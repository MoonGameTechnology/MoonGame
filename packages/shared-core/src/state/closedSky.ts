/**
 * ЗАКРЫТОЕ НЕБО (решение владельца 2026-11-19: «пролетающая авиация через звезду или
 * чёрную дыру выглядела бы странно»). Авиация не летает над провинциями вида с
 * `overflight: false` — звездой, чёрной дырой и кольцами вокруг них: путь вылета, перелёта
 * и ракеты не проходит над ними, патруль над ними не встаёт.
 *
 * Удару через светило это почти ничего не запрещает: рука вылета (до 260) короче, чем от
 * соседей до той стороны кольца. Правило держит то, что размером не закрыть: патруль,
 * который ставится в любую точку, и перелёт (до 520).
 *
 * Небо меряется по ТОЙ ЖЕ мозаике, что рисует карта и из которой выведены дороги
 * (`mosaic.ts`): точка лежит в провинции, у которой её степень `|p − s|² − w` меньше, чем
 * у любой другой, с весами после того же `clampPowerWeights`. Своя приблизительная копия
 * (круг вокруг звезды) разошлась бы с нарисованной границей: игрок видел бы путь в обход
 * кольца, а ядро его отбивало бы.
 *
 * Считается точно, без выборки точек: на отрезке `a + t·d` разность степеней двух провинций
 * ЛИНЕЙНА по `t` (квадратичный член у всех один), поэтому кусок отрезка внутри ячейки —
 * пересечение полупрямых, один проход по провинциям на каждую закрытую. Только `+ − * /`.
 */
import type { GameData } from '../data/schemas';
import type { GameState } from './gameState';
import { SEED_WEIGHT, clampPowerWeights } from './mosaic';
import { isForkSite } from './forkSite';

/** Short of this many map units over a closed province, a path only grazes a corner of
 *  its border — not a flight over the star. */
const GRAZE = 1;

/** The mosaic's sites with their clamped weights, and which of them close the sky. Build
 *  once per handler: the clamp walks every pair of provinces. */
export interface ClosedSky {
  readonly sites: ReadonlyArray<{ x: number; y: number; w: number }>;
  readonly closed: readonly number[];
}

type XY = { x: number; y: number };

/** The closed sky of the map in `state`. A map without such provinces costs nothing.
 *  A fortress site (on a road fork or a province berth, `isForkSite`) is a node of the
 *  state but not a cell of the mosaic (`buildFromMap.ts` and the map draw only the map's
 *  provinces): counted as a site it would carve its own cell out of the ring next to it,
 *  and aviation would fly over a ring the player sees whole. */
export function closedSky(state: Pick<GameState, 'planets'>, data: GameData): ClosedSky {
  const ids = Object.keys(state.planets)
    .filter((id) => !isForkSite(state.planets[id]))
    .sort();
  const closed = ids.flatMap((id, i) =>
    data.sectorKinds[state.planets[id]!.kind ?? '']?.overflight === false ? [i] : [],
  );
  if (closed.length === 0) return { sites: [], closed };
  // The build walks every pair of provinces (`clampPowerWeights`), and the world is a new
  // object at every step while its mosaic stays the same all match: the last sky is kept
  // per catalogue, keyed by exactly what it is built from.
  const sites = ids.map((id) => {
    const p = state.planets[id]!;
    return { x: p.position.x, y: p.position.y, w: (p.size ?? 1) * SEED_WEIGHT };
  });
  const last = LAST_SKY.get(data);
  if (last && sameSky(last, ids, sites, closed)) return last.sky;
  const raw = sites.map((s) => ({ ...s }));
  clampPowerWeights(sites);
  const sky = { sites, closed };
  LAST_SKY.set(data, { ids, raw, sky });
  return sky;
}

/** The last sky {@link closedSky} built for a catalogue, with the provinces and unclamped
 *  weights it was built from. A memo, not state: the answer is the same function of them. */
const LAST_SKY = new WeakMap<
  GameData,
  { ids: readonly string[]; raw: ReadonlyArray<{ x: number; y: number; w: number }>; sky: ClosedSky }
>();

function sameSky(
  last: NonNullable<ReturnType<typeof LAST_SKY.get>>,
  ids: readonly string[],
  sites: ReadonlyArray<{ x: number; y: number; w: number }>,
  closed: readonly number[],
): boolean {
  if (last.ids.length !== ids.length || last.sky.closed.length !== closed.length) return false;
  for (let i = 0; i < closed.length; i++) if (last.sky.closed[i] !== closed[i]) return false;
  for (let i = 0; i < ids.length; i++) {
    const a = last.raw[i]!;
    const b = sites[i]!;
    if (last.ids[i] !== ids[i] || a.x !== b.x || a.y !== b.y || a.w !== b.w) return false;
  }
  return true;
}

/** Does the straight path from `a` to `b` pass over closed sky? `a === b` asks about the
 *  point itself (a patrol standing over it). */
export function crossesClosedSky(sky: ClosedSky, a: XY, b: XY): boolean {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const len2 = dx * dx + dy * dy;
  for (const i of sky.closed) {
    const si = sky.sites[i]!;
    const ax = a.x - si.x;
    const ay = a.y - si.y;
    const own = ax * ax + ay * ay - si.w;
    // The stretch of the path inside cell i: every other site loses on it.
    let lo = 0;
    let hi = 1;
    for (let j = 0; j < sky.sites.length && lo < hi; j++) {
      if (j === i) continue;
      const sj = sky.sites[j]!;
      const bx = a.x - sj.x;
      const by = a.y - sj.y;
      const c = own - (bx * bx + by * by - sj.w);
      const k = 2 * (dx * (sj.x - si.x) + dy * (sj.y - si.y));
      // i wins over j while c + k·t < 0.
      if (k === 0) {
        if (c >= 0) hi = lo;
        continue;
      }
      const t = -c / k;
      if (k > 0) {
        if (t < hi) hi = t;
      } else if (t > lo) {
        lo = t;
      }
    }
    if (hi <= lo) continue;
    if (len2 === 0) return true;
    const span = hi - lo;
    if (span * span * len2 > GRAZE * GRAZE) return true;
  }
  return false;
}
