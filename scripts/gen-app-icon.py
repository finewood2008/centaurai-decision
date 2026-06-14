#!/usr/bin/env python3
"""Build the CentaurAI app icon from the brand centaur artwork.

Takes the low-poly centaur logo (white background), keys out the white to
transparency with a soft edge, trims, centers it on a square canvas with
padding, and writes resources/app.png / app_dev.png / app.ico / app.icns.

Usage: python3 scripts/gen-app-icon.py [source-image]
"""
import os, sys, glob
from PIL import Image

RES = os.path.join(os.path.dirname(__file__), "..", "resources")
OUT = 1024
PAD = 0.08  # padding fraction on each side


def find_source():
    if len(sys.argv) > 1 and os.path.exists(sys.argv[1]):
        return sys.argv[1]
    # default: the centaur artwork the user provided
    cands = glob.glob("/home/user/桌面/centauros-assets/*MsgID=7589502657397164613*")
    if cands:
        return cands[0]
    raise SystemExit("source image not found; pass it as an argument")


def key_out_white(img):
    """Return RGBA with white background made transparent (soft edge)."""
    img = img.convert("RGBA")
    px = img.load()
    w, h = img.size
    HI, LO = 250, 232  # min-channel thresholds: >=HI fully transparent, <=LO opaque
    for y in range(h):
        for x in range(w):
            r, g, b, a = px[x, y]
            mn = min(r, g, b)
            if mn >= HI:
                alpha = 0
            elif mn <= LO:
                alpha = 255
            else:
                alpha = int((HI - mn) / (HI - LO) * 255)
            px[x, y] = (r, g, b, alpha)
    return img


def main():
    src = find_source()
    print("source:", src)
    img = key_out_white(Image.open(src))

    bbox = img.getbbox()
    if bbox:
        img = img.crop(bbox)

    # Fit into a padded square, preserving aspect ratio.
    target = int(OUT * (1 - 2 * PAD))
    w, h = img.size
    scale = min(target / w, target / h)
    img = img.resize((max(1, int(w * scale)), max(1, int(h * scale))), Image.LANCZOS)

    canvas = Image.new("RGBA", (OUT, OUT), (0, 0, 0, 0))
    canvas.paste(img, ((OUT - img.width) // 2, (OUT - img.height) // 2), img)

    canvas.save(os.path.join(RES, "app.png"))
    canvas.save(os.path.join(RES, "app_dev.png"))
    print("wrote app.png / app_dev.png")

    canvas.save(
        os.path.join(RES, "app.ico"),
        format="ICO",
        sizes=[(16, 16), (24, 24), (32, 32), (48, 48), (64, 64), (128, 128), (256, 256)],
    )
    print("wrote app.ico")

    try:
        canvas.resize((1024, 1024), Image.LANCZOS).save(os.path.join(RES, "app.icns"), format="ICNS")
        print("wrote app.icns")
    except Exception as e:
        print("SKIP app.icns:", e)


if __name__ == "__main__":
    main()
