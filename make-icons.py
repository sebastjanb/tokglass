# TokGlass mark: a vertical video (rounded portrait card) with a play triangle
# cut out of it. Colour icon stacks cyan and red copies behind the white card.
import sys
from PIL import Image, ImageDraw, ImageChops, ImageFilter
out = sys.argv[1]
SS = 2

def card(s, scale=1.0, dx=0.0, dy=0.0):
    """Alpha mask of the card with the triangle cut out, on an s×s canvas."""
    m = Image.new('L', (s, s), 0)
    d = ImageDraw.Draw(m)
    w, hh = s * .40 * scale, s * .62 * scale
    cx, cy = s / 2 + dx * s, s / 2 + dy * s
    d.rounded_rectangle([cx - w / 2, cy - hh / 2, cx + w / 2, cy + hh / 2], radius=w * .26, fill=255)
    # Triangle centred on its centroid so it looks centred, corners rounded by a round-join outline.
    t = w * .30
    pts = [(cx - t * .62, cy - t), (cx - t * .62, cy + t), (cx + t * 1.24, cy)]
    d.polygon(pts, fill=0)
    r = w * .035
    d.line(pts + [pts[0]], fill=0, width=int(r * 2))
    for x, y in pts: d.ellipse([x - r, y - r, x + r, y + r], fill=0)
    return m

def colour(size):
    s = size * SS
    im = Image.new('RGBA', (s, s), (0, 0, 0, 0))
    bg = Image.new('L', (s, s), 0)
    ImageDraw.Draw(bg).rounded_rectangle([0, 0, s - 1, s - 1], radius=int(s * .225), fill=255)
    im.paste((12, 12, 14, 255), mask=bg)
    off = .028
    for rgb, dx, dy in (((37, 244, 238), -off, -off * .6), ((254, 44, 85), off, off * .6)):
        im.paste(rgb + (255,), mask=card(s, 1.18, dx, dy))
    im.paste((255, 255, 255, 255), mask=card(s, 1.18))
    # The cut-out shows the dark ground, not the colour layers behind it.
    hole = ImageChops.subtract(solid(s, 1.18), card(s, 1.18))
    im.paste((12, 12, 14, 255), mask=hole)
    return im.resize((size, size), Image.LANCZOS)

def solid(s, scale):
    m = Image.new('L', (s, s), 0)
    w, hh = s * .40 * scale, s * .62 * scale
    ImageDraw.Draw(m).rounded_rectangle([s / 2 - w / 2, s / 2 - hh / 2, s / 2 + w / 2, s / 2 + hh / 2], radius=w * .26, fill=255)
    return m

def mask(size):
    """Glasses artwork: the card, plus the two offset edges of the colour icon
    as thin contours. Without them a play triangle in a card reads as YouTube."""
    s = size * SS
    scale, off, gap = 1.22, .075, .034
    a = card(s, scale)
    body = solid(s, scale)
    for sign in (-1, 1):
        ghost = solid_at(s, scale, sign * off, sign * off * .6)
        # Keep only the sliver that sticks out, with a clear gap to the card.
        grown = body.filter(ImageFilter.MaxFilter(int(s * gap) * 2 + 1))
        a = ImageChops.lighter(a, ImageChops.subtract(ghost, grown))
    im = Image.new('RGBA', (s, s), (255, 255, 255, 0))
    im.putalpha(a)
    return im.resize((size, size), Image.LANCZOS)

def solid_at(s, scale, dx, dy):
    m = Image.new('L', (s, s), 0)
    w, hh = s * .40 * scale, s * .62 * scale
    cx, cy = s / 2 + dx * s, s / 2 + dy * s
    ImageDraw.Draw(m).rounded_rectangle([cx - w / 2, cy - hh / 2, cx + w / 2, cy + hh / 2], radius=w * .26, fill=255)
    return m

mask(256).save(out + '/.well-known/icon.png')
for n in (192, 512): colour(n).save(f'{out}/icon-{n}.png')
# Preview only: the mask in white on the dark container, at device size and enlarged.
prev = Image.new('RGBA', (420, 220), (0, 0, 0, 255))
for size, x, y in ((192, 14, 14), (64, 250, 78)):
    disc = Image.new('RGBA', (size, size), (0, 0, 0, 0))
    ImageDraw.Draw(disc).ellipse([0, 0, size - 1, size - 1], fill=(30, 34, 42, 255))
    art = mask(int(size * .7))
    disc.alpha_composite(art, ((size - art.width) // 2, (size - art.height) // 2))
    prev.alpha_composite(disc, (x, y))
prev.save(sys.argv[2])
