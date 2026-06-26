"""
Generate 4 stylish letterhead .docx files for SandalMist Resort & Spa.
Import each into Google Docs: File > Open > Upload. Replace the placeholder logo
(right-click > Replace image). Placeholders {RECIPIENT_DATA} and {LETTER_BODY}
live in the body for the Apps Script generator.
"""
import os
from docx import Document
from docx.shared import Pt, RGBColor, Inches, Cm, Emu
from docx.enum.text import WD_ALIGN_PARAGRAPH
from docx.enum.table import WD_TABLE_ALIGNMENT
from docx.oxml.ns import qn
from docx.oxml import OxmlElement

OUT = "/home/user/SM-Letter-head/letterheads"
LOGO = "/tmp/claude-0/-home-user-SM-Letter-head/00d8b480-5d9a-50a7-9059-f6ed2856c44a/scratchpad/logo_placeholder.png"
os.makedirs(OUT, exist_ok=True)

GREEN = RGBColor(0x1F, 0x4D, 0x46)
GOLD = RGBColor(0xC9, 0xA2, 0x4B)
CHARCOAL = RGBColor(0x33, 0x33, 0x33)
GREY = RGBColor(0x70, 0x70, 0x70)
LIGHT = RGBColor(0x8A, 0x8A, 0x8A)

COMPANY = "SandalMist Resort & Spa"
ADDRESS = "12/374, Sankar Hills, Munnad, Kasaragod, Kerala, 671541, India"
PHONE = "+91 97784 34442"
EMAILS = "info@sandalmistresort.com  |  sandalmistresortandspa@gmail.com"
GSTIN = "32AARFB1365N1Z6"
DOMAIN = "https://sandalmistresort.com"

# Bank details placeholders (fill your real values in Google Docs after import)
BANK = [
    ("Account Name", "SandalMist Resort & Spa"),
    ("Bank / Branch", "<<BANK NAME>>, <<BRANCH>>"),
    ("Account No.", "<<ACCOUNT NUMBER>>"),
    ("IFSC Code", "<<IFSC>>"),
]


# ---------- low-level XML helpers ----------
def shade(cell, hex_color):
    tcPr = cell._tc.get_or_add_tcPr()
    sh = OxmlElement('w:shd')
    sh.set(qn('w:val'), 'clear')
    sh.set(qn('w:color'), 'auto')
    sh.set(qn('w:fill'), hex_color)
    tcPr.append(sh)


def no_table_borders(table):
    tbl = table._tbl
    tblPr = tbl.tblPr
    borders = OxmlElement('w:tblBorders')
    for edge in ('top', 'left', 'bottom', 'right', 'insideH', 'insideV'):
        e = OxmlElement('w:' + edge)
        e.set(qn('w:val'), 'none')
        e.set(qn('w:sz'), '0')
        e.set(qn('w:space'), '0')
        borders.append(e)
    tblPr.append(borders)


def para_bottom_border(paragraph, color="C9A24B", size=18):
    p = paragraph._p
    pPr = p.get_or_add_pPr()
    pbdr = OxmlElement('w:pBdr')
    bottom = OxmlElement('w:bottom')
    bottom.set(qn('w:val'), 'single')
    bottom.set(qn('w:sz'), str(size))
    bottom.set(qn('w:space'), '6')
    bottom.set(qn('w:color'), color)
    pbdr.append(bottom)
    pPr.append(pbdr)


def set_cell_width(cell, cm):
    cell.width = Cm(cm)
    tcPr = cell._tc.get_or_add_tcPr()
    tcW = OxmlElement('w:tcW')
    tcW.set(qn('w:w'), str(int(cm * 567)))
    tcW.set(qn('w:type'), 'dxa')
    tcPr.append(tcW)


def vcenter(cell):
    tcPr = cell._tc.get_or_add_tcPr()
    va = OxmlElement('w:vAlign')
    va.set(qn('w:val'), 'center')
    tcPr.append(va)


def run(p, text, size=11, color=CHARCOAL, bold=False, italic=False, font="Calibri", spacing=None):
    r = p.add_run(text)
    r.font.size = Pt(size)
    r.font.color.rgb = color
    r.font.bold = bold
    r.font.italic = italic
    r.font.name = font
    if spacing is not None:
        rPr = r._r.get_or_add_rPr()
        sp = OxmlElement('w:spacing')
        sp.set(qn('w:val'), str(spacing))
        rPr.append(sp)
    return r


# ---------- builders ----------
def build_header(doc, tagline, accent):
    section = doc.sections[0]
    section.top_margin = Cm(1.4)
    section.bottom_margin = Cm(2.2)
    section.left_margin = Cm(2.0)
    section.right_margin = Cm(2.0)
    section.header_distance = Cm(0.8)
    section.footer_distance = Cm(0.8)

    header = section.header
    header.is_linked_to_previous = False
    # clear default empty paragraph
    htbl = header.add_table(rows=1, cols=2, width=Cm(17))
    htbl.alignment = WD_TABLE_ALIGNMENT.CENTER
    no_table_borders(htbl)

    logo_cell, txt_cell = htbl.rows[0].cells
    set_cell_width(logo_cell, 3.6)
    set_cell_width(txt_cell, 13.4)
    vcenter(logo_cell); vcenter(txt_cell)

    lp = logo_cell.paragraphs[0]
    lp.alignment = WD_ALIGN_PARAGRAPH.LEFT
    if os.path.exists(LOGO):
        lp.add_run().add_picture(LOGO, width=Cm(2.9))

    # company name
    p1 = txt_cell.paragraphs[0]
    p1.alignment = WD_ALIGN_PARAGRAPH.RIGHT
    p1.paragraph_format.space_after = Pt(0)
    run(p1, COMPANY, size=22, color=GREEN, bold=True, font="Georgia", spacing=4)
    # tagline (purpose-specific)
    p2 = txt_cell.add_paragraph()
    p2.alignment = WD_ALIGN_PARAGRAPH.RIGHT
    p2.paragraph_format.space_before = Pt(2)
    p2.paragraph_format.space_after = Pt(2)
    run(p2, tagline.upper(), size=9.5, color=accent, bold=True, font="Calibri", spacing=30)
    # contact line
    p3 = txt_cell.add_paragraph()
    p3.alignment = WD_ALIGN_PARAGRAPH.RIGHT
    p3.paragraph_format.space_before = Pt(0)
    run(p3, PHONE + "   |   " + DOMAIN.replace("https://", ""), size=8.5, color=GREY)

    # gold divider rule beneath the header
    rule = header.add_paragraph()
    rule.paragraph_format.space_before = Pt(4)
    rule.paragraph_format.space_after = Pt(0)
    para_bottom_border(rule, color="C9A24B", size=16)


def build_footer(doc, include_bank, accent):
    section = doc.sections[0]
    footer = section.footer
    footer.is_linked_to_previous = False

    # top gold rule
    top = footer.paragraphs[0]
    top.paragraph_format.space_after = Pt(2)
    para_bottom_border(top, color="C9A24B", size=8)

    if include_bank:
        btbl = footer.add_table(rows=1, cols=1, width=Cm(17))
        no_table_borders(btbl)
        bcell = btbl.rows[0].cells[0]
        shade(bcell, "F3EFE5")
        bp = bcell.paragraphs[0]
        bp.alignment = WD_ALIGN_PARAGRAPH.CENTER
        bp.paragraph_format.space_before = Pt(3)
        bp.paragraph_format.space_after = Pt(3)
        run(bp, "BANK DETAILS   ", size=8, color=accent, bold=True, spacing=20)
        run(bp, "  |  ".join(f"{k}: {v}" for k, v in BANK), size=8, color=CHARCOAL)
        footer.add_paragraph()

    # address / contact line
    a = footer.add_paragraph()
    a.alignment = WD_ALIGN_PARAGRAPH.CENTER
    a.paragraph_format.space_before = Pt(2)
    a.paragraph_format.space_after = Pt(0)
    run(a, ADDRESS, size=8, color=GREY)
    b = footer.add_paragraph()
    b.alignment = WD_ALIGN_PARAGRAPH.CENTER
    b.paragraph_format.space_before = Pt(0)
    run(b, EMAILS, size=8, color=GREY)
    c = footer.add_paragraph()
    c.alignment = WD_ALIGN_PARAGRAPH.CENTER
    c.paragraph_format.space_before = Pt(0)
    run(c, f"GSTIN: {GSTIN}", size=8, color=accent, bold=True)


def build_body(doc, title, accent):
    body = doc

    # purpose title badge
    t = body.add_paragraph()
    t.alignment = WD_ALIGN_PARAGRAPH.LEFT
    t.paragraph_format.space_before = Pt(10)
    t.paragraph_format.space_after = Pt(2)
    run(t, title.upper(), size=15, color=GREEN, bold=True, font="Georgia", spacing=10)
    sub = body.add_paragraph()
    sub.paragraph_format.space_after = Pt(12)
    para_bottom_border(sub, color=("%02X%02X%02X" % (accent[0], accent[1], accent[2])), size=6)

    # date
    dp = body.add_paragraph()
    dp.alignment = WD_ALIGN_PARAGRAPH.RIGHT
    dp.paragraph_format.space_after = Pt(8)
    run(dp, "Date: ____________________", size=10, color=GREY)

    # recipient block
    rl = body.add_paragraph()
    rl.paragraph_format.space_after = Pt(0)
    run(rl, "To,", size=11, color=CHARCOAL, bold=True)
    rp = body.add_paragraph()
    rp.paragraph_format.space_after = Pt(10)
    run(rp, "{RECIPIENT_DATA}", size=11, color=CHARCOAL)

    # body placeholder
    bp = body.add_paragraph()
    run(bp, "{LETTER_BODY}", size=11, color=CHARCOAL)

    # signature
    body.add_paragraph().paragraph_format.space_after = Pt(18)
    sg = body.add_paragraph()
    sg.paragraph_format.space_before = Pt(20)
    run(sg, "Warm regards,", size=11, color=CHARCOAL)
    sg2 = body.add_paragraph()
    run(sg2, "For " + COMPANY, size=11, color=GREEN, bold=True)
    sg3 = body.add_paragraph()
    run(sg3, "Authorised Signatory", size=10, color=GREY, italic=True)


def make(filename, title, tagline, include_bank, accent):
    doc = Document()
    # base style
    style = doc.styles['Normal']
    style.font.name = 'Calibri'
    style.font.size = Pt(11)
    build_header(doc, tagline, accent)
    build_footer(doc, include_bank, accent)
    build_body(doc, title, accent)
    path = os.path.join(OUT, filename)
    doc.save(path)
    print("saved", path)


GOLD_T = RGBColor(201, 162, 75)
TEAL_T = RGBColor(31, 77, 70)
WINE_T = RGBColor(140, 56, 60)
SLATE_T = RGBColor(70, 90, 110)

make("01_General_Purpose_Letterhead.docx",
     "General Correspondence", "Luxury Stays | Spa | Fine Dining",
     include_bank=False, accent=GOLD_T)

make("02_Buffet_Menu_Pricing_Proposal.docx",
     "Buffet & Catering Pricing Proposal", "Catering | Banquets | Events",
     include_bank=True, accent=WINE_T)

make("03_Room_Booking_Events_Proposal.docx",
     "Rooms & Events Proposal", "Rooms | Events | Celebrations",
     include_bank=True, accent=TEAL_T)

make("04_Purchase_Proposal.docx",
     "Procurement & Purchase Proposal", "Procurement | Vendor Relations",
     include_bank=True, accent=SLATE_T)

print("ALL DONE")
