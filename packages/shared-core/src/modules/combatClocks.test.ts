import { describe, expect, it } from 'vitest';
import { createKernel } from '../kernel/kernel';
import type { GameModule } from '../kernel/module';
import { combatModule } from './combat';
import { createInitialState, type GameState, type BattleSide } from '../state/gameState';
import { parseGameData } from '../data/schemas';
import { combatantKey } from '../state/battle';
import { inspectBattle } from '../state/battleReadout';
import { hashState } from '../state/hash';

const hour = 3_600_000;
const data = parseGameData({
  version: '1',
  resources: ['metal'],
  factions: {},
  buildings: {},
  events: {},
  units: {
    ship: { faction: 'x', stats: { hp: 1000, speed: 1, attack: 12, defense: 8 }, line: 'front' },
    troop: {
      faction: 'x',
      domain: 'ground',
      kind: 'infantry',
      stats: { hp: 1000, speed: 1, attack: 12, defense: 8 },
      line: 'front',
    },
  },
});
const ctx = (now: number) => ({ now, data });
const kernel = createKernel([combatModule]);
function advance(k: ReturnType<typeof createKernel>, s: GameState, now: number) {
  const result = k.advanceTo(s, ctx(now));
  if (!result.ok) throw Error(result.code);
  expect(result.failures).toEqual([]);
  return result;
}
function fixture(ground = false): GameState {
  const s = createInitialState({ seed: 'clocks', version: { data: '1', manifest: '1' } });
  s.planets.P = {
    id: 'P',
    owner: 'b',
    position: { x: 0, y: 0 },
    resources: {},
    buildings: [],
    traits: [],
    garrison: [{ unit: 'troop', count: 1 }],
  };
  s.fleets.a = {
    id: 'a',
    owner: 'a',
    location: 'P',
    movement: null,
    units: [{ unit: 'ship', count: 1 }],
    landing: [{ unit: 'troop', count: 1 }],
    traits: [],
    battleId: 'B',
  };
  s.fleets.b = { ...s.fleets.a, id: 'b', owner: 'b' };
  const sides: BattleSide[] = [
    {
      ref: { kind: ground ? 'landing' : 'fleet', fleetId: 'a' },
      owner: 'a',
      role: 'attacker',
      attackStartedAt: 0,
      nextAttackAt: hour,
    },
    {
      ref: ground ? { kind: 'garrison', planetId: 'P' } : { kind: 'fleet', fleetId: 'b' },
      owner: 'b',
      role: 'defender',
    },
  ];
  s.battles.B = {
    id: 'B',
    phase: ground ? 'ground' : 'orbital',
    location: 'P',
    sides,
    round: 0,
    nextRoundAt: hour,
  };
  s.scheduled = [
    { id: 'evt:0', seq: 0, type: 'combat.tick', at: hour, payload: { battleId: 'B' } },
  ];
  s.scheduleSeq = 1;
  return s;
}
function attack(s: GameState, playerId: string, now: number, side?: string) {
  return kernel.applyAction(
    s,
    {
      id: 'cmd',
      type: 'battle.attack',
      playerId,
      issuedAt: now,
      payload: { battleId: 'B', ...(side ? { side } : {}) },
    },
    ctx(now),
  );
}

describe('personal attack clocks', () => {
  it.each([false, true])(
    'defense has no clock; switching starts its own cycle (ground=%s)',
    (ground) => {
      const original = fixture(ground);
      const initialHash = hashState(original);
      const command = attack(original, 'b', hour / 2);
      expect(command.ok).toBe(true);
      if (!command.ok) return;
      expect(hashState(original)).toBe(initialHash);
      expect(command.state.battles.B!.sides.map((s) => s.nextAttackAt)).toEqual([hour, 1.5 * hour]);
      const first = advance(kernel, command.state, hour);
      expect(first.failures).toEqual([]);
      // The former defender is now attacking and does NOT return defensive damage.
      expect(first.state.fleets.a!.units[0]!.hp).toBeUndefined();
      const second = advance(kernel, first.state, 1.5 * hour);
      expect(second.events.filter((e) => e.type === 'combat.round')).toHaveLength(1);
      expect(second.state.battles.B!.sides.map((s) => s.nextAttackAt)).toEqual([
        2 * hour,
        2.5 * hour,
      ]);
      expect(
        hashState(advance(kernel, JSON.parse(JSON.stringify(command.state)), 1.5 * hour).state),
      ).toBe(hashState(second.state));
    },
  );

  it('a late arrival starts its cycle at contact without moving older clocks', () => {
    const arrive: GameModule = {
      id: 'arrival',
      version: '1',
      setup(api) {
        api.onAction('arrive', (_, h) => h.emit('fleet.arrived', { fleetId: 'c', at: 'P' }));
      },
    };
    const k = createKernel([combatModule, arrive]);
    const s = fixture();
    s.fleets.c = { ...s.fleets.a!, id: 'c', owner: 'c', battleId: null };
    const joined = k.applyAction(
      s,
      { id: 'join', type: 'arrive', playerId: 'c', payload: {}, issuedAt: hour / 2 },
      ctx(hour / 2),
    );
    if (!joined.ok) throw Error(joined.code);
    const after = advance(k, joined.state, hour / 2);
    expect(after.events.filter((e) => e.type === 'combat.round')).toHaveLength(1);
    expect(after.state.battles.B!.sides.map((s) => s.nextAttackAt)).toEqual([
      hour,
      undefined,
      1.5 * hour,
    ]);
    expect(after.state.fleets.a!.units[0]!.hp).toBe(994);
    expect(after.state.fleets.c!.units[0]!.hp).toBe(992);
  });

  it('bulk attack only orders owned defenders and never resets attackers', () => {
    const s = fixture();
    s.fleets.c = { ...s.fleets.b!, id: 'c', owner: 'b' };
    s.battles.B!.sides.push({
      ref: { kind: 'fleet', fleetId: 'c' },
      owner: 'b',
      role: 'attacker',
      attackStartedAt: 10,
      nextAttackAt: hour + 10,
    });
    const first = attack(s, 'b', 200);
    if (!first.ok) throw Error(first.code);
    const second = attack(first.state, 'b', 300);
    if (!second.ok) throw Error(second.code);
    expect(second.state.battles.B!.sides.map((s) => s.nextAttackAt)).toEqual([
      hour,
      hour + 200,
      hour + 10,
    ]);
    expect(attack(s, 'b', 100, combatantKey(s.battles.B!.sides[0]!.ref))).toEqual({
      ok: false,
      code: 'E_NO_BATTLE',
    });
    expect(attack(s, 'stranger', 100)).toEqual({ ok: false, code: 'E_NO_BATTLE' });
  });

  it('defender answers each attacker, never fires at another defender', () => {
    const s = fixture();
    s.fleets.c = { ...s.fleets.a!, id: 'c', owner: 'c' };
    s.battles.B!.sides.push({
      ref: { kind: 'fleet', fleetId: 'c' },
      owner: 'c',
      role: 'attacker',
      nextAttackAt: hour * 1.5,
      attackStartedAt: hour / 2,
    });
    const after = advance(kernel, s, hour);
    expect(after.state.fleets.a!.units[0]!.hp).toBe(992); // full reply, no c attack yet
    expect(after.state.fleets.b!.units[0]!.hp).toBe(994);
    expect(after.state.fleets.c!.units[0]!.hp).toBe(994); // only a's divided attack
    expect(after.state.battles.B!.sides[1]!.nextAttackAt).toBeUndefined();
    const later = advance(kernel, after.state, 1.5 * hour);
    expect(later.events.filter((e) => e.type === 'combat.round')).toHaveLength(1);
  });

  it('many staggered volleys do not consume another participant’s stalemate limit', () => {
    const s = fixture();
    s.battles.B!.round = 240;
    s.battles.B!.sides[0]!.attackCount = 2;
    const after = advance(kernel, s, hour);
    expect(after.state.battles.B?.round).toBe(241);
    expect(after.state.battles.B?.sides[0]?.attackCount).toBe(3);
  });

  it('duplicate scheduled instants do not create extra volleys', () => {
    const s = fixture();
    s.scheduled.push({ ...s.scheduled[0]!, id: 'evt:1', seq: 1 });
    s.scheduleSeq = 2;
    expect(advance(kernel, s, hour).events.filter((e) => e.type === 'combat.round')).toHaveLength(
      1,
    );
  });

  it('bulk retreat excludes enemies and rolls back every fleet on route failure', () => {
    const course: GameModule = {
      id: 'course',
      version: '1',
      setup(api) {
        api.provideCapability('fleet.course', ({ fleetId }: { fleetId: string }) =>
          fleetId === 'c' ? 'E_NO_PATH' : null,
        );
      },
    };
    const k = createKernel([course, combatModule]);
    const s = fixture();
    s.fleets.c = { ...s.fleets.a!, id: 'c' };
    s.battles.B!.sides.push({ ref: { kind: 'fleet', fleetId: 'c' }, owner: 'a', role: 'attacker' });
    const before = hashState(s);
    const action = {
      id: 'retreat',
      type: 'battle.retreat',
      playerId: 'a',
      issuedAt: 0,
      payload: { battleId: 'B', to: 'safe' },
    };
    expect(k.applyAction(s, action, ctx(0))).toEqual({ ok: false, code: 'E_NO_PATH' });
    expect(hashState(s)).toBe(before);
    const success = kernel.applyAction(s, action, ctx(0));
    if (!success.ok) throw Error(success.code);
    expect(success.state.fleets.a!.units[0]!.hp).toBe(600);
    expect(success.state.fleets.c!.units[0]!.hp).toBe(600);
    expect(success.state.fleets.b!.units[0]!.hp).toBeUndefined();
    expect(success.state.fleets.b!.retreatHasteUntil).toBeUndefined();
    expect(kernel.applyAction(fixture(true), action, ctx(0))).toEqual({
      ok: false,
      code: 'E_CANNOT_RETREAT',
    });
  });

  it('readout uses the actual hook pipeline and leaves state/RNG untouched', () => {
    const buffs: GameModule = {
      id: 'test-buff',
      version: '1',
      setup(api) {
        api.hook<number>('combat.damage.parallel', (n) => n + 0.5);
        api.hook<number>('combat.mitigation', (n) => n + 0.25);
      },
    };
    const k = createKernel([buffs, combatModule]);
    const s = fixture();
    const before = hashState(s);
    const view = inspectBattle(k, s, ctx(0), 'B')[combatantKey(s.battles.B!.sides[0]!.ref)]!;
    expect(view.attack).toBeCloseTo(14.4);
    expect(view.defense.min).toBeCloseTo(9.6);
    expect(view.defense.max).toBeCloseTo(9.6);
    expect(view.modifiers.some((m) => m.beneficial && m.direction === 'incoming')).toBe(true);
    expect(hashState(s)).toBe(before);
    const after = advance(k, s, hour);
    expect(1000 - after.state.fleets.b!.units[0]!.hp!).toBeCloseTo(view.attack);
    expect(1000 - after.state.fleets.a!.units[0]!.hp!).toBeCloseTo(view.defense.max);
  });
});
