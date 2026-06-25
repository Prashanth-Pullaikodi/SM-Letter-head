# Letterhead PDF Design — Claude AI Prompts

Use these prompts with Claude (or any AI design assistant) to design the **Google Doc letterhead
templates**. Create one Google Doc per template, paste the generated design, then add the two
placeholder tags exactly as written so the generator can fill them in:

- `{RECIPIENT_DATA}` — where the recipient name / company / address should appear.
- `{LETTER_BODY}`   — where the typed letter content should be inserted.

> ⚠️ The placeholder tags **must be plain text** (not inside a text box or table cell that the
> Text Finder can't reach) and must be spelled exactly, including the curly braces.

---

## 0. Master / Brand prompt (run this first)

```
You are a senior brand & print designer. I am building a set of corporate letterhead templates
for "SM Corporation". Establish a reusable brand system I will apply across multiple letterhead
variants. Give me:

1. A primary, secondary, and accent color palette (provide HEX codes).
2. A typography pairing: one heading font and one body font (Google Fonts only, so they work in
   Google Docs). Specify sizes for company name, contact line, body, and footer.
3. Letterhead layout rules for A4 / US-Letter: top header band height, logo placement, margin
   sizes, footer band, and where a watermark (if any) should sit.
4. A short style description (formal / modern / minimal) I can reuse in every template prompt.

Constraints: must look professional when exported to PDF from Google Docs, must remain readable
in grayscale, and must leave a clean content area for body text. Output the palette + fonts as a
copy-pasteable spec.
```

---

## 1. "Official Corporate" template

```
Design a FORMAL CORPORATE LETTERHEAD for Google Docs (A4), using the brand system above.

Header: a slim top band in the primary brand color containing the company logo (left), the
company name in the heading font (center or left), and a thin gold accent rule beneath it.
Top-right: a small contact block (website, phone, email).

Body area: generous white space, professional. Insert the literal text placeholder
{RECIPIENT_DATA} near the top-left of the body (this is where the recipient name, company and
address go), followed by a blank line, then the literal placeholder {LETTER_BODY} for the main
letter text.

Footer: a thin band with registered office address, company registration number, and page note.

Tone: conservative, trustworthy, banking/legal grade. Provide exact fonts, sizes, colors and
spacing so I can recreate it in a Google Doc. Keep both placeholders as plain editable text.
```

## 2. "Marketing / Pitch" template

```
Design a MODERN, BOLD MARKETING / SALES PITCH LETTERHEAD for Google Docs (A4), using the brand
system but with more energy.

Header: a full-width gradient or color-blocked banner with the logo and a punchy tagline. Allow
a large headline zone. Use the accent color more liberally. Optional subtle geometric shapes in
the margins.

Body: place {RECIPIENT_DATA} top-left, then {LETTER_BODY} below it. Leave room for a strong
call-to-action paragraph and a signature block with the sender's name, title and contact.

Footer: social handles and website in the accent color.

Tone: confident, persuasive, creative-agency / startup pitch energy — but still on-brand and
print-clean. Give exact colors, fonts, sizes and layout. Keep {RECIPIENT_DATA} and {LETTER_BODY}
as plain editable text.
```

## 3. "Internal Memo" template

```
Design a CLEAN INTERNAL MEMORANDUM LETTERHEAD for Google Docs (A4), minimal and utilitarian.

Header: compact. Small logo top-left and the word "MEMORANDUM" in the heading font top-right.
Below, a structured meta block with labeled lines: TO:, FROM:, DATE:, RE: — and place the
{RECIPIENT_DATA} placeholder in the TO: field area.

Body: a single horizontal rule, then the {LETTER_BODY} placeholder for the memo content. Tight,
efficient spacing. No heavy color — just the primary brand color for labels and rules.

Footer: "Confidential — Internal Use Only" note.

Tone: crisp, no-nonsense, internal communications. Provide exact fonts, sizes, colors, spacing.
Keep both placeholders as plain editable text.
```

---

## Tips for best results

- After Claude returns a spec, build the Doc manually (Google Docs has no AI import) — set the
  page color, header/footer, fonts and the colored bands using **Insert → Drawing** or table
  rows with cell background colors for the bands.
- Put the colored header **inside the Doc header region** (Insert → Headers & footers) so it
  repeats on multi-page letters but never overlaps `{LETTER_BODY}`.
- Keep `{RECIPIENT_DATA}` and `{LETTER_BODY}` in the **main body**, left-aligned, on their own
  lines, so Apps Script's Text Finder locates and replaces them reliably.
- Copy each finished Doc's ID from its URL into `TEMPLATE_IDS` in `Code.gs`.
