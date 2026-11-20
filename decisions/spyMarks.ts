/**
 * ШПИОНЫ НА КАРТЕ (SPM-1, заказ владельца 2026-11-20): что из своих шпионов рисует карта.
 *
 * 1. **Только свои.** Чужого шпиона не видно ни в пути, ни на точке (решение владельца
 *    2026-11-20); вызывающий передаёт только собственный реестр.
 * 2. **В пути — корабль на лейне.** Шпион, летящий на задание или домой, стоит там, где он
 *    сейчас на своём пути (`Spy.way` ядра: миры и время каждого), с остатком маршрута до
 *    цели и концом пути. Путь старого сохранения не записан — тогда прямой отрезок от места
 *    вылета до цели по доле прошедшего времени: шпион всё равно прибудет вовремя.
 * 3. **На месте — значок у мира, а не корабль.** Шпионы, что стоят в мире (дома, ждут приказа
 *    или работают), сходятся в один значок «🕵 N» у его имени — как ангар (`hangarBadge.ts`):
 *    на карте на сто игроков отдельные корабли у каждого мира забили бы экран. Порядок
 *    шпионов значка — по номеру, одинаковый на всех клиентах.
 * 4. **Вербовка и «на дне» не рисуются:** такого шпиона нет нигде на карте.
 * 5. **Вспышка — по событию своего шпиона:** удача — зелёная, провал или потеря — красная,
 *    прибытие — бирюзовая, остальное — без вспышки.
 */
import type { PlanetId, Spy, SpyWayPoint } from '../packages/shared-core/src/index';
import { spyWayAt } from '../packages/shared-core/src/index';

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

/** Правила 1–4 для реестра `own` в мировое время `now`. */
export function spyMarks(own: readonly Spy[] | undefined, now: number): SpyMarks {
  const flights: SpyFlight[] = [];
  const byWorld = new Map<PlanetId, number[]>();
  for (const spy of own ?? []) {
    if (spy.state === 'travel' || spy.state === 'return') {
      const way = spy.way?.length ? spy.way : straight(spy);
      const at = way && spyWayAt(way, now);
      if (!way || !at) continue;
      const next = way.findIndex((p) => p.t > now);
      const ahead = next < 0 ? [] : way.slice(next + 1).map((p) => p.at);
      flights.push({
        id: spy.id,
        gen: spy.gen,
        home: spy.state === 'return',
        a: at.a,
        b: at.b,
        f: at.f,
        ahead,
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
