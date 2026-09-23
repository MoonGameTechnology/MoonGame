/**
 * Canvas2D map renderer — the consumer camera.ts was built for (CP0.2b), enriched to the
 * game's holographic look with the SHARED render kit (drawTerritory / blitSphere / blitGlow
 * from @void/client — one render implementation, not two). A side-effecting draw pass whose
 * geometry all flows through the pure camera helpers, so both surfaces can share one map.
 *
 * Reads a `GameState` (positions + lane graph live inside `state.planets`; ownership/fleets
 * in the live state) and paints, in z-order: the political territory fill (weighted Voronoi),
 * star lanes, holographic planet spheres coloured by owner with a floating type badge, and
 * fleets at their interpolated positions. Node sizes stay constant in screen px.
 */
import { drawFleetCount, fleetCountWidth } from './fleetCountBadge';
import { emblemTally } from '../../../decisions/fleetTally';
import { forkMarks, roadStrokes } from '../../../decisions/roadNetwork';
import { ambushOf } from '../../../decisions/forkAmbush';
import { drawAmbushMark, drawForkMark } from './forkMark';
import { effectiveStats, fleetPositionAt, type GameData, type GameState, type PlayerId } from '@void/shared-core';
import { worldToScreen, fitTransform, inView, type Cam, type Viewport, type Bounds } from './camera';
import { blitGlow, blitSphere, rgba } from './holoDraw';
import { drawTerritory, type TerritorySeed } from './territory';
import { theme } from './theme';
import { drawSpaceBackdrop } from './spaceBackdrop';
import { drawProvinceSelection } from './provinceSelection';
import { dominantUnit, glyphHalo, glyphScale, unitArchetype, unitShape, unitSizeClass } from './shipGlyphs';
import { drawShipShape } from './shipShapes';
import { mapLod, mapSpacing, drawSchematicNode } from './mapLod';
import { TerritoryGeometryCache } from './territoryGeometry';

const geometryCaches = new WeakMap<CanvasRenderingContext2D, TerritoryGeometryCache>();

/** Seat colours in join order (cyan / red / amber / violet — the prototype's palette). */
const OWNER_COLORS = ['#35d6e6', '#ff5a4d', '#ffb43a', '#b07cff'] as const;
/** Neutral (unowned) sector colour. */
const NEUTRAL = '#6f8a93';
/** Sector-kind glyphs (a floating "what kind of place" badge over each node). */
const KIND_ICON: Record<string, string> = {
  planet: '◉',
  dead_world: '⊗',
  asteroid: '⬡',
  nebula: '≋',
  dense_nebula: '❋',
  graveyard: '⊘',
  ion_storm: '⌁',
  solar_flare: '✸',
};
/** Sector-kind accent tints (the faint terrain wash under the owner fill). */
const KIND_COLOR: Record<string, string> = {
  planet: '#5fd0ff',
  dead_world: '#9fb0a8',
  asteroid: '#d6a645',
  nebula: '#8f6dff',
  dense_nebula: '#a78bff',
  graveyard: '#5a4a4a',
  ion_storm: '#6fe3ff',
  solar_flare: '#ff9f3a',
};

export interface MapRenderOpts {
  /** Catalogue for identified hulls; hidden contacts have no unit stack to resolve. */
  data: GameData;
  /** World time (ms) for interpolating fleets in transit. */
  now: number;
  /** Device-pixel-ratio the canvas transform was set to — the holo sprites bake at it. */
  dpr: number;
  /** Visual-only rotation clock; the caller freezes it for reduced motion/background tabs. */
  visualTime?: number;
  /** Planet id to ring as the current selection (a fleet's home), if any. */
  selected?: string | null;
}

/** Map each player id → a stable seat colour by join order. */
export function ownerColors(state: GameState): Map<PlayerId, string> {
  const m = new Map<PlayerId, string>();
  let i = 0;
  for (const id of Object.keys(state.players)) {
    m.set(id, OWNER_COLORS[i % OWNER_COLORS.length] ?? theme.cyan);
    i += 1;
  }
  return m;
}

/** Draw the whole map onto `g` for the current camera. Clears the viewport first. */
export function renderMap(
  g: CanvasRenderingContext2D,
  state: GameState,
  cam: Cam,
  vp: Viewport,
  bounds: Bounds,
  opts: MapRenderOpts,
): void {
  const colors = ownerColors(state);
  const ownerColor = (o: PlayerId): string => colors.get(o) ?? theme.dim;
  const vw = vp.right;
  const vh = vp.bottom;
  const planets = Object.values(state.planets);
  const gap = mapSpacing(planets.map((p) => ({ id: p.id, ...p.position, links: p.links })));
  const lod = mapLod(gap * fitTransform(vp, bounds).scale * cam.scale, cam.scale);
  g.clearRect(vp.left, vp.top, vw - vp.left, vh - vp.top);
  drawSpaceBackdrop(g, vw, vh, cam.x, cam.y, true);

  // Political territory — the weighted-Voronoi province fill (shared drawTerritory): every
  // sector is a cell coloured by its owner (neutral a faint wash), so who-holds-what reads
  // at a glance. Clipped to the map bounding box (+ padding) so it pans/zooms with the map.
  const padB = Math.max(40, (bounds.maxX - bounds.minX) * 0.05);
  const tl = worldToScreen({ x: bounds.minX - padB, y: bounds.minY - padB }, cam, vp, bounds);
  const br = worldToScreen({ x: bounds.maxX + padB, y: bounds.maxY + padB }, cam, vp, bounds);
  const clip: Array<[number, number]> = [
    [tl.x, tl.y],
    [br.x, tl.y],
    [br.x, br.y],
    [tl.x, br.y],
  ];
  const W = 9000 * cam.scale * cam.scale; // size → weight (screen px²), zoom-consistent
  const seeds: TerritorySeed[] = [];
  for (const p of planets) {
    const c = worldToScreen(p.position, cam, vp, bounds);
    seeds.push({
      x: c.x,
      y: c.y,
      w: (p.size ?? 1) * W,
      owner: p.owner ?? null,
      kind: p.kind ?? 'planet',
    });
  }
  if (seeds.length >= 2) {
    let geometry = geometryCaches.get(g);
    if (!geometry) { geometry = new TerritoryGeometryCache(); geometryCaches.set(g, geometry); }
    const cells = drawTerritory(g, seeds, clip, {
      ownerColor,
      neutralFill: NEUTRAL,
      kindAccent: (kind) => KIND_COLOR[kind],
      provinceDetail: lod.provinceDetail,
    }, geometry.project(seeds, clip, cam.scale));
    const selected = cells.find((cell) => planets[cell.idx]?.id === opts.selected);
    if (selected) drawProvinceSelection(g, selected.poly);
  }

  // Roads (ROADS-4), over the territory fill: the road NETWORK the core flies fleets along —
  // trails, forks, crossings on the shared border — each piece once (`roadStrokes`, the same
  // decision the prototype draws with). Straight lanes here put ships off the drawn lines,
  // since `fleetPositionAt` already walks the roads; a lane without roads is still the
  // straight line (the core's own fallback).
  g.lineWidth = 0.7;
  g.strokeStyle = rgba(theme.cyan, 0.28 * lod.provinceDetail);
  g.beginPath();
  for (const line of roadStrokes(state.planets)) {
    const pts = line.map((p) => worldToScreen(p, cam, vp, bounds));
    const xs = pts.map((p) => p.x);
    const ys = pts.map((p) => p.y);
    if (Math.max(...xs) < vp.left || Math.min(...xs) > vp.right ||
      Math.max(...ys) < vp.top || Math.min(...ys) > vp.bottom) continue;
    g.moveTo(pts[0]!.x, pts[0]!.y);
    for (let i = 1; i < pts.length; i++) g.lineTo(pts[i]!.x, pts[i]!.y);
  }
  g.stroke();
  // Forks — a place, not a bend: standing on one catches everyone on its trail (ROADS-3).
  if (lod.provinceDetail > 0) {
    g.fillStyle = rgba(theme.cyan, 0.55 * lod.provinceDetail);
    for (const mark of forkMarks(state.planets)) {
      const c = worldToScreen(mark.at, cam, vp, bounds);
      if (inView(c, vw, vh, 6)) drawForkMark(g, c.x, c.y);
    }
  }

  // Planet nodes — a holographic sphere + owner aura + a floating type badge + id label.
  const R = 8;
  for (const p of planets) {
    const c = worldToScreen(p.position, cam, vp, bounds);
    if (!inView(c, vw, vh, 44)) continue;
    const col = p.owner ? ownerColor(p.owner) : NEUTRAL;
    if (lod.art < 1) {
      g.save();
      g.globalAlpha *= 1 - lod.art;
      drawSchematicNode(g, c, lod.markerRadius);
      g.restore();
    }
    if (lod.art === 0 && p.id !== opts.selected) continue;
    if (lod.art > 0) {
      g.save();
      g.globalAlpha *= lod.art;
      blitGlow(g, opts.dpr, col, c.x, c.y, R + 14, p.owner ? 0.12 : 0.045);
      blitSphere(g, opts.dpr, col, c.x, c.y, R, 1, lod.detail > 0 ? opts.visualTime ?? 0 : 0);
      g.restore();
    }
    // floating type badge — the sector kind, glowing in its accent colour just above the node
    const icon = KIND_ICON[p.kind ?? ''];
    if (icon && lod.detail > 0) {
      const kc = KIND_COLOR[p.kind ?? ''] ?? theme.cyan;
      g.save();
      g.globalAlpha *= lod.detail;
      g.font = '700 12px ui-monospace, monospace';
      g.textAlign = 'center';
      g.textBaseline = 'middle';
      g.shadowColor = kc;
      g.shadowBlur = 5;
      g.fillStyle = rgba(kc, 0.95);
      g.fillText(icon, c.x, c.y - R - 12);
      g.restore();
    }
    if (lod.detail === 0 && p.id !== opts.selected) continue;
    g.save();
    g.globalAlpha *= p.id === opts.selected ? 1 : lod.detail;
    g.font = '10px ui-monospace, monospace';
    g.textAlign = 'left';
    g.textBaseline = 'alphabetic';
    g.fillStyle = theme.ink;
    g.fillText(p.id, c.x + R + 6, c.y + 3);
    g.restore();
  }

  // Selection reticle — a bright ring + corner brackets around the picked planet.
  if (opts.selected) {
    const sp = state.planets[opts.selected];
    if (sp) {
      const c = worldToScreen(sp.position, cam, vp, bounds);
      const rr = R + 8;
      g.save();
      g.strokeStyle = rgba('#7df0d0', 0.95);
      g.lineWidth = 2;
      g.beginPath();
      g.arc(c.x, c.y, rr, 0, Math.PI * 2);
      g.stroke();
      g.beginPath();
      for (const [dx, dy] of [
        [-1, -1],
        [1, -1],
        [1, 1],
        [-1, 1],
      ] as const) {
        g.moveTo(c.x + dx * rr, c.y + dy * (rr - 4));
        g.lineTo(c.x + dx * rr, c.y + dy * rr);
        g.lineTo(c.x + dx * (rr - 4), c.y + dy * rr);
      }
      g.stroke();
      g.restore();
    }
  }

  // Same holographic hulls and modifiers as the playable client. The caller supplies
  // its server-filtered state; this pass never reconstructs hidden fleet composition.
  for (const f of Object.values(state.fleets)) {
    const pt = fleetPositionAt(state, f, opts.now);
    if (!pt) continue;
    const c = worldToScreen(pt, cam, vp, bounds);
    if (!inView(c, vw, vh, 24)) continue;
    const col = colors.get(f.owner) ?? theme.cyan;
    if (ambushOf(state, f)) drawAmbushMark(g, c.x, c.y, col);
    if (lod.detail > 0) blitGlow(g, opts.dpr, col, c.x, c.y, 10, 0.5 * lod.detail);
    const dom = dominantUnit(f.units, opts.data);
    const shape = dom && unitShape(dom.def, dom.unit, state.players[f.owner]?.faction);
    g.save();
    g.translate(c.x, c.y);
    g.strokeStyle = col;
    if (!dom || !shape) {
      // Unknown contact: no made-up class, no inferred ship portrait.
      g.beginPath();
      g.arc(0, 0, 4, 0, Math.PI * 2);
      g.stroke();
      g.restore();
      continue;
    }
    const ships = emblemTally(f.units, [], (id) => (opts.data.units[id]?.traits ?? []).includes('shuttle')).ships;
    // Reset the ship transform before drawing screen-aligned count text.
    g.restore();
    drawFleetCount(g, c.x - fleetCountWidth(g, ships) / 2, c.y + 20, ships, col);
    g.save();
    g.translate(c.x, c.y);
    g.strokeStyle = col;
    const k = glyphScale(unitSizeClass(dom.def.stats.hp));
    if (lod.detail > 0) {
      const stack = f.units.find((st) => st.unit === dom.unit && st.count > 0)!;
      if (glyphHalo(unitArchetype(dom.def), (effectiveStats(dom.def, stack, opts.data).shield ?? 0) > 0)) {
        g.setLineDash([2.6, 2.8]);
        g.beginPath();
        g.arc(0, 0, 12.5 * k + 2, 0, Math.PI * 2);
        g.stroke();
        g.setLineDash([]);
      }
    }
    g.scale(k, k);
    g.translate(-12, -12);
    g.fillStyle = rgba(col, 0.24);
    drawShipShape(g, shape, lod.detail > 0.5);
    g.restore();
  }
}
