import { afterEach, describe, expect, it, vi } from 'vitest';
import { SYSTEM_BOT_ROSTER } from '../../packages/server/src/botRoster';
import type { Action, GameState } from '../../packages/shared-core/src/index';
import {
  buildBuilding,
  buildUnit,
  moveFleet,
  retreatFleet,
  splitFleet,
} from '../../decisions/actions';
import { botAcceptsOffer, botBehaviorOrders, botStyle, BOT_STYLES } from './botBehavior';
import * as ai from './ai';
import { newGame, START_CANDIDATES, kernel, ctx } from './game';
import { atWeakTurn } from './weakTurnFixture';
import { networkSeats } from './matchSetup';

afterEach(() => vi.restoreAllMocks());

function scenario(): GameState {
  const state = newGame({
    seats: [
      { id: 'p1', name: 'A', faction: 'azure', start: START_CANDIDATES[0]!, ai: true },
      { id: 'p2', name: 'B', faction: 'crimson', start: START_CANDIDATES[1]!, ai: true },
    ],
  });
  state.players.p2!.resources = {
    credits: 6000,
    metal: 9000,
    food: 800,
    energy: 800,
    microelectronics: 400,
  };
  // The expansionist has a combat fleet ready to move, while a staffed home
  // garrison lets the industrialist spend its surplus on the economy instead.
  for (const fleet of Object.values(state.fleets)) {
    if (fleet.owner !== 'p2') continue;
    fleet.units = [{ unit: 'cruiser', count: 2 }];
    fleet.landing = [{ unit: 'militia', count: 4 }];
  }
  for (const planet of Object.values(state.planets)) {
    if (planet.owner === null) planet.garrison = [];
    if (planet.owner === 'p2') planet.garrison = [{ unit: 'militia', count: 20 }];
  }
  return atWeakTurn(state, 'full');
}

const shape = (groups: Action[][]): unknown =>
  groups.map((group) => group.map(({ type, payload }) => ({ type, payload })));

describe('permanent bot strategies', () => {
  it('gives personalities distinct, stable negotiation policies without bypassing diplomacy', () => {
    const state = scenario();
    expect(botAcceptsOffer(state, 'p2', 'p1', 0, 'pact')).toBe(false);
    expect(botAcceptsOffer(state, 'p2', 'p1', 1, 'pact')).toBe(true);
    expect(botAcceptsOffer(state, 'p2', 'p1', 2, 'peace')).toBe(true);
    state.diplomacy = { ...(state.diplomacy ?? {}), 'p1|p2': 'war' };
    expect(botAcceptsOffer(state, 'p2', 'p1', 2, 'pact')).toBe(false);
    expect(botAcceptsOffer(state, 'p2', 'missing', 1, 'peace')).toBe(false);
    state.diplomacy['p1|p2'] = 'peace';
    expect(botAcceptsOffer(state, 'p2', 'p1', 2, 'pact')).toBe(true);
    state.match.scores.p1 = { controlledPlanets: 1, fleets: 0, units: 0, total: 10 };
    state.match.scores.p2 = { controlledPlanets: 1, fleets: 0, units: 0, total: 20 };
    expect(botAcceptsOffer(state, 'p2', 'p1', 0, 'peace')).toBe(true);
    expect(botAcceptsOffer(state, 'p2', 'p1', 3, 'peace')).toBe(false);
    state.match.scores.p1.total = 20;
    expect(botAcceptsOffer(state, 'p2', 'p1', 0, 'peace')).toBe(true);
    expect(botAcceptsOffer(state, 'p2', 'p1', 3, 'peace')).toBe(false);
  });

  it('assigns all three strategies from the permanent seed independently of seat or restart', () => {
    const styles = SYSTEM_BOT_ROSTER.map((bot) => botStyle(bot.seed));
    expect(new Set(styles)).toEqual(new Set(BOT_STYLES));
    for (const bot of SYSTEM_BOT_ROSTER)
      expect(botStyle(JSON.parse(JSON.stringify(bot)).seed)).toBe(botStyle(bot.seed));
    for (const invalid of [-1, 0.5, Number.NaN, 0x1_0000_0000])
      expect(() => botStyle(invalid)).toThrow('E_BOT_SEED');
  });

  it('uses expansion, local counter-defense and economic spending as distinct real strategies', () => {
    const state = scenario();
    const expansion = botBehaviorOrders(state, 'p2', 0);
    const defense = botBehaviorOrders(state, 'p2', 1);
    const economy = botBehaviorOrders(state, 'p2', 2);
    const moves = expansion.flat().filter((a) => a.type === 'fleet.move');
    expect(moves.length).toBeGreaterThan(0);
    expect(defense.flat().some((a) => a.type === 'fleet.move')).toBe(false);
    expect(defense.flat().some((a) => a.type === 'unit.build')).toBe(true);
    expect(economy.flat().some((a) => a.type === 'unit.build')).toBe(false);
    const investment = economy.flat().find((a) => a.type === 'building.construct');
    expect(investment).toBeDefined();
    expect(shape(expansion)).not.toEqual(shape(defense));
    expect(shape(defense)).not.toEqual(shape(economy));
    // These are the ordinary legal intentions, still judged by the real kernel.
    for (const action of [moves[0]!, investment!]) {
      const result = kernel.applyAction(state, action, ctx(state.time));
      expect(result.ok, result.ok ? '' : result.code).toBe(true);
    }
  });

  it('retains complete retreat/course and split/course pairs during economic filtering', () => {
    const state = scenario();
    const home = Object.values(state.planets).find((p) => p.owner === 'p2')!;
    const retreat = [retreatFleet('p2', 'f1'), moveFleet('p2', 'f1', home.id)];
    const split = [
      splitFleet('p2', 'f2', [{ unit: 'frigate', count: 1 }]),
      moveFleet('p2', 'f2', home.id),
    ];
    vi.spyOn(ai, 'aiOrders').mockReturnValue([
      ...retreat,
      ...split,
      buildUnit('p2', home.id, 'cruiser'),
      buildBuilding('p2', home.id, 'refinery'),
    ]);
    const groups = botBehaviorOrders(state, 'p2', 2);
    expect(groups.slice(0, 2)).toEqual([retreat, split]);
    expect(groups.flat().some((a) => a.type === 'unit.build')).toBe(false);
    expect(groups.at(-1)![0]!.type).toBe('building.construct');
  });

  it('keeps basic garrison replacement and lifts economic military restraint at war', () => {
    const state = scenario();
    const home = Object.values(state.planets).find((p) => p.owner === 'p2')!;
    home.garrison = [];
    const ground = buildUnit('p2', home.id, 'militia', 2);
    const navy = buildUnit('p2', home.id, 'cruiser');
    vi.spyOn(ai, 'aiOrders').mockReturnValue([ground, navy]);
    expect(botBehaviorOrders(state, 'p2', 2)).toEqual([[ground]]);
    state.diplomacy = { ...(state.diplomacy ?? {}), 'p1|p2': 'war' };
    expect(botBehaviorOrders(state, 'p2', 2)).toEqual([[ground]]);
    state.players.p1!.seated = true;
    expect(botBehaviorOrders(state, 'p2', 2)).toEqual([[ground], [navy]]);
  });

  it('keeps economic spending on the real FFA-20 despite hostile NPCs and empty hostile chairs', () => {
    const state = newGame({ mapId: 'ffa-20', seats: networkSeats('ffa', 'ffa-20') });
    const seat = 'p2';
    state.players[seat]!.seated = true;
    state.players[seat]!.resources = {
      credits: 6000,
      metal: 9000,
      food: 800,
      energy: 800,
      microelectronics: 400,
    };
    const home = Object.values(state.planets).find((p) => p.owner === seat)!;
    home.garrison = [{ unit: 'militia', count: 20 }];
    expect(Object.values(state.players).some((player) => !!player.npc)).toBe(true);
    // Deliberately leave the unclaimed opponent at the engine's hostile default.
    state.diplomacy = { ...(state.diplomacy ?? {}), 'p1|p2': 'war' };
    const defense = botBehaviorOrders(state, seat, 1).flat();
    const economy = botBehaviorOrders(state, seat, 2).flat();
    expect(defense.some((a) => a.type === 'unit.build')).toBe(true);
    expect(economy.some((a) => a.type === 'unit.build')).toBe(false);
    expect(economy.some((a) => a.type === 'building.construct')).toBe(true);
    // A real participant at war changes the budget; an empty chair never does.
    state.players.p1!.seated = true;
    expect(
      botBehaviorOrders(state, seat, 2)
        .flat()
        .some((a) => a.type === 'unit.build'),
    ).toBe(true);
  });
});
