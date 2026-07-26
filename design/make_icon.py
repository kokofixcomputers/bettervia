"""Generates the Keycap app icon: a 1024x1024 master PNG with a gradient
rounded-square keycap and a bold "K" glyph, used both as the source for
Tauri's icon set and (separately) mirrored by hand into an SVG for in-app use.
"""
from PIL import Image, ImageDraw, ImageFont

SIZE = 1024
RADIUS = 220
PAD = 40

def lerp(a, b, t):
    return a + (b - a) * t

def hex_to_rgb(h):
    h = h.lstrip("#")
    return tuple(int(h[i:i+2], 16) for i in (0, 2, 4))

def make_gradient(size, c1, c2):
    """Diagonal (top-left -> bottom-right) linear gradient."""
    c1 = hex_to_rgb(c1)
    c2 = hex_to_rgb(c2)
    grad = Image.new("RGB", (size, size))
    px = grad.load()
    for y in range(size):
        for x in range(size):
            t = (x + y) / (2 * size)
            px[x, y] = tuple(int(lerp(c1[i], c2[i], t)) for i in range(3))
    return grad

def rounded_mask(size, radius, inset=0):
    mask = Image.new("L", (size, size), 0)
    d = ImageDraw.Draw(mask)
    d.rounded_rectangle([inset, inset, size - 1 - inset, size - 1 - inset], radius=radius, fill=255)
    return mask

def main():
    base = Image.new("RGBA", (SIZE, SIZE), (0, 0, 0, 0))

    gradient = make_gradient(SIZE, "#7c5cff", "#34d399").convert("RGBA")
    mask = rounded_mask(SIZE, RADIUS, inset=PAD)
    base.paste(gradient, (0, 0), mask)

    # subtle inner top highlight for depth
    highlight = Image.new("RGBA", (SIZE, SIZE), (0, 0, 0, 0))
    hd = ImageDraw.Draw(highlight)
    hd.rounded_rectangle(
        [PAD, PAD, SIZE - 1 - PAD, SIZE // 2],
        radius=RADIUS,
        fill=(255, 255, 255, 26),
    )
    hmask = rounded_mask(SIZE, RADIUS, inset=PAD)
    base.paste(Image.alpha_composite(base, highlight), (0, 0), hmask)

    # Bold white "K" glyph, centered
    draw = ImageDraw.Draw(base)
    font = ImageFont.truetype("/System/Library/Fonts/Supplemental/Arial Rounded Bold.ttf", 560)
    text = "K"
    bbox = draw.textbbox((0, 0), text, font=font)
    tw, th = bbox[2] - bbox[0], bbox[3] - bbox[1]
    tx = (SIZE - tw) / 2 - bbox[0]
    ty = (SIZE - th) / 2 - bbox[1]
    draw.text((tx, ty), text, font=font, fill=(255, 255, 255, 255))

    base.save("/Users/ct/Documents/via_redesigned/design/icon-master.png")
    print("wrote design/icon-master.png", base.size)

if __name__ == "__main__":
    main()
