// Ферма и реактор по нужде (решение владельца 2026-10-07).
//
// Что здесь закрепляется. Бот ставил ферму и реактор максимум по одному за партию
// (`if (has(b)) continue`), а дальше жил в долгах: self-play показывал давление еды и
// энергии, которое чувствовал только бот (`econplaytest 14 4 3`: долги med 36 ч; бот,
// который строит их по нужде, в долг не уходит вовсе). Теперь при отрицательном потоке
// или долге бот ставит следующую на первом своём мире без такой постройки — дом
// первым, — но держит в очереди не больше одной каждого вида.
import { describe, expect, it } from 'vitest';
import { newGame, aiOrders, START_CANDIDATES } from './game';
import type { GameState } from '../../packages/shared-core/src/index';

const HOME = 'C1R1';
const COLONY = 'C1R2';
const RICH = { credits: 2000, metal: 2000, food: 0, energy: 500, microelectronics: 200 };

/** Место p2 в долгу по еде, дом и колония — свои, ферма на доме стоит или нет. */
function hungry(homeFarm: boolean): GameState {
  const s = newGame({
    seats: [
      { id: 'p1', name: 'A', faction: 'azure', start: START_CANDIDATES[0]!, ai: true },
      { id: 'p2', name: 'B', faction: 'crimson', start: START_CANDIDATES[1]!, ai: true },
    ],
  });
  const home = s.planets[HOME]!;
  const colony = s.planets[COLONY]!;
  return {
    ...s,
    players: { ...s.players, p2: { ...s.players.p2!, resources: RICH, arrears: ['food'] } },
    planets: {
      ...s.planets,
      [HOME]: {
        ...home,
        buildings: homeFarm
          ? [...home.buildings, { type: 'farm', level: 1, hp: 20 }]
          : home.buildings,
      },
      [COLONY]: { ...colony, owner: 'p2', garrison: [] },
    },
  };
}

const farmSites = (s: GameState): string[] =>
  aiOrders(s, 'p2', 'expand', 'strong')
    .filter((a) => a.type === 'building.construct')
    .map((a) => a.payload as { planetId: string; building: string })
    .filter((p) => p.building === 'farm')
    .map((p) => p.planetId);

describe('бот ставит ферму по нужде, а не одну за партию', () => {
  it('без фермы в державе — первая встаёт дома', () => {
    expect(farmSites(hungry(false))).toEqual([HOME]);
  });

  it('ферма дома уже есть, а еды не хватает — следующая встаёт на колонии', () => {
    expect(farmSites(hungry(true))).toEqual([COLONY]);
  });

  it('одна ферма уже строится — вторую в очередь не ставит', () => {
    const s = hungry(true);
    const queued: GameState = {
      ...s,
      scheduled: [
        ...s.scheduled,
        {
          id: 'evt:farm',
          at: s.time + 3_600_000,
          seq: 9_999,
          type: 'construction.complete',
          payload: { kind: 'building', planetId: COLONY, building: 'farm' },
        },
      ],
    };
    expect(farmSites(queued)).toEqual([]);
  });

  it('еды хватает и долга нет — новой фермы нет', () => {
    const s = hungry(true);
    const fed: GameState = {
      ...s,
      players: {
        ...s.players,
        p2: { ...s.players.p2!, resources: { ...RICH, food: 2000 }, arrears: [] },
      },
    };
    expect(farmSites(fed)).toEqual([]);
  });
});
