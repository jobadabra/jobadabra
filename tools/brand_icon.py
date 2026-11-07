"""The Mac app's Icon Composer icon (desktop/assets/icon.icon), drawn from the same vector mark as every other icon, so one brand change reaches the Windows icon and the Mac icon together.

    python3 -c "import sys; sys.path.insert(0, 'tools'); import brand_icon; brand_icon.write()"   # tools/brand.py calls it for you

Why (7 Nov 2026, Gitar on #3510: brand.py regenerated icon.png but not the Mac layer, so a brand change would leave the installed Mac app on the old art): the layer and the fill colour are
written here, from tools/brand_mark.py, never by hand. The icon is a flat fill (the tile's yellow) plus one layer: the mark's dark shapes, with the cut-outs (the brim opening, the J) transparent,
placed as in the 824 px tile of icon.png and scaled to Icon Composer's 1024 px canvas (the system draws the tile's squircle itself).
"""
import json
from pathlib import Path

from PIL import Image

import brand_mark as mm

ROOT = Path(__file__).resolve().parents[1]
ICON_DIR = ROOT / 'desktop' / 'assets' / 'icon.icon'
TILE = (100, 100, 924)  # the yellow tile inside icon.png's 1024 px canvas: left, top, right/bottom (824 px; tools/brand.py draws it)
MARK_AT = (192, 212)    # where tools/brand.py puts the 640 px mark in that canvas


def _rgb(hex_colour):
    return tuple(int(hex_colour[i:i + 2], 16) for i in (1, 3, 5))


def foreground():
    """The mark's dark shapes as a 1024 px RGBA layer: INK where it is dark, transparent where it is the tile's yellow (alpha = how dark, so the edges stay smooth)."""
    ink, yellow = _rgb(mm.INK), _rgb(mm.YELLOW)
    mark = mm.draw('tile', 640)
    span = sum((y - i) ** 2 for y, i in zip(yellow, ink))
    alpha = Image.new('L', mark.size, 0)
    px_in, px_out = mark.load(), alpha.load()
    for y in range(mark.height):
        for x in range(mark.width):
            r, g, b, a = px_in[x, y]
            t = max(0.0, min(1.0, sum((yy - c) * (yy - i) for yy, c, i in zip(yellow, (r, g, b), ink)) / span))
            px_out[x, y] = round(a * t)
    side = TILE[2] - TILE[0]
    canvas = Image.new('L', (side, side), 0)
    canvas.paste(alpha, (MARK_AT[0] - TILE[0], MARK_AT[1] - TILE[1]))
    layer = Image.new('RGBA', (1024, 1024), ink + (0,))
    layer.putalpha(canvas.resize((1024, 1024), Image.LANCZOS))
    return layer


def _srgb(hex_colour):
    return 'srgb:' + ','.join(f'{c / 255:.5f}' for c in _rgb(hex_colour)) + ',1.00000'


def write(icon_dir=ICON_DIR):
    """Writes Assets/foreground.png and sets the fill colour (default and dark appearance) in icon.json."""
    icon_dir = Path(icon_dir)
    foreground().save(icon_dir / 'Assets' / 'foreground.png')
    spec = json.loads((icon_dir / 'icon.json').read_text())
    spec['fill'] = {'solid': _srgb(mm.YELLOW)}
    for entry in spec.get('fill-specializations', []):
        entry['value'] = {'solid': _srgb(mm.YELLOW)}
    (icon_dir / 'icon.json').write_text(json.dumps(spec, indent=2, separators=(',', ' : ')) + '\n')
