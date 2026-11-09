/**
 * РАКЕТЫ ИЗ АНГАРА (missiles-roadmap, решения владельца 2026-11-09).
 *
 * Ракета строится в «Производстве» как челнок и стоит в порту или трюме носителя эскадрой
 * (`planet.hangar` / `fleet.hangar`): перегрузка, деление и слияние у неё те же, что у
 * эскадр. Удар, патруль и перелёт — не для неё: она ПУСКАЕТСЯ, по одной или залпом.
 *
 * `missile.launch { planetId | fleetId, squadronId, targetFleetId | targetPlanetId, count? }`
 *
 * Пущенная ракета — отряд во `fleets` с прямым полётом, как ракета мины: её видно по
 * обычному туману, сбивают зональное ПВО и челноки, шаги и попадание обрабатывает модуль
 * `rocketMines` (`util/missileFlight.ts`). Ракета САМОНАВОДЯЩАЯСЯ: идёт за целью и не
 * промахивается, пока цель-флот не ушла дальше дальности ракеты от точки пуска. По миру
 * промаха нет, и взрыв задевает его здания.
 */
import type { GameModule, HandlerContext } from '../kernel/module';
import type { Fleet, Planet, RoadPoint, Squadron } from '../state/gameState';
import { fleetPositionAt } from '../state/fleetPosition';
import { distance } from '../state/route';
import { getStance } from '../state/diplomacy';
import { isVisibleTo } from '../state/visibility';
import { isOrdnanceFleet, MISSILE_SALVO } from '../state/ordnance';
import {
  isMissileStack,
  portDisabled,
  shuttleBayAt,
  squadronReach,
  squadronSize,
} from '../state/shuttle';
import { requireOwnedUnengagedFleet } from '../util/fleet';
import { spawnMissile } from '../util/missileFlight';

interface LaunchBase {
  id: string;
  kind: 'planet' | 'fleet';
  position: RoadPoint;
  hangar: Squadron[];
  setHangar: (next: Squadron[]) => void;
}

/** База пуска: свой мир с целым портом или свой носитель вне боя. */
function launchBase(h: HandlerContext, playerId: string, p: Record<string, unknown>): LaunchBase {
  const fromPlanet = typeof p.planetId === 'string';
  if (fromPlanet === (typeof p.fleetId === 'string')) return h.reject('E_BAD_PAYLOAD');
  if (fromPlanet) {
    const planet: Planet | undefined = h.state.planets[p.planetId as string];
    if (!planet) return h.reject('E_NO_PLANET');
    if (planet.owner !== playerId) return h.reject('E_FORBIDDEN');
    if (shuttleBayAt(planet, h.ctx.data) <= 0) return h.reject('E_NO_PORT');
    if (portDisabled(planet, h.ctx.data)) return h.reject('E_PORT_DAMAGED');
    return {
      id: planet.id,
      kind: 'planet',
      position: planet.position,
      hangar: planet.hangar ?? [],
      setHangar: (next) => {
        planet.hangar = next;
      },
    };
  }
  const fleet: Fleet = requireOwnedUnengagedFleet(h, p.fleetId as string, playerId);
  const position = fleetPositionAt(h.state, fleet, h.ctx.now);
  if (!position) return h.reject('E_NO_PORT');
  return {
    id: fleet.id,
    kind: 'fleet',
    position,
    hangar: fleet.hangar ?? [],
    setHangar: (next) => {
      fleet.hangar = next;
    },
  };
}

/** Цель пуска: видимый враждебный флот или враждебный мир. Чужой флот за туманом — тот же
 *  отказ, что отсутствующий: иначе перебор id выдавал бы флоты за туманом (A06). */
function launchTarget(
  h: HandlerContext,
  playerId: string,
  p: Record<string, unknown>,
): { fleetId: string; at: RoadPoint } | { planetId: string; at: RoadPoint } {
  const wantFleet = typeof p.targetFleetId === 'string';
  if (wantFleet === (typeof p.targetPlanetId === 'string')) return h.reject('E_BAD_PAYLOAD');
  if (wantFleet) {
    const fleet = h.state.fleets[p.targetFleetId as string];
    if (!fleet || !isVisibleTo(h.state, playerId, { fleetId: fleet.id }, h.ctx.data))
      return h.reject('E_NO_TARGET');
    // Ракета — для кораблей: мину снимают челноки, ракету — ПВО и челноки.
    if (isOrdnanceFleet(fleet, h.ctx.data)) return h.reject('E_INVALID_TARGET');
    if (getStance(h.state, playerId, fleet.owner) !== 'war') return h.reject('E_NOT_HOSTILE');
    const at = fleetPositionAt(h.state, fleet, h.ctx.now);
    if (!at) return h.reject('E_NO_TARGET_POSITION');
    return { fleetId: fleet.id, at };
  }
  const planet = h.state.planets[p.targetPlanetId as string];
  if (!planet) return h.reject('E_NO_PLANET');
  if (!planet.owner || getStance(h.state, playerId, planet.owner) !== 'war')
    return h.reject('E_NOT_HOSTILE');
  return { planetId: planet.id, at: planet.position };
}

/** Снять `count` ракет с эскадры, с хвоста стеков. Опустевшая эскадра исчезает. */
function takeMissiles(base: LaunchBase, squad: Squadron, count: number): Array<{ unit: string }> {
  const out: Array<{ unit: string }> = [];
  const units = squad.units.map((st) => ({ ...st }));
  for (let i = units.length - 1; i >= 0 && out.length < count; i--) {
    const st = units[i]!;
    while (st.count > 0 && out.length < count) {
      st.count -= 1;
      out.push({ unit: st.unit });
    }
  }
  const left = units.filter((st) => st.count > 0);
  base.setHangar(
    left.length > 0
      ? base.hangar.map((q) => (q.id === squad.id ? { ...q, units: left } : q))
      : base.hangar.filter((q) => q.id !== squad.id),
  );
  return out;
}

export const missilesModule: GameModule = {
  id: 'missiles',
  version: '1.0.0',
  setup(api) {
    api.onAction('missile.launch', (action, h) => {
      const p = (action.payload ?? {}) as Record<string, unknown>;
      const base = launchBase(h, action.playerId, p);
      const squad = base.hangar.find((q) => q.id === p.squadronId);
      if (!squad) return h.reject('E_NO_SQUADRON');
      if (squad.units.some((st) => st.count > 0 && !isMissileStack(st, h.ctx.data)))
        return h.reject('E_NOT_MISSILE');
      const count = p.count === undefined ? 1 : p.count;
      if (
        typeof count !== 'number' ||
        !Number.isInteger(count) ||
        count < 1 ||
        count > MISSILE_SALVO
      )
        return h.reject('E_BAD_PAYLOAD');
      if (squadronSize(squad) < count) return h.reject('E_NOT_ENOUGH');
      const target = launchTarget(h, action.playerId, p);
      const range = squadronReach(squad, h.ctx.data);
      if (range <= 0) return h.reject('E_NO_RANGE');
      if (distance(base.position, target.at) > range) return h.reject('E_OUT_OF_RANGE');

      for (const { unit } of takeMissiles(base, squad, count)) {
        const def = h.ctx.data.units[unit];
        const speed = def?.stats.speed ?? 0;
        if (!def?.warhead || !(speed > 0) || !((def.stats.hp ?? 0) > 0))
          return h.reject('E_NOT_MISSILE'); // fail-secure: ракета без боевой части или хода
        const missile = spawnMissile(h, {
          owner: action.playerId,
          from: base.position,
          to: target.at,
          stack: { unit, count: 1 },
          speed,
          minFlightHours: 0,
          warhead: def.warhead.damage,
          guidance: {
            ...('fleetId' in target ? { fleetId: target.fleetId } : { planetId: target.planetId }),
            range: def.stats.strikeRange ?? 0,
          },
        });
        h.emit('missile.launched', {
          owner: action.playerId,
          missileId: missile.id,
          baseId: base.id,
          baseKind: base.kind,
        });
      }
    });
  },
};
