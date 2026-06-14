#!/usr/bin/env python3
"""Generate the CentaurAI app icon (geometric centaur logo) into resources/.

Produces resources/app.png, app_dev.png, app.ico (and app.icns if supported),
rendered at high resolution with supersampling for smooth rings. The logo is the
brand mark from centauros-assets/generate.py: gold C-ring + blue horse head +
gold diamond, on the dark tech-domain background.
"""
from PIL import Image, ImageDraw
import math, os

RES = os.path.join(os.path.dirname(__file__), "..", "resources")
GOLD = (212, 175, 55)
BLUE = (80, 144, 224)
BG_TOP = (10, 12, 22)
BG_BOTTOM = (20, 16, 40)
OUT = 1024
SS = 3  # supersample factor


def gradient_bg(size):
    img = Image.new("RGB", (size, size), BG_TOP)
    d = ImageDraw.Draw(img)
    for y in range(size):
        t = y / size
        r = int(BG_TOP[0] + (BG_BOTTOM[0] - BG_TOP[0]) * t)
        g = int(BG_TOP[1] + (BG_BOTTOM[1] - BG_TOP[1]) * t)
        b = int(BG_TOP[2] + (BG_BOTTOM[2] - BG_TOP[2]) * t)
        d.line([(0, y), (size, y)], fill=(r, g, b))
    return img


def draw_centaur(draw, cx, cy, s):
    """Geometric centaur: glow + gold outer ring + C-arc + blue horse head + diamond."""
    # Soft glow behind the mark
    for r in range(int(s * 2.0), int(s * 1.5), -2):
        a = max(0, int(36 * (1 - (r - s * 1.5) / (s * 0.5))))
        draw.ellipse([cx - r, cy - r, cx + r, cy + r], fill=(20 + a // 5, 30 + a // 5, 64 + a // 5))

    # Outer thin ring
    r_ring = s * 1.5
    draw.ellipse([cx - r_ring, cy - r_ring, cx + r_ring, cy + r_ring], outline=GOLD, width=max(2, int(s * 0.03)))

    # Bold C-shaped arc (opening like the brand C)
    ring_r = s * 1.2
    arc_w = max(3, int(s * 0.075))
    pts = []
    for ang in range(120, 421, 2):
        rad = math.radians(ang)
        pts.append((cx + ring_r * math.cos(rad), cy + ring_r * math.sin(rad)))
    draw.line(pts, fill=GOLD, width=arc_w, joint="curve")

    # Horse head silhouette inside the ring — large & centered so it reads small.
    hx = cx + s * 0.04
    hy = cy - s * 0.02
    head = [
        (hx - s * 0.30, hy + s * 0.52),  # neck / jaw bottom
        (hx + s * 0.58, hy + s * 0.06),  # snout
        (hx + s * 0.22, hy - s * 0.58),  # ear tip
        (hx - s * 0.20, hy - s * 0.34),  # crown / mane
    ]
    draw.polygon(head, fill=BLUE)
    # Eye
    ex, ey = hx + s * 0.12, hy - s * 0.06
    er = max(2, int(s * 0.05))
    draw.ellipse([ex - er, ey - er, ex + er, ey + er], fill=BG_TOP)

    # Gold diamond accent on the ring (right side)
    dx, dy = cx + s * 1.35, cy
    dsz = max(4, int(s * 0.08))
    draw.polygon([(dx, dy - dsz), (dx + dsz * 2 // 3, dy), (dx, dy + dsz), (dx - dsz * 2 // 3, dy)], fill=GOLD)


def render(size):
    big = size * SS
    img = gradient_bg(big).convert("RGBA")
    d = ImageDraw.Draw(img)
    draw_centaur(d, big // 2, big // 2, s=big * 0.30)
    return img.resize((size, size), Image.LANCZOS)


def main():
    icon = render(OUT)
    png_path = os.path.join(RES, "app.png")
    icon.convert("RGB").save(png_path)
    icon.convert("RGB").save(os.path.join(RES, "app_dev.png"))
    print("wrote app.png / app_dev.png")

    # Windows .ico (multi-size)
    icon.save(
        os.path.join(RES, "app.ico"),
        format="ICO",
        sizes=[(16, 16), (24, 24), (32, 32), (48, 48), (64, 64), (128, 128), (256, 256)],
    )
    print("wrote app.ico")

    # macOS .icns (Pillow supports ICNS write in recent versions)
    try:
        icns = icon.resize((1024, 1024), Image.LANCZOS)
        icns.save(os.path.join(RES, "app.icns"), format="ICNS")
        print("wrote app.icns")
    except Exception as e:
        print("SKIP app.icns (Pillow can't write ICNS here):", e)


if __name__ == "__main__":
    main()
