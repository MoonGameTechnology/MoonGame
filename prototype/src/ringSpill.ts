/**
 * The light of a body's ring spills past the ring into the provinces round it and fades
 * (owner 2026-11-19, as on the rings mockup: no hard cut at the ring's border): a soft halo
 * and motes in the ring's colour, drawn live over the map's bake (`mapSurface.ts`). The ring's
 * outer border lies about half again as far from the body as the centres of its provinces
 * (`ringReach`), and the light fades out over half that radius again. A body spills only
 * while one of its ring provinces is a known field of the bake, so fog keeps the ring
 * hidden. The motes drift and twinkle on the map's hologram clock: they stand still on pause
 * and with animation off.
 */
import { isCelestialRing, ringBodyOf, ringReach } from '../../decisions/celestialRing';
import { rgba } from '../../packages/client/src/holoDraw';
import type { TerrainField } from './holographicSurface';
import { RING_ART_COLORS } from './ringTerrainArt';

interface SpillNode {
  readonly id: string;
  readonly x: number;
  readonly y: number;
  readonly sector: string;
}

/** What the spill needs of the bake: its scale (bake units per map unit) and the map. */
export interface SpillGeometry {
  readonly at: { readonly a: number };
  readonly nodes: readonly SpillNode[];
}

/** The ring's outer border, in reaches of its provinces' centres. */
const BORDER = 1.5;
/** How far past the border the light goes, as a share of the border's radius. */
const SPILL = 0.5;
const MOTES = 40;
/** Below this border radius on screen (CSS px) the halo alone carries the light. */
const MOTES_FROM_PX = 40;
const TAU = Math.PI * 2;
/** Ring kind → the colour its light spills in: the disk's amber, a star ring's class light. */
const SPILL_COLOR: Readonly<Record<string, string>> = { accretion_disk: '#ffb26b', ...RING_ART_COLORS };

interface Spill {
  readonly body: SpillNode;
  /** The border's radius in map units. */
  readonly border: number;
}

/** Ring province id → its body and the border of the body's ring, once per map. */
const spills = new WeakMap<readonly SpillNode[], Map<string, Spill | null>>();

function spillOf(nodes: readonly SpillNode[], id: string, kind: string): Spill | null {
  let known = spills.get(nodes);
  if (!known) spills.set(nodes, (known = new Map()));
  let spill = known.get(id);
  if (spill === undefined) {
    spill = null;
    const node = nodes.find((n) => n.id === id);
    const body = node && ringBodyOf(nodes, node, kind);
    if (body) {
      // Every ring province of one body shares one entry: the reach is measured once.
      const twin = [...known.values()].find((s) => s?.body === body);
      const reach = twin ? twin.border / BORDER : ringReach(nodes, body);
      if (reach !== undefined) spill = { body, border: reach * BORDER };
    }
    known.set(id, spill);
  }
  return spill;
}

/** A repeatable 0…1 per integer: the motes keep their places from frame to frame. */
const hash = (k: number): number => {
  const v = Math.sin(k * 127.1 + 311.7) * 43758.5453;
  return v - Math.floor(v);
};

/**
 * Draws the spill of every body whose ring has a field in `fields`, in the bake's space (the
 * canvas transform already puts it on screen). `sight` is the part of the bake on screen, `k`
 * the bake's scale onto the screen, `clockMs` the hologram clock.
 */
export function drawRingSpills(
  cx: CanvasRenderingContext2D,
  fields: readonly TerrainField[],
  geo: SpillGeometry | null,
  sight: { x: number; y: number; width: number; height: number },
  k: number,
  clockMs: number,
): void {
  if (!geo) return;
  const drawn = new Set<SpillNode>();
  for (const field of fields) {
    if (!field.marker || !isCelestialRing(field.kind)) continue;
    const color = SPILL_COLOR[field.kind];
    const spill = color ? spillOf(geo.nodes, field.id, field.kind) : null;
    if (!spill || drawn.has(spill.body)) continue;
    drawn.add(spill.body);
    const border = spill.border * geo.at.a;
    const outer = border * (1 + SPILL);
    const { x, y } = field.marker;
    if (border * k < 4 || x + outer < sight.x || y + outer < sight.y ||
      x - outer > sight.x + sight.width || y - outer > sight.y + sight.height) continue;
    drawSpill(cx, x, y, border, k, color!, clockMs);
  }
}

function drawSpill(cx: CanvasRenderingContext2D, x: number, y: number, border: number, k: number, color: string, clockMs: number): void {
  const inner = border * 0.9;
  const outer = border * (1 + SPILL);
  const lit = cx.globalAlpha;
  const blend = cx.globalCompositeOperation;
  cx.globalCompositeOperation = 'screen';
  const glow = cx.createRadialGradient(x, y, inner, x, y, outer);
  glow.addColorStop(0, rgba(color, 0));
  glow.addColorStop((border - inner) / (outer - inner), rgba(color, 0.12));
  glow.addColorStop(1, rgba(color, 0));
  cx.fillStyle = glow;
  cx.beginPath();
  cx.arc(x, y, outer, 0, TAU);
  cx.arc(x, y, inner, 0, TAU, true);
  cx.fill();
  if (border * k >= MOTES_FROM_PX) {
    // Motes thin out with distance: most just past the border, the last ones far out. They
    // grow with the ring on screen, from a pixel and a half.
    const size = Math.max(1, (border * k) / 160) / k;
    cx.fillStyle = color;
    const t = clockMs / 1000;
    for (let i = 0; i < MOTES; i++) {
      const u = Math.pow(hash(i + 101), 1.6);
      const a = hash(i) * TAU + t * 0.01 * (hash(i + 7) - 0.5);
      const r = border * (0.96 + SPILL * u);
      const twinkle = 0.65 + 0.35 * Math.sin(t * 0.8 + i * 1.7);
      cx.globalAlpha = lit * 0.55 * Math.pow(1 - u, 1.5) * twinkle;
      cx.beginPath();
      cx.arc(x + Math.cos(a) * r, y + Math.sin(a) * r, (0.7 + hash(i + 13) * 0.9) * size, 0, TAU);
      cx.fill();
    }
  }
  cx.globalAlpha = lit;
  cx.globalCompositeOperation = blend;
}
