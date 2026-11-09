/**
 * ПОЛЁТ РАКЕТЫ — общий для ракеты мины (`rocketMines`) и ракеты из ангара (`missiles`).
 *
 * Ракета — отряд во `fleets` с прямым полётом (`Fleet.flight`, SM-3.7b). Шаги полёта и
 * попадание обрабатывает модуль `rocketMines` (события `rocketMine.flight` и
 * `rocketMine.impact`): так ракету любого происхождения бьют одно ПВО и одни челноки.
 *
 * САМОНАВЕДЕНИЕ (решение владельца 2026-11-09): ракета идёт за целью и не промахивается.
 * Промах один: цель-флот ушла дальше дальности ракеты от точки пуска. Каждую игровую
 * минуту полёт перестраивается на живую позицию цели; так делает и погоня челноков.
 */
import type { HandlerContext } from '../kernel/module';
import type { Context } from '../action/types';
import { hoursToMs, travelSpeedFactorOf } from '../action/types';
import type { Fleet, GameState, RoadPoint, UnitStack } from '../state/gameState';
import type { MissileGuidance } from '../state/ordnance';
import { emptyOrdnance } from '../state/ordnance';
import { fleetPositionAt, flightPointAt } from '../state/fleetPosition';
import { distance } from '../state/route';
import { nextFleetSeq } from './fleet';

export const MISSILE_FLIGHT_EVENT = 'rocketMine.flight';
export const MISSILE_IMPACT_EVENT = 'rocketMine.impact';

/** Шаг полёта ракеты — игровая минута. */
export function missileFlightStep(ctx: Context): number {
  return Math.max(1, Math.ceil(hoursToMs(ctx, 1 / 60)));
}

/** Время полёта от `from` до `to`: не короче `minHours` и не короче одного мига. */
function flightMs(ctx: Context, from: RoadPoint, to: RoadPoint, speed: number, minHours: number): number {
  const hours = distance(from, to) / (speed * travelSpeedFactorOf(ctx));
  return Math.max(1, Math.ceil(hoursToMs(ctx, Math.max(minHours, hours))));
}

/** Следующий шаг полёта, если до попадания он ещё успевает. */
export function scheduleMissileStep(h: HandlerContext, missile: Fleet): void {
  const step = missileFlightStep(h.ctx);
  if (missile.flight && h.ctx.now + step < missile.flight.arrivesAt) {
    h.schedule(h.ctx.now + step, MISSILE_FLIGHT_EVENT, { missileId: missile.id });
  }
}

/** Ракета на карте: отряд без приказов, полёт по прямой, боевая часть и наведение у
 *  хозяина. Попадание и первый шаг полёта ставятся в очередь здесь же. */
export function spawnMissile(
  h: HandlerContext,
  spec: {
    owner: string;
    from: RoadPoint;
    to: RoadPoint;
    stack: UnitStack;
    speed: number;
    minFlightHours: number;
    warhead: number;
    guidance?: Omit<MissileGuidance, 'origin' | 'speed'>;
  },
): Fleet {
  const arrivesAt = h.ctx.now + flightMs(h.ctx, spec.from, spec.to, spec.speed, spec.minFlightHours);
  const missile: Fleet = {
    id: `fleet:missile:${h.ctx.now}:${nextFleetSeq(h.state)}`,
    owner: spec.owner,
    location: null,
    movement: null,
    edge: null,
    flight: { from: { ...spec.from }, to: { ...spec.to }, departedAt: h.ctx.now, arrivesAt },
    units: [spec.stack],
    landing: [],
    traits: [],
    battleId: null,
  };
  h.state.fleets[missile.id] = missile;
  const ord = (h.state.ordnance ??= emptyOrdnance());
  (ord.warheads ??= {})[missile.id] = spec.warhead;
  if (spec.guidance)
    (ord.guidance ??= {})[missile.id] = {
      ...spec.guidance,
      origin: { ...spec.from },
      speed: spec.speed,
    };
  h.schedule(arrivesAt, MISSILE_IMPACT_EVENT, { missileId: missile.id });
  scheduleMissileStep(h, missile);
  return missile;
}

/**
 * Куда сейчас идёт ракета. `null` — наведения нет или цели больше нет: ракета летит в
 * прежнюю точку. `'lost'` — цель-флот дальше дальности от точки пуска: промах.
 */
export function guidedAim(state: GameState, missileId: string, now: number): RoadPoint | 'lost' | null {
  const g = state.ordnance?.guidance?.[missileId];
  if (!g) return null;
  if (g.planetId !== undefined) return state.planets[g.planetId]?.position ?? null;
  const target = g.fleetId !== undefined ? state.fleets[g.fleetId] : undefined;
  const at = target && fleetPositionAt(state, target, now);
  if (!at) return null;
  return distance(g.origin, at) > g.range ? 'lost' : { x: at.x, y: at.y };
}

/** Перестроить полёт на новую точку цели от того места, где ракета сейчас. Старое
 *  попадание в очереди отпадёт само: обработчик сверяет срок с `flight.arrivesAt`. */
export function retargetMissile(h: HandlerContext, missile: Fleet, aim: RoadPoint): void {
  const fl = missile.flight;
  const g = h.state.ordnance?.guidance?.[missile.id];
  if (!fl || !g || (fl.to.x === aim.x && fl.to.y === aim.y)) return;
  const from = flightPointAt(fl, h.ctx.now);
  const arrivesAt = h.ctx.now + flightMs(h.ctx, from, aim, g.speed, 0);
  missile.flight = { from: { ...from }, to: { ...aim }, departedAt: h.ctx.now, arrivesAt };
  h.schedule(arrivesAt, MISSILE_IMPACT_EVENT, { missileId: missile.id });
}
