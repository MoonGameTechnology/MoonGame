#!/usr/bin/env python3
"""Cut the owner's frontal corporation sheets into per-level game sprites.

Each sheet art/corporations/frontal/<building>.png draws one building in five styles, one per
row in the order of the sheet manifest's `layout.rowOrder`, and levels I, II and III left to
right, on opaque paper with a title, captions and grid lines. For every style the hub draws:

- The grid lines and each row's ground line run the full width of the sheet; a cell is the
  space between the grid lines, down to its row's ground line.
- Paper is what the cell's top and side edges reach through paper-coloured pixels and the
  light halo sharpening left along the drawing. The rim of the drawing is unmixed from the
  paper towards the colour just inside it, so the outline keeps its anti-aliasing on any
  background.
- Only what stands on the ground line is kept: the row caption floats free of it. The ground
  line itself stays only under the building.
- Levels I and III are shifted onto level II by the best colour match of their lower half, the
  core the later levels build around. All three share one canvas whose bottom is the ground
  line: a level-up never moves or rescales the building in the hub.

Writes prototype/art/corp/<style>/<building>-<level>.webp and manifest.json with each image's
size and the box of its drawn pixels (fractions of the image), which the hub uses as the click
zone. Needs numpy and Pillow. Run from the repository root:

    python3 scripts/cut-corp-art.py
"""
import json
from pathlib import Path

import numpy as np
from PIL import Image

SOURCE = Path('art/corporations/frontal')
TARGET = Path('prototype/art/corp')
STYLES = ['standard', 'imperial-gothic', 'high-tech']
# Sprite width per building, about one and a half times its lot on the hub panorama
# (corpSprites.ts).
WIDTHS = {'headquarters': 560, 'supply_center': 460, 'engineering_complex': 500}
LINE = 0.9  # a grid or ground line is dark across this share of the width
GROUND = 6  # the thickest a ground line gets, with its anti-aliasing, in source pixels
SHADOW = 4  # how much the line thickens into a shadow beside a building, in source pixels
PAPER = 14  # a pixel this close to the paper colour in every channel may be paper
HALO = 28  # sharpening lightened the paper along the drawing by up to this much
HUE = 6  # and kept its hue: the channels moved together within this much
POCKET = 8  # a pocket of paper inside the drawing is this close to the paper colour
POCKET_CORE = 16  # and has at least this many pixels not touching anything else
RIM = 2  # the drawing's rim unmixed from the paper, in source pixels
INSET = 3  # a cell keeps this far from the grid lines
SOLID = 16  # alpha above this counts as drawn
REACH = 90  # the widest shift searched when aligning levels, in source pixels


def runs(flags):
    """(first, last) of every run of True."""
    idx = np.flatnonzero(flags)
    if not idx.size:
        return []
    cut = np.flatnonzero(np.diff(idx) > 1)
    return list(zip(idx[np.r_[0, cut + 1]], idx[np.r_[cut, idx.size - 1]]))


def spread(mask, diagonal=False):
    """`mask` grown by one pixel."""
    out = mask.copy()
    out[1:] |= mask[:-1]
    out[:-1] |= mask[1:]
    out[:, 1:] |= mask[:, :-1]
    out[:, :-1] |= mask[:, 1:]
    if diagonal:
        out[1:, 1:] |= mask[:-1, :-1]
        out[1:, :-1] |= mask[:-1, 1:]
        out[:-1, 1:] |= mask[1:, :-1]
        out[:-1, :-1] |= mask[1:, 1:]
    return out


def fill_rows(region, within):
    """Every run of `within` along a row that holds a pixel of `region`, whole."""
    starts = within.copy()
    starts[:, 1:] &= ~within[:, :-1]
    ids = np.cumsum(starts).reshape(within.shape) * within
    hit = np.zeros(ids.max() + 1, dtype=bool)
    hit[ids[region & within]] = True
    hit[0] = False
    return hit[ids]


def reach(seed, within):
    """Pixels of `within` connected to `seed` through `within` (4-neighbourhood)."""
    region = seed & within
    while True:
        wider = fill_rows(fill_rows(region, within).T, within.T).T
        if (wider == region).all():
            return region
        region = wider


def near(mask, r):
    """Pixels within `r` of `mask` (Chebyshev)."""
    for _ in range(r):
        mask = spread(mask, diagonal=True)
    return mask


def grid(rgb):
    """Column bounds and, per style row, the top and the ground line of its cells."""
    lum = rgb.mean(axis=2)
    dark = lum < np.median(lum) - 12
    lines = runs(dark.mean(axis=1) > LINE)
    # A grid line has paper on both sides; a ground line has buildings standing on it.
    paper = lambda y: dark[min(max(y, 0), len(dark) - 1)].mean() < 0.5  # noqa: E731
    seps = [r for r in lines if paper(r[0] - 3) and paper(r[1] + 3)]
    cols = runs(dark[seps[0][0] - 30 : seps[0][0] - 4].mean(axis=0) > LINE)
    edges = [-1 - INSET] + [x for c in cols for x in c] + [rgb.shape[1] + INSET]
    bounds = [(edges[i] + 1 + INSET, edges[i + 1] - INSET) for i in range(0, len(edges), 2)]
    rows = []
    for k, sep in enumerate(seps):
        end = seps[k + 1][0] if k + 1 < len(seps) else len(dark)
        rows.append((sep[1] + 1 + INSET, max(r[1] for r in lines if sep[1] < r[0] < end)))
    if len(bounds) != 3 or len(rows) != 5:
        raise SystemExit(f'expected a 5×3 grid, found {len(rows)}×{len(bounds)}')
    return bounds, rows


def lift(cell):
    """RGBA of what stands on the cell's ground line, its last row."""
    rgb = cell.astype(np.float64)
    frame = np.concatenate([rgb[:4].reshape(-1, 3), rgb[:, :4].reshape(-1, 3), rgb[:, -4:].reshape(-1, 3)])
    paper = np.median(frame, axis=0)
    seed = np.zeros(rgb.shape[:2], dtype=bool)
    seed[0], seed[:, 0], seed[:, -1] = True, True, True
    sheet = reach(seed, (np.abs(rgb - paper) < PAPER).all(axis=2))
    # The light halo sharpening left along the drawing is paper too; it fills the narrow gaps
    # between towers. A light wall is lighter than that or has a hue of its own.
    d = rgb - paper
    hue = (np.abs(d[:, :, 0] - d[:, :, 1]) < HUE) & (np.abs(d[:, :, 1] - d[:, :, 2]) < HUE)
    sheet = reach(sheet, sheet | ((d > -PAPER) & (d < HALO)).all(axis=2) & hue)
    seed[:] = False
    seed[-1] = True
    body = reach(seed, ~sheet)
    # The ground line runs under the whole row and thickens into a shadow beside the
    # building: keep it only under what stands on it. A column of bare line is the shortest
    # one; the line is never thicker than GROUND.
    height = body.sum(axis=0)
    body[:, height <= min(height.min(), GROUND) + SHADOW] = False
    # Paper seen through the drawing (between towers, under a bridge) is cut off from the
    # cell's edges. A paper-coloured pocket with a real inside is paper too, with the light
    # halo around it; streaks of a light wall are too thin to have an inside.
    pockets = body & (np.abs(rgb - paper) < POCKET).all(axis=2)
    cores = pockets & ~near(~pockets, 1)
    light = body & (rgb > paper - PAPER).all(axis=2)
    while cores.any():
        seed[:] = False
        seed.flat[np.flatnonzero(cores)[0]] = True
        pocket = reach(seed, pockets)
        if (pocket & cores).sum() >= POCKET_CORE:
            pocket = reach(pocket, light)
            body &= ~pocket
            sheet |= pocket
        cores &= ~pocket
    # The rim blends the colour just inside it with the paper; the alpha is how far along.
    rim = body & near(~body, RIM)
    inside = body & ~rim
    k = RIM + 1
    total = np.zeros_like(rgb)
    count = np.zeros(body.shape)
    src = np.pad(rgb * inside[:, :, None], ((k, k), (k, k), (0, 0)))
    cnt = np.pad(inside.astype(np.float64), k)
    h, w = body.shape
    for dy in range(2 * k + 1):
        for dx in range(2 * k + 1):
            total += src[dy : dy + h, dx : dx + w]
            count += cnt[dy : dy + h, dx : dx + w]
    alpha = body.astype(np.float64)
    known = rim & (count > 0)
    towards = total[known] / count[known][:, None] - paper
    span = (towards**2).sum(axis=1)
    along = ((rgb[known] - paper) * towards).sum(axis=1) / np.maximum(span, 1)
    # Too close to the paper to tell the blend: the drawing decided it, keep it whole.
    alpha[known] = np.where(span < 24**2, 1, np.clip(along, 0, 1))
    # Thin parts with nothing inside (masts, rails) are unmixed from the paper alone. So is
    # the paper's first ring around the drawing, where only a darker edge is drawing: the
    # light halo is not.
    thin = rim & (count == 0)
    diff = rgb[thin] - paper
    alpha[thin] = np.clip(np.where(diff > 0, diff / (255 - paper), -diff / paper).max(axis=1), 0, 1)
    ring = near(body, 1) & sheet
    alpha[ring] = np.clip(((paper - rgb[ring]) / paper).max(axis=1), 0, 1)
    soft = rim | ring
    colour = rgb.copy()
    colour[soft] = np.clip(paper + (rgb[soft] - paper) / np.maximum(alpha[soft], 0.05)[:, None], 0, 255)
    rgba = np.dstack([colour, alpha * 255]).round().astype(np.uint8)
    rgba[rgba[:, :, 3] <= 4] = 0
    return rgba


def trim(rgba):
    """The drawn columns of a level."""
    xs = np.flatnonzero((rgba[:, :, 3] > SOLID).any(axis=0))
    return rgba[:, xs[0] : xs[-1] + 1]


def match(level, base):
    """Where `level` sits on `base` (both trimmed, one height): the best colour match of the
    lower half, searched around the centred guess."""
    half = slice(level.shape[0] // 2, None)
    lv, bs = level[half].astype(np.float64), base[half].astype(np.float64)
    lsolid, bsolid = lv[:, :, 3] > 250, bs[:, :, 3] > 250
    best, shift = np.inf, 0
    guess = (bs.shape[1] - lv.shape[1]) // 2
    for d in range(guess - REACH, guess + REACH + 1):
        x0, x1 = max(d, 0), min(d + lv.shape[1], bs.shape[1])
        if x1 <= x0:
            continue
        both = lsolid[:, x0 - d : x1 - d] & bsolid[:, x0:x1]
        if both.sum() < lsolid.sum() * 0.5:
            continue
        diff = np.abs(lv[:, x0 - d : x1 - d, :3] - bs[:, x0:x1, :3]).sum(axis=2)[both].mean()
        if diff < best:
            best, shift = diff, d
    return shift


def cut(sheet, row):
    """Levels I–III of one style row on one shared canvas."""
    rgb = np.array(Image.open(sheet).convert('RGB'))
    bounds, rows = grid(rgb)
    top, ground = rows[row]
    levels = [trim(lift(rgb[top : ground + 1, x0 : x1 + 1])) for x0, x1 in bounds]
    offsets = [0 if k == 1 else match(img, levels[1]) for k, img in enumerate(levels)]
    left = min(offsets)
    width = max(o + img.shape[1] for o, img in zip(offsets, levels)) - left
    height = max(len(img) - np.flatnonzero((img[:, :, 3] > SOLID).any(axis=1))[0] for img in levels)
    for o, img in zip(offsets, levels):
        canvas = np.zeros((height, width, 4), dtype=np.uint8)
        canvas[:, o - left : o - left + img.shape[1]] = img[len(img) - height :]
        yield Image.fromarray(canvas)


def box(sprite):
    """Drawn pixels' bounding box as fractions of the image: x0, y0, x1, y1."""
    ys, xs = np.nonzero(np.array(sprite)[:, :, 3] > SOLID)
    w, h = sprite.size
    return [round(xs.min() / w, 3), round(ys.min() / h, 3), round((xs.max() + 1) / w, 3), round((ys.max() + 1) / h, 3)]


manifest = {}
order = json.loads((SOURCE / 'manifest.json').read_text())['layout']['rowOrder']
for style in STYLES:
    (TARGET / style).mkdir(parents=True, exist_ok=True)
    manifest[style] = {}
    for building, width in WIDTHS.items():
        levels = []
        for level, canvas in enumerate(cut(SOURCE / f'{building}.png', order.index(style)), start=1):
            sprite = canvas.resize((width, round(canvas.size[1] * width / canvas.size[0])), Image.LANCZOS)
            sprite.save(TARGET / style / f'{building}-{level}.webp', 'WEBP', quality=82, method=6)
            levels.append(box(sprite))
        manifest[style][building] = {'w': width, 'h': sprite.size[1], 'box': levels}
styles = []
for style, buildings in manifest.items():
    entries = ',\n'.join(f'    "{b}": {json.dumps(entry)}' for b, entry in buildings.items())
    styles.append(f'  "{style}": {{\n{entries}\n  }}')
(TARGET / 'manifest.json').write_text('{\n' + ',\n'.join(styles) + '\n}\n')
print(f'{sum(len(b) for b in manifest.values()) * 3} sprites → {TARGET}')
