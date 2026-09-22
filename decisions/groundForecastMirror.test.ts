/**
 * СТОРОЖ ЗЕРКАЛА: прогноз обязан сходиться с НАСТОЯЩИМ боем.
 *
 * `groundForecast.ts` не переписывает правила боя — он зовёт `cappedUnitStat` и
 * `damageUnits` ядра. Но порядок раунда (одновременный залп из предраундового снимка)
 * он всё-таки повторяет, а повторённое правило расходится молча. Здесь оно и проверяется
 * там, где расхождение видно: один и тот же расклад разыгрывается КЕРНЕЛОМ через
 * `fleet.assault` — и победитель обязан совпасть с предсказанным.
 */
import { describe, expect, it } from 'vitest';
import { createKernel } from '../packages/shared-core/src/kernel/kernel';
import { combatModule } from '../packages/shared-core/src/modules/combat';
import { orbitalModule } from '../packages/shared-core/src/modules/orbital';
import { createInitialState } from '../packages/shared-core/src/state/gameState';
import type { Fleet, GameState, Planet } from '../packages/shared-core/src/state/gameState';
import { parseGameData, type GameData } from '../packages/shared-core/src/index';
import type { Action, Context } from '../packages/shared-core/src/action/types';
import { forecastGround } from './groundForecast';

const data: GameData = parseGameData({
  version: '0.1.0',
  resources: ['metal'],
  units: {
    militia: { faction: 'x', domain: 'ground', kind: 'infantry', stats: { attack: 4, defense: 8, hp: 14, speed: 44 } },
    heavy: { faction: 'x', domain: 'ground', kind: 'infantry', stats: { attack: 8, defense: 20, hp: 34, speed: 40 } },
    tank: { faction: 'x', domain: 'ground', kind: 'vehicle', stats: { attack: 22, defense: 14, hp: 46, speed: 40 } },
  },
  factions: {},
  buildings: {},
  events: {},
});

const HOUR = 3_600_000;
const ctx = (now: number): Context => ({ now, data });
const stacks = (list: Array<[string, number]>) => list.map(([unit, count]) => ({ unit, count }));

function world(landing: Array<[string, number]>, garrison: Array<[string, number]>): GameState {
  const s = createInitialState({ seed: 'mirror', version: { data: '0.1.0', manifest: '1' } });
  const attacker: Fleet = {
    id: 'A',
    owner: 'p1',
    location: 'P',
    movement: null,
    units: [],
    landing: stacks(landing),
    traits: [],
    battleId: null,
    orbit: 'near',
  } as Fleet;
  const target: Planet = {
    id: 'P',
    owner: 'p2',
    position: { x: 0, y: 0 },
    resources: {},
    buildings: [],
    garrison: stacks(garrison),
    traits: [],
  };
  return {
    ...s,
    players: {
      p1: { id: 'p1', name: 'p1', faction: 'x', status: 'active', resources: {} },
      p2: { id: 'p2', name: 'p2', faction: 'x', status: 'active', resources: {} },
    },
    planets: { P: target },
    fleets: { A: attacker },
    heroes: {},
    battles: {},
  };
}

const assault = (): Action => ({
  id: 'a:1',
  type: 'fleet.assault',
  playerId: 'p1',
  payload: { fleetId: 'A' },
  issuedAt: 0,
});

const kernel = createKernel([orbitalModule, combatModule]);

/** Кто ВЗЯЛ мир по версии настоящего боя. */
function realWinner(landing: Array<[string, number]>, garrison: Array<[string, number]>): string {
  let state = world(landing, garrison);
  const started = kernel.applyAction(state, assault(), ctx(0));
  if (!started.ok) throw new Error(`штурм отбит: ${started.code}`);
  state = started.state;
  // Раунд — игровой час; предохранителя ядра (240) хватает с запасом на любой из
  // раскладов ниже, поэтому прогоняем заведомо дольше самого длинного.
  const done = kernel.advanceTo(state, ctx(300 * HOUR));
  if (!done.ok) throw new Error(`время не пошло: ${done.code}`);
  return done.state.planets.P?.owner === 'p1' ? 'attacker' : 'defender';
}

describe('прогноз сходится с настоящим боем', () => {
  const cases: Array<[Array<[string, number]>, Array<[string, number]>]> = [
    [[['tank', 6]], [['militia', 2]]],
    [[['tank', 3]], [['heavy', 3]]],
    [[['tank', 2]], [['heavy', 3]]],
    [[['militia', 10]], [['heavy', 2]]],
    [[['heavy', 4]], [['militia', 6]]],
    [[['militia', 2]], [['militia', 2]]],
  ];
  for (const [att, def] of cases) {
    const name = `${att.map((x) => x.join('×')).join('+')} против ${def.map((x) => x.join('×')).join('+')}`;
    it(name, () => {
      expect(forecastGround(stacks(att), stacks(def), data).winner).toBe(realWinner(att, def));
    });
  }
});
