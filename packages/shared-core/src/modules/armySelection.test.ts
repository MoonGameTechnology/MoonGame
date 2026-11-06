import { describe, expect, it } from 'vitest';
import { createKernel } from '../kernel/kernel';
import { createInitialState, type GameState } from '../state/gameState';
import { parseGameData } from '../data/schemas';
import { isValidActionPayload } from '../actions/payloadSchemas';
import { mergeStacks } from '../util/stacks';
import { armyModule } from './army';

const data = parseGameData({
  version: 'test',
  resources: ['metal'],
  factions: {},
  buildings: {},
  events: {},
  units: {
    ship: { faction: 'x', stats: { attack: 1, defense: 1, speed: 1, hp: 100, cargoCapacity: 20 } },
    infantry: {
      faction: 'x',
      domain: 'ground',
      stats: { attack: 1, defense: 1, speed: 0, hp: 20, cargoSize: 1 },
    },
  },
});
const kernel = createKernel([armyModule]);
const context = { now: 0, data };
function initial(): GameState {
  const s = createInitialState({ seed: 'selection', version: { data: 'test', manifest: '1' } });
  s.players.p = { id: 'p', name: 'P', faction: 'x', status: 'active', resources: {} };
  s.planets.a = {
    id: 'a',
    owner: 'p',
    position: { x: 0, y: 0 },
    buildings: [],
    traits: [],
    resources: {},
    garrison: [
      { unit: 'infantry', count: 4 },
      { unit: 'infantry', count: 4, battles: 3, hp: 40, damageDealt: 12 },
      { unit: 'infantry', count: 4, battles: 2 },
    ],
  };
  for (const id of ['f', 'g'])
    s.fleets[id] = {
      id,
      owner: 'p',
      location: 'a',
      movement: null,
      units: [{ unit: 'ship', count: 1 }],
      traits: [],
    };
  return s;
}
const action = (type: string, payload: object, playerId = 'p') => ({
  id: 'test',
  type,
  payload,
  playerId,
  issuedAt: 0,
});
function apply(s: GameState, type: string, payload: object): GameState {
  const r = kernel.applyAction(s, action(type, payload), context);
  if (!r.ok) throw new Error(r.code);
  return r.state;
}
function complete(s: GameState): GameState {
  const r = kernel.advanceTo(s, { now: 3_600_000, data });
  if (!r.ok) throw new Error(r.code);
  return r.state;
}
const prepared = () => apply(initial(), 'army.prepare', { fleetId: 'f' });

describe('explicit army formation selection', () => {
  it('pins a legacy wounded-first reservation before admitting an exact healthy selection', () => {
    let s = initial();
    s.fleets.f!.loading = [{ unit: 'infantry', count: 3, from: 'a', startAt: 0, doneAt: 3_600_000, first: 'wounded' }];
    s = apply(s, 'army.prepare', { fleetId: 'g' });
    const wounded = s.planets.a!.garrison[1]!;
    const healthy = s.planets.a!.garrison[0]!;
    expect(s.fleets.f!.loading![0]!.sources).toEqual([{ group: wounded.armyGroup, count: 3 }]);
    s = apply(s, 'army.load', { fleetId: 'g', unit: 'infantry', count: 4, group: healthy.armyGroup });
    expect(s.fleets.g!.loading![0]!.sources).toEqual([{ group: healthy.armyGroup, count: 4 }]);
  });
  it('prepares stable identities without changing counts, wounds or the input state', () => {
    const before = initial();
    const after = apply(before, 'army.prepare', { fleetId: 'f' });
    expect(before.planets.a!.garrison.every((s) => s.armyGroup === undefined)).toBe(true);
    expect(new Set(after.planets.a!.garrison.map((s) => s.armyGroup)).size).toBe(3);
    expect(after.planets.a!.garrison).toMatchObject(before.planets.a!.garrison);
    expect(apply(after, 'army.prepare', { fleetId: 'f' })).toEqual(after);
  });

  it('loads the chosen wounded veterans after healing, list reorder and JSON restore', () => {
    let s = prepared();
    const group = s.planets.a!.garrison[1]!.armyGroup!;
    s = apply(s, 'army.load', { fleetId: 'f', unit: 'infantry', count: 2, group });
    expect(s.fleets.f!.loading![0]!.sources).toEqual([{ group, count: 2 }]);
    s.planets.a!.garrison[1]!.hp = 60;
    s.planets.a!.garrison.reverse();
    const done = complete(JSON.parse(JSON.stringify(s)) as GameState);
    expect(done.fleets.f!.landing).toEqual([
      { unit: 'infantry', count: 2, hp: 30, battles: 3, damageDealt: 12 },
    ]);
    expect(done.planets.a!.garrison.find((st) => st.armyGroup === group)).toMatchObject({
      count: 2,
      hp: 30,
    });
    expect(
      done.planets.a!.garrison.filter((st) => st.armyGroup !== group).map((st) => st.count),
    ).toEqual([4, 4]);
  });

  it('never substitutes healthy troops after the selected formation disappears', () => {
    let s = prepared();
    const group = s.planets.a!.garrison[1]!.armyGroup!;
    s = apply(s, 'army.load', { fleetId: 'f', unit: 'infantry', count: 3, group });
    s.planets.a!.garrison = s.planets.a!.garrison.filter((st) => st.armyGroup !== group);
    const done = complete(s);
    expect(done.fleets.f!.landing ?? []).toEqual([]);
    expect(done.planets.a!.garrison).toEqual(s.planets.a!.garrison);
    expect(done.fleets.f!.loading).toBeUndefined();
  });

  it('reserves each formation across fleets and rejects forged or overbooked selections', () => {
    let s = prepared();
    const group = s.planets.a!.garrison[1]!.armyGroup!;
    s = apply(s, 'army.load', { fleetId: 'f', unit: 'infantry', count: 3, group });
    for (const choice of [group, 'other-world-group']) {
      const result = kernel.applyAction(
        s,
        action('army.load', { fleetId: 'g', unit: 'infantry', count: 2, group: choice }),
        context,
      );
      expect(result).toMatchObject({ ok: false, code: 'E_NO_ARMY' });
    }
    const other = s.planets.a!.garrison[2]!.armyGroup!;
    const done = complete(
      apply(s, 'army.load', { fleetId: 'g', unit: 'infantry', count: 2, group: other }),
    );
    expect(done.fleets.f!.landing![0]).toMatchObject({ count: 3, hp: 30, battles: 3 });
    expect(done.fleets.g!.landing![0]).toEqual({ unit: 'infantry', count: 2, battles: 2 });
  });

  it('pins a legacy saved order before a new explicit order can take its troops', () => {
    let s = apply(initial(), 'army.load', { fleetId: 'f', unit: 'infantry', count: 3 });
    delete s.fleets.f!.loading![0]!.sources;
    s = apply(s, 'army.prepare', { fleetId: 'g' });
    const group = s.planets.a!.garrison[0]!.armyGroup!;
    expect(s.fleets.f!.loading![0]!.sources).toEqual([{ group, count: 3 }]);
    expect(
      kernel.applyAction(
        s,
        action('army.load', { fleetId: 'g', unit: 'infantry', count: 2, group }),
        context,
      ),
    ).toMatchObject({ ok: false, code: 'E_NO_ARMY' });
    const done = complete(
      apply(s, 'army.load', { fleetId: 'g', unit: 'infantry', count: 1, group }),
    );
    expect(done.fleets.f!.landing).toEqual([{ unit: 'infantry', count: 3 }]);
    expect(done.fleets.g!.landing).toEqual([{ unit: 'infantry', count: 1 }]);
  });

  it('unloads only the chosen formation with proportional wounds and service intact', () => {
    const start = initial();
    start.fleets.f!.landing = start.planets.a!.garrison;
    start.planets.a!.garrison = [];
    let s = apply(start, 'army.prepare', { fleetId: 'f' });
    const group = s.fleets.f!.landing![1]!.armyGroup!;
    s = apply(s, 'army.unload', { fleetId: 'f', unit: 'infantry', count: 2, group });
    const done = complete(s);
    expect(done.planets.a!.garrison).toEqual([
      { unit: 'infantry', count: 2, hp: 20, battles: 3, damageDealt: 12 },
    ]);
    expect(done.fleets.f!.landing!.find((st) => st.armyGroup === group)).toMatchObject({
      count: 2,
      hp: 20,
    });
  });

  it('preserves distinct identities on merge and validates the new API fields', () => {
    const stacks = prepared().planets.a!.garrison;
    const healthy = stacks.filter((s) => s.hp === undefined).map((s) => ({ ...s, battles: 3 }));
    expect(mergeStacks([healthy[0]!], [healthy[1]!])).toHaveLength(2);
    for (const group of ['', null, 1, 'x'.repeat(129)])
      expect(
        isValidActionPayload('army.load', { fleetId: 'f', unit: 'infantry', count: 1, group }),
      ).toBe(false);
    expect(isValidActionPayload('army.prepare', { fleetId: 'f' })).toBe(true);
    expect(
      kernel.applyAction(initial(), action('army.prepare', { fleetId: 'f' }, 'intruder'), context)
        .ok,
    ).toBe(false);
  });
});
