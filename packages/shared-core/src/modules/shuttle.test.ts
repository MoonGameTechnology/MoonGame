import { describe, it, expect } from 'vitest';
import { createKernel } from '../kernel/kernel';
import { fleetOpsModule } from './fleetOps';
import { shuttleModule } from './shuttle';
import {
  createInitialState,
  type Fleet,
  type GameState,
  type Planet,
  type Player,
} from '../state/gameState';
import { parseGameData, type GameData } from '../data/schemas';
import type { Action, Context } from '../action/types';

/**
 * Свободный вылет эскадрилий — шов между `fleet.split` и `shuttle.strike`.
 *
 * У модуля не было ни одного теста, и именно поэтому весь свободный вылет успел
 * побыть недостижимым кодом: `shuttle.strike` требует `fleet.homeBase`, а не
 * выставлял его никто. Тесты здесь держат ровно этот шов — не внутренности модуля,
 * а то, что вылет вообще состоится и полетит откуда надо.
 */

const data: GameData = parseGameData({
  version: '0.1.0',
  resources: ['metal'],
  units: {
    cruiser: { faction: 'x', domain: 'space', stats: { attack: 5, defense: 5, speed: 6, hp: 40 } },
    interceptor: {
      faction: 'x',
      domain: 'space',
      traits: ['shuttle'],
      stats: { attack: 14, defense: 3, speed: 14, hp: 10, strikeRange: 180, fuel: 3, rearmRounds: 2 },
    },
  },
  factions: {},
  buildings: {},
  events: {},
});

const ctx: Context = { now: 0, data };
const kernel = createKernel([fleetOpsModule, shuttleModule]);

const player = (id: string): Player => ({
  id,
  name: id,
  faction: 'x',
  status: 'active',
  resources: {},
});
const planet = (id: string, owner: string | null, x: number): Planet => ({
  id,
  owner,
  position: { x, y: 0 },
  resources: {},
  buildings: [],
  garrison: [],
  traits: [],
});
const fleet = (
  id: string,
  owner: string,
  location: string | null,
  units: Array<[string, number]>,
): Fleet => ({
  id,
  owner,
  location,
  movement: null,
  units: units.map(([unit, count]) => ({ unit, count })),
  traits: [],
});

/** Носитель у A(0), враг у C(150) — в пределах strikeRange (180) от базы. */
function world(carrierUnits: Array<[string, number]>): GameState {
  const s = createInitialState({ seed: 'sq', version: { data: '0.1.0', manifest: '1' } });
  return {
    ...s,
    players: { p1: player('p1'), p2: player('p2') },
    planets: {
      A: planet('A', 'p1', 0),
      B: planet('B', 'p1', 100),
      C: planet('C', 'p2', 150),
    },
    fleets: {
      F1: fleet('F1', 'p1', 'A', carrierUnits),
      E1: fleet('E1', 'p2', 'C', [['cruiser', 1]]),
    },
    heroes: {},
    battles: {},
  };
}

const split = (take: Array<{ unit: string; count: number }>): Action => ({
  id: 'a:split',
  type: 'fleet.split',
  playerId: 'p1',
  payload: { fleetId: 'F1', take },
  issuedAt: 0,
});
const strike = (fleetId: string): Action => ({
  id: `a:strike:${fleetId}`,
  type: 'shuttle.strike',
  playerId: 'p1',
  payload: { fleetId, targetFleetId: 'E1' },
  issuedAt: 0,
});

/** Отделить эскадрильи от носителя и вернуть (состояние, id крыла). */
function splitWing(
  state: GameState,
  take: Array<{ unit: string; count: number }>,
): { state: GameState; wingId: string } {
  const r = kernel.applyAction(state, split(take), ctx);
  if (!r.ok) throw new Error(`split rejected: ${r.code}`);
  const wingId = Object.keys(r.state.fleets).find((id) => id !== 'F1' && id !== 'E1')!;
  return { state: r.state, wingId };
}

describe('shuttle — свободный вылет от носителя', () => {
  // Тот самый сквозной контракт: пока `fleet.split` не выставлял `homeBase`,
  // здесь стоял E_NOT_SHUTTLE и весь модуль был недостижим.
  it('отделённое крыло взлетает: split → strike принят', () => {
    const { state, wingId } = splitWing(world([['cruiser', 1], ['interceptor', 2]]), [
      { unit: 'interceptor', count: 2 },
    ]);
    const r = kernel.applyAction(state, strike(wingId), ctx);
    expect(r.ok, r.ok ? '' : `отказ ${r.code}`).toBe(true);
    if (r.ok) expect(r.state.fleets[wingId]?.freeMovement).not.toBeNull();
  });

  // Регрессия: `fleet.split` выставлял крылу ВТОРУЮ координату (`freePosition`),
  // которая не обновляется обычным ходом по лейну. Крыло, оказавшееся в другом
  // месте, считало бы полёт от точки вылета — эскадрильная логика читает позицию
  // как `freePosition ?? location` и предпочла бы застывшую.
  it('вылет считается от ТЕКУЩЕГО места крыла, а не от точки отделения', () => {
    const { state, wingId } = splitWing(world([['cruiser', 1], ['interceptor', 2]]), [
      { unit: 'interceptor', count: 2 },
    ]);
    const fromA = kernel.applyAction(state, strike(wingId), ctx);

    // То же крыло, но оказавшееся у B(100) — вдвое ближе к цели C(150).
    const moved: GameState = {
      ...state,
      fleets: { ...state.fleets, [wingId]: { ...state.fleets[wingId]!, location: 'B' } },
    };
    const fromB = kernel.applyAction(moved, strike(wingId), ctx);

    expect(fromA.ok && fromB.ok).toBe(true);
    if (!fromA.ok || !fromB.ok) return;
    const atA = fromA.state.fleets[wingId]!.freeMovement!.arrivesAt;
    const atB = fromB.state.fleets[wingId]!.freeMovement!.arrivesAt;
    // От B лететь втрое короче (50 против 150), значит и прибытие заметно раньше.
    // При застывшей `freePosition` оба вылета считались бы от A и совпали бы.
    expect(atB).toBeLessThan(atA);
  });

  // Регрессия: свободный полёт уносит ВЕСЬ флот, поэтому крылом считается только
  // чистый shuttle-состав. Иначе крейсер уходил бы мимо графа линий «зайцем».
  it('смешанный отряд крылом не становится и взлететь не может', () => {
    const { state, wingId } = splitWing(world([['cruiser', 3], ['interceptor', 2]]), [
      { unit: 'cruiser', count: 1 },
      { unit: 'interceptor', count: 2 },
    ]);
    expect(state.fleets[wingId]?.homeBase).toBeUndefined();
    const r = kernel.applyAction(state, strike(wingId), ctx);
    expect(r.ok ? 'принят' : r.code).toBe('E_NOT_SHUTTLE');
  });

  // Обычный флот к свободному полёту не допускается — правило не размылось.
  it('не-эскадрильный отряд отклоняется', () => {
    const { state, wingId } = splitWing(world([['cruiser', 3]]), [{ unit: 'cruiser', count: 1 }]);
    const r = kernel.applyAction(state, strike(wingId), ctx);
    expect(r.ok ? 'принят' : r.code).toBe('E_NOT_SHUTTLE');
  });
});
