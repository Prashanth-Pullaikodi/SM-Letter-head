/*************************************************************************************************
 * CORPORATE LETTERHEAD DOCUMENT GENERATOR  —  Google Apps Script Web App (Backend)
 * ------------------------------------------------------------------------------------------------
 * Flow:
 *   1. doGet()            -> serves Index.html (the web form).
 *   2. generateLetter()   -> copies a template Doc, replaces placeholders ({RECIPIENT_DATA},
 *                            {LETTER_BODY}), exports to PDF, deletes the temp copy, and returns
 *                            the PDF as a base64 string for instant client-side download.
 *   3. RBAC               -> every protected call is gated by the "Users" sheet (Name/Email/Role).
 *   4. setup()            -> one-time bootstrap that creates the "Users" sheet + sample data.
 *
 * >>> STEP 1: Configure your templates in TEMPLATES below (Doc-based or built-in-code).
 * >>> STEP 2: Run setup() once from the editor, authorise the scopes, then add real users.
 * >>> STEP 3: Deploy > New deployment > Web app (Execute as: Me, Access: Anyone in your org).
 *************************************************************************************************/

/* ============================================================================================
 *  CONFIGURATION  —  EDIT THESE VALUES
 * ============================================================================================ */

// 1) Paste each template's Google Doc ID here. The KEY must match the dropdown value in Index.html.
//    The ID is the long string in the Doc URL: docs.google.com/document/d/<<<THIS_PART>>>/edit
//    Each template is ONE of:
//      type:'doc'     -> uses a Google Doc you designed; set its docId. Supports RICH body text.
//      type:'slides'  -> uses a Google Slides deck (e.g. an imported .pptx); set its slidesId.
//                        Body is inserted as PLAIN text (Slides can't take rich formatting).
//      type:'builtin' -> the letterhead is built in code (no file needed); set companyName,
//                        tagline, color (brand hex), and footer.
//    You can mix all kinds freely. The KEY (e.g. 'official') must match the dropdown value.
//    Both Doc and Slides templates must contain {RECIPIENT_DATA} and {LETTER_BODY} as text.
const TEMPLATES = {
  'official': {
    label: 'Official Corporate',
    type: 'doc',
    docId: '1cibOjVGWxfG7rE0eXoaupNy3bwYE8FlOji400Xf5pus'   // <-- your Google Doc ID
  },
  'marketing': {
    label: 'Marketing / Pitch',
    type: 'builtin',
    companyName: 'SM CORPORATION',
    tagline: 'Innovate. Pitch. Win.',
    color: '#c8a04a',
    footer: 'SM Corporation   |   www.smcorp.com   |   hello@smcorp.com'
  },
  'memo': {
    label: 'Internal Memo',
    type: 'builtin',
    companyName: 'INTERNAL MEMORANDUM',
    tagline: 'SM Corporation',
    color: '#1a237e',
    footer: 'Confidential - Internal Use Only'
  }
};

// 3) Name of the sheet that stores the RBAC user list.
const USERS_SHEET_NAME = 'Users';

// 4) Roles that are allowed to generate letters. (Everyone listed can generate; you can tighten
//    this further per-template if you wish — see roleCanUseTemplate() below.)
const ROLES_ALLOWED_TO_GENERATE = ['Admin', 'Manager', 'Staff'];

// 5) Optional: restrict specific templates to specific roles. Leave a template out = all roles.
const TEMPLATE_ROLE_RESTRICTIONS = {
  // 'memo': ['Admin', 'Manager']   // e.g. only Admins/Managers may issue Internal Memos
};

// 6) FORM FIELDS -> template placeholders.
//    Each field's `tag` becomes the placeholder {TAG} you put in your Doc/Slides template box.
//    The web form builds an input for every field automatically. Add/remove to match your boxes.
//    type: 'text' (single line) | 'textarea' (multi-line) | 'rich' (the styled editor; use ONE).
//    e.g. put {RECIPIENT_NAME} in the name box, {RECIPIENT_ADDRESS} in the address box, etc.
const FIELDS = [
  { tag: 'RECIPIENT_NAME',    label: 'Recipient Name',     type: 'text',     required: true  },
  { tag: 'RECIPIENT_COMPANY', label: 'Recipient Company',  type: 'text',     required: false },
  { tag: 'RECIPIENT_ADDRESS', label: 'Recipient Address',  type: 'textarea', required: false },
  { tag: 'SUBJECT',           label: 'Subject',            type: 'text',     required: false },
  { tag: 'LETTER_BODY',       label: 'Letter Content',     type: 'rich',     required: true  }
];

function fieldDef_(tag) {
  for (var i = 0; i < FIELDS.length; i++) if (FIELDS[i].tag === tag) return FIELDS[i];
  return null;
}


/**
 * RUN THIS ONCE to grant all permissions (Docs + Slides + Sheets + Drive) in a single consent.
 * Because Apps Script authorizes lazily (only the scopes the run function uses), running setup()
 * never asks for Slides. This function actively touches every service, so running it forces the
 * full authorization prompt — including "Google Slides presentations". Click Allow, then redeploy.
 */
function authorizeAll() {
  // Sheets + Drive scopes
  SpreadsheetApp.getActiveSpreadsheet();
  DriveApp.getRootFolder().getName();

  // Docs scope (create a temp doc, then delete it)
  var tmpDoc = DocumentApp.create('TEMP_auth_check');
  DriveApp.getFileById(tmpDoc.getId()).setTrashed(true);

  // Slides scope — actively call SlidesApp so the "presentations" permission is requested.
  var tmpSlides = SlidesApp.create('TEMP_auth_check');
  DriveApp.getFileById(tmpSlides.getId()).setTrashed(true);

  Logger.log('authorizeAll complete. All scopes granted. Now Deploy > New version.');
}


/* ============================================================================================
 *  WEB APP ENTRY POINT
 * ============================================================================================ */

/**
 * Serves the HTML web form. Instrumented with logging so the Executions panel shows exactly
 * what happened: which account hit it, and whether the HTML was served. If anything throws,
 * the error is logged AND rendered to the page instead of a blank failure.
 */
function doGet(e) {
  try {
    Logger.log('doGet START | activeUser=%s | effectiveUser=%s | params=%s',
      Session.getActiveUser().getEmail() || '(empty)',
      Session.getEffectiveUser().getEmail() || '(empty)',
      e ? JSON.stringify(e.parameter) : '(no event)');

    // NOTE: Do NOT call setXFrameOptionsMode(ALLOWALL) here. Removing the frame-protection
    // header makes the browser reject Google's sandbox iframe, which renders as a blank
    // "Access Denied" page even though the server served the HTML fine. Use the default.
    var out = HtmlService.createHtmlOutputFromFile('Index')
      .setTitle('Corporate Letterhead Generator');

    Logger.log('doGet OK | Index.html served successfully');
    return out;
  } catch (err) {
    Logger.log('doGet ERROR | ' + (err && err.stack ? err.stack : err));
    return HtmlService.createHtmlOutput(
      '<h2 style="font-family:sans-serif;color:#c00">doGet failed</h2>' +
      '<pre style="font-family:monospace">' + (err && err.message ? err.message : err) + '</pre>');
  }
}


/* ============================================================================================
 *  RBAC  —  ROLE BASED ACCESS CONTROL
 * ============================================================================================ */

/**
 * Returns the Users sheet from the bound spreadsheet. Throws a clear error if the script isn't
 * bound to a sheet or setup() hasn't been run yet.
 */
function getUsersSheet_() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  if (!ss) {
    throw new Error('No bound spreadsheet found. This script must be created from inside a ' +
      'Google Sheet (Extensions > Apps Script), then run setup().');
  }
  var sheet = ss.getSheetByName(USERS_SHEET_NAME);
  if (!sheet) {
    throw new Error('The "' + USERS_SHEET_NAME + '" sheet was not found. Run setup() once first.');
  }
  return sheet;
}

/**
 * Returns the active user's record from the Users sheet, or null if they are not authorised.
 * Uses Session.getActiveUser() — the verified Google identity, which cannot be spoofed by the
 * client — so the access check is enforced server-side and is secure.
 */
function getAuthorisedUser_() {
  const email = (Session.getActiveUser().getEmail() || '').trim().toLowerCase();
  if (!email) return null;

  const sheet = getUsersSheet_();
  const rows = sheet.getDataRange().getValues();
  if (rows.length < 2) return null;

  // Header row -> column index map (case-insensitive).
  const header = rows[0].map(function (h) { return String(h).trim().toLowerCase(); });
  const iName = header.indexOf('name');
  const iEmail = header.indexOf('email');
  const iRole = header.indexOf('role');
  if (iEmail === -1 || iRole === -1) return null;

  for (var r = 1; r < rows.length; r++) {
    var rowEmail = String(rows[r][iEmail] || '').trim().toLowerCase();
    if (rowEmail && rowEmail === email) {
      return {
        name: iName !== -1 ? String(rows[r][iName] || '').trim() : '',
        email: rowEmail,
        role: String(rows[r][iRole] || '').trim()
      };
    }
  }
  return null;
}

/**
 * True if the given role may generate the given template.
 */
function roleCanUseTemplate_(role, templateKey) {
  if (ROLES_ALLOWED_TO_GENERATE.indexOf(role) === -1) return false;
  var restriction = TEMPLATE_ROLE_RESTRICTIONS[templateKey];
  if (restriction && restriction.indexOf(role) === -1) return false;
  return true;
}

/**
 * Called by the frontend on load. Returns the user's identity + which templates they may use,
 * so the UI can show their name and hide forbidden templates. Never throws — returns a status.
 */
function getSessionInfo() {
  Logger.log('getSessionInfo START | activeUser=%s',
    Session.getActiveUser().getEmail() || '(empty)');
  var user = getAuthorisedUser_();
  if (!user) {
    return {
      authorised: false,
      email: (Session.getActiveUser().getEmail() || ''),
      message: 'Your account is not registered for the Letterhead Generator. Contact an administrator.'
    };
  }
  var allowed = [];
  Object.keys(TEMPLATES).forEach(function (key) {
    if (roleCanUseTemplate_(user.role, key)) {
      allowed.push({ key: key, label: TEMPLATES[key].label });
    }
  });
  return {
    authorised: true,
    name: user.name,
    email: user.email,
    role: user.role,
    templates: allowed,
    fields: FIELDS
  };
}


/* ============================================================================================
 *  MAIN: GENERATE LETTER  ->  PDF (base64)
 * ============================================================================================ */

/**
 * Generates a letterhead PDF from a template.
 * @param {Object} formData { template, recipient, bodyHtml }
 * @return {Object} { ok:true, base64, fileName } on success, or { ok:false, error } on failure.
 */
function generateLetter(formData) {
  try {
    // ---- 1. AUTHORISE (server-side, cannot be bypassed by the client) --------------------
    var user = getAuthorisedUser_();
    if (!user) {
      return { ok: false, error: 'Access denied: your account is not authorised.' };
    }

    // ---- 2. VALIDATE INPUT ----------------------------------------------------------------
    formData = formData || {};
    var templateKey = String(formData.template || '').trim();
    var fields = formData.fields || {};

    if (!templateKey) return { ok: false, error: 'Please select a template.' };

    // Validate required fields (rich fields are checked by their stripped text).
    var missing = [];
    FIELDS.forEach(function (f) {
      if (!f.required) return;
      var raw = String(fields[f.tag] || '');
      var text = (f.type === 'rich') ? stripHtml_(raw).trim() : raw.trim();
      if (!text) missing.push(f.label);
    });
    if (missing.length) {
      return { ok: false, error: 'Please fill in: ' + missing.join(', ') + '.' };
    }
    if (!roleCanUseTemplate_(user.role, templateKey)) {
      return { ok: false, error: 'Your role (' + user.role + ') may not use this template.' };
    }

    var tpl = TEMPLATES[templateKey];
    if (!tpl) {
      return { ok: false, error: 'Template "' + templateKey + '" is not configured in Code.gs.' };
    }

    // ---- 3. RENDER THE PDF (dispatch by template type) ------------------------------------
    var pdfBlob;
    if (tpl.type === 'doc') {
      if (!tpl.docId || tpl.docId.indexOf('PASTE_') === 0) {
        return { ok: false, error: 'Template "' + tpl.label + '" has no Doc ID set in Code.gs.' };
      }
      pdfBlob = renderFromDocTemplate_(tpl.docId, fields, user, tpl.label);
    } else if (tpl.type === 'slides') {
      if (!tpl.slidesId || tpl.slidesId.indexOf('PASTE_') === 0) {
        return { ok: false, error: 'Template "' + tpl.label + '" has no Slides ID set in Code.gs.' };
      }
      pdfBlob = renderFromSlidesTemplate_(tpl.slidesId, fields, user, tpl.label);
    } else {
      pdfBlob = renderFromBuiltinTemplate_(tpl, fields);
    }

    // ---- 4. LOG (audit trail) -------------------------------------------------------------
    logGeneration_(user, templateKey);

    // ---- 5. RETURN AS BASE64 --------------------------------------------------------------
    return {
      ok: true,
      fileName: 'Generated_Letterhead.pdf',
      base64: Utilities.base64Encode(pdfBlob.getBytes())
    };

  } catch (err) {
    return { ok: false, error: 'Server error: ' + (err && err.message ? err.message : err) };
  }
}

/**
 * Opens a template file by ID, converting Drive's cryptic "Document is missing" / access errors
 * into a clear, actionable message that names the template and the likely fix.
 */
function getTemplateFile_(fileId, label) {
  try {
    return DriveApp.getFileById(fileId);
  } catch (e) {
    throw new Error('Template "' + label + '" could not be opened (ID: ' + fileId + '). ' +
      'Make sure the file still exists (not trashed) and is owned by, or shared with, the ' +
      'Google account that runs this web app. Then redeploy a new version.');
  }
}

/**
 * Replaces every {TAG} placeholder in a Google Doc body with its field value. Rich fields are
 * inserted with formatting; all other fields are replaced as plain text. Empty fields clear the
 * placeholder so no stray {TAG} is left behind.
 */
function applyFieldsToDoc_(body, fields) {
  FIELDS.forEach(function (f) {
    var val = String(fields[f.tag] == null ? '' : fields[f.tag]);
    if (f.type === 'rich') {
      insertRichBody_(body, '{' + f.tag + '}', val);
    } else {
      body.replaceText('\\{' + f.tag + '\\}', escapeForReplace_(val));
    }
  });
}

/**
 * Replaces every {TAG} in a Slides deck with its field value (plain text only — Slides can't
 * take rich formatting, so rich fields are flattened to text).
 */
function applyFieldsToSlides_(pres, fields) {
  FIELDS.forEach(function (f) {
    var val = String(fields[f.tag] == null ? '' : fields[f.tag]);
    // Rich field: convert HTML to text but KEEP line breaks/paragraphs (Slides honors \n).
    if (f.type === 'rich') val = htmlToText_(val);
    pres.replaceAllText('{' + f.tag + '}', val);
  });
}

/**
 * DOC TEMPLATE: copy the Doc, replace all {TAG} placeholders, export PDF, delete copy.
 */
function renderFromDocTemplate_(docId, fields, user, label) {
  var copy = getTemplateFile_(docId, label).makeCopy('TEMP_Letter_' + user.email + '_' + Date.now());
  var copyId = copy.getId();
  try {
    var doc = DocumentApp.openById(copyId);
    applyFieldsToDoc_(doc.getBody(), fields);
    doc.saveAndClose();
    return DriveApp.getFileById(copyId).getAs('application/pdf').setName('Generated_Letterhead.pdf');
  } finally {
    try { DriveApp.getFileById(copyId).setTrashed(true); } catch (e) {}
  }
}

/**
 * SLIDES TEMPLATE: copy the deck, replace all {TAG} placeholders (plain text), export PDF, delete.
 */
function renderFromSlidesTemplate_(slidesId, fields, user, label) {
  var copy = getTemplateFile_(slidesId, label).makeCopy('TEMP_Letter_' + user.email + '_' + Date.now());
  var copyId = copy.getId();
  try {
    var pres = SlidesApp.openById(copyId);
    applyFieldsToSlides_(pres, fields);
    pres.saveAndClose();
    return DriveApp.getFileById(copyId).getAs('application/pdf').setName('Generated_Letterhead.pdf');
  } finally {
    try { DriveApp.getFileById(copyId).setTrashed(true); } catch (e) {}
  }
}

/**
 * BUILT-IN TEMPLATE: build a branded letterhead entirely in code (no file to maintain). The
 * recipient block is composed from all non-rich fields (in order), and the rich field becomes
 * the letter body.
 */
function renderFromBuiltinTemplate_(tpl, fields) {
  var doc = DocumentApp.create('TEMP_Letter_' + Date.now());
  var docId = doc.getId();
  try {
    var color = tpl.color || '#1a237e';
    var body = doc.getBody();
    body.setMarginTop(56).setMarginBottom(56).setMarginLeft(64).setMarginRight(64);

    // --- Header (repeats on every page) ---
    var header = doc.addHeader();
    header.appendParagraph(tpl.companyName || 'SM CORPORATION')
      .setForegroundColor(color).setBold(true).setFontSize(20);
    if (tpl.tagline) {
      header.appendParagraph(tpl.tagline).setForegroundColor('#777777').setFontSize(9).setBold(false);
    }
    header.appendHorizontalRule();

    // --- Footer ---
    if (tpl.footer) {
      doc.addFooter().appendParagraph(tpl.footer)
        .setForegroundColor('#888888').setFontSize(8)
        .setAlignment(DocumentApp.HorizontalAlignment.CENTER);
    }

    // --- Body: date, recipient block (non-rich fields), then rich content ---
    body.appendParagraph(
      Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'MMMM d, yyyy'))
      .setAlignment(DocumentApp.HorizontalAlignment.RIGHT).setForegroundColor('#444444');

    var bodyHtml = '';
    FIELDS.forEach(function (f) {
      var val = String(fields[f.tag] == null ? '' : fields[f.tag]);
      if (f.type === 'rich') { bodyHtml = val; return; }
      if (!val.trim()) return;
      val.split('\n').forEach(function (line) {
        body.appendParagraph(line).setForegroundColor('#000000');
      });
    });
    body.appendParagraph('');

    // Rich letter body is inserted at this placeholder, which is then removed.
    body.appendParagraph('{LETTER_BODY}');
    insertRichBody_(body, '{LETTER_BODY}', bodyHtml);

    doc.saveAndClose();
    return DriveApp.getFileById(docId).getAs('application/pdf').setName('Generated_Letterhead.pdf');
  } finally {
    try { DriveApp.getFileById(docId).setTrashed(true); } catch (e) {}
  }
}


/* ============================================================================================
 *  RICH TEXT  ->  GOOGLE DOC INSERTION
 * --------------------------------------------------------------------------------------------
 *  Parses the editor's HTML and rebuilds it as formatted Google Doc paragraphs at the
 *  {LETTER_BODY} placeholder. Supports: <p> <br> <div> <h1-3> <b>/<strong> <i>/<em> <u>
 *  <span style="color/background-color/font-size/font-family"> <ul>/<ol>/<li> and text-align.
 * ============================================================================================ */

/**
 * Finds the paragraph containing the placeholder, then replaces it with rendered HTML content.
 */
function insertRichBody_(body, placeholder, html) {
  var found = body.findText(escapeRegex_(placeholder));
  if (!found) return; // placeholder not present; nothing to do.

  var element = found.getElement();
  var paragraph = element.getParent();
  // Walk up to a paragraph/list-item level element.
  while (paragraph && paragraph.getType() !== DocumentApp.ElementType.PARAGRAPH &&
         paragraph.getType() !== DocumentApp.ElementType.LIST_ITEM) {
    paragraph = paragraph.getParent();
  }
  if (!paragraph) return;

  var parent = paragraph.getParent();
  var insertAt = parent.getChildIndex(paragraph);

  // Parse HTML into a flat list of block descriptors.
  var blocks = parseHtmlToBlocks_(html);

  // Insert each parsed block just before the placeholder paragraph.
  blocks.forEach(function (block) {
    if (block.type === 'list') {
      var p = parent.insertListItem(insertAt++, '');
      p.setGlyphType(block.ordered ? DocumentApp.GlyphType.NUMBER
                                   : DocumentApp.GlyphType.BULLET);
      applyRuns_(p, block.runs);
    } else {
      var par = parent.insertParagraph(insertAt++, '');
      if (block.heading) par.setHeading(block.heading);
      if (block.align) par.setAlignment(block.align);
      applyRuns_(par, block.runs);
    }
  });

  // Remove the original placeholder paragraph.
  try { parent.removeChild(paragraph); } catch (e) {}
}

/**
 * Applies an array of styled text "runs" to a paragraph / list item.
 */
function applyRuns_(para, runs) {
  if (!runs || !runs.length) return;
  runs.forEach(function (run) {
    if (run.text === '') return;
    var t = para.appendText(run.text);
    var start = t.getText().length - run.text.length;
    var end = t.getText().length - 1;
    if (end < start) return;
    if (run.bold)      t.setBold(start, end, true);
    if (run.italic)    t.setItalic(start, end, true);
    if (run.underline) t.setUnderline(start, end, true);
    if (run.color)     t.setForegroundColor(start, end, run.color);
    if (run.bg)        t.setBackgroundColor(start, end, run.bg);
    if (run.size)      t.setFontSize(start, end, run.size);
    if (run.font)      t.setFontFamily(start, end, run.font);
  });
}

/**
 * Lightweight HTML walker. Returns an ordered array of block descriptors:
 *   { type:'para'|'list', ordered:bool, heading:Heading, align:Alignment, runs:[ {text,...style} ] }
 * Uses XmlService on a sanitised XHTML wrapper so we never depend on external libraries.
 */
function parseHtmlToBlocks_(html) {
  var xhtml = htmlToXhtml_(html);
  var blocks = [];
  var root;
  try {
    root = XmlService.parse('<root>' + xhtml + '</root>').getRootElement();
  } catch (e) {
    // Fallback: treat the whole thing as one plain paragraph.
    return [{ type: 'para', runs: [{ text: stripHtml_(html) }] }];
  }

  walkNodes_(root, { bold: false, italic: false, underline: false }, blocks, false);

  // Ensure at least one block exists.
  if (!blocks.length) blocks.push({ type: 'para', runs: [{ text: '' }] });
  return blocks;
}

/**
 * Recursive node walker. `inline` style is inherited; block elements start new blocks.
 */
function walkNodes_(node, style, blocks, inList) {
  var children = node.getAllContent();
  for (var i = 0; i < children.length; i++) {
    var child = children[i];
    var type = child.getType();

    if (type === XmlService.ContentTypes.TEXT) {
      var text = child.getValue();
      if (text) {
        var blk = currentBlock_(blocks);
        blk.runs.push(makeRun_(text, style));
      }
      continue;
    }
    if (type !== XmlService.ContentTypes.ELEMENT) continue;

    var el = child.asElement();
    var name = el.getName().toLowerCase();
    var newStyle = cloneStyle_(style);
    applyTagStyle_(name, el, newStyle);

    if (name === 'br') {
      blocks.push(newBlock_('para'));
      continue;
    }

    if (name === 'p' || name === 'div' || /^h[1-6]$/.test(name)) {
      var b = newBlock_('para');
      b.align = readAlign_(el);
      if (/^h[1-6]$/.test(name)) b.heading = headingFor_(name);
      blocks.push(b);
      walkNodes_(el, newStyle, blocks, false);
      continue;
    }

    if (name === 'ul' || name === 'ol') {
      walkListItems_(el, newStyle, blocks, name === 'ol');
      continue;
    }

    // Inline element (span, b, i, u, strong, em, font, a, etc.) -> keep same block.
    walkNodes_(el, newStyle, blocks, inList);
  }
}

function walkListItems_(listEl, style, blocks, ordered) {
  var items = listEl.getChildren('li');
  // XmlService getChildren needs namespace-less names; iterate generically instead.
  var all = listEl.getAllContent();
  for (var i = 0; i < all.length; i++) {
    if (all[i].getType() !== XmlService.ContentTypes.ELEMENT) continue;
    var li = all[i].asElement();
    if (li.getName().toLowerCase() !== 'li') continue;
    var b = newBlock_('list');
    b.ordered = ordered;
    blocks.push(b);
    walkNodes_(li, cloneStyle_(style), blocks, true);
  }
}

/* ---- block/style helpers ---- */

function newBlock_(type) { return { type: type, ordered: false, heading: null, align: null, runs: [] }; }

function currentBlock_(blocks) {
  if (!blocks.length) blocks.push(newBlock_('para'));
  return blocks[blocks.length - 1];
}

function cloneStyle_(s) {
  return {
    bold: s.bold, italic: s.italic, underline: s.underline,
    color: s.color, bg: s.bg, size: s.size, font: s.font
  };
}

function makeRun_(text, s) {
  return {
    text: decodeEntities_(text),
    bold: s.bold, italic: s.italic, underline: s.underline,
    color: s.color, bg: s.bg, size: s.size, font: s.font
  };
}

function applyTagStyle_(name, el, style) {
  if (name === 'b' || name === 'strong') style.bold = true;
  if (name === 'i' || name === 'em') style.italic = true;
  if (name === 'u') style.underline = true;

  var styleAttr = el.getAttribute('style');
  if (styleAttr) {
    var css = String(styleAttr.getValue()).toLowerCase();
    parseInlineCss_(css, style);
  }
  var colorAttr = el.getAttribute('color');
  if (colorAttr) style.color = normaliseColor_(colorAttr.getValue());
  var faceAttr = el.getAttribute('face');
  if (faceAttr) style.font = String(faceAttr.getValue()).split(',')[0].trim();
}

function parseInlineCss_(css, style) {
  css.split(';').forEach(function (decl) {
    var parts = decl.split(':');
    if (parts.length < 2) return;
    var prop = parts[0].trim();
    var val = parts.slice(1).join(':').trim();
    if (prop === 'color') style.color = normaliseColor_(val);
    else if (prop === 'background-color') style.bg = normaliseColor_(val);
    else if (prop === 'font-weight' && (val === 'bold' || parseInt(val, 10) >= 600)) style.bold = true;
    else if (prop === 'font-style' && val === 'italic') style.italic = true;
    else if (prop === 'text-decoration' && val.indexOf('underline') !== -1) style.underline = true;
    else if (prop === 'font-size') { var n = parseFloat(val); if (n) style.size = Math.round(val.indexOf('px') !== -1 ? n * 0.75 : n); }
    else if (prop === 'font-family') style.font = val.split(',')[0].replace(/['"]/g, '').trim();
  });
}

function readAlign_(el) {
  var styleAttr = el.getAttribute('style');
  var align = '';
  if (styleAttr) {
    var m = String(styleAttr.getValue()).toLowerCase().match(/text-align\s*:\s*(left|right|center|justify)/);
    if (m) align = m[1];
  }
  var alignAttr = el.getAttribute('align');
  if (alignAttr) align = String(alignAttr.getValue()).toLowerCase();
  switch (align) {
    case 'center': return DocumentApp.HorizontalAlignment.CENTER;
    case 'right': return DocumentApp.HorizontalAlignment.RIGHT;
    case 'justify': return DocumentApp.HorizontalAlignment.JUSTIFY;
    case 'left': return DocumentApp.HorizontalAlignment.LEFT;
    default: return null;
  }
}

function headingFor_(name) {
  switch (name) {
    case 'h1': return DocumentApp.ParagraphHeading.HEADING1;
    case 'h2': return DocumentApp.ParagraphHeading.HEADING2;
    case 'h3': return DocumentApp.ParagraphHeading.HEADING3;
    default: return DocumentApp.ParagraphHeading.HEADING4;
  }
}

/**
 * Converts loose browser HTML into well-formed XHTML that XmlService can parse:
 *  - self-closes void elements (<br>, <hr>, <img>)
 *  - strips comments / scripts / styles
 *  - normalises ampersands
 */
function htmlToXhtml_(html) {
  var s = String(html);
  s = s.replace(/<!--[\s\S]*?-->/g, '');
  s = s.replace(/<script[\s\S]*?<\/script>/gi, '');
  s = s.replace(/<style[\s\S]*?<\/style>/gi, '');
  // Self-close void elements.
  s = s.replace(/<(br|hr|img|input|meta|link)([^>]*?)\/?>/gi, '<$1$2/>');
  // Encode stray ampersands (not part of an entity).
  s = s.replace(/&(?!#?[a-zA-Z0-9]+;)/g, '&amp;');
  return s;
}

/* ---- text utilities ---- */

function stripHtml_(html) {
  return decodeEntities_(String(html).replace(/<[^>]*>/g, ' '));
}

/**
 * Converts editor HTML to plain text but PRESERVES structure as line breaks:
 * <br> and the END of block elements (</p>, </div>, </li>, headings) become newlines;
 * list items get a bullet prefix. Used for Slides bodies so paragraphs don't collapse.
 */
function htmlToText_(html) {
  var s = String(html);
  s = s.replace(/<!--[\s\S]*?-->/g, '');
  s = s.replace(/<\s*br\s*\/?\s*>/gi, '\n');               // line breaks
  s = s.replace(/<\s*li[^>]*>/gi, '• ');              // bullet prefix
  s = s.replace(/<\/\s*(p|div|li|h[1-6]|tr|ul|ol|blockquote)\s*>/gi, '\n'); // end of blocks
  s = s.replace(/<[^>]+>/g, '');                            // strip any remaining tags
  s = decodeEntities_(s);
  s = s.replace(/\r/g, '');
  s = s.replace(/[ \t]+\n/g, '\n');                         // trim trailing spaces on lines
  s = s.replace(/\n[ \t]+/g, '\n');                         // trim leading spaces on lines
  s = s.replace(/[ \t]{2,}/g, ' ');                         // collapse runs of spaces
  s = s.replace(/\n{3,}/g, '\n\n');                         // cap blank lines
  return s.replace(/^\n+|\n+$/g, '');                       // trim leading/trailing newlines
}

function decodeEntities_(s) {
  return String(s)
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&#(\d+);/g, function (_, n) { return String.fromCharCode(parseInt(n, 10)); });
}

function normaliseColor_(val) {
  val = String(val).trim();
  if (/^#[0-9a-fA-F]{6}$/.test(val)) return val.toLowerCase();
  if (/^#[0-9a-fA-F]{3}$/.test(val)) {
    return ('#' + val[1] + val[1] + val[2] + val[2] + val[3] + val[3]).toLowerCase();
  }
  var m = val.match(/rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)/i);
  if (m) {
    return '#' + [m[1], m[2], m[3]].map(function (x) {
      var h = parseInt(x, 10).toString(16);
      return h.length === 1 ? '0' + h : h;
    }).join('');
  }
  var named = { black: '#000000', white: '#ffffff', red: '#ff0000', green: '#008000',
    blue: '#0000ff', yellow: '#ffff00', gray: '#808080', grey: '#808080',
    orange: '#ffa500', purple: '#800080' };
  return named[val.toLowerCase()] || null;
}

function escapeRegex_(s) { return String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); }

/** Replacement strings for Text Finder treat $ specially; escape it. */
function escapeForReplace_(s) { return String(s).replace(/\$/g, '\\$'); }


/* ============================================================================================
 *  AUDIT LOG
 * ============================================================================================ */

function logGeneration_(user, templateKey) {
  try {
    var ss = SpreadsheetApp.getActiveSpreadsheet();
    var log = ss.getSheetByName('Log');
    if (!log) {
      log = ss.insertSheet('Log');
      log.appendRow(['Timestamp', 'Name', 'Email', 'Role', 'Template']);
      log.getRange(1, 1, 1, 5).setFontWeight('bold');
    }
    var label = (TEMPLATES[templateKey] && TEMPLATES[templateKey].label) || templateKey;
    log.appendRow([new Date(), user.name, user.email, user.role, label]);
  } catch (e) { /* logging must never break generation */ }
}


/* ============================================================================================
 *  SETUP  —  RUN ONCE FROM THE EDITOR
 * ============================================================================================ */

/**
 * Creates (or resets) the Users sheet with headers + sample data, secures it, and creates the
 * Log sheet. Run this ONCE after first opening the bound spreadsheet, then replace the sample
 * rows with your real staff. The sheet owner (you) always retains full access.
 */
function setup() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  if (!ss) {
    throw new Error('setup() must be run from a Spreadsheet-bound script. ' +
      'Create a Google Sheet, open Extensions > Apps Script, paste this code, then run setup().');
  }

  // ---- Users sheet ----
  var sheet = ss.getSheetByName(USERS_SHEET_NAME);
  if (!sheet) sheet = ss.insertSheet(USERS_SHEET_NAME);
  sheet.clear();

  var header = ['Name', 'Email', 'Role'];
  sheet.getRange(1, 1, 1, header.length).setValues([header])
    .setFontWeight('bold').setBackground('#1a237e').setFontColor('#ffffff');

  var ownerEmail = Session.getEffectiveUser().getEmail();
  var sample = [
    ['Site Owner', ownerEmail, 'Admin'],
    ['Jane Manager', 'jane.manager@example.com', 'Manager'],
    ['John Staff', 'john.staff@example.com', 'Staff']
  ];
  sheet.getRange(2, 1, sample.length, 3).setValues(sample);

  // Data validation on the Role column (drop-down) so roles stay consistent.
  var roleRule = SpreadsheetApp.newDataValidation()
    .requireValueInList(['Admin', 'Manager', 'Staff'], true)
    .setAllowInvalid(false).build();
  sheet.getRange(2, 3, sheet.getMaxRows() - 1, 1).setDataValidation(roleRule);

  sheet.setFrozenRows(1);
  sheet.autoResizeColumns(1, 3);

  // ---- SECURITY: protect the Users sheet so only the owner can edit who has access ----
  var protections = sheet.getProtections(SpreadsheetApp.ProtectionType.SHEET);
  protections.forEach(function (p) { if (p.canEdit()) p.remove(); });
  var protection = sheet.protect()
    .setDescription('RBAC user list — restricted. Only owner/admins may edit.');
  // Remove all editors except the effective user (owner). This prevents staff from
  // self-elevating by editing the access list, even if they can open the spreadsheet.
  protection.removeEditors(protection.getEditors().map(function (u) { return u.getEmail(); }));
  if (protection.canDomainEdit()) protection.setDomainEdit(false);

  // ---- Log sheet ----
  if (!ss.getSheetByName('Log')) {
    var log = ss.insertSheet('Log');
    log.appendRow(['Timestamp', 'Name', 'Email', 'Role', 'Template']);
    log.getRange(1, 1, 1, 5).setFontWeight('bold').setBackground('#1a237e').setFontColor('#ffffff');
    log.setFrozenRows(1);
  }

  SpreadsheetApp.getUi && SpreadsheetApp.flush();
  Logger.log('Setup complete. Users sheet created and protected. Replace sample rows with real staff.');
}
