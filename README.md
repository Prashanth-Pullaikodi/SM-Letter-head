# SM Corporate Letterhead Document Generator

A Google Apps Script Web App that lets staff write rich-text letter content, pick a branded
letterhead template, and instantly download a finished **PDF**. Access is role-restricted (RBAC)
via a protected `Users` sheet, and every generation is logged.

| File | Purpose |
|------|---------|
| `Code.gs` | Backend: `doGet`, `generateLetter`, RBAC, `setup`, rich-HTML→Doc rendering, audit log |
| `Index.html` | Frontend: responsive UI, rich-text editor, validation, spinner, base64 PDF download |
| `DESIGN_PROMPTS.md` | Claude AI prompts to design the three letterhead templates |

## Setup (one time)

1. **Create a Google Sheet** (this becomes the data store) → `Extensions → Apps Script`.
2. In the Apps Script editor, create:
   - a file named `Code.gs` → paste `Code.gs`
   - an HTML file named `Index` → paste `Index.html`
3. **Design your 3 letterhead templates** as Google Docs (see `DESIGN_PROMPTS.md`). In each Doc,
   add the plain-text placeholders `{RECIPIENT_DATA}` and `{LETTER_BODY}`.
4. Copy each Doc's ID (from its URL) into `TEMPLATE_IDS` at the top of `Code.gs`.
5. Run **`setup()`** once from the editor and authorise the requested scopes. This creates the
   protected `Users` sheet (with sample rows) and the `Log` sheet.
6. Open the `Users` sheet and replace the sample rows with real staff: **Name · Email · Role**
   (`Admin`, `Manager`, or `Staff`).
7. **Deploy** → `New deployment` → `Web app`:
   - *Execute as:* **Me** (so the app can read the Sheet/Docs)
   - *Who has access:* **Anyone within your organization** (recommended)
8. Share the web-app URL with your staff.

## Security / RBAC notes

- Identity is read server-side via `Session.getActiveUser().getEmail()` — it **cannot be spoofed**
  by the browser, so the access check is authoritative.
- The `Users` sheet is **protected** in `setup()`: only the owner can edit who has access, which
  stops staff from self-elevating their role even if they can open the spreadsheet.
- Templates can be restricted per-role via `TEMPLATE_ROLE_RESTRICTIONS` in `Code.gs`.
- All generations are written to the `Log` sheet (timestamp, user, role, template).

## How generation works

1. Validate input + authorise the user.
2. `makeCopy()` the chosen template Doc.
3. Replace `{RECIPIENT_DATA}` (plain text) and render the rich `{LETTER_BODY}` HTML into styled
   Doc content (bold/italic/underline, color, highlight, font, size, alignment, lists, headings).
4. `saveAndClose()`, export the copy as a **PDF blob**.
5. **Trash the temporary copy** (in a `finally` block, so cleanup runs even on error).
6. Return the PDF as base64 → the browser rebuilds it into a Blob and auto-downloads
   `Generated_Letterhead.pdf`.
