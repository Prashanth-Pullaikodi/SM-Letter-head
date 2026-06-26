"""Generate an elegant placeholder emblem for SandalMist Resort & Spa."""
from PIL import Image, ImageDraw, ImageFont
import math

SIZE = 700
GREEN = (31, 77, 70)      # deep teal-green
GOLD = (201, 162, 75)     # gold
CREAM = (250, 247, 240)

img = Image.new("RGBA", (SIZE, SIZE), (0, 0, 0, 0))
d = ImageDraw.Draw(img)
cx = cy = SIZE // 2

# Outer gold ring
d.ellipse([20, 20, SIZE-20, SIZE-20], outline=GOLD, width=10)
# Inner green disc
pad = 50
d.ellipse([pad, pad, SIZE-pad, SIZE-pad], fill=GREEN)
# thin inner gold ring
d.ellipse([pad+18, pad+18, SIZE-pad-18, SIZE-pad-18], outline=GOLD, width=3)

def font(sz, bold=True):
    paths = [
        "/usr/share/fonts/truetype/dejavu/DejaVuSerif-Bold.ttf" if bold
        else "/usr/share/fonts/truetype/dejavu/DejaVuSerif.ttf",
        "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf",
    ]
    for p in paths:
        try:
            return ImageFont.truetype(p, sz)
        except Exception:
            continue
    return ImageFont.load_default()

# Monogram "SM"
mono = font(230, bold=True)
text = "SM"
bb = d.textbbox((0, 0), text, font=mono)
w, h = bb[2]-bb[0], bb[3]-bb[1]
d.text((cx - w/2 - bb[0], cy - h/2 - bb[1] - 40), text, font=mono, fill=CREAM)

# A small decorative leaf/sprig under the monogram (two simple leaves)
def leaf(ox, oy, ang, scale=1.0, col=GOLD):
    pts = []
    for t in range(0, 181, 10):
        r = math.radians(t)
        x = math.sin(r) * 60 * scale
        y = -math.sin(r) * (1 - math.cos(r)) * 55 * scale
        pts.append((x, y))
    for t in range(180, 361, 10):
        r = math.radians(t)
        x = math.sin(r) * 60 * scale
        y = -math.sin(r) * (1 - math.cos(r)) * 20 * scale
        pts.append((x, y))
    rot = math.radians(ang)
    out = []
    for x, y in pts:
        rx = x*math.cos(rot) - y*math.sin(rot)
        ry = x*math.sin(rot) + y*math.cos(rot)
        out.append((ox+rx, oy+ry))
    d.polygon(out, fill=col)

leaf(cx-32, cy+150, -25, 0.7)
leaf(cx+32, cy+150, 25+180, 0.7)

# Curved tagline text along bottom arc
arc = font(46, bold=True)
banner = "RESORT  &  SPA"
bb = d.textbbox((0, 0), banner, font=arc)
w = bb[2]-bb[0]
d.text((cx - w/2, SIZE-150), banner, font=arc, fill=GOLD)

img.save("/tmp/claude-0/-home-user-SM-Letter-head/00d8b480-5d9a-50a7-9059-f6ed2856c44a/scratchpad/logo_placeholder.png")
print("logo saved")
