/**
 * Карта главы в меню Sector Zero — что игрок о ней уже знает (заказ владельца 2026-09-23:
 * «справа должна открываться панель с картой, где видно, что игрок разведал, а что нет»).
 *
 * Та же мозаика провинций, что у игровой карты: клетки строит `computePowerCells` по
 * центрам и размерам секторов, рамка — `mosaicFrame` ядра. Своей геометрии тут нет —
 * иначе карта в меню разошлась бы с той, по которой потом летают флоты.
 *
 * Знание — ПАМЯТЬ ТУМАНА прошлых забегов (`SectorZeroProgress.chapterScouted`) плюс
 * стартовые провинции игрока: их он знает до первого забега. Про неопознанное панель не
 * говорит ничего — ни вида, ни хозяина, ни проходов: это была бы разведка даром.
 */
import { mosaicFrame, SEED_WEIGHT, type GameState } from '../packages/shared-core/src/index';
import { computePowerCells } from '../packages/client/src/territory';

/** Кому принадлежит опознанная провинция — глазами игрока на старте главы. */
export type ChapterCellSide = 'you' | 'hostile' | 'neutral';

export interface ChapterMapCell {
  id: string;
  poly: Array<[number, number]>;
  /** Центр — для отметки задачи. */
  x: number;
  y: number;
  known: boolean;
  /** Только у опознанной: вид сектора и сторона. У неопознанной — `null`. */
  kind: string | null;
  side: ChapterCellSide | null;
  /** Цель задачи главы (заказ владельца 2026-09-24: «на карте главы рисовать доступные и
   *  активные задания»): `active` — задача следующего забега, `later` — откроется позже
   *  из запаса главы, `null` — не цель или задача уже выполнена. */
  objective: 'active' | 'later' | null;
}

/** Провинции-цели задач главы: активные (видны в следующем забеге) и те, что позже. */
export interface ChapterTargets {
  active: readonly string[];
  later: readonly string[];
}

export interface ChapterMapView {
  /** Рамка карты в мировых единицах — `viewBox` панели. */
  frame: { x: number; y: number; w: number; h: number };
  cells: ChapterMapCell[];
  /** Проходы между ДВУМЯ опознанными провинциями — остальные скрыты туманом. */
  lanes: Array<[number, number, number, number]>;
  known: number;
  total: number;
}

/**
 * Цели задач главы на её карте. `control` называет провинции — метятся всегда: задача сама
 * говорит, куда идти, и клетка на карте есть и в тумане (без вида и хозяина). `raze`
 * метит провинции со стоящей постройкой названного вида — только ОПОЗНАННЫЕ: иначе метка
 * выдала бы разведку, которой не было. У `build`, `scout` и `wave` одной точки нет.
 * Выполненные задачи в `pool` уже не входят — закрытое не зовёт на карту.
 */
export function chapterTargets(
  state: GameState,
  pool: ReadonlyArray<{ id: string; kind: string; targets?: readonly string[] }>,
  active: ReadonlySet<string>,
  known: ReadonlySet<string>,
): ChapterTargets {
  const where = (o: (typeof pool)[number]): string[] => {
    if (o.kind === 'control') return (o.targets ?? []).filter((id) => state.planets[id]);
    if (o.kind === 'raze') {
      const kinds = new Set(o.targets ?? []);
      return Object.values(state.planets)
        .filter((p) => known.has(p.id) && p.buildings.some((b) => kinds.has(b.type) && b.hp > 0))
        .map((p) => p.id)
        .sort();
    }
    return [];
  };
  const now = pool.filter((o) => active.has(o.id)).flatMap(where);
  const nowSet = new Set(now);
  return {
    active: [...new Set(now)],
    later: [...new Set(pool.filter((o) => !active.has(o.id)).flatMap(where))].filter(
      (id) => !nowSet.has(id),
    ),
  };
}

/**
 * Модель панели. `state` — стартовое состояние главы (`pveState`), `scouted` — память
 * тумана из профиля, `targets` — провинции-цели задач главы (`chapterTargets`).
 */
export function chapterMapView(
  state: GameState,
  scouted: readonly string[],
  player = 'p1',
  targets: ChapterTargets = { active: [], later: [] },
): ChapterMapView {
  const planets = Object.values(state.planets).sort((a, b) =>
    a.id < b.id ? -1 : a.id > b.id ? 1 : 0,
  );
  const knownIds = new Set([
    ...scouted,
    ...planets.filter((p) => p.owner === player).map((p) => p.id),
  ]);
  const seeds = planets.map((p) => ({
    x: p.position.x,
    y: p.position.y,
    w: SEED_WEIGHT * (p.size ?? 1),
    owner: p.owner,
    kind: p.kind ?? 'planet',
  }));
  const f = mosaicFrame(
    planets.map((p) => ({ id: p.id, x: p.position.x, y: p.position.y, size: p.size ?? 1 })),
  );
  const clip: Array<[number, number]> = [
    [f.x0, f.y0],
    [f.x1, f.y0],
    [f.x1, f.y1],
    [f.x0, f.y1],
  ];
  const cells = computePowerCells(seeds, clip).map((c): ChapterMapCell => {
    const p = planets[c.idx]!;
    const known = knownIds.has(p.id);
    return {
      id: p.id,
      poly: c.poly,
      x: p.position.x,
      y: p.position.y,
      known,
      kind: known ? (p.kind ?? 'planet') : null,
      side: !known ? null : p.owner === player ? 'you' : p.owner ? 'hostile' : 'neutral',
      objective: targets.active.includes(p.id)
        ? 'active'
        : targets.later.includes(p.id)
          ? 'later'
          : null,
    };
  });
  const lanes: ChapterMapView['lanes'] = [];
  for (const p of planets) {
    if (!knownIds.has(p.id)) continue;
    for (const to of p.links ?? []) {
      const q = state.planets[to];
      if (q && p.id < q.id && knownIds.has(q.id))
        lanes.push([p.position.x, p.position.y, q.position.x, q.position.y]);
    }
  }
  return {
    frame: { x: f.x0, y: f.y0, w: f.x1 - f.x0, h: f.y1 - f.y0 },
    cells,
    lanes,
    known: planets.filter((p) => knownIds.has(p.id)).length,
    total: planets.length,
  };
}
