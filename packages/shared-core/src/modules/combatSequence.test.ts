import { describe, expect, it } from 'vitest';
import { createKernel } from '../kernel/kernel';
import { createInitialState, type BattleSide, type Fleet } from '../state/gameState';
import { parseGameData } from '../data/schemas';
import { setStance } from '../state/diplomacy';
import { heroModule } from './hero';
import { heroEffectsModule } from './heroEffects';
import { combatModule } from './combat';
import { constructionModule } from './construction';

const data = parseGameData({
  version: 'test',
  resources: ['metal'],
  factions: {},
  events: {},
  buildings: { cover: { name: 'Cover', hp: 10, defenseBonus: 0.2 } },
  units: {
    a: { faction: 'x', stats: { defense: 0, speed: 1, hp: 1000, attack: 100 } },
    b: { faction: 'x', stats: { defense: 0, speed: 1, hp: 1000, attack: 80 } },
    guard: { faction: 'x', stats: { attack: 0, speed: 1, hp: 100, defense: 30 } },
  },
});
const kernel = createKernel([combatModule, constructionModule]);
function fixture(ground = false) {
  const state = createInitialState({
    seed: 'sequential',
    version: { data: 'test', manifest: '1' },
  });
  const sides: BattleSide[] = [];
  for (const [id, unit, owner, role, count] of [
    ['z-first', 'a', 'a', 'attacker', 1],
    ['guard', 'guard', 'd', 'defender', 3],
    ['a-second', 'b', 'b', 'attacker', 1],
  ] as const) {
    state.players[owner] = {
      id: owner,
      name: owner,
      faction: 'x',
      status: 'active',
      resources: {},
    };
    const fleet: Fleet = {
      id,
      owner,
      location: 'P',
      movement: null,
      units: [{ unit, count }],
      traits: [],
      battleId: 'battle',
    };
    state.fleets[id] = fleet;
    sides.push({
      ref:
        ground && role === 'defender'
          ? { kind: 'garrison', planetId: 'P' }
          : { kind: 'fleet', fleetId: id },
      owner,
      role,
      ...(role === 'attacker' ? { nextAttackAt: 0 } : {}),
    });
  }
  state.planets.P = {
    id: 'P',
    owner: 'd',
    position: { x: 0, y: 0 },
    resources: {},
    traits: [],
    buildings: ground ? [{ type: 'cover', level: 1, hp: 10 }] : [],
    garrison: ground ? [{ unit: 'guard', count: 3 }] : [],
  };
  setStance(state, 'a', 'b', 'alliance');
  setStance(state, 'a', 'd', 'war');
  setStance(state, 'b', 'd', 'war');
  state.battles.battle = {
    id: 'battle',
    location: 'P',
    phase: ground ? 'ground' : 'orbital',
    round: 0,
    sides,
  };
  state.scheduled = [
    { id: 'evt:0', at: 0, seq: 0, type: 'combat.tick', payload: { battleId: 'battle' } },
  ];
  state.scheduleSeq = 1;
  return state;
}
function run(state = fixture()) {
  const result = kernel.advanceTo(state, { now: 0, data });
  if (!result.ok) throw new Error('combat failed');
  return result;
}

describe('sequential losses and return fire', () => {
  it('100 then 80 against 300 HP produces replies 60 then 36, in entry order', () => {
    const { state } = run();
    expect(state.fleets.guard!.units[0]!.hp).toBe(120);
    expect(state.fleets['z-first']!.units[0]!.hp).toBe(940);
    expect(state.fleets['a-second']!.units[0]!.hp).toBe(964);
  });
  it('earlier attack clock precedes entry order', () => {
    const state = fixture();
    state.battles.battle!.sides[2]!.nextAttackAt = -1;
    const after = run(state).state;
    expect(after.fleets['z-first']!.units[0]!.hp).toBe(964);
    expect(after.fleets['a-second']!.units[0]!.hp).toBe(934);
  });
  it('a dead defender never fires back', () => {
    const state = fixture();
    state.fleets.guard!.units = [{ unit: 'guard', count: 1, hp: 50 }];
    const after = run(state).state;
    expect(after.fleets['z-first']!.units[0]!.hp).toBeUndefined();
  });
  it('commits both target shares even when the first reply destroys the attacker', () => {
    const state = fixture();
    state.fleets['a-second']!.units = [{ unit: 'guard', count: 3 }];
    state.battles.battle!.sides[2]!.role = 'defender';
    delete state.battles.battle!.sides[2]!.nextAttackAt;
    setStance(state, 'a', 'b', 'war');
    setStance(state, 'b', 'd', 'alliance');
    const fragile = {
      ...data,
      units: {
        ...data.units,
        a: { ...data.units.a!, stats: { ...data.units.a!.stats, hp: 10, attack: 480 } },
      },
    };
    const result = kernel.advanceTo(state, { now: 0, data: fragile });
    if (!result.ok) throw new Error(result.code);
    expect(result.state.fleets['z-first']).toBeUndefined();
    expect(result.state.fleets.guard!.units[0]!.hp).toBe(60);
    expect(result.state.fleets['a-second']!.units[0]!.hp).toBe(60);
  });

  it('building losses from the first source remove cover for the second', () => {
    // First: 100 * .8 = 80. The cover then falls. Second: all 80.
    const after = run(fixture(true)).state;
    expect(after.planets.P!.buildings).toHaveLength(0);
    expect(after.planets.P!.garrison[0]!.hp).toBe(140);
    expect(after.fleets['z-first']!.units[0]!.hp).toBe(934);
    expect(after.fleets['a-second']!.units[0]!.hp).toBe(958);
  });
  it('removes a fallen hero aura before replies without killing another hero on event replay', () => {
    const state = fixture();
    // 100 damage kills the 1 HP hero; the remaining 99 leaves 201 HP of escorts.
    state.fleets.guard!.units.push({ unit: 'hero', count: 1 });
    state.heroes = {
      'a-survivor': {
        id: 'a-survivor', owner: 'd', location: 'P', fleetId: 'reserve',
        alive: true, abilities: [], cooldowns: {},
      },
      commander: {
        id: 'commander',
        owner: 'd',
        location: 'P',
        home: 'P',
        fleetId: 'guard',
        alive: true,
        abilities: [],
        cooldowns: {},
        activeAuras: [{ bonus: 1, radius: 100, until: 1000 }],
      },
    };
    state.fleets.reserve = {
      id: 'reserve', owner: 'd', location: 'P', movement: null,
      units: [{ unit: 'hero', count: 1 }], traits: [],
    };
    state.battles.battle!.sides[2]!.nextAttackAt = 1000;
    const heroData = parseGameData({
      ...data,
      units: {
        ...data.units,
        hero: { faction: 'x', traits: ['hero'], stats: { attack: 0, defense: 0, speed: 1, hp: 1 } },
      },
    });
    const result = createKernel([heroModule, heroEffectsModule, combatModule]).advanceTo(state, {
      now: 0,
      data: heroData,
    });
    if (!result.ok) throw new Error(result.code);
    expect(result.state.heroes!.commander!.alive).toBe(false);
    expect(result.state.heroes!['a-survivor']!.alive).toBe(true);
    expect(result.state.heroes!['a-survivor']!.fleetId).toBe('reserve');
    expect(result.state.heroes!['a-survivor']!.cooldowns.respawn).toBeUndefined();
    expect(result.state.scheduled.filter((e) => e.type === 'hero.respawn')).toHaveLength(1);
    expect(result.state.fleets['z-first']!.units[0]!.hp).toBeCloseTo(939.7);
    expect(result.events.filter((e) => e.type === 'hero.died')).toHaveLength(1);
  });
});
