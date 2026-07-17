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
  'General': {
    label: 'Official Corporate Letterhead',
    type: 'slides',
    slidesId: '1Ux5sBKlJ-sLaHPgnaH953SJ1RH6ReOSylLEQFKpGeMc'   // Google Slides ID
  },
  'Proposal': {
    label: 'Room_Booking_Events_Proposal',
    type: 'doc',
    docId: '1B-VJIgQqB9usg-8E_OQRw3Gdu5cvjJ7N'   // NOTE: must be a NATIVE Google Doc, not a .docx
  },
  'marketing': {
    label: 'Marketing / Pitch',
    type: 'builtin',
    companyName: 'SandalMist Resort & Spa',
    tagline: 'The Hill Top habitat',
    color: '#c8a04a',
    footer: 'SandalMist Resort & Spa   |   www.sandalmistresort.com   |   info@sandalmistresort.com'
  },
  'memo': {
    label: 'Internal Memo',
    type: 'builtin',
    companyName: 'SandalMist Resort & Spa',
    tagline: 'The Hill Top habitat',
    color: '#1a237e',
    footer: 'Confidential - Internal Use Only'
  },
  'invoice_gst': {
    label: 'Guest Invoice (with GST)',
    type: 'doc',
    form: 'invoice',
    gst: true,                                         // shows GST fields & adds GST to totals
    docId: 'PASTE_INVOICE_GST_GOOGLE_DOC_ID_HERE'      // import 05_Guest_Invoice_GST.docx, convert, paste ID
  },
  'invoice_nogst': {
    label: 'Guest Invoice (no GST)',
    type: 'doc',
    form: 'invoice',
    docId: 'PASTE_INVOICE_NOGST_GOOGLE_DOC_ID_HERE'    // import 06_Guest_Invoice_NoGST.docx, convert, paste ID
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

// Proposal document palette (matches the approved cream/copper design).
var PROP_SLATE = '#39434b', PROP_COPPER = '#b06a3a', PROP_GOLD = '#c9a24b',
    PROP_CREAM = '#f7f3ec', PROP_ZEBRA = '#faf7f2', PROP_LINE = '#e7e0d5',
    PROP_INK = '#22303c', PROP_MUTED = '#8f897f', PROP_TEXT = '#413d37';

// 7) COMPANY details — used to brand the code-built Proposal (header/footer/GST). Edit freely.
const COMPANY = {
  name: 'SandalMist Resort & Spa',
  tagline: 'The Hill Top Habitat',
  address: '12/374, Sankar Hills, Munnad, Kasaragod, Kerala, 671541, India',
  phone: '+91 97784 34442',
  email: 'info@sandalmistresort.com',
  website: 'www.sandalmistresort.com',
  gstin: '32AARFB1365N1Z6',
  brandColor: '#1f4d46',
  accent: '#c9a24b'
};

// 8) Default Terms & Conditions prefilled in the Proposal builder (one per line; editable there).
const DEFAULT_TERMS = [
  '50% advance is required to confirm the booking; balance payable on arrival.',
  'Prices are valid until the date mentioned above and subject to availability.',
  'GST is charged as applicable and shown separately.',
  'Cancellation charges apply as per resort policy.'
];

// 6) FORMS -> each form is a tab in the app with its own set of fields. A template belongs to a
//    form via its `form` property (default 'letter'). Each field's `tag` becomes the placeholder
//    {TAG} you put in the template. type: 'text' | 'textarea' | 'rich' (styled editor; max one).
//    A form with `custom:true` (e.g. proposal) is rendered by a bespoke UI, not the generic fields.
const FORMS = {
  letter: {
    label: 'Letter',
    fields: [
      { tag: 'RECIPIENT_NAME',    label: 'Recipient Name',    type: 'text',     required: true,
        placeholder: 'e.g. Mr. Ramesh Kumar' },
      { tag: 'RECIPIENT_COMPANY', label: 'Recipient Company', type: 'text',     required: false,
        placeholder: 'e.g. Nexus Technologies Pvt. Ltd.' },
      { tag: 'DATE',              label: 'Date',              type: 'text',     required: false, default: 'today',
        placeholder: 'e.g. 26 June 2026' },
      { tag: 'SUBJECT',           label: 'Subject',           type: 'text',     required: false,
        placeholder: 'e.g. Buffet Pricing Proposal for your event' },
      { tag: 'LETTER_BODY',       label: 'Letter Content',    type: 'rich',     required: true,
        placeholder: 'Type your letter here. Select text and use the toolbar to make it Bold, ' +
                     'change colour/font, align, or add bullet lists. Press Enter for a new paragraph.' }
    ]
  },
  invoice: {
    label: 'Invoice',
    fields: [
      { tag: 'INVOICE_NO',   label: 'Invoice No.',     type: 'text',   required: false, auto: 'invoiceNo',
        placeholder: 'auto-generated (you can edit)' },
      { tag: 'INVOICE_DATE', label: 'Invoice Date',    type: 'date',   required: false, default: 'today' },
      { tag: 'GUEST_NAME',   label: 'Guest Name',      type: 'text',   required: true,
        placeholder: 'e.g. Vivek' },
      { tag: 'CHECK_IN',     label: 'Check-in Date',   type: 'date',   required: false },
      { tag: 'CHECK_OUT',    label: 'Check-out Date',  type: 'date',   required: false },
      { tag: 'ROOM_TYPE',    label: 'Room',            type: 'select', required: false, optionsKey: 'rooms',
        placeholder: 'Select a room' },
      { tag: 'NUM_GUESTS',   label: 'No. of Guests',   type: 'number', required: false, placeholder: 'e.g. 5' },
      { tag: 'MEAL_PLAN',    label: 'Meal Plan',       type: 'select', required: false,
        options: ['EP (Room only)', 'CP (Breakfast)', 'MAP (Breakfast + 1 meal)', 'AP (All meals)'] },
      { tag: 'ROOM_DETAILS', label: 'Room Charges',    type: 'lineitems', totalTag: 'ROOM_TOTAL',
        itemPlaceholder: 'e.g. Premium Room Tariff' },
      { tag: 'ROOM_TOTAL',   label: 'Room Total (Rs.)', type: 'computed' },
      { tag: 'FOOD_DETAILS', label: 'Food Items',      type: 'lineitems', totalTag: 'FOOD_TOTAL',
        itemPlaceholder: 'e.g. Paneer Butter Masala' },
      { tag: 'FOOD_TOTAL',   label: 'Food Total (Rs.)', type: 'computed' },
      { tag: 'GRAND_TOTAL',  label: 'Grand Total (Rs.)', type: 'computed' },
      { tag: 'ADVANCE_PAID', label: 'Advance Paid (Rs.)', type: 'number', placeholder: '0' },
      { tag: 'BALANCE',      label: 'Balance Payable (Rs.)', type: 'computed' }
    ]
  },
  proposal: {
    label: 'Proposal',
    custom: true,          // rendered by a bespoke UI (buildProposalForm) and generateProposal()
    fields: []
  }
};

// Returns the field list for a template (by its `form`, default 'letter').
function fieldsForTemplate_(tpl) {
  var formKey = (tpl && tpl.form) ? tpl.form : 'letter';
  var form = FORMS[formKey] || FORMS.letter;
  return form.fields;
}

/* ---- Invoice number counter (stored in Script Properties) ---- */
function invoicePrefix_() {
  return 'SM/' + Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'yyyy') + '/';
}
function padLeft_(n, w) { var s = String(n); while (s.length < w) s = '0' + s; return s; }
function peekInvoiceNo_() {
  var seq = parseInt(PropertiesService.getScriptProperties().getProperty('INVOICE_SEQ') || '0', 10) + 1;
  return invoicePrefix_() + padLeft_(seq, 4);
}
function bumpInvoiceNo_() {
  var props = PropertiesService.getScriptProperties();
  var seq = parseInt(props.getProperty('INVOICE_SEQ') || '0', 10) + 1;
  props.setProperty('INVOICE_SEQ', String(seq));
}

/* ---- Room list from the "Rooms" sheet (Name | Tariff) ---- */
function getRooms_() {
  try {
    var sh = SpreadsheetApp.getActiveSpreadsheet().getSheetByName('Rooms');
    if (!sh) return [];
    var rows = sh.getDataRange().getValues();
    var out = [];
    for (var i = 1; i < rows.length; i++) {
      var name = String(rows[i][0] || '').trim();
      if (!name) continue;
      out.push({
        name: name,
        tariff: rows[i].length > 1 ? String(rows[i][1] || '').trim() : '',
        unit: rows[i].length > 2 ? String(rows[i][2] || '').trim() : 'night',
        maxPax: rows[i].length > 3 ? String(rows[i][3] || '').trim() : ''
      });
    }
    return out;
  } catch (e) { return []; }
}

/* ---- Proposal number counter ---- */
function peekProposalNo_() {
  var seq = parseInt(PropertiesService.getScriptProperties().getProperty('PROPOSAL_SEQ') || '0', 10) + 1;
  return 'PROP/' + Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'yyyy') + '/' + padLeft_(seq, 4);
}
function bumpProposalNo_() {
  var props = PropertiesService.getScriptProperties();
  var seq = parseInt(props.getProperty('PROPOSAL_SEQ') || '0', 10) + 1;
  props.setProperty('PROPOSAL_SEQ', String(seq));
}

/* ---- Services from the "Services" sheet (Category | Name | Rate) -> grouped by category ---- */
function getServices_() {
  try {
    var sh = SpreadsheetApp.getActiveSpreadsheet().getSheetByName('Services');
    if (!sh) return {};
    var rows = sh.getDataRange().getValues();
    var out = {};
    for (var i = 1; i < rows.length; i++) {
      var cat = String(rows[i][0] || '').trim();
      var name = String(rows[i][1] || '').trim();
      if (!cat || !name) continue;
      var rate = rows[i].length > 2 ? Number(rows[i][2]) || 0 : 0;
      var unit = rows[i].length > 3 ? String(rows[i][3] || '').trim() : '';
      var key = cat.toLowerCase();
      if (!out[key]) out[key] = [];
      out[key].push({ name: name, rate: rate, unit: unit });
    }
    return out;
  } catch (e) { return {}; }
}

/* ---- Settings sheet (Key | Value) -> company info + repeated Inclusion/Exclusion/Term lists ----
 * Repeated keys 'Inclusion', 'Exclusion', 'Term' (one value per row) become selectable lists.
 * Everything else is a single company/config value. Falls back to the COMPANY/DEFAULT_TERMS consts. */
function getSettings_() {
  var raw = {}, inclusions = [], exclusions = [], terms = [];
  try {
    var sh = SpreadsheetApp.getActiveSpreadsheet().getSheetByName('Settings');
    if (sh) {
      var rows = sh.getDataRange().getValues();
      for (var i = 1; i < rows.length; i++) {
        var k = String(rows[i][0] || '').trim(); var v = String(rows[i][1] || '').trim();
        if (!k) continue;
        var lk = k.toLowerCase();
        if (lk === 'inclusion') { if (v) inclusions.push(v); }
        else if (lk === 'exclusion') { if (v) exclusions.push(v); }
        else if (lk === 'term') { if (v) terms.push(v); }
        else raw[lk] = v;
      }
    }
  } catch (e) {}
  var company = {
    name: raw['company name'] || COMPANY.name,
    tagline: raw['tagline'] || COMPANY.tagline,
    address: raw['address'] || COMPANY.address,
    mobile: raw['mobile'] || raw['phone'] || COMPANY.phone,
    phone: raw['phone'] || COMPANY.phone,
    email: raw['email'] || COMPANY.email,
    website: raw['website'] || raw['domain'] || COMPANY.website,
    gstin: raw['gstin'] || COMPANY.gstin,
    brandColor: raw['brand color'] || COMPANY.brandColor,
    accent: raw['accent color'] || COMPANY.accent
  };
  return {
    company: company,
    inclusions: inclusions,
    exclusions: exclusions,
    terms: terms.length ? terms : DEFAULT_TERMS.slice()
  };
}

/* ============================================================================================
 *  COMPANY LOGO (uploaded from the app, stored as a Drive file, embedded in documents)
 * ============================================================================================ */
/** Saves an uploaded logo (base64) as a Drive file; stores its ID in Script Properties. */
function saveLogo(base64, mime) {
  try {
    if (!getAuthorisedUser_()) return { ok: false, error: 'Not authorised.' };
    if (!base64) return { ok: false, error: 'No image data received.' };
    mime = mime || 'image/png';
    var blob = Utilities.newBlob(Utilities.base64Decode(base64), mime, 'SandalMist_Logo');
    var props = PropertiesService.getScriptProperties();
    var oldId = props.getProperty('LOGO_FILE_ID');
    if (oldId) { try { DriveApp.getFileById(oldId).setTrashed(true); } catch (e) {} }
    var file = DriveApp.createFile(blob);
    props.setProperty('LOGO_FILE_ID', file.getId());
    return { ok: true };
  } catch (err) { return { ok: false, error: String(err && err.message ? err.message : err) }; }
}
function removeLogo() {
  var props = PropertiesService.getScriptProperties();
  var id = props.getProperty('LOGO_FILE_ID');
  if (id) { try { DriveApp.getFileById(id).setTrashed(true); } catch (e) {} }
  props.deleteProperty('LOGO_FILE_ID');
  return { ok: true };
}
function hasLogo_() { return !!PropertiesService.getScriptProperties().getProperty('LOGO_FILE_ID'); }
function getLogoBlob_() {
  try {
    var id = PropertiesService.getScriptProperties().getProperty('LOGO_FILE_ID');
    return id ? DriveApp.getFileById(id).getBlob() : null;
  } catch (e) { return null; }
}
/** Returns the stored logo as a data URL (for the client to build the watermark + preview). */
function getLogoDataUrl() {
  try {
    var blob = getLogoBlob_();
    if (!blob) return { ok: false };
    return { ok: true, dataUrl: 'data:' + blob.getContentType() + ';base64,' + Utilities.base64Encode(blob.getBytes()) };
  } catch (e) { return { ok: false }; }
}

/* ---- Menu from the "Menu" sheet (Category | Item | Price) -> grouped by category (display name) ---- */
function getMenu_() {
  try {
    var sh = SpreadsheetApp.getActiveSpreadsheet().getSheetByName('Menu');
    if (!sh) return {};
    var rows = sh.getDataRange().getValues();
    var out = {};
    for (var i = 1; i < rows.length; i++) {
      var cat = String(rows[i][0] || '').trim() || 'Menu';
      var item = String(rows[i][1] || '').trim();
      if (!item) continue;
      var price = rows[i].length > 2 ? Number(rows[i][2]) || 0 : 0;
      if (!out[cat]) out[cat] = [];
      out[cat].push({ name: item, rate: price });
    }
    return out;
  } catch (e) { return {}; }
}


/* ============================================================================================
 *  PROPOSAL BUILDER  ->  Google Doc  ->  PDF + DOCX
 * ============================================================================================ */

// GST rate rule: rooms/hall/amphitheater = 5% if the per-unit RATE <= 7500 else 18%;
// food/other = 18%. Basing it on the per-unit rate handles per-head / per-night packages
// correctly (e.g. Rs.1,800/head -> 5% even when the total is large).
function gstRateForItem_(key, rate) {
  key = String(key).toLowerCase();
  if (key === 'food' || key === 'other') return 18;
  return num_(rate) > 7500 ? 18 : 5;
}

// Indian-grouped integer formatting: 1234567 -> 12,34,567
function money_(n) {
  n = Math.round(Number(n) || 0);
  var neg = n < 0; var s = String(Math.abs(n));
  var last3 = s.slice(-3), rest = s.slice(0, -3);
  if (rest) rest = rest.replace(/\B(?=(\d{2})+(?!\d))/g, ',') + ',';
  return (neg ? '-' : '') + rest + last3;
}

/**
 * Builds a branded proposal Google Doc from structured data, returns PDF + DOCX (base64).
 * @param {Object} data { recipientName, recipientCompany, proposalNo, date, validUntil,
 *                         modules:[{key,title,items:[{item,qty,rate}]}],
 *                         discountType:'flat'|'percent', discountValue, inclusions, exclusions, terms }
 */
function generateProposal(data) {
  try {
    var user = getAuthorisedUser_();
    if (!user) return { ok: false, error: 'Access denied: your account is not authorised.' };

    data = data || {};
    if (!String(data.recipientName || '').trim()) return { ok: false, error: 'Recipient name is required.' };

    var modules = (data.modules || []).filter(function (m) {
      return m && m.items && m.items.some(function (it) { return num_(it.qty) > 0 && num_(it.rate) > 0 || String(it.item || '').trim(); });
    });
    if (!modules.length) return { ok: false, error: 'Add at least one service item to the proposal.' };

    // ---- Compute money (GST slab is decided PER LINE by its per-unit rate) ----
    modules.forEach(function (m) {
      m.rows = [];
      m.subtotal = 0;
      m.items.forEach(function (it) {
        var name = String(it.item || '').trim();
        var qty = num_(it.qty), rate = num_(it.rate);
        var unit = String(it.unit || '').trim();
        if (!name && !qty && !rate) return;
        var amt = qty * rate;
        m.subtotal += amt;
        // Rooms/Hall/Amphitheater: slab from the per-unit RATE (per head/night); Food/Other: 18%.
        m.rows.push({ name: name || 'Item', qty: qty, unit: unit, rate: rate, amt: amt,
                      gstRate: gstRateForItem_(m.key, rate) });
      });
      // Section's representative rate (for any display) = the highest line rate in the section.
      m.gstRate = m.rows.reduce(function (a, r) { return Math.max(a, r.gstRate); }, 0) || 18;
    });

    var taxable = 0;
    modules.forEach(function (m) { taxable += m.subtotal; });

    var discountType = (data.discountType === 'percent') ? 'percent' : 'flat';
    var discountVal = num_(data.discountValue);
    var discountAmt = discountType === 'percent' ? taxable * discountVal / 100 : Math.min(discountVal, taxable);
    if (discountAmt < 0) discountAmt = 0;

    // Per-line net (proportional discount) + GST grouped by rate -> CGST/SGST.
    var gstGroups = {}; // rate -> { taxable, cgst, sgst }
    var totalCgst = 0, totalSgst = 0;
    modules.forEach(function (m) {
      m.rows.forEach(function (r) {
        var lineDisc = taxable > 0 ? discountAmt * (r.amt / taxable) : 0;
        var net = r.amt - lineDisc;
        var half = net * r.gstRate / 100 / 2;
        totalCgst += half; totalSgst += half;
        var key = String(r.gstRate);
        if (!gstGroups[key]) gstGroups[key] = { taxable: 0, cgst: 0, sgst: 0 };
        gstGroups[key].taxable += net; gstGroups[key].cgst += half; gstGroups[key].sgst += half;
      });
    });
    var netTaxable = taxable - discountAmt;
    var grand = netTaxable + totalCgst + totalSgst;

    // ---- Build both variants (Client + Internal) ----
    var settings = getSettings_();
    var co = settings.company;
    var logo = getLogoBlob_();
    var totals = {
      taxable: taxable, discountType: discountType, discountVal: discountVal, discountAmt: discountAmt,
      gstGroups: gstGroups, totalCgst: totalCgst, totalSgst: totalSgst, netTaxable: netTaxable, grand: grand
    };

    var client = renderProposalVariant_(data, modules, totals, co, logo, 'client');
    var internal = renderProposalVariant_(data, modules, totals, co, logo, 'internal');

    logGeneration_(user, 'Proposal');
    bumpProposalNo_();

    var base = 'Proposal_' + String(data.proposalNo || '').replace(/[^\w\-]/g, '_');
    return {
      ok: true,
      clientPdf: client.pdf, clientDocx: client.docx,
      internalPdf: internal.pdf, internalDocx: internal.docx,
      clientPdfName: base + '_Client.pdf', clientDocxName: base + '_Client.docx',
      internalPdfName: base + '_Internal.pdf', internalDocxName: base + '_Internal.docx'
    };
  } catch (err) {
    return { ok: false, error: 'Server error: ' + (err && err.message ? err.message : err) };
  }
}

/** Builds one proposal variant (client|internal) as a temp Doc, returns base64 PDF + DOCX. */
function renderProposalVariant_(data, modules, totals, co, logo, mode) {
  var doc = DocumentApp.create('TEMP_Proposal_' + mode + '_' + Date.now());
  var docId = doc.getId();
  try {
    buildProposalDoc_(doc, data, modules, totals, co, { mode: mode, logo: logo });
    doc.saveAndClose();
    var pdf = Utilities.base64Encode(DriveApp.getFileById(docId).getAs('application/pdf').getBytes());
    var docx = Utilities.base64Encode(exportDocx_(docId).getBytes());
    return { pdf: pdf, docx: docx };
  } finally {
    try { DriveApp.getFileById(docId).setTrashed(true); } catch (e) {}
  }
}

function num_(v) { var n = parseFloat(v); return isNaN(n) ? 0 : n; }

/** Exports a Google Doc as .docx via the Drive export endpoint. */
function exportDocx_(docId) {
  var mime = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
  var url = 'https://www.googleapis.com/drive/v3/files/' + docId + '/export?mimeType=' + encodeURIComponent(mime);
  var resp = UrlFetchApp.fetch(url, {
    headers: { Authorization: 'Bearer ' + ScriptApp.getOAuthToken() },
    muteHttpExceptions: true
  });
  if (resp.getResponseCode() !== 200) throw new Error('DOCX export failed: ' + resp.getContentText().slice(0, 200));
  return resp.getBlob().setName('Proposal.docx');
}

/** Renders a professionally-styled proposal into the document.
 * @param opts { mode:'client'|'internal', logo: Blob|null } */
function buildProposalDoc_(doc, data, modules, t, co, opts) {
  opts = opts || {};
  var mode = opts.mode || 'client';
  var brand = PROP_SLATE;
  var body = doc.getBody();
  body.setMarginTop(96).setMarginBottom(60).setMarginLeft(54).setMarginRight(54);
  var base = {};
  base[DocumentApp.Attribute.FONT_FAMILY] = 'Arial';
  base[DocumentApp.Attribute.FONT_SIZE] = 10;
  base[DocumentApp.Attribute.FOREGROUND_COLOR] = PROP_TEXT;
  body.setAttributes(base);

  // ---- Header (repeats every page): logo LEFT, contact RIGHT, gold rule ----
  var header = doc.addHeader();
  if (data.watermarkPng) {
    try { addWatermark_(doc, header, data.watermarkPng); } catch (wmErr) { Logger.log('watermark: ' + wmErr); }
  }
  var htbl = header.appendTable([['', '']]);
  htbl.setBorderWidth(0);
  try { htbl.setColumnWidth(0, 215); htbl.setColumnWidth(1, 300); } catch (e) {}
  var lcell = htbl.getCell(0, 0), rcell = htbl.getCell(0, 1);
  lcell.setPaddingTop(2).setPaddingBottom(2).setPaddingLeft(0).setPaddingRight(4);
  rcell.setPaddingTop(2).setPaddingBottom(2).setPaddingLeft(4).setPaddingRight(0);

  var lp = lcell.getChild(0).asParagraph();
  lp.setAlignment(DocumentApp.HorizontalAlignment.LEFT);
  if (opts.logo) {
    try {
      var img = lp.appendInlineImage(opts.logo);
      var maxH = 58, maxW = 200, w = img.getWidth() || maxW, h = img.getHeight() || maxH;
      var scale = maxH / h; if (w * scale > maxW) scale = maxW / w;
      img.setWidth(Math.round(w * scale)).setHeight(Math.round(h * scale));
    } catch (e) {
      lp.appendText(co.name).setBold(true).setFontFamily('Georgia').setForegroundColor(brand).setFontSize(16);
    }
  } else {
    lp.appendText(co.name).setBold(true).setFontFamily('Georgia').setForegroundColor(brand).setFontSize(16);
  }

  var r0 = rcell.getChild(0).asParagraph();
  r0.setAlignment(DocumentApp.HorizontalAlignment.RIGHT).setSpacingAfter(0);
  r0.appendText(co.name).setBold(true).setForegroundColor(PROP_SLATE).setFontSize(10).setFontFamily('Arial');
  [co.address, 'Mob: ' + co.mobile + '   ·   ' + co.email, co.website + '   ·   GSTIN: ' + co.gstin].forEach(function (line) {
    var p = rcell.appendParagraph(line);
    p.setAlignment(DocumentApp.HorizontalAlignment.RIGHT).setSpacingBefore(0).setSpacingAfter(0);
    p.editAsText().setFontSize(8).setBold(false).setForegroundColor(PROP_MUTED).setFontFamily('Arial');
  });
  goldRule_(header);

  // ---- Footer (repeats every page) ----
  doc.addFooter().appendParagraph(co.name + '   |   ' + co.website + '   |   GSTIN: ' + co.gstin)
    .setForegroundColor('#9a9a9a').setFontSize(8).setAlignment(DocumentApp.HorizontalAlignment.CENTER);

  // ---- Internal banner ----
  if (mode === 'internal') {
    var ib = body.appendTable([['INTERNAL COPY — NOT FOR CLIENT']]);
    ib.setBorderWidth(0);
    ib.getCell(0, 0).setBackgroundColor('#b03535').setPaddingTop(3).setPaddingBottom(3);
    ib.getCell(0, 0).getChild(0).asParagraph().setForegroundColor('#ffffff').setBold(true).setFontSize(9)
      .setAlignment(DocumentApp.HorizontalAlignment.CENTER);
    body.appendParagraph('').setFontSize(3);
  }

  // ---- Title (light, serif, copper underline) ----
  body.appendParagraph('PROPOSAL  /  QUOTATION')
    .setForegroundColor(PROP_SLATE).setBold(true).setFontSize(17).setFontFamily('Georgia')
    .setAlignment(DocumentApp.HorizontalAlignment.CENTER).setSpacingAfter(2);
  goldRule_(body);
  body.appendParagraph('').setFontSize(3).setSpacingAfter(2);

  // ---- Guest box (Prepared For on the left, numbers on the right) ----
  var meta = body.appendTable([['', '']]);
  meta.setBorderColor(PROP_LINE).setBorderWidth(0.5);
  try { meta.setColumnWidth(0, 300); meta.setColumnWidth(1, 210); } catch (e) {}
  var mL = meta.getCell(0, 0), mR = meta.getCell(0, 1);
  [mL, mR].forEach(function (cl) {
    cl.setBackgroundColor(PROP_CREAM).setPaddingTop(9).setPaddingBottom(9).setPaddingLeft(13).setPaddingRight(13);
  });
  var lLab = mL.getChild(0).asParagraph();
  lLab.appendText('PREPARED FOR');
  lLab.editAsText().setFontSize(8).setBold(true).setForegroundColor(PROP_MUTED).setFontFamily('Arial');
  lLab.setSpacingAfter(2);
  var lName = mL.appendParagraph(data.recipientName || '');
  lName.editAsText().setFontSize(12).setBold(true).setForegroundColor(PROP_INK).setFontFamily('Arial');
  lName.setSpacingBefore(0).setSpacingAfter(0);
  if (data.recipientCompany) {
    var lCo = mL.appendParagraph(data.recipientCompany);
    lCo.editAsText().setFontSize(9).setBold(false).setForegroundColor(PROP_MUTED).setFontFamily('Arial');
    lCo.setSpacingBefore(1).setSpacingAfter(0);
  }
  function metaRight(label, val, first) {
    var p = first ? mR.getChild(0).asParagraph() : mR.appendParagraph('');
    p.setAlignment(DocumentApp.HorizontalAlignment.RIGHT).setSpacingBefore(0).setSpacingAfter(2);
    p.appendText(label + '  ').setBold(true).setForegroundColor(PROP_MUTED).setFontSize(8).setFontFamily('Arial');
    p.appendText(String(val || '')).setBold(false).setForegroundColor(PROP_INK).setFontSize(10).setFontFamily('Arial');
  }
  metaRight('PROPOSAL NO', data.proposalNo, true);
  metaRight('DATE', data.date, false);
  metaRight('VALID UNTIL', data.validUntil, false);
  body.appendParagraph('').setFontSize(3).setSpacingAfter(2);

  // ---- Warm client intro (client copy only; regular weight, clean sans) ----
  if (mode === 'client') {
    var first = (data.recipientName || 'there');
    body.appendParagraph('Dear ' + first + ',')
      .setFontFamily('Arial').setFontSize(10.5).setForegroundColor('#333333').setBold(false).setSpacingAfter(3);
    body.appendParagraph(
      'Thank you for thinking of ' + co.name + ' for your celebration — it would be our genuine ' +
      'pleasure to host you and your guests up here in the hills. We have put together the proposal below ' +
      'with your event in mind, arranging every detail so that on the day you can simply arrive, settle in, ' +
      'and enjoy. Do tell us what you would like changed; nothing here is fixed, and we would be glad to ' +
      'shape it around you.')
      .setFontFamily('Arial').setFontSize(10).setForegroundColor('#444444').setBold(false)
      .setSpacingAfter(4).setLineSpacing(1.3);
  }

  // ---- Service sections (no GST in the heading; slab is applied in the summary) ----
  modules.forEach(function (m) {
    sectionBar_(body, m.title.toUpperCase(), brand);
    var rows = [['Description', 'Qty', 'Unit', 'Rate', 'Amount']];
    m.rows.forEach(function (r) { rows.push([r.name, String(r.qty), r.unit || '', money_(r.rate), money_(r.amt)]); });
    rows.push(['Subtotal', '', '', '', money_(m.subtotal)]);
    styleItemsTable_(body.appendTable(rows), brand);
  });

  // ---- Charges summary ----
  sectionBar_(body, 'CHARGES SUMMARY', brand);
  var sumRows = [['Description', 'Amount (Rs.)']];
  sumRows.push(['Taxable Value', money_(t.taxable)]);
  if (t.discountAmt > 0) {
    sumRows.push(['Discount' + (t.discountType === 'percent' ? ' (' + t.discountVal + '%)' : ''), '- ' + money_(t.discountAmt)]);
    sumRows.push(['Net Taxable Value', money_(t.netTaxable)]);
  }
  Object.keys(t.gstGroups).sort(function (a, b) { return Number(a) - Number(b); }).forEach(function (rate) {
    var half = Number(rate) / 2;
    sumRows.push(['CGST @ ' + half + '%', money_(t.gstGroups[rate].cgst)]);
    sumRows.push(['SGST @ ' + half + '%', money_(t.gstGroups[rate].sgst)]);
  });
  sumRows.push(['GRAND TOTAL', 'Rs. ' + money_(t.grand)]);
  styleSummaryTable_(body.appendTable(sumRows), brand);

  // GST slab note — which rate applied to which section.
  var slabParts = modules.map(function (m) { return m.title + ' @ ' + m.gstRate + '%'; });
  body.appendParagraph('GST slab applied:  ' + slabParts.join('    ·    '))
    .setFontFamily('Arial').setFontSize(8).setForegroundColor(PROP_MUTED).setItalic(true).setSpacingBefore(3);

  // ---- Inclusions / Exclusions ----
  if (String(data.inclusions || '').trim()) { sectionBar_(body, 'INCLUSIONS', brand); addBullets_(body, data.inclusions, '#2e7d32', '✓'); }
  if (String(data.exclusions || '').trim()) { sectionBar_(body, 'EXCLUSIONS', brand); addBullets_(body, data.exclusions, '#b03535', '✕'); }

  // ---- Terms ----
  if (String(data.terms || '').trim()) {
    sectionBar_(body, 'TERMS & CONDITIONS', brand);
    String(data.terms).split('\n').forEach(function (line) {
      line = line.trim(); if (!line) return;
      body.appendListItem(line).setGlyphType(DocumentApp.GlyphType.NUMBER).setFontSize(8.5).setForegroundColor('#555555');
    });
  }

  // ---- Sign-off ----
  body.appendParagraph('We look forward to hosting you.').setItalic(true).setForegroundColor('#666666').setFontSize(9).setSpacingBefore(14);
  body.appendParagraph('For ' + co.name).setBold(true).setForegroundColor(brand).setFontFamily('Georgia').setFontSize(11).setSpacingBefore(16);
  body.appendParagraph('Authorised Signatory').setItalic(true).setForegroundColor('#777777').setFontSize(9);
}

/**
 * Places a page-sized watermark image behind the text on every page. The image is anchored to a
 * paragraph in the (repeating) header and offset to cover the full page. The PNG already carries
 * the faintness/tiling, so we just size it to the page.
 */
function addWatermark_(doc, header, b64) {
  var blob = Utilities.newBlob(Utilities.base64Decode(b64), 'image/png', 'watermark.png');
  var body = doc.getBody();
  var pw = body.getPageWidth();   // points, full page incl. margins
  var ph = body.getPageHeight();
  var p = header.getParagraphs()[0] || header.appendParagraph('');
  var img = p.addPositionedImage(blob);
  img.setWidth(pw).setHeight(ph)
     .setLayout(DocumentApp.PositionedLayout.ABOVE_TEXT)
     .setLeftOffset(-body.getMarginLeft())
     .setTopOffset(-(body.getMarginTop() - 6));   // pull up to roughly the page top; tune if needed
}

/* ---- proposal doc styling helpers (approved cream/copper look) ---- */

// A thin gold hairline (1-row table shaded gold).
function goldRule_(container) {
  var t = container.appendTable([['']]);
  t.setBorderWidth(0);
  var c = t.getCell(0, 0);
  c.setBackgroundColor(PROP_GOLD).setPaddingTop(0).setPaddingBottom(0).setPaddingLeft(0).setPaddingRight(0);
  c.getChild(0).asParagraph().setFontSize(1).setSpacingBefore(0).setSpacingAfter(0);
}

// Copper uppercase section label with a hairline underneath (no dark fill).
function sectionBar_(body, text, brand) {
  body.appendParagraph('').setFontSize(4);
  body.appendParagraph(text.toUpperCase())
    .setForegroundColor(PROP_COPPER).setBold(true).setFontSize(10.5).setFontFamily('Georgia')
    .setSpacingBefore(4).setSpacingAfter(1);
  var hr = body.appendTable([['']]);
  hr.setBorderWidth(0);
  hr.getCell(0, 0).setBackgroundColor(PROP_LINE).setPaddingTop(0).setPaddingBottom(0);
  hr.getCell(0, 0).getChild(0).asParagraph().setFontSize(1);
}

function styleItemsTable_(tbl, brand) {
  tbl.setBorderColor(PROP_LINE).setBorderWidth(0.5);
  var widths = [232, 46, 58, 74, 86];  // Description, Qty, Unit, Rate, Amount (points)
  for (var w = 0; w < widths.length; w++) { try { tbl.setColumnWidth(w, widths[w]); } catch (e) {} }
  var n = tbl.getNumRows();
  for (var r = 0; r < n; r++) {
    var row = tbl.getRow(r);
    var head = (r === 0), sub = (r === n - 1);
    for (var c = 0; c < row.getNumCells(); c++) {
      var cell = row.getCell(c);
      cell.setPaddingTop(4).setPaddingBottom(4).setPaddingLeft(7).setPaddingRight(7);
      var txt = cell.editAsText(); txt.setFontSize(8.5).setFontFamily('Calibri');
      var para = cell.getChild(0).asParagraph();
      if (c >= 3) para.setAlignment(DocumentApp.HorizontalAlignment.RIGHT);
      else if (c === 1 || c === 2) para.setAlignment(DocumentApp.HorizontalAlignment.CENTER);
      if (head) { cell.setBackgroundColor(PROP_CREAM); txt.setForegroundColor(PROP_MUTED).setBold(true).setFontSize(8); }
      else {
        txt.setForegroundColor(PROP_TEXT);
        if (sub) { cell.setBackgroundColor(PROP_CREAM); txt.setBold(true).setForegroundColor(PROP_INK); }
        else if (r % 2 === 0) cell.setBackgroundColor(PROP_ZEBRA);   // zebra
      }
    }
  }
}

function styleSummaryTable_(tbl, brand) {
  tbl.setBorderColor(PROP_LINE).setBorderWidth(0.5);
  try { tbl.setColumnWidth(0, 380); tbl.setColumnWidth(1, 116); } catch (e) {}
  var n = tbl.getNumRows();
  for (var r = 0; r < n; r++) {
    var row = tbl.getRow(r);
    var head = (r === 0), grand = (r === n - 1);
    for (var c = 0; c < 2; c++) {
      var cell = row.getCell(c);
      cell.setPaddingTop(4).setPaddingBottom(4).setPaddingLeft(9).setPaddingRight(9);
      var txt = cell.editAsText(); txt.setFontSize(9.5).setFontFamily('Calibri');
      if (c === 1) cell.getChild(0).asParagraph().setAlignment(DocumentApp.HorizontalAlignment.RIGHT);
      txt.setForegroundColor(PROP_TEXT);
      if (head) { cell.setBackgroundColor(PROP_CREAM); txt.setBold(true).setForegroundColor(PROP_MUTED).setFontSize(8.5); }
      if (grand) { cell.setBackgroundColor(PROP_SLATE); txt.setBold(true).setForegroundColor('#ffffff').setFontSize(11.5).setFontFamily('Georgia'); }
    }
  }
}

function addBullets_(body, text, color, mark) {
  String(text).split('\n').forEach(function (line) {
    line = line.trim(); if (!line) return;
    var p = body.appendParagraph(mark + '   ' + line);
    p.setFontSize(9).setForegroundColor('#333333').setSpacingAfter(1).setIndentStart(10);
    try { p.editAsText().setForegroundColor(0, mark.length - 1, color).setBold(0, mark.length - 1, true); } catch (e) {}
  });
}


/**
 * RUN THIS ONCE to grant all permissions (Docs + Slides + Sheets + Drive) in a single consent.
 * Because Apps Script authorizes lazily (only the scopes the run function uses), running setup()
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
      allowed.push({ key: key, label: TEMPLATES[key].label, form: TEMPLATES[key].form || 'letter' });
    }
  });
  // Build a plain forms map (label + fields + custom flag) for the frontend tabs.
  var forms = {};
  Object.keys(FORMS).forEach(function (k) {
    forms[k] = { label: FORMS[k].label, fields: FORMS[k].fields, custom: FORMS[k].custom || false };
  });
  return {
    authorised: true,
    forms: forms,
    name: user.name,
    email: user.email,
    role: user.role,
    templates: allowed,
    rooms: getRooms_(),
    nextInvoiceNo: peekInvoiceNo_(),
    services: getServices_(),
    menu: getMenu_(),
    nextProposalNo: peekProposalNo_(),
    settings: getSettings_(),
    hasLogo: hasLogo_()
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

    var tpl = TEMPLATES[templateKey];
    if (!tpl) {
      return { ok: false, error: 'Template "' + templateKey + '" is not configured in Code.gs.' };
    }
    var fieldList = fieldsForTemplate_(tpl);

    // Validate required fields (rich fields are checked by their stripped text).
    var missing = [];
    fieldList.forEach(function (f) {
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

    // Apply field defaults (e.g. DATE -> today) if the client left them blank.
    fieldList.forEach(function (f) {
      if (f.default === 'today' && !String(fields[f.tag] || '').trim()) {
        fields[f.tag] = Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'd MMMM yyyy');
      }
    });

    // ---- 3. RENDER THE PDF (dispatch by template type) ------------------------------------
    var pdfBlob;
    if (tpl.type === 'doc') {
      if (!tpl.docId || tpl.docId.indexOf('PASTE_') === 0) {
        return { ok: false, error: 'Template "' + tpl.label + '" has no Doc ID set in Code.gs.' };
      }
      pdfBlob = renderFromDocTemplate_(tpl.docId, fields, user, tpl.label, fieldList);
    } else if (tpl.type === 'slides') {
      if (!tpl.slidesId || tpl.slidesId.indexOf('PASTE_') === 0) {
        return { ok: false, error: 'Template "' + tpl.label + '" has no Slides ID set in Code.gs.' };
      }
      pdfBlob = renderFromSlidesTemplate_(tpl.slidesId, fields, user, tpl.label, fieldList);
    } else {
      pdfBlob = renderFromBuiltinTemplate_(tpl, fields, fieldList);
    }

    // ---- 4. LOG (audit trail) + advance invoice counter -----------------------------------
    logGeneration_(user, templateKey);
    if (tpl.form === 'invoice') bumpInvoiceNo_();

    // ---- 5. RETURN AS BASE64 --------------------------------------------------------------
    var outName = (tpl.form === 'invoice') ? 'Invoice.pdf' : 'Generated_Letterhead.pdf';
    return {
      ok: true,
      fileName: outName,
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
function cleanId_(id) {
  id = String(id || '').trim();
  var m = id.match(/\/d\/([A-Za-z0-9_-]+)/);   // a full pasted URL like .../d/<ID>/edit
  if (m) return m[1];
  return id.replace(/[\/\s]+$/, '');           // strip trailing slashes / whitespace
}

function getTemplateFile_(fileId, label) {
  fileId = cleanId_(fileId);
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
function applyFieldsToDoc_(body, fields, fieldList) {
  fieldList.forEach(function (f) {
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
function applyFieldsToSlides_(pres, fields, fieldList) {
  fieldList.forEach(function (f) {
    var val = String(fields[f.tag] == null ? '' : fields[f.tag]);
    // Rich field: convert HTML to text but KEEP line breaks/paragraphs (Slides honors \n).
    if (f.type === 'rich') val = htmlToText_(val);
    pres.replaceAllText('{' + f.tag + '}', val);
  });
}

/**
 * DOC TEMPLATE: copy the Doc, replace all {TAG} placeholders, export PDF, delete copy.
 */
function renderFromDocTemplate_(docId, fields, user, label, fieldList) {
  var srcFile = getTemplateFile_(docId, label);
  // A doc template must be a NATIVE Google Doc, not an uploaded Word .docx — DocumentApp
  // cannot open .docx and throws "The document is inaccessible". Detect and explain.
  if (srcFile.getMimeType() === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document') {
    throw new Error('Template "' + label + '" is still a Word (.docx) file, not a Google Doc. ' +
      'Open it in Drive, choose File > Save as Google Docs, and use the NEW document\'s ID.');
  }
  var copy = srcFile.makeCopy('TEMP_Letter_' + user.email + '_' + Date.now());
  var copyId = copy.getId();
  try {
    var doc = DocumentApp.openById(copyId);
    applyFieldsToDoc_(doc.getBody(), fields, fieldList);
    doc.saveAndClose();
    return DriveApp.getFileById(copyId).getAs('application/pdf').setName('Generated_Letterhead.pdf');
  } finally {
    try { DriveApp.getFileById(copyId).setTrashed(true); } catch (e) {}
  }
}

/**
 * SLIDES TEMPLATE: copy the deck, replace all {TAG} placeholders (plain text), export PDF, delete.
 */
function renderFromSlidesTemplate_(slidesId, fields, user, label, fieldList) {
  var copy = getTemplateFile_(slidesId, label).makeCopy('TEMP_Letter_' + user.email + '_' + Date.now());
  var copyId = copy.getId();
  try {
    var pres = SlidesApp.openById(copyId);
    applyFieldsToSlides_(pres, fields, fieldList);
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
function renderFromBuiltinTemplate_(tpl, fields, fieldList) {
  var doc = DocumentApp.create('TEMP_Letter_' + Date.now());
  var docId = doc.getId();
  try {
    var color = tpl.color || '#1a237e';
    var body = doc.getBody();
    body.setMarginTop(56).setMarginBottom(56).setMarginLeft(64).setMarginRight(64);

    // --- Header (repeats on every page) ---
    var header = doc.addHeader();
    header.appendParagraph(tpl.companyName || 'SandalMist Resort & Spa')
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
    fieldList.forEach(function (f) {
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

  // Remove the original placeholder paragraph. If it's the LAST paragraph of the section it
  // cannot be removed (Apps Script throws) — in that case clear its text so the literal
  // {LETTER_BODY} does not appear in the output.
  try {
    parent.removeChild(paragraph);
  } catch (e) {
    try { paragraph.clear(); }
    catch (e2) { try { paragraph.editAsText().setText(''); } catch (e3) {} }
  }
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

  // ---- Rooms sheet. Name | Rate | Unit | Max Pax. Unit = 'night' or 'head' (per-head billing). ----
  if (!ss.getSheetByName('Rooms')) {
    var rooms = ss.insertSheet('Rooms');
    rooms.appendRow(['Name', 'Rate', 'Unit', 'Max Pax']);
    rooms.getRange(1, 1, 1, 4).setFontWeight('bold').setBackground('#1f4d46').setFontColor('#ffffff');
    rooms.getRange(2, 1, 5, 4).setValues([
      ['Premium Room', 6000, 'night', 3],
      ['Deluxe Room', 4500, 'night', 3],
      ['Cottage', 8000, 'night', 5],
      ['Dormitory (per head)', 1200, 'head', 20],
      ['Wedding Package (per head, incl. food)', 1800, 'head', 200]
    ]);
    rooms.setFrozenRows(1);
    rooms.autoResizeColumns(1, 4);
  }

  // ---- Services sheet (Proposal pickers). Category | Name | Rate | Unit. ----
  // Categories: Room, Hall, Amphitheater, Food, Other. Unit e.g. night / head / plate / event / day.
  if (!ss.getSheetByName('Services')) {
    var svc = ss.insertSheet('Services');
    svc.appendRow(['Category', 'Name', 'Rate', 'Unit']);
    svc.getRange(1, 1, 1, 4).setFontWeight('bold').setBackground('#1f4d46').setFontColor('#ffffff');
    svc.getRange(2, 1, 11, 4).setValues([
      ['Room', 'Premium Room', 6000, 'night'],
      ['Room', 'Deluxe Room', 4500, 'night'],
      ['Room', 'Cottage', 8000, 'night'],
      ['Hall', 'Function Hall (half day)', 15000, 'day'],
      ['Hall', 'Function Hall (full day)', 25000, 'day'],
      ['Amphitheater', 'Amphitheater', 20000, 'event'],
      ['Food', 'Veg Buffet', 650, 'plate'],
      ['Food', 'Non-Veg Buffet', 850, 'plate'],
      ['Food', 'Wedding Meal (per head)', 900, 'head'],
      ['Other', 'Decoration Package', 12000, 'event'],
      ['Other', 'DJ & Music', 10000, 'event']
    ]);
    svc.setFrozenRows(1);
    svc.autoResizeColumns(1, 4);
  }

  // ---- Menu sheet (drives the Food menu picker in the Proposal builder). Category | Item | Price. ----
  if (!ss.getSheetByName('Menu')) {
    var menu = ss.insertSheet('Menu');
    menu.appendRow(['Category', 'Item', 'Price']);
    menu.getRange(1, 1, 1, 3).setFontWeight('bold').setBackground('#1f4d46').setFontColor('#ffffff');
    menu.getRange(2, 1, 10, 3).setValues([
      ['Starters', 'Onion Pakoda', 200],
      ['Starters', 'Paneer Tikka', 320],
      ['Main Course', 'Paneer Butter Masala', 350],
      ['Main Course', 'Veg Fried Rice', 270],
      ['Main Course', 'Kadai Paneer', 320],
      ['Breads', 'Phulka', 45],
      ['Breads', 'Chapathi', 40],
      ['Desserts', 'Butterscotch Cone', 50],
      ['Beverages', 'Tea', 45],
      ['Beverages', 'Mineral Water', 25]
    ]);
    menu.setFrozenRows(1);
    menu.autoResizeColumns(1, 3);
  }

  // ---- Settings sheet (Key | Value). Company details + repeatable Inclusion/Exclusion/Term rows. ----
  if (!ss.getSheetByName('Settings')) {
    var st = ss.insertSheet('Settings');
    st.appendRow(['Key', 'Value']);
    st.getRange(1, 1, 1, 2).setFontWeight('bold').setBackground('#1f4d46').setFontColor('#ffffff');
    st.getRange(2, 1, 20, 2).setValues([
      ['Company Name', COMPANY.name],
      ['Tagline', COMPANY.tagline],
      ['Address', COMPANY.address],
      ['Mobile', COMPANY.phone],
      ['Email', COMPANY.email],
      ['Website', COMPANY.website],
      ['GSTIN', COMPANY.gstin],
      ['Brand Color', COMPANY.brandColor],
      ['Accent Color', COMPANY.accent],
      ['Inclusion', 'Complimentary breakfast'],
      ['Inclusion', 'Wi-Fi access'],
      ['Inclusion', 'Car parking'],
      ['Inclusion', 'Welcome drink'],
      ['Exclusion', 'Anything not mentioned above'],
      ['Exclusion', 'Personal expenses / laundry'],
      ['Exclusion', 'Early check-in / late check-out'],
      ['Term', '50% advance to confirm the booking; balance on arrival.'],
      ['Term', 'Prices valid until the date mentioned; subject to availability.'],
      ['Term', 'GST charged as applicable and shown separately.'],
      ['Term', 'Cancellation charges apply as per resort policy.']
    ]);
    st.setFrozenRows(1);
    st.autoResizeColumns(1, 2);
  }

  SpreadsheetApp.getUi && SpreadsheetApp.flush();
  Logger.log('Setup complete. Users, Log, Rooms, Services, Menu and Settings sheets ready.');
}
