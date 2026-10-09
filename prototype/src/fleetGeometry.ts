/**
 * Геометрия флотов на карте (REFM-238): где флот стоит и куда целится. Позиция флота в
 * мире (`fleetPos`) и её проекция (`fleetOriginPx`), база и сам вылет (`strikeBasePos`,
 * `strikeWorldPos`), точка боя (`battleAnchor`), шеврон на орбитальном кольце или в строю
 * боя (`fleetAnchor`: кольцо, слоты, фаза вращения), флоты под приказ (`selectedFleetIds`),
 * точка на дороге под пальцем и расчёт марша к ней (`nearestLanePoint`, `laneAim`),
 * крепость и свободная развилка под пальцем (`forkFortressAt`, `forkMarkAt`).
 *
 * Своё состояние у модуля одно — фаза вращения орбит: её крутил кадр, а робот прокрутки
 * обнулял присваиванием. Теперь кадр зовёт дверь {@link spinOrbits}, а снаружи фаза только
 * для чтения.
 *
 * Мир на экране, своё место, часы картинки (в сети они досчитывают снимок), детализация
 * карты, развилки из кэша дорог и раскладка орбит из кэша кадра живут в `main.ts`; модуль
 * получает их хуками {@link initFleetGeometry} — импорт оттуда был бы циклом.
 */
import {
  estimateTravelHours,
  fleetTravelSpeed,
  forkSiteId,
  isForkSite,
  laneRoad,
  laneRoadLength,
  legT,
  pointAlong,
  snapToFork,
  type Battle,
  type Fleet,
  type GameState,
  type StrikeBase,
} from '../../packages/shared-core/src/index';
import { isOrdnanceFleet } from '../../packages/shared-core/src/state/ordnance';
import type { MapLod } from '../../packages/client/src/mapLod';
import { battleStance } from '../../decisions/battleStance';
import { EMPLACEMENT_HEADING, isEmplacementFleet } from '../../decisions/emplacement';
import type { OrbitSeats } from '../../decisions/orbitSeats';
import { nearestSegment } from '../../decisions/pointerPick';
import { lanePieceT, lanePieces, roadHeading, type ForkMark } from '../../decisions/roadNetwork';
import { clashPoint } from './battleMark';
import { fleetOrigin } from './fleetOrigin';
import { data } from './gameData';
import { selFleet, selFleets } from './interaction';
import { world } from './mapCamera';
import { known } from './mapFog';
import { chevronAngle, orbitBloom, orbitRadius, slotAngle } from './orbitRing';
import { ctx } from './protoKernel';
import { lanes } from './setupMap';
import { strikeHome, strikeLeg, strikeProgress } from './strikeTrail';

/** Что геометрии флотов нужно от игры. Мир, часы картинки и кэши кадра — в `main.ts`. */
export interface FleetGeometryHost {
  /** Мир на экране. */
  world(): GameState;
  /** Своё место. */
  me(): string;
  /** Игровое «сейчас» для картинки движения: в сети — время снимка, досчитанное до кадра. */
  now(): number;
  /** Детализация карты при текущем зуме: открыты ли орбиты и как раздут их радиус. */
  lod(): MapLod;
  /** Развилки дорог этого мира — из кэша нарисованных дорог. */
  forkMarks(): readonly ForkMark[];
  /** Кто где стоит у миров: кольца и строи боёв — раз на мир, из кэша кадра. */
  orbits(): OrbitSeats<Fleet>;
}

let game: FleetGeometryHost;

/** Поднять геометрию флотов: хуки игры. Зовётся из `main.ts` один раз, до первого кадра. */
export function initFleetGeometry(host: FleetGeometryHost): void {
  game = host;
}

/** Где флот НАХОДИТСЯ по правилам, в МИРОВЫХ координатах — правила и вся интерполяция
 *  живут чистой моделью `fleetOrigin.ts`; здесь остаётся подстановка живого состояния. */
export function fleetPos(f: Fleet): { x: number; y: number } | null {
  const s = game.world();
  // По ДОРОГЕ лейна (ROADS-2) — тем же счётом, что ядро (`fleetPositionAt`).
  return fleetOrigin(
    f,
    game.now(),
    (id) => s.planets[id]?.position ?? null,
    (from, to, t) => {
      const road = laneRoad(s, from, to);
      return road ? pointAlong(road, t) : null;
    },
  );
}
/** Где сейчас БАЗА вылета — космопорт мира или носитель. Точка живая (правило 2
 *  `strikeTrail.ts`): носитель волен уйти, пока челноки летят. */
export function strikeBasePos(base: StrikeBase): { x: number; y: number } | null {
  const s = game.world();
  if (base.kind === 'planet') return s.planets[base.id]?.position ?? null;
  const f = s.fleets[base.id];
  return f ? fleetPos(f) : null;
}
/** Где сейчас САМ вылет — по времени мира, тем же счётом, что рисует трассу. */
export function strikeWorldPos(strikeId: string): { x: number; y: number } | null {
  const st = (game.world().strikes ?? []).find((x) => x.id === strikeId);
  if (!st) return null;
  const home = strikeHome(st, strikeBasePos); // погибший корабль — его последняя точка
  if (!home) return null;
  const [from, to] = strikeLeg(st, home);
  const k = strikeProgress(st, game.now());
  return { x: from.x + (to.x - from.x) * k, y: from.y + (to.y - from.y) * k };
}
/** Та же точка отсчёта, спроецированная НА ЭКРАН.
 *
 *  Отсюда меряют дальности способностей и отсюда выходят линии маршрутов — потому что
 *  ровно эту точку знает ядро (`hero.ability` меряет `E_OUT_OF_RANGE` от позиции узла).
 *  Не путать с `fleetAnchor`: тот отдаёт слот на орбитальном кольце — он кружит вокруг
 *  планеты и годится ТОЛЬКО чтобы нарисовать шеврон и поймать по нему тап. */
export function fleetOriginPx(f: Fleet): { x: number; y: number } | null {
  const p = fleetPos(f);
  return p ? world(p) : null;
}
/** Where to draw a battle: the position of a fleet engaged in it (so a mid-lane
 *  intercept renders at the crossing point, not the nearest node), falling back to
 *  the battle's node when no participant is in view. */
export function battleAnchor(b: Battle): { x: number; y: number } | null {
  const s = game.world();
  // Точка схватки — у ВОЮЮЩЕГО флота, и только если её нет — узел (`battleMark.ts`,
  // REFM-118): перехват идёт там, где корабли встретились, а не в ближайшем мире.
  const fighting = Object.values(s.fleets)
    .filter((f) => f.battleId === b.id)
    .map((f) => fleetPos(f));
  return clashPoint(fighting, s.planets[b.location]?.position ?? null);
}

/** The fleets the command bar / move order currently act on (mine only). */
export function selectedFleetIds(): string[] {
  const s = game.world();
  const ME = game.me();
  // Мина (SM-3.6), ракета (SM-3.7b) и крепость (`emplacement.ts`, правило 4) — не флоты
  // под приказ: в выбор для приказов они не попадают.
  const orderable = (id: string): boolean =>
    s.fleets[id]?.owner === ME &&
    !isOrdnanceFleet(s.fleets[id]!, data) &&
    !isEmplacementFleet(s.fleets[id]!, data);
  if (selFleets.size) return [...selFleets].filter(orderable);
  return selFleet && orderable(selFleet) ? [selFleet] : [];
}

// Порог открытия слоя, раздутие радиуса, потолок по соседу и веер слотов — правила
// `orbitRing.ts` (REFM-94); здесь остаётся только замер зазора на экране.
/** Фаза вращения орбит: накопленное время мира в мс (на паузе стоит). Снаружи только
 *  для чтения: крутит её кадр дверью {@link spinOrbits}. */
export let orbitPhase = 0; // accumulated sim-time ms (frozen on pause) — drives the orbit spin
/** Провернуть орбиты на `dt` мс времени мира — кадр, когда вращение идёт. */
export function spinOrbits(dt: number): void {
  orbitPhase += dt;
}
/** Ring/animation are gated on the same close-zoom threshold. */
function orbitsLive(): boolean {
  return game.lod().detail > 0;
}
/** Orbit-ring radius for a planet at the current zoom, in screen px. The ring blooms with
 *  zoom but is capped to a fraction of the on-screen gap to the nearest LINKED neighbour,
 *  so it never spills onto the adjacent sectors. Fleets sit on this same radius (so a
 *  chevron never floats off the ring). */
export function orbitRingRadius(pl: {
  position: { x: number; y: number };
  links?: string[];
}): number {
  const s = game.world();
  const pc = world(pl.position);
  let nearest = Infinity;
  for (const nb of pl.links ?? []) {
    const np = s.planets[nb];
    if (!np) continue;
    const npc = world(np.position);
    nearest = Math.min(nearest, Math.hypot(npc.x - pc.x, npc.y - pc.y));
  }
  return orbitRadius(orbitBloom(game.lod().scale), nearest);
}
/** Angular position (radians) of a stationed fleet's orbit slot at index `idx` of
 *  `nPeers` sharing the ring — fanned out, and spinning when zoomed in close. */
function orbitAngle(idx: number, nPeers: number): number {
  return slotAngle(idx, nPeers, orbitPhase, orbitsLive());
}

/** Строй боя раскладывается раз на строй: строй — массив из раскладки мира (`orbitSeats`),
 *  новый мир даёт новые массивы, а смотрящий входит в ключ памяти мира. */
const stances = new WeakMap<readonly Fleet[], ReturnType<typeof battleStance>>();
function stanceOf(fighting: readonly Fleet[]): ReturnType<typeof battleStance> {
  let stance = stances.get(fighting);
  if (!stance) stances.set(fighting, (stance = battleStance(fighting, game.me())));
  return stance;
}

/** Screen anchor (+ heading) for a fleet's chevron: the interpolated lane
 *  position while moving, or a slot on the orbit ring while stationed
 *  (fleets sharing the ring are fanned out so they don't overlap).
 *
 *  ТОЛЬКО КАРТИНКА И ПАЛЕЦ. Слот на кольце кружит вокруг планеты (`orbitRing.ts`),
 *  поэтому мерить отсюда нельзя ничего: дальности способностей и начала маршрутов
 *  берут `fleetOriginPx` — точку, которую знает ядро. Здесь же остаются отрисовка
 *  шеврона, попадание тапом/рамкой по нему и привязка меню к его картинке. */
export function fleetAnchor(f: Fleet): { x: number; y: number; ang: number } | null {
  const s = game.world();
  // Крепость стоит в точке постройки носом вверх — ни кольца, ни строя боя
  // (`emplacement.ts`, правило 2). На развилке эта точка — на дороге, на узле — его центр.
  if (isEmplacementFleet(f, data)) {
    const at = fleetPos(f);
    return at ? { ...world(at), ang: EMPLACEMENT_HEADING } : null;
  }
  if (f.movement || !f.location) {
    const mp = fleetPos(f);
    if (!mp) return null;
    const c = world(mp);
    let ang = -Math.PI / 2;
    const lane = f.movement ?? f.edge; // heading = along the lane it is on
    if (lane) {
      // Нос — вдоль КУСКА ДОРОГИ, на котором корабль (ROADS-4, `roadHeading`), а не по
      // прямой «мир → мир»: на ветке развилки та смотрела бы мимо дороги.
      const road = laneRoad(s, lane.from, lane.to);
      const t = f.movement ? legT(f.movement, game.now()) : (f.edge?.t ?? 0);
      const d = road ? roadHeading(road, t) : { x: 0, y: 0 };
      if (d.x !== 0 || d.y !== 0) {
        const wa = world(mp);
        const wb = world({ x: mp.x + d.x, y: mp.y + d.y });
        ang = Math.atan2(wb.y - wa.y, wb.x - wa.x);
      }
    }
    return { x: c.x, y: c.y, ang };
  }
  const pl = s.planets[f.location];
  if (!pl) return null;
  const pc = world(pl.position);
  // Кольца и строи всех миров — одним проходом на мир, а не проходом по всем флотам на
  // каждый флот (`orbitSeats.ts`).
  const seats = game.orbits();
  // Боевая стойка (заказ владельца 2026-09-23): флот в бою не кружит — стоит в строю своей
  // стороны лицом к противнику (`decisions/battleStance.ts`).
  if (f.battleId) {
    const slot = stanceOf(seats.fight(f.battleId, f.location)).get(f.id);
    if (slot) {
      const r = orbitRingRadius(pl);
      return {
        x: pc.x + Math.cos(slot.angle) * r,
        y: pc.y + Math.sin(slot.angle) * r,
        ang: slot.heading,
      };
    }
  }
  // a single orbit: every stationed (non-transit, not fighting) fleet here shares the one ring
  // Крепость слота на кольце не занимает (`emplacement.ts`, правило 3).
  const { idx, peers } = seats.ring(f.id, f.location);
  const a0 = orbitAngle(idx, peers);
  const r = orbitRingRadius(pl);
  // when circling, the chevron faces along its travel (tangent); static = radial as before
  const ang = chevronAngle(a0, orbitsLive());
  return { x: pc.x + Math.cos(a0) * r, y: pc.y + Math.sin(a0) * r, ang };
}

/** The closest point ON a lane to a screen point: which lane (`from`,`to`), the
 *  fraction `t` along it and its screen position — or null if none within `maxPx`.
 *  Lets the player march an army to any point on a road (Bytro continuous order). */
export function nearestLanePoint(
  mx: number,
  my: number,
  maxPx = 14,
): { from: string; to: string; t: number; x: number; y: number } | null {
  const s = game.world();
  // Перечень трасс — `lanes()` (`setupMap.ts`, правило 7): «каждая трасса ровно один
  // раз» здесь стояло СВОЕЙ копией сравнения идентификаторов, третьей в файле после
  // мини-карты и печати статического слоя. Разъедься копии — и игрок целился бы в
  // дорогу, которой в списке заказа нет: нарисована, а марш на неё не встаёт.
  // Узлы сразу в ЭКРАННЫХ координатах: попадание пальца считается там же, где палец.
  const nodes = Object.values(s.planets).map((p) => ({
    id: p.id,
    ...world(p.position),
    links: p.links ?? [],
  }));
  // Прижатие к отрезку и выбор ближайшей трассы — `pointerPick.ts` (REFM-128). Трасса —
  // ДОРОГА (ROADS-2): ловим нарисованную ломаную по кускам, а долю переводим в долю всей
  // дороги лейна — ею ядро и держит точку стоянки (`roadNetwork.ts`).
  const pieces = lanes(nodes).flatMap((l) => {
    const road = laneRoad(s, l.from.id, l.to.id);
    return road ? lanePieces(l.from.id, l.to.id, road) : [];
  });
  // Доли — по МИРОВОЙ дороге (их знает ядро), экран — только для расстояния до пальца:
  // доля вдоль отрезка при проекции не меняется.
  const hit = nearestSegment(
    pieces,
    (piece) => ({ a: world(piece.a), b: world(piece.b) }),
    mx,
    my,
    maxPx,
  );
  if (!hit) return null;
  const { from, to } = hit.seg;
  const raw = lanePieceT(hit.seg, hit.at.t);
  // У развилки ядро ставит флот НА неё (`snapToFork`, ROADS-3) — туда же и целимся, иначе
  // прицел обещал бы одну точку, а приказ встал бы в другую.
  const t = snapToFork(s, from, to, raw);
  const road = t === raw ? null : laneRoad(s, from, to);
  const at = road ? world(pointAlong(road, t)) : hit.at;
  return { from, to, t, x: at.x, y: at.y };
}

/** Крепость на развилке под пальцем (FORT-6.1): её площадки нет в `MAP` — она не узел
 *  карты, — поэтому попадание ищется по состоянию. Только стоящая и видимая: пустая
 *  площадка — это развилка, и тап по ней выбирает место, а не мир. */
export function forkFortressAt(mx: number, my: number, r: number): string | null {
  const s = game.world();
  const ME = game.me();
  let best: string | null = null;
  let bestD = r * r;
  for (const p of Object.values(s.planets)) {
    if (!isForkSite(p) || p.owner === null || !(p.owner === ME || known(p.id))) continue;
    const c = world(p.position);
    const d = (c.x - mx) * (c.x - mx) + (c.y - my) * (c.y - my);
    if (d <= bestD) {
      bestD = d;
      best = p.id;
    }
  }
  return best;
}

/** Свободная развилка под пальцем — место, куда ставят крепость (FORT-6.1). Развилка с
 *  крепостью сюда не попадает: тап по ней — выбор самой крепости (`forkFortressAt`). */
export function forkMarkAt(mx: number, my: number, r: number): ForkMark | null {
  const s = game.world();
  let best: ForkMark | null = null;
  let bestD = r * r;
  for (const m of game.forkMarks()) {
    if ((s.planets[forkSiteId(m.province, m.trail)]?.owner ?? null) !== null) continue;
    const c = world(m.at);
    const d = (c.x - mx) * (c.x - mx) + (c.y - my) * (c.y - my);
    if (d <= bestD) {
      bestD = d;
      best = m;
    }
  }
  return best;
}

/** For a march to a lane point: which endpoint the fleet routes through and the
 *  total ETA (node route + the partial leg into the lane), mirroring the kernel's
 *  cheaper-end choice. Used only for the move preview. */
export function laneAim(
  f: Fleet,
  from: string,
  lane: { from: string; to: string; t: number },
): { endId: string; hrs: number } {
  const s = game.world();
  const rules = ctx(s.time);
  const speed = fleetTravelSpeed(f, rules) || 1;
  // The lane's ROAD length (ROADS-2): `t` is a share of the road, so is the partial leg.
  const len = laneRoadLength(s, lane.from, lane.to);
  const toNode = (to: string): number =>
    from === to ? 0 : (estimateTravelHours(s, rules, from, to, f) ?? Infinity);
  const hFrom = toNode(lane.from) + (len * lane.t) / speed; // reach `from`, then advance t
  const hTo = toNode(lane.to) + (len * (1 - lane.t)) / speed; // reach `to`, then back (1-t)
  return hFrom <= hTo ? { endId: lane.from, hrs: hFrom } : { endId: lane.to, hrs: hTo };
}
