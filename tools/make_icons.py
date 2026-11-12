"""Rasterise public/icon.svg into the PNG and ICO icons the site links to (32, 180, 192, 512 px and favicon.ico).

Usage: python tools/make_icons.py
Only the rectangles of the logo are drawn (rounded rectangles with an optional stroke and opacity), so the
script needs nothing but Pillow. Drawn at 8x and scaled down for smooth edges."""
import os, re
from PIL import Image, ImageDraw

root = os.path.join(os.path.dirname(__file__), '..', 'public')
svg = open(os.path.join(root, 'icon.svg')).read()
vb = [float(v) for v in re.search(r'viewBox="([^"]+)"', svg).group(1).split()]
SS = 8  # supersampling
W = int(vb[2] * SS)

def attrs(tag):
    return {k: v for k, v in re.findall(r'([\w:-]+)="([^"]*)"', tag)}

def hex_rgba(color, opacity):
    c = color.lstrip('#')
    return tuple(int(c[i:i + 2], 16) for i in (0, 2, 4)) + (int(round(255 * opacity)),)

def render(size):
    img = Image.new('RGBA', (W, W), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)
    for tag in re.findall(r'<rect[^>]*/>', svg):
        a = attrs(tag)
        x, y, w, h = (float(a[k]) * SS for k in ('x', 'y', 'width', 'height'))
        rx = float(a.get('rx', 0)) * SS
        op = float(a.get('opacity', 1))
        fill = hex_rgba(a['fill'], op) if 'fill' in a else None
        stroke = hex_rgba(a['stroke'], op) if 'stroke' in a else None
        sw = int(round(float(a.get('stroke-width', 0)) * SS))
        # The SVG stroke is centred on the edge: draw the outline as an outer shape minus an inner one.
        if stroke and sw:
            d.rounded_rectangle([x - sw / 2, y - sw / 2, x + w + sw / 2, y + h + sw / 2], radius=rx + sw / 2, fill=stroke)
            if fill:
                d.rounded_rectangle([x + sw / 2, y + sw / 2, x + w - sw / 2, y + h - sw / 2], radius=max(0, rx - sw / 2), fill=fill)
            continue
        if fill:
            d.rounded_rectangle([x, y, x + w, y + h], radius=rx, fill=fill)
    return img.resize((size, size), Image.LANCZOS)

for name, px in (('icon-32.png', 32), ('apple-touch-icon.png', 180), ('icon-192.png', 192), ('icon-512.png', 512)):
    render(px).save(os.path.join(root, name), optimize=True)
render(256).save(os.path.join(root, 'favicon.ico'), sizes=[(16, 16), (32, 32), (48, 48), (64, 64)])
print('icons ok')
