import { describe, expect, it } from 'vitest';
import { aiOrders, newGame, order, START_CANDIDATES } from './game';
import { data } from './gameData';
import {
  buildingLevel,
  matchCost,
  matchUnitCost,
  type GameState,
} from '../../packages/shared-core/src/index';

function developed(): GameState {
  const state = newGame({
    seats: [
      { id: 'p1', name: 'A', faction: 'azure', start: START_CANDIDATES[0]!, ai: true },
      { id: 'p2', name: 'B', faction: 'crimson', start: START_CANDIDATES[1]!, ai: true },
    ],
  });
  state.pricing = {
    cost: { metal: 1.5, credits: 3, microelectronics: 2 },
    shipCost: { metal: 4, credits: 2, microelectronics: 2 },
  };
  state.players.p2!.technologies = { completed: Object.keys(data.technologies) };
  state.players.p2!.scientists = [];
  const home = homeOf(state);
  for (const type of ['refinery', 'spaceport', 'tax_office', 'fabricator', 'power_plant', 'farm']) {
    if (!home.buildings.some((b) => b.type === type)) {
      const level = type === 'power_plant' || type === 'farm' ? 3 : 1;
      home.buildings.push({ type, level, hp: buildingLevel(data.buildings[type]!, level).hp });
    }
  }
  const mine = home.buildings.find((b) => b.type === 'mine')!;
  mine.level = 1;
  const upgrade = matchCost(state, buildingLevel(data.buildings.mine!, 2).cost);
  const hull = matchUnitCost(state, data.units.cruiser!);
  state.players.p2!.resources = {
    credits: 100_000,
    food: 100_000,
    energy: 100_000,
    microelectronics: 100_000,
    metal: (upgrade.metal ?? 0) + (hull.metal ?? 0) + matchCost(state, { metal: 60 }).metal! + 1,
  };
  return state;
}

function homeOf(s: GameState) {
  return Object.values(s.planets).find(
    (p) => p.owner === 'p2' && p.buildings.some((b) => b.type === 'mine'),
  )!;
}

const upgrades = (s: GameState) =>
  aiOrders(s, 'p2', 'expand', 'strong').filter(
    (a) =>
      a.type === 'building.upgrade' && (a.payload as { building?: string }).building === 'mine',
  );

describe('AI invests in the single mining upgrade chain', () => {
  it('invests once while retaining a line hull at the real match price', () => {
    const s = developed();
    const choices = upgrades(s);
    expect(choices).toHaveLength(1);
    expect(choices[0]!.payload).toMatchObject({ planetId: homeOf(s).id, building: 'mine' });
    const result = order(s, choices[0]!, s.time);
    expect(result.error).toBeUndefined();
    const hull = matchUnitCost(s, data.units.cruiser!);
    for (const [resource, amount] of Object.entries(hull)) {
      expect(result.state.players.p2!.resources[resource] ?? 0).toBeGreaterThanOrEqual(amount);
    }
    expect(upgrades(result.state)).toEqual([]);
  });

  it('keeps the last hull reserve instead of spending it on mining', () => {
    const s = developed();
    s.players.p2!.resources.metal! -= 2;
    expect(upgrades(s)).toEqual([]);
  });

  it('does not expand metal production when stockpiles are already ample', () => {
    const s = developed();
    s.players.p2!.resources.metal = 100_000;
    expect(upgrades(s)).toEqual([]);
  });

  it('does not duplicate a queued or paused mining investment', () => {
    const s = developed();
    const home = homeOf(s);
    home.buildQueue = [{ id: 900, kind: 'upgrade', playerId: 'p2', building: 'mine' }];
    expect(upgrades(s)).toEqual([]);
    home.buildQueue = [];
    home.pausedConstruction = [
      {
        id: 900,
        kind: 'upgrade',
        playerId: 'p2',
        building: 'mine',
        level: 2,
        progress: 0.5,
        remainingHours: 2,
        remainingCost: { metal: 70 },
      },
    ];
    expect(upgrades(s)).toEqual([]);
  });

  it('stops at the top level', () => {
    const s = developed();
    homeOf(s).buildings.find((b) => b.type === 'mine')!.level = 3;
    expect(upgrades(s)).toEqual([]);
  });
});
