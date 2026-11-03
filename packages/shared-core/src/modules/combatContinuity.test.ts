import { describe, expect, it } from 'vitest';
import { createKernel } from '../kernel/kernel';
import type { GameModule } from '../kernel/module';
import { createInitialState, type BattleSide, type GameState } from '../state/gameState';
import { hashState } from '../state/hash';
import { attacks } from '../state/battle';
import { previewSides } from '../state/previewBattle';
import { setStance } from '../state/diplomacy';
import { parseGameData } from '../data/schemas';
import { combatModule } from './combat';

const HOUR = 3_600_000;
const data = parseGameData({
  version: 'continuity', resources: ['metal'], factions: {}, buildings: {}, events: {},
  units: {
    ship: { faction: 'x', stats: { hp: 1000, speed: 1, attack: 12, defense: 8 } },
    troop: { faction: 'x', domain: 'ground', kind: 'infantry',
      stats: { hp: 1000, speed: 1, attack: 12, defense: 8 } },
  },
});
const signals: GameModule = {
  id: 'test-signals', version: '1',
  setup(api) {
    api.onAction('test.diplomacy', (_, h) => h.emit('diplomacy.changed', { a: 'a', b: 'c' }));
    api.onAction('test.arrive', (_, h) => {
      h.emit('fleet.arrived', { fleetId: 'd', at: 'P' });
      h.emit('fleet.arrived', { fleetId: 'd', at: 'P' });
    });
  },
};
const kernel = createKernel([combatModule, signals]);
const ctx = (now: number) => ({ now, data });

function world(ground = false): GameState {
  const state = createInitialState({ seed: 'continuity', version: { data: data.version, manifest: '1' } });
  for (const owner of ['a', 'b', 'c']) {
    state.players[owner] = { id: owner, name: owner, faction: 'x', status: 'active', resources: {} };
    state.fleets[owner] = { id: owner, owner, location: 'P', movement: null,
      units: [{ unit: 'ship', count: 1 }], traits: [], battleId: 'battle:0' };
  }
  const sides: BattleSide[] = [
    { ref: { kind: 'fleet', fleetId: 'a' }, owner: 'a', role: 'attacker',
      attackStartedAt: 0, nextAttackAt: HOUR, attackCount: 7 },
    { ref: { kind: 'fleet', fleetId: 'b' }, owner: 'b', role: 'defender' },
    { ref: { kind: 'fleet', fleetId: 'c' }, owner: 'c', role: 'attacker',
      attackStartedAt: HOUR / 2, nextAttackAt: 1.5 * HOUR, attackCount: 3 },
  ];
  state.planets.P = { id: 'P', owner: 'b', position: { x: 0, y: 0 },
    resources: {}, buildings: [], traits: [], garrison: [{ unit: 'troop', count: 1 }] };
  if (ground) {
    state.fleets = {};
    state.planets.P.beachheads = ['a', 'c'].map(owner => ({ owner, units: [{ unit: 'troop', count: 1 }] }));
    sides[0]!.ref = { kind: 'beachhead', planetId: 'P', owner: 'a' };
    sides[1]!.ref = { kind: 'garrison', planetId: 'P' };
    sides[2]!.ref = { kind: 'beachhead', planetId: 'P', owner: 'c' };
    setStance(state, 'a', 'c', 'alliance');
  }
  state.battles['battle:0'] = { id: 'battle:0', location: 'P', phase: ground ? 'ground' : 'orbital',
    sides, round: 7, nextRoundAt: HOUR };
  state.battleSeq = 1;
  state.scheduled = [{ id: 'evt:0', seq: 0, type: 'combat.tick', at: HOUR,
    payload: { battleId: 'battle:0' } }];
  state.scheduleSeq = 1;
  return state;
}
function advance(state: GameState, now: number) {
  const result = kernel.advanceTo(state, ctx(now));
  if (!result.ok) throw Error(result.code);
  expect(result.failures).toEqual([]);
  return result;
}
function retreat(state: GameState, owner: string) {
  const result = kernel.applyAction(state, { id: 'retreat', type: 'fleet.retreat', playerId: owner,
    issuedAt: HOUR / 4, payload: { fleetId: owner } }, ctx(HOUR / 4));
  if (!result.ok) throw Error(result.code);
  return result;
}
function survivor(state: GameState, owner: string): BattleSide | undefined {
  return Object.values(state.battles).flatMap(b => b.sides).find(s => s.owner === owner);
}

describe('combat lifecycle preserves personal clocks', () => {
  it('retreating reinforcement leaves hostile survivors fighting on their original clocks', () => {
    const before = world();
    const beforeHash = hashState(before);
    const result = retreat(before, 'c');
    expect(hashState(before)).toBe(beforeHash);
    expect(result.state.fleets.c!.battleId).toBeNull();
    expect(result.state.battles['battle:0']?.sides.map(s => s.owner)).toEqual(['a', 'b']);
    expect(survivor(result.state, 'a')?.nextAttackAt).toBe(HOUR);
    expect(survivor(result.state, 'a')?.attackCount).toBe(7);
    const fired = advance(result.state, HOUR);
    expect(fired.events.filter(e => e.type === 'combat.round')).toHaveLength(1);
    expect(fired.state.fleets.b!.units[0]!.hp).toBe(988);
    expect(fired.state.fleets.c!.units[0]!.hp).toBe(600);
  });

  it('retreating defender preserves both attackers’ stances and staggered clocks', () => {
    const result = retreat(world(), 'b');
    expect(result.state.battles['battle:0']!.sides.map(side => side.role)).toEqual(['attacker', 'attacker']);
    expect(result.state.battles['battle:0']!.sides.every(side => side.stance === undefined)).toBe(true);
    expect(survivor(result.state, 'a')?.nextAttackAt).toBe(HOUR);
    expect(survivor(result.state, 'c')?.nextAttackAt).toBe(1.5 * HOUR);
    const first = advance(result.state, HOUR);
    expect(first.state.fleets.a!.units[0]!.hp).toBeUndefined();
    expect(first.state.fleets.c!.units[0]!.hp).toBe(988);
    const second = advance(first.state, 1.5 * HOUR);
    expect(second.state.fleets.a!.units[0]!.hp).toBeCloseTo(1000 - 12 * .988);
  });

  it('a casualty cannot grant a second immediate volley to surviving ships', () => {
    const state = world();
    state.fleets.c!.units[0]!.hp = 1;
    const result = advance(state, HOUR);
    expect(result.events.filter(e => e.type === 'combat.round')).toHaveLength(1);
    expect(result.state.fleets.b!.units[0]!.hp).toBe(994);
    expect(survivor(result.state, 'a')?.nextAttackAt).toBe(2 * HOUR);
    expect(survivor(result.state, 'a')?.attackCount).toBe(0);
  });

  it.each([false, true])('retreat does not invent a persistent attack order (explicit=%s)', explicit => {
    const state = world();
    state.fleets.d = { id: 'd', owner: 'd', location: 'P', movement: null,
      units: [{ unit: 'ship', count: 1, hp: 1 }], traits: [], battleId: 'battle:0' };
    state.battles['battle:0']!.sides.push({ ref: { kind: 'fleet', fleetId: 'd' },
      owner: 'd', role: 'attacker', nextAttackAt: 2 * HOUR });
    if (explicit) state.battles['battle:0']!.sides[2]!.stance = 'attack';
    const left = retreat(state, 'b').state;
    left.fleets.b!.location = 'Q'; // the retreating fleet has left the encounter
    expect(attacks(survivor(left, 'c')!)).toBe(true);
    const result = advance(JSON.parse(JSON.stringify(left)), HOUR);
    expect(survivor(result.state, 'c')?.role).toBe('defender');
    expect(attacks(survivor(result.state, 'c')!)).toBe(explicit);
    expect(survivor(result.state, 'c')?.stance).toBe(explicit ? 'attack' : undefined);
  });

  it.each([{ offset: 1, scale: 1 }, { offset: 1.5, scale: 1 }, { offset: 1.5, scale: 24 }])(
    'forecast mirrors clocks after the first attacker dies (offset=$offset, scale=$scale)', ({ offset, scale }) => {
    const state = world();
    const hour = HOUR / scale;
    for (const side of state.battles['battle:0']!.sides) {
      if (side.nextAttackAt !== undefined) side.nextAttackAt /= scale;
    }
    state.battles['battle:0']!.nextRoundAt = hour;
    state.scheduled[0]!.at = hour;
    state.fleets.a!.units[0]!.hp = 1;
    state.fleets.d = { id: 'd', owner: 'd', location: 'P', movement: null,
      units: [{ unit: 'ship', count: 1 }], traits: [], battleId: 'battle:0' };
    state.battles['battle:0']!.sides.push({ ref: { kind: 'fleet', fleetId: 'd' },
      owner: 'd', role: 'attacker', nextAttackAt: hour });
    state.battles['battle:0']!.sides[2]!.nextAttackAt = offset * hour;
    const fast = parseGameData({ ...data, units: {
      ...data.units, ship: { ...data.units.ship!, stats: { ...data.units.ship!.stats, attack: 300 } },
    } });
    const owners = ['a', 'b', 'c', 'd'];
    const forecast = previewSides(state.battles['battle:0']!.sides.map(side => ({
      units: state.fleets[side.owner!]!.units, owner: side.owner, role: side.role,
      key: side.owner!, nextAttackAt: side.nextAttackAt,
    })), fast, undefined, { now: 0, intervalMs: hour });
    const result = kernel.advanceTo(state, { now: 240 * hour, data: fast, config: { timeScale: scale } });
    if (!result.ok) throw Error(result.code);
    expect(result.failures).toEqual([]);
    expect(forecast.roundsEst).toBe(result.events.filter(e => e.type === 'combat.round').length);
    for (const [i, owner] of owners.entries()) {
      const live = result.state.fleets[owner]?.units ?? [];
      expect(forecast.sides[i]!.survivors.map(({ unit, count, hp }) => ({ unit, count, hp })))
        .toEqual(live.map(({ unit, count, hp }) => ({ unit, count, hp })));
    }
  });

  it('joining an already scheduled battle after a casualty cannot fire before reload', () => {
    const state = world();
    state.fleets.c!.units[0]!.hp = 1;
    for (const id of ['d', 'e']) state.fleets[id] = { id, owner: id, location: 'P', movement: null,
      units: [{ unit: 'ship', count: 1 }], traits: [], battleId: 'battle:1' };
    state.battles['battle:1'] = { id: 'battle:1', phase: 'orbital', location: 'P', round: 0,
      nextRoundAt: HOUR, sides: [
        { ref: { kind: 'fleet', fleetId: 'd' }, owner: 'd', role: 'attacker', nextAttackAt: HOUR },
        { ref: { kind: 'fleet', fleetId: 'e' }, owner: 'e', role: 'defender' },
      ] };
    state.battleSeq = 2;
    state.scheduled.push({ id: 'evt:1', seq: 1, type: 'combat.tick', at: HOUR,
      payload: { battleId: 'battle:1' } });
    state.scheduleSeq = 2;
    const result = advance(state, HOUR);
    expect(result.state.fleets.a!.units[0]!.damageDealt).toBe(12);
    expect(survivor(result.state, 'a')?.nextAttackAt).toBe(2 * HOUR);
    expect(survivor(result.state, 'a')?.attackCount).toBe(0);
  });

  it('a casualty on a road keeps surviving enemies pinned in combat', () => {
    const state = world();
    for (const fleet of Object.values(state.fleets)) {
      fleet.location = null;
      fleet.edge = { from: 'P', to: 'Q', t: .5 };
      fleet.resume = { to: 'Q' };
    }
    state.fleets.c!.units[0]!.hp = 1;
    const result = advance(state, HOUR);
    expect(Object.keys(result.state.battles)).toHaveLength(1);
    expect(result.state.fleets.a!.battleId).toBeTruthy();
    expect(result.state.fleets.b!.battleId).toBe(result.state.fleets.a!.battleId);
    expect(result.state.fleets.a!.edge).toEqual({ from: 'P', to: 'Q', t: .5 });
    expect(result.state.fleets.a!.resume).toEqual({ to: 'Q' });
    expect(survivor(result.state, 'a')?.nextAttackAt).toBe(2 * HOUR);
    expect(result.events.filter(e => e.type === 'combat.round')).toHaveLength(1);
  });

  it('a casualty keeps the former defender’s explicit attack order and deadline', () => {
    const state = world();
    state.fleets.c!.units[0]!.hp = 1;
    Object.assign(state.battles['battle:0']!.sides[1]!, { stance: 'attack',
      attackStartedAt: .75 * HOUR, nextAttackAt: 1.75 * HOUR, attackCount: 2 });
    const result = advance(state, HOUR);
    expect(survivor(result.state, 'b')).toMatchObject({ stance: 'attack',
      nextAttackAt: 1.75 * HOUR, attackCount: 0 });
    expect(result.state.fleets.a!.units[0]!.hp).toBeUndefined();
    const next = advance(result.state, 1.75 * HOUR);
    expect(next.events.filter(e => e.type === 'combat.round')).toHaveLength(1);
    expect(next.state.fleets.a!.units[0]!.hp).toBeCloseTo(1000 - 12 * .994);
  });

  it('default roles are reassigned by the existing relink rule without an explicit order', () => {
    const state = world();
    state.fleets.a!.units[0]!.hp = 1;
    const result = advance(state, HOUR);
    expect(attacks(survivor(result.state, 'b')!)).toBe(true);
    expect(attacks(survivor(result.state, 'c')!)).toBe(false);
  });

  it('a casualty starts a fresh stalemate window without an immediate extra volley', () => {
    const state = world();
    state.fleets.c!.units[0]!.hp = 1;
    state.battles['battle:0']!.sides[0]!.attackCount = 239;
    const result = advance(state, 2 * HOUR);
    expect(result.events.filter(e => e.type === 'combat.round')).toHaveLength(2);
    expect(result.events.some(e => e.type === 'battle.resolved' &&
      (e.payload as { end: string }).end === 'stalemate')).toBe(false);
    expect(survivor(result.state, 'a')?.attackCount).toBe(1);
    expect(survivor(result.state, 'a')?.nextAttackAt).toBe(3 * HOUR);
  });

  it('forecast and live combat keep attack orders through the same casualty', () => {
    const state = world();
    state.fleets.c!.units[0]!.hp = 1;
    for (const side of state.battles['battle:0']!.sides) {
      side.stance = 'attack';
      side.nextAttackAt = HOUR;
      side.attackCount = 0;
    }
    const fast = parseGameData({ ...data, units: {
      ...data.units, ship: { ...data.units.ship!, stats: { ...data.units.ship!.stats, attack: 300 } },
    } });
    const owners = ['a', 'b', 'c'];
    const forecast = previewSides(owners.map(owner => ({ units: state.fleets[owner]!.units,
      owner, role: 'attacker', attackOrdered: true, key: owner })), fast);
    const result = kernel.advanceTo(state, { now: 240 * HOUR, data: fast });
    if (!result.ok) throw Error(result.code);
    expect(result.failures).toEqual([]);
    for (const [i, owner] of owners.entries()) {
      const live = result.state.fleets[owner]?.units ?? [];
      expect(forecast.sides[i]!.survivors.map(({ unit, count, hp }) => ({ unit, count, hp })))
        .toEqual(live.map(({ unit, count, hp }) => ({ unit, count, hp })));
    }
  });

  it('a fallen beachhead cannot bring forward another landing force’s volley', () => {
    const state = world(true);
    state.planets.P!.beachheads![1]!.units[0]!.hp = 1;
    state.battles['battle:0']!.sides[0]!.nextAttackAt = 1.5 * HOUR;
    state.battles['battle:0']!.sides[2]!.nextAttackAt = HOUR;
    const result = advance(state, HOUR);
    expect(result.events.filter(e => e.type === 'combat.round')).toHaveLength(1);
    expect(survivor(result.state, 'a')?.nextAttackAt).toBe(1.5 * HOUR);
    expect(survivor(result.state, 'a')?.attackCount).toBe(0);
    expect(result.state.planets.P!.beachheads![0]!.units[0]!.hp).toBeUndefined();
  });

  it('a captured garrison cannot inherit its previous owner’s attack clock', () => {
    const state = world(true);
    state.planets.P!.garrison[0]!.hp = 1;
    setStance(state, 'a', 'c', 'war');
    Object.assign(state.battles['battle:0']!.sides[1]!, { stance: 'attack',
      attackStartedAt: .75 * HOUR, nextAttackAt: 1.75 * HOUR });
    const result = advance(state, HOUR);
    expect(result.state.planets.P!.owner).toBe('a');
    expect(survivor(result.state, 'a')?.ref).toEqual({ kind: 'garrison', planetId: 'P' });
    expect(survivor(result.state, 'a')?.nextAttackAt).toBeUndefined();
    expect(survivor(result.state, 'c')?.nextAttackAt).toBe(1.5 * HOUR);
  });

  it('a pending ground-clock restoration survives JSON persistence before its tick', () => {
    const state = world(true);
    const previous = JSON.parse(JSON.stringify(state.battles['battle:0']!));
    previous.id = 'previous';
    previous.sides[0].nextAttackAt = 2 * HOUR;
    previous.sides[2].nextAttackAt = 2.5 * HOUR;
    state.scheduled = [
      { id: 'evt:0', seq: 0, at: HOUR, type: 'combat.clocks.restore', payload: { previous } },
      { id: 'evt:1', seq: 1, at: HOUR, type: 'combat.tick', payload: { battleId: 'battle:0' } },
    ];
    state.scheduleSeq = 2;
    const result = advance(JSON.parse(JSON.stringify(state)), HOUR);
    expect(result.events.filter(e => e.type === 'combat.round')).toHaveLength(0);
    expect(survivor(result.state, 'a')?.nextAttackAt).toBe(2 * HOUR);
    expect(survivor(result.state, 'c')?.nextAttackAt).toBe(2.5 * HOUR);
    expect(hashState(result.state)).toBe(hashState(advance(state, HOUR).state));
  });

  it.each(['tick', 'diplomacy'])('allied landings keep fighting a neutral garrison (%s)', source => {
    const state = world(true);
    state.planets.P!.owner = null;
    state.battles['battle:0']!.sides[1]!.owner = null;
    const result = source === 'tick' ? advance(state, HOUR)
      : kernel.applyAction(state, { id: 'peace', type: 'test.diplomacy', playerId: 'a',
        issuedAt: 0, payload: {} }, ctx(0));
    if (!result.ok) throw Error(result.code);
    expect(result.events.some(e => e.type === 'battle.resolved')).toBe(false);
    expect(Object.keys(result.state.battles)).toHaveLength(1);
    if (source === 'tick') expect(result.state.planets.P!.garrison[0]!.hp).toBe(988);
  });

  it('repeated arrival notifications cannot duplicate a reinforcement or its volley', () => {
    const state = world();
    state.fleets.d = { id: 'd', owner: 'd', location: 'P', movement: null,
      units: [{ unit: 'ship', count: 1 }], traits: [], battleId: null };
    const joined = kernel.applyAction(state, { id: 'arrive', type: 'test.arrive', playerId: 'd',
      issuedAt: HOUR / 2, payload: {} }, ctx(HOUR / 2));
    if (!joined.ok) throw Error(joined.code);
    expect(joined.state.battles['battle:0']!.sides.filter(s => s.owner === 'd')).toHaveLength(1);
    const fired = advance(joined.state, HOUR / 2);
    expect(fired.events.filter(e => e.type === 'combat.round')).toHaveLength(1);
    expect(survivor(fired.state, 'a')?.nextAttackAt).toBe(HOUR);
    expect(survivor(fired.state, 'd')?.nextAttackAt).toBe(1.5 * HOUR);
  });

  it('duplicate ticks and a JSON restart preserve the same continuation and damage', () => {
    const state = world();
    state.fleets.c!.units[0]!.hp = 1;
    state.scheduled.push({ ...state.scheduled[0]!, id: 'evt:1', seq: 1 });
    state.scheduleSeq = 2;
    const coarse = advance(state, 3 * HOUR);
    const first = advance(state, HOUR);
    const restarted = advance(JSON.parse(JSON.stringify(first.state)), 3 * HOUR);
    expect(hashState(restarted.state)).toBe(hashState(coarse.state));
    expect(coarse.events.filter(e => e.type === 'combat.round')).toHaveLength(3);
  });
});
