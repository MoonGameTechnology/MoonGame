#!/usr/bin/env python3
"""Cut the owner's corporation building sheets into per-level game sprites.

Each sheet in art/corporations/<style>/<building>.png shows levels I, II and III left to
right on a transparent background. The cut runs along the least-alpha seam between two
stages, so a crane arm reaching towards the neighbour stays with its own stage. Levels I
and III are then shifted onto level II by the best overlap of the platform band, and all
three share one canvas anchored at the bottom: a level-up never moves or rescales the
platform in the hub.

Writes prototype/art/corp/<style>/<building>-<level>.webp and manifest.json with each
image's size and the box of its drawn pixels (fractions of the image), which the hub uses
as the click zone. Needs numpy and Pillow. Run from the repository root:

    python3 scripts/cut-corp-art.py
"""
import json
from pathlib import Path

import numpy as np
from PIL import Image

SOURCE = Path('art/corporations')
TARGET = Path('prototype/art/corp')
STYLES = ['standard', 'imperial-gothic', 'high-tech']
# Sprite width per building: about twice its lot on the hub panorama (corpSprites.ts).
WIDTHS = {'headquarters': 560, 'supply_center': 460, 'engineering_complex': 500}
SOLID = 16  # alpha above this counts as drawn
REACH = 220  # the widest platform shift searched, in source pixels


def valley(mass, lo, hi):
    """Middle of the widest run of least-filled columns in [lo, hi)."""
    window = mass[lo:hi]
    xs = np.flatnonzero(window == window.min())
    runs, start = [], xs[0]
    for a, b in zip(xs, xs[1:]):
        if b != a + 1:
            runs.append((start, a))
            start = b
    runs.append((start, xs[-1]))
    s, e = max(runs, key=lambda r: r[1] - r[0])
    return lo + (s + e) // 2


def seam(alpha, x0, band):
    """Top-to-bottom path of least alpha within x0 ± band, drifting a column per row."""
    h, w = alpha.shape
    lo, hi = max(0, x0 - band), min(w, x0 + band + 1)
    acc = alpha[:, lo:hi].astype(np.float64)
    acc += np.abs(np.arange(lo, hi) - x0)[None, :] * 0.05  # prefer staying near the valley
    back = np.zeros(acc.shape, dtype=np.int8)
    for y in range(1, h):
        prev = acc[y - 1]
        steps = np.vstack([np.r_[np.inf, prev[:-1]], prev, np.r_[prev[1:], np.inf]])
        choice = steps.argmin(axis=0)
        acc[y] += steps[choice, np.arange(steps.shape[1])]
        back[y] = choice - 1
    xs = np.empty(h, dtype=np.int64)
    xs[-1] = int(acc[-1].argmin())
    for y in range(h - 1, 0, -1):
        xs[y - 1] = xs[y] + back[y, xs[y]]
    return xs + lo


def stages_of(sheet):
    rgba = np.array(Image.open(sheet).convert('RGBA'))
    alpha = rgba[:, :, 3]
    w = alpha.shape[1]
    mass = np.convolve((alpha > SOLID).sum(axis=0).astype(np.float64), np.ones(9) / 9, mode='same')
    band = int(w * 0.09)
    left = seam(alpha, valley(mass, int(w * 0.22), int(w * 0.45)), band)
    right = seam(alpha, valley(mass, int(w * 0.55), int(w * 0.78)), band)
    cols = np.arange(w)[None, :]
    owner = np.where(cols < left[:, None], 0, np.where(cols < right[:, None], 1, 2))
    stages = []
    for k in range(3):
        part = rgba.copy()
        part[owner != k, 3] = 0
        ys, xs = np.nonzero(part[:, :, 3] > 8)
        crop = part[ys.min() : ys.max() + 1, xs.min() : xs.max() + 1]
        rows = np.flatnonzero((crop[:, :, 3] > SOLID).any(axis=1))
        front = np.flatnonzero(crop[rows[-1], :, 3] > SOLID)
        # First guess of the anchor: the front of the platform, refined by `align`.
        stages.append({'img': crop, 'ax': (front[0] + front[-1]) / 2})
    return stages


def align(stages):
    """Shift levels I and III so their platform band overlaps level II's best."""
    band = int(min(s['img'].shape[0] for s in stages) * 0.3)
    span = max(s['img'].shape[1] for s in stages) * 2 + 2 * REACH

    def placed(s, shift):
        m = s['img'][-band:, :, 3] > SOLID
        row = np.zeros((band, span), dtype=bool)
        x = int(round(span / 2 - s['ax'] + shift))
        row[:, x : x + m.shape[1]] = m
        return row

    base = placed(stages[1], 0)
    for k in (0, 2):
        overlap = {d: placed(stages[k], d) for d in range(-REACH, REACH + 1, 2)}
        best = max(overlap, key=lambda d: (overlap[d] & base).sum() / max(1, (overlap[d] | base).sum()))
        stages[k]['ax'] -= best


def compose(stages, width):
    left = max(s['ax'] for s in stages)
    cw = int(np.ceil(left + max(s['img'].shape[1] - s['ax'] for s in stages)))
    height = max(s['img'].shape[0] for s in stages)
    size = (width, int(round(height * width / cw)))
    for s in stages:
        canvas = Image.new('RGBA', (cw, height), (0, 0, 0, 0))
        img = Image.fromarray(s['img'])
        canvas.paste(img, (int(round(left - s['ax'])), height - img.size[1]))
        yield canvas.resize(size, Image.LANCZOS)


def box(sprite):
    """Drawn pixels' bounding box as fractions of the image: x0, y0, x1, y1."""
    ys, xs = np.nonzero(np.array(sprite)[:, :, 3] > SOLID)
    w, h = sprite.size
    return [round(xs.min() / w, 3), round(ys.min() / h, 3), round((xs.max() + 1) / w, 3), round((ys.max() + 1) / h, 3)]


manifest = {}
for style in STYLES:
    (TARGET / style).mkdir(parents=True, exist_ok=True)
    manifest[style] = {}
    for building, width in WIDTHS.items():
        stages = stages_of(SOURCE / style / f'{building}.png')
        align(stages)
        levels = []
        for level, sprite in enumerate(compose(stages, width), start=1):
            sprite.save(TARGET / style / f'{building}-{level}.webp', 'WEBP', quality=82, method=6)
            levels.append(box(sprite))
        manifest[style][building] = {'w': width, 'h': sprite.size[1], 'box': levels}
styles = []
for style, buildings in manifest.items():
    rows = ',\n'.join(f'    "{b}": {json.dumps(entry)}' for b, entry in buildings.items())
    styles.append(f'  "{style}": {{\n{rows}\n  }}')
(TARGET / 'manifest.json').write_text('{\n' + ',\n'.join(styles) + '\n}\n')
print(f'{sum(len(b) for b in manifest.values()) * 3} sprites → {TARGET}')
