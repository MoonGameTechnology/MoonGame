"""Package the generated transparent atlases without changing their pixels/layout.

Only encode WebP and measure alpha bounds; SVG viewports select the atlas cells.
Requires cwebp. No image editor, background removal or resampling is performed.
"""
from pathlib import Path
import json
import struct
import subprocess
import zlib

ROOT = Path(__file__).resolve().parents[1]
SOURCE = ROOT / 'art/corporations/expansion'
DEST = ROOT / 'prototype/art/corp/expansion'
STYLES = ['standard', 'high_tech', 'imperial_gothic']


def rgba(path):
    blob = path.read_bytes()
    pos, chunks = 8, []
    while pos < len(blob):
        size = struct.unpack('>I', blob[pos:pos + 4])[0]
        kind, body = blob[pos + 4:pos + 8], blob[pos + 8:pos + 8 + size]
        pos += size + 12
        if kind == b'IHDR':
            width, height, depth, colour, *_ = struct.unpack('>IIBBBBB', body)
        if kind == b'IDAT':
            chunks.append(body)
    assert depth == 8 and colour == 6, 'Expected an RGBA PNG atlas'
    raw = zlib.decompress(b''.join(chunks))
    stride = width * 4
    previous = bytearray(stride)
    rows = []
    for y in range(height):
        offset = y * (stride + 1)
        method = raw[offset]
        row = bytearray(raw[offset + 1:offset + 1 + stride])
        for x in range(stride):
            a = row[x - 4] if x >= 4 else 0
            b = previous[x]
            c = previous[x - 4] if x >= 4 else 0
            p = a + b - c
            pa, pb, pc = abs(p - a), abs(p - b), abs(p - c)
            predictor = a if pa <= pb and pa <= pc else b if pb <= pc else c
            row[x] = (row[x] + (0, a, b, (a + b) // 2, predictor)[method]) & 255
        rows.append(row)
        previous = row
    return width, height, rows


def cell(rows, iw, ih, rect, canvas, scale=1):
    sx, sy, sw, sh = rect
    width, height = canvas
    dx, dy = (width - sw * scale) / 2, height - sh * scale
    lo_x, lo_y, hi_x, hi_y = sw, sh, 0, 0
    for y in range(sy, sy + sh):
        for x in range(sx, sx + sw):
            if rows[y][x * 4 + 3] > 16:
                lo_x, lo_y = min(lo_x, x - sx), min(lo_y, y - sy)
                hi_x, hi_y = max(hi_x, x - sx + 1), max(hi_y, y - sy + 1)
    assert hi_x > lo_x and hi_y > lo_y
    return {'w': width, 'h': height, 'box': [round(v, 6) for v in
            ((dx + lo_x * scale) / width, (dy + lo_y * scale) / height,
             (dx + hi_x * scale) / width, (dy + hi_y * scale) / height)],
            'frame': {'sx': sx, 'sy': sy, 'sw': sw, 'sh': sh, 'iw': iw, 'ih': ih,
                      'dx': dx, 'dy': dy, 'dw': sw * scale, 'dh': sh * scale}}


def main():
    DEST.mkdir(parents=True, exist_ok=True)
    manifest = {style: {} for style in STYLES}
    grids = {
        'headquarters': ([0, 502, 1024], [0, 487, 980, 1496], (600, 600), 1.1),
        'warehouse': ([0, 310, 735, 1254], [0, 425, 798, 1212], (560, 440), 1),
        'hall_of_fame': ([0, 302, 730, 1254], [0, 430, 800, 1220], (560, 440), 1),
        'operations_center': ([0, 330, 777, 1254], [0, 460, 850, 1230], (560, 460), 1),
    }
    for name in [*grids, 'monument']:
        png = SOURCE / f'{name}.png'
        iw, ih, rows = rgba(png)
        subprocess.run(['cwebp', '-quiet', '-q', '88', '-alpha_q', '100', str(png), '-o', str(DEST / f'{name}.webp')], check=True)
        for index, style in enumerate(STYLES):
            if name == 'monument':
                cells = [cell(rows, iw, ih, (index * 512, 0, 512, 902), (560, 930))]
            else:
                xs, ys, canvas, scale = grids[name]
                cells = [cell(rows, iw, ih, (xs[i], ys[index], xs[i + 1] - xs[i], ys[index + 1] - ys[index]), canvas, scale) for i in range(len(xs) - 1)]
            manifest[style][name] = cells
    (DEST / 'manifest.json').write_text(json.dumps(manifest, indent=2) + '\n')


if __name__ == '__main__':
    main()
