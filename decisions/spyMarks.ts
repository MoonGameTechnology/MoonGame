/**
 * ШПИОНЫ НА КАРТЕ (SPM-1, заказ владельца 2026-11-20): что из своих шпионов рисует карта.
 *
 * 1. **Только свои.** Чужого шпиона не видно ни в пути, ни на точке (решение владельца
 *    2026-11-20); вызывающий передаёт только собственный реестр.
 * 2. **В пути — корабль на лейне.** Шпион, летящий на задание или домой, стоит там, где он
 *    сейчас на своём пути (`Spy.way` ядра: миры и время каждого), с остатком маршрута до
 *    цели и концом пути. Путь старого сохранения не записан — тогда прямой отрезок от места
 *    вылета до цели по доле прошедшего времени: шпион всё равно прибудет вовремя.
 * 2а. **По дорогам — как флот** (замечание владельца 2026-11-21: «залетает в центральный узел
 *    провинции»). Мимо промежуточного мира шпион идёт по развилке тропы, в узел мира не
 *    заходит; корабль и пунктир берут одну дорогу с линией флота (`roadAhead`, `legEndT`).
 *    Время пути ядро считает по-прежнему: меняется только, где на дороге стоит корабль.
 *    Отозванный с полпути разворачивается с той же точки: обратный путь ядра начинается с
 *    мира впереди и не помнит, куда шпион летел дальше, поэтому вызывающий передаёт
 *    последний виденный путь туда (`outbound`), и лейн разворота меряется, как его летели.
 * 3. **На месте — значок у мира, а не корабль.** Шпионы, что стоят в мире (дома, ждут приказа
 *    или работают), сходятся в один значок «🕵 N» у его имени — как ангар (`hangarBadge.ts`):
 *    на карте на сто игроков отдельные корабли у каждого мира забили бы экран. Порядок
 *    шпионов значка — по номеру, одинаковый на всех клиентах.
 * 4. **Вербовка и «на дне» не рисуются:** такого шпиона нет нигде на карте.
 * 5. **Вспышка — по событию своего шпиона:** удача — зелёная, провал или потеря — красная,
 *    прибытие — бирюзовая, остальное — без вспышки.
 */
import type {
  GameState,
  PlanetId,
  RoadPoint,
  Spy,
  SpyWayPoint,
} from '../packages/shared-core/src/index';
import { forkTAtStart, legEndT, roadAhead, spyWayAt } from '../packages/shared-core/src/index';

/** Свой шпион в пути (правило 2). */
export interface SpyFlight {
  id: number;
  gen: number;
  /** Летит домой (а не на задание). */
  home: boolean;
  /** Лейн `a → b`, `f` его позади; `a === b` — стоит в мире. */
  a: PlanetId;
  b: PlanetId;
  f: number;
  /** Миры впереди, после `b`, до цели включительно. */
  ahead: PlanetId[];
  /** Миры позади, до `a` (без него), от места вылета. У отозванного первым идёт мир, к
   *  которому он летел за `a`, когда развернулся (если путь туда виден). */
  behind: PlanetId[];
  /** Цель пути. */
  target: PlanetId;
  /** Конец пути (мировое время). */
  until: number;
}

/** Значок мира со стоящими шпионами (правило 3). */
export interface SpySpot {
  planetId: PlanetId;
  spyIds: number[];
}

export interface SpyMarks {
  flights: SpyFlight[];
  spots: SpySpot[];
}

function straight(spy: Spy): SpyWayPoint[] | null {
  if (spy.from === undefined || spy.departedAt === undefined || spy.arrivesAt === undefined)
    return null;
  return [
    { at: spy.from, t: spy.departedAt },
    { at: spy.location, t: spy.arrivesAt },
  ];
}

/**
 * Куда летел дальше отозванный шпион (правило 2а): мир за точкой разворота на пути туда.
 * Обратный путь `back` ядра начинается с мира впереди, отмеченного в прошлом зеркально
 * (`spyTurnBack`): время этого мира на пути туда — `2 × departedAt − back[0].t`. По нему и по
 * соседнему миру путь туда узнаётся однозначно; чужой или старый путь — `undefined`.
 */
export function turnedOnTo(
  back: readonly SpyWayPoint[],
  departedAt: number | undefined,
  outbound: readonly SpyWayPoint[] | undefined,
): PlanetId | undefined {
  if (departedAt === undefined || !outbound || back.length < 2 || back[0]!.t >= departedAt)
    return undefined;
  const tAhead = 2 * departedAt - back[0]!.t;
  const i = outbound.findIndex(
    (p, k) =>
      k > 0 &&
      p.at === back[0]!.at &&
      outbound[k - 1]!.at === back[1]!.at &&
      Math.abs(p.t - tAhead) < 1,
  );
  return i < 0 ? undefined : outbound[i + 1]?.at;
}

/** Правила 1–4 для реестра `own` в мировое время `now`. `outbound` — последний виденный путь
 *  туда каждого шпиона (по номеру), для разворота отозванного (правило 2а). */
export function spyMarks(
  own: readonly Spy[] | undefined,
  now: number,
  outbound?: ReadonlyMap<number, readonly SpyWayPoint[]>,
): SpyMarks {
  const flights: SpyFlight[] = [];
  const byWorld = new Map<PlanetId, number[]>();
  for (const spy of own ?? []) {
    if (spy.state === 'travel' || spy.state === 'return') {
      const way = spy.way?.length ? spy.way : straight(spy);
      const at = way && spyWayAt(way, now);
      if (!way || !at) continue;
      // Индекс мира `b`: до вылета шпион стоит в первом мире и весь путь впереди, после
      // прибытия — в последнем, и впереди ничего.
      const next = now <= way[0]!.t ? 0 : way.findIndex((p) => p.t > now);
      const ahead = next < 0 ? [] : way.slice(next + 1).map((p) => p.at);
      const behind = way.slice(0, next < 0 ? -1 : Math.max(0, next - 1)).map((p) => p.at);
      const turned = turnedOnTo(way, spy.departedAt, outbound?.get(spy.id));
      if (turned !== undefined) behind.unshift(turned);
      flights.push({
        id: spy.id,
        gen: spy.gen,
        home: spy.state === 'return',
        a: at.a,
        b: at.b,
        f: at.f,
        ahead,
        behind,
        target: spy.location,
        until: spy.arrivesAt ?? way[way.length - 1]!.t,
      });
    } else if (spy.state === 'rest' || spy.state === 'wait' || spy.state === 'work') {
      if (!spy.location) continue;
      const list = byWorld.get(spy.location) ?? [];
      list.push(spy.id);
      byWorld.set(spy.location, list);
    }
  }
  const spots = [...byWorld]
    .map(([planetId, spyIds]) => ({ planetId, spyIds: spyIds.sort((x, y) => x - y) }))
    .sort((x, y) => (x.planetId < y.planetId ? -1 : x.planetId > y.planetId ? 1 : 0));
  flights.sort((x, y) => x.id - y.id);
  return { flights, spots };
}

/**
 * Дорога шпиона `fl` (правило 2а): точка, где он сейчас, и дальше по дорогам до цели — первая
 * точка и есть корабль. Начало и конец текущего лейна на его дороге — по правилу флота
 * (`legEndT`): лейн, после которого путь идёт мимо мира той же тропой, кончается на её
 * развилке, и следующий начинается с неё. Доля `f` времени лейна ложится на этот отрезок.
 * Пусто — миров пути нет на карте.
 */
export function spyFlightRoad(
  state: GameState,
  fl: Pick<SpyFlight, 'a' | 'b' | 'f' | 'ahead' | 'behind'>,
): RoadPoint[] {
  const legs = [...fl.behind, fl.a, ...(fl.a === fl.b ? [] : [fl.b]), ...fl.ahead];
  const cur = fl.behind.length;
  const to = legs[cur + 1];
  if (to === undefined) {
    const p = state.planets[fl.a]?.position;
    return p ? [{ x: p.x, y: p.y }] : [];
  }
  let startT = 0;
  let endT = 1;
  for (let i = 0; i <= cur; i++) {
    endT = legEndT(state, legs[i]!, legs[i + 1]!, legs[i + 2], startT);
    if (i < cur) startT = endT < 1 ? forkTAtStart(state, legs[i + 1]!, legs[i + 2]!) : 0;
  }
  const t = startT + fl.f * (endT - startT);
  return roadAhead(state, { from: fl.a, to, path: legs.slice(cur + 2), endT }, t);
}

/** Вид вспышки (правило 5). */
export type SpyFlashKind = 'win' | 'fail' | 'arrive';

/** Вспышка по событию `type` с `payload`, если это событие о своём шпионе игрока `me`. */
export function spyFlashOf(
  type: string,
  payload: Record<string, unknown>,
  me: string,
): SpyFlashKind | null {
  if (payload.owner !== me || typeof payload.planetId !== 'string') return null;
  switch (type) {
    case 'espionage.succeeded':
    case 'espionage.counter.caught':
      return 'win';
    case 'espionage.failed':
    case 'espionage.caught':
    case 'espionage.counter.lost':
      return 'fail';
    case 'espionage.arrived':
    case 'espionage.started':
    case 'espionage.waiting':
      return 'arrive';
    default:
      return null;
  }
}
