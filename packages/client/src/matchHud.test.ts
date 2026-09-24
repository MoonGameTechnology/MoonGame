import { describe, expect, it } from 'vitest';
import {
  createInitialState,
  MS_PER_DAY,
  MS_PER_HOUR,
  type Fleet,
  type GameData,
  type GameState,
  type Hero,
  type Planet,
} from '@void/shared-core';
import {
  createBattleModel,
  createBattlePreviewModel,
  createSelectionModel,
  createStatusBarModel,
  resolveBattleAction,
  resolveFleetAction,
  createWorldModel,
  resolveWorldAction,
  createSplitModel,
  stepSplitTake,
  resolveSplit,
  mergeCandidates,
  resolveMerge,
  type FleetSelectionModel,
  type WorldModel,
} from './matchHud';

/** Minimal game-data slice the HUD reads: canonical resource order + unit defs
 *  (only `domain` and `stats.hp` are consulted). Cast keeps the fixture terse.
 *  `raider`/`sentry` carry `attack`/`defense` too — the assault-preview describe
 *  below is the only one that runs the actual combat math. */
const DATA = {
  resources: ['credits', 'metal', 'food', 'energy', 'microelectronics'],
  units: {
    frigate: { domain: 'space', stats: { hp: 10 } },
    corvette: { domain: 'space', stats: { hp: 6 } },
    marine: { domain: 'ground', stats: { hp: 3 } },
    aegis: { domain: 'space', stats: { hp: 10, shield: 4 } }, // shielded hull
    raider: { domain: 'ground', stats: { hp: 20, attack: 10, defense: 0 }, traits: [], line: 'front' },
    sentry: { domain: 'ground', stats: { hp: 5, attack: 0, defense: 0 }, traits: [], line: 'front' },
  },
  sectorKinds: {
    outpost: { capturable: true },
    fortress: { capturable: false },
  },
  // Пустой каталог модулей — не украшение: `effectiveStats` читает `data.modules`
  // всякий раз, когда у стека есть лоадаут (окно деления считает так вместимость трюма),
  // и без карты падает. В боевых данных она есть по схеме.
  modules: {},
  // Объявлен как ПОЛНЫЙ `GameData`, хотя заполнены только читаемые полями модели срезы:
  // панель мира спрашивает у ядра `isInhabited`/`stewardUnlocked`, а те принимают весь
  // `GameData` — с `Pick` фикстура в них не проходит по типу.
} as unknown as GameData;

function baseState(): GameState {
  const s = createInitialState({ seed: 'hud', version: { data: '1', manifest: '1' } });
  s.players = {
    p1: {
      id: 'p1',
      name: 'Носорог-1',
      faction: 'vanguard',
      status: 'active',
      resources: { credits: 17_446, metal: 38_000, food: 5_600, energy: 10_000 },
    },
    p2: { id: 'p2', name: 'Комета-2', faction: 'raiders', status: 'active', resources: {} },
    p3: { id: 'p3', name: 'Орион-3', faction: 'vanguard', status: 'defeated', resources: {} },
  };
  s.match.scores = {
    p1: { controlledPlanets: 2, fleets: 1, units: 5, total: 120 },
    p2: { controlledPlanets: 4, fleets: 2, units: 9, total: 300 },
    p3: { controlledPlanets: 0, fleets: 0, units: 0, total: 0 },
  };
  return s;
}

describe('createStatusBarModel', () => {
  it('projects the viewing commander from real player + clock state', () => {
    const s = baseState();
    s.startedAt = 1_000 * MS_PER_DAY; // a match booted at a large world-time
    s.time = s.startedAt + 2 * MS_PER_DAY + 5 * MS_PER_HOUR + 30 * 60_000;

    const res = createStatusBarModel(s, 'p1', DATA);
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.commander).toBe('Носорог-1');
    expect(res.faction).toBe('vanguard');
    expect(res.players).toBe(3);
    expect(res.defeated).toBe(false);
    // Clock is startedAt-anchored (raw time would read day 1002), not absolute.
    expect(res.day).toBe(2);
    expect(res.dayTimeMs).toBe(5 * MS_PER_HOUR + 30 * 60_000);
  });

  it('keeps day/dayTimeMs coherent at a day boundary and under backward skew', () => {
    const boundary = createStatusBarModel(
      Object.assign(baseState(), { startedAt: 0, time: 3 * MS_PER_DAY }),
      'p1',
    );
    expect(boundary).toMatchObject({ ok: true, day: 3, dayTimeMs: 0 });
    // startedAt > time (clock skew): clamp to the anchor, not a bogus "day 0, 23:59".
    const skew = createStatusBarModel(
      Object.assign(baseState(), { startedAt: 5 * MS_PER_DAY, time: 5 * MS_PER_DAY - MS_PER_HOUR }),
      'p1',
    );
    expect(skew).toMatchObject({ ok: true, day: 0, dayTimeMs: 0 });
  });

  it('derives placement by score total, best rank = 1', () => {
    const s = baseState();
    // p2 total 300 → 1st, p1 total 120 → 2nd, p3 total 0 → 3rd.
    expect(createStatusBarModel(s, 'p2', DATA)).toMatchObject({ ok: true, rank: 1 });
    expect(createStatusBarModel(s, 'p1', DATA)).toMatchObject({ ok: true, rank: 2 });
    expect(createStatusBarModel(s, 'p3', DATA)).toMatchObject({ ok: true, rank: 3 });
  });

  it('breaks score ties by id deterministically', () => {
    const s = baseState();
    s.match.scores.p1!.total = 300; // tie with p2 at 300
    // Tie → id order: p1 before p2.
    expect(createStatusBarModel(s, 'p1', DATA)).toMatchObject({ ok: true, rank: 1 });
    expect(createStatusBarModel(s, 'p2', DATA)).toMatchObject({ ok: true, rank: 2 });
  });

  it('orders resources by the canonical game-data order, missing shown as 0', () => {
    const res = createStatusBarModel(baseState(), 'p1', DATA);
    if (!res.ok) throw new Error('expected ok');
    expect(res.resources).toEqual([
      { id: 'credits', amount: 17_446 },
      { id: 'metal', amount: 38_000 },
      { id: 'food', amount: 5_600 },
      { id: 'energy', amount: 10_000 },
      { id: 'microelectronics', amount: 0 },
    ]);
  });

  it('appends bag resources outside the canonical list, after the ordered ones', () => {
    const s = baseState();
    s.players.p1!.resources = { credits: 10, plasma: 42 }; // plasma ∉ data.resources
    const res = createStatusBarModel(s, 'p1', DATA);
    if (!res.ok) throw new Error('expected ok');
    expect(res.resources).toEqual([
      { id: 'credits', amount: 10 },
      { id: 'metal', amount: 0 },
      { id: 'food', amount: 0 },
      { id: 'energy', amount: 0 },
      { id: 'microelectronics', amount: 0 },
      { id: 'plasma', amount: 42 }, // leftover key appended last
    ]);
  });

  it('degrades gracefully without game data — bag order, no invented keys', () => {
    const res = createStatusBarModel(baseState(), 'p1');
    if (!res.ok) throw new Error('expected ok');
    expect(res.resources).toEqual([
      { id: 'credits', amount: 17_446 },
      { id: 'metal', amount: 38_000 },
      { id: 'food', amount: 5_600 },
      { id: 'energy', amount: 10_000 },
    ]);
  });

  it('reports a defeated commander', () => {
    expect(createStatusBarModel(baseState(), 'p3', DATA)).toMatchObject({
      ok: true,
      defeated: true,
    });
  });

  it('fail-secure: an unknown viewer yields a stable code', () => {
    expect(createStatusBarModel(baseState(), 'ghost', DATA)).toEqual({
      ok: false,
      code: 'E_NO_PLAYER',
    });
  });

  it('produces a JSON-serialisable model', () => {
    const res = createStatusBarModel(baseState(), 'p1', DATA);
    expect(JSON.parse(JSON.stringify(res))).toEqual(res);
  });
});

/* selection fixtures */
function fleet(partial: Partial<Fleet> & Pick<Fleet, 'id' | 'owner'>): Fleet {
  return {
    location: 'A',
    movement: null,
    units: [],
    traits: [],
    ...partial,
  };
}

describe('createSelectionModel', () => {
  it('projects a fleet in transit: destination, ETA, composition, full hull', () => {
    const s = baseState();
    s.fleets = {
      f1: fleet({
        id: 'f1',
        owner: 'p1',
        location: null,
        movement: {
          from: 'A',
          to: 'B',
          departedAt: 100,
          arrivesAt: 900,
          destination: 'C',
        },
        units: [
          { unit: 'frigate', count: 3 },
          { unit: 'corvette', count: 2 },
        ],
      }),
    };
    const res = createSelectionModel(s, 'f1', 'p1', DATA);
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.status).toBe('transit');
    expect(res.mine).toBe(true);
    expect(res.ownerName).toBe('Носорог-1');
    expect(res.ownerFaction).toBe('vanguard');
    expect(res.transit).toEqual({
      from: 'A',
      to: 'B',
      destination: 'C',
      departedAt: 100,
      arrivesAt: 900,
    });
    expect(res.ships).toEqual([
      { unit: 'frigate', count: 3, domain: 'space' },
      { unit: 'corvette', count: 2, domain: 'space' },
    ]);
    // Outside combat = full: (3×10) + (2×6) = 42.
    expect(res.hull).toEqual({ current: 42, max: 42 });
    expect(res.inCombat).toBe(false);
    expect(res.location).toBeUndefined();
  });

  it('falls back to `to` when a leg has no explicit final destination', () => {
    const s = baseState();
    s.fleets = {
      f1: fleet({
        id: 'f1',
        owner: 'p1',
        location: null,
        movement: { from: 'A', to: 'B', departedAt: 0, arrivesAt: 10 },
      }),
    };
    const res = createSelectionModel(s, 'f1', 'p1', DATA);
    if (!res.ok) throw new Error('expected ok');
    expect(res.transit?.destination).toBe('B');
  });

  it('projects a stationed fleet at its node', () => {
    const s = baseState();
    s.fleets = { f1: fleet({ id: 'f1', owner: 'p1', location: 'Гелиос-III' }) };
    const res = createSelectionModel(s, 'f1', 'p1', DATA);
    expect(res).toMatchObject({ ok: true, status: 'stationed', location: 'Гелиос-III' });
  });

  it('treats a fleet with no location/movement/edge as stationed with no node', () => {
    const s = baseState();
    s.fleets = { f1: fleet({ id: 'f1', owner: 'p1', location: null }) };
    const res = createSelectionModel(s, 'f1', 'p1', DATA);
    if (!res.ok) throw new Error('expected ok');
    expect(res.status).toBe('stationed');
    expect(res.location).toBeUndefined();
  });

  it('projects a fleet parked mid-lane', () => {
    const s = baseState();
    s.fleets = {
      f1: fleet({ id: 'f1', owner: 'p1', location: null, edge: { from: 'A', to: 'B', t: 0.4 } }),
    };
    const res = createSelectionModel(s, 'f1', 'p1', DATA);
    expect(res).toMatchObject({
      ok: true,
      status: 'parked',
      parked: { from: 'A', to: 'B', t: 0.4 },
    });
  });

  it('uses the per-stack combat pool for current hull and flags combat', () => {
    const s = baseState();
    s.fleets = {
      f1: fleet({
        id: 'f1',
        owner: 'p1',
        battleId: 'b7',
        units: [{ unit: 'frigate', count: 3, hp: 22 }], // damaged: 22 of 30
      }),
    };
    const res = createSelectionModel(s, 'f1', 'p1', DATA);
    if (!res.ok) throw new Error('expected ok');
    expect(res.hull).toEqual({ current: 22, max: 30 });
    expect(res.inCombat).toBe(true);
  });

  it('tolerates a unit id absent from game data (0 hp, no domain), never throws', () => {
    const s = baseState();
    s.fleets = {
      f1: fleet({
        id: 'f1',
        owner: 'p1',
        units: [
          { unit: 'frigate', count: 2 },
          { unit: 'ghostship', count: 5 }, // not in DATA.units
        ],
      }),
    };
    const res = createSelectionModel(s, 'f1', 'p1', DATA);
    if (!res.ok) throw new Error('expected ok');
    expect(res.hull).toEqual({ current: 20, max: 20 }); // unknown unit contributes 0
    expect(res.ships).toEqual([
      { unit: 'frigate', count: 2, domain: 'space' },
      { unit: 'ghostship', count: 5 }, // no domain resolved
    ]);
  });

  it('reports zero hull for an empty fleet', () => {
    const s = baseState();
    s.fleets = { f1: fleet({ id: 'f1', owner: 'p1', units: [] }) };
    const res = createSelectionModel(s, 'f1', 'p1', DATA);
    expect(res).toMatchObject({ ok: true, hull: { current: 0, max: 0 } });
  });

  it('emits a shield bar from real shield capacity, full when undamaged', () => {
    const s = baseState();
    s.fleets = { f1: fleet({ id: 'f1', owner: 'p1', units: [{ unit: 'aegis', count: 3 }] }) };
    const res = createSelectionModel(s, 'f1', 'p1', DATA);
    if (!res.ok) throw new Error('expected ok');
    expect(res.shield).toEqual({ current: 12, max: 12 }); // 3 × 4, full
    expect(res.hull).toEqual({ current: 30, max: 30 }); // 3 × 10
  });

  it('uses the per-stack shieldHp pool for current shield', () => {
    const s = baseState();
    s.fleets = {
      f1: fleet({ id: 'f1', owner: 'p1', units: [{ unit: 'aegis', count: 3, shieldHp: 5 }] }),
    };
    const res = createSelectionModel(s, 'f1', 'p1', DATA);
    if (!res.ok) throw new Error('expected ok');
    expect(res.shield).toEqual({ current: 5, max: 12 }); // depleted shield, hull intact
  });

  it('omits the shield bar for a shieldless fleet', () => {
    const s = baseState();
    s.fleets = { f1: fleet({ id: 'f1', owner: 'p1', units: [{ unit: 'frigate', count: 2 }] }) };
    const res = createSelectionModel(s, 'f1', 'p1', DATA);
    if (!res.ok) throw new Error('expected ok');
    expect(res.shield).toBeUndefined(); // one HP bar, not an empty second
  });

  it('attaches the commanding hero (grade, name fallback to owner)', () => {
    const s = baseState();
    s.fleets = { f1: fleet({ id: 'f1', owner: 'p1' }) };
    const hero: Hero = {
      id: 'h1',
      owner: 'p1',
      location: 'A',
      cooldowns: {},
      grade: 'legendary',
      fleetId: 'f1',
    };
    s.heroes = { h1: hero };
    const res = createSelectionModel(s, 'f1', 'p1', DATA);
    if (!res.ok) throw new Error('expected ok');
    // Neither a seat name nor an archetype → the owner's callsign is all there is.
    expect(res.commander).toEqual({ name: 'Носорог-1', grade: 'legendary' });
  });

  it('names a commander by ARCHETYPE, not by a string baked into the state (AUD-13)', () => {
    const s = baseState();
    s.fleets = { f1: fleet({ id: 'f1', owner: 'p1' }) };
    s.heroes = {
      // A roster hero: the state carries its archetype, and the renderer builds the
      // name from it — display text never lives in `GameState` (one state, one
      // locale per viewer).
      h1: { id: 'h1', owner: 'p1', location: 'A', cooldowns: {}, archetype: 'warden', fleetId: 'f1' },
    };
    const res = createSelectionModel(s, 'f1', 'p1', DATA);
    if (!res.ok) throw new Error('expected ok');
    expect(res.commander).toEqual({ archetype: 'warden' });
    // The seat identity of a MAIN hero (a callsign) still rides through as `name`.
    s.heroes.h1!.name = 'Носорог-1';
    s.heroes.h1!.grade = 'main';
    const main = createSelectionModel(s, 'f1', 'p1', DATA);
    if (!main.ok) throw new Error('expected ok');
    expect(main.commander).toEqual({ name: 'Носорог-1', archetype: 'warden', grade: 'main' });
  });

  it('ignores a dead hero and a hero commanding another fleet', () => {
    const s = baseState();
    s.fleets = { f1: fleet({ id: 'f1', owner: 'p1' }) };
    s.heroes = {
      dead: { id: 'dead', owner: 'p1', location: 'A', cooldowns: {}, fleetId: 'f1', alive: false },
      other: { id: 'other', owner: 'p1', location: 'A', cooldowns: {}, fleetId: 'f9' },
    };
    const res = createSelectionModel(s, 'f1', 'p1', DATA);
    if (!res.ok) throw new Error('expected ok');
    expect(res.commander).toBeUndefined();
  });

  it('marks an enemy fleet not-mine but keeps its identity', () => {
    const s = baseState();
    s.fleets = { f2: fleet({ id: 'f2', owner: 'p2', units: [{ unit: 'frigate', count: 1 }] }) };
    const res = createSelectionModel(s, 'f2', 'p1', DATA);
    expect(res).toMatchObject({
      ok: true,
      mine: false,
      owner: 'p2',
      ownerName: 'Комета-2',
      ownerFaction: 'raiders',
    });
  });

  it('never leaks an enemy commander, even on a non-fogged state', () => {
    const s = baseState();
    s.fleets = { f2: fleet({ id: 'f2', owner: 'p2' }) };
    // An enemy hero present in state (as it would be on a raw, un-fogged state).
    s.heroes = {
      h2: { id: 'h2', owner: 'p2', location: 'A', cooldowns: {}, grade: 'rare', fleetId: 'f2' },
    };
    const res = createSelectionModel(s, 'f2', 'p1', DATA);
    if (!res.ok) throw new Error('expected ok');
    expect(res.commander).toBeUndefined(); // ownership guard, not just the fog pass
  });

  it('falls back to the id when the owner has no player record', () => {
    const s = baseState();
    s.fleets = { fx: fleet({ id: 'fx', owner: 'p9' }) }; // p9 ∉ players
    const res = createSelectionModel(s, 'fx', 'p1', DATA);
    expect(res).toMatchObject({ ok: true, ownerName: 'p9', ownerFaction: '' });
  });

  it('degrades gracefully without game data — no hull, no stack domain', () => {
    const s = baseState();
    s.fleets = { f1: fleet({ id: 'f1', owner: 'p1', units: [{ unit: 'frigate', count: 3 }] }) };
    const res = createSelectionModel(s, 'f1', 'p1');
    if (!res.ok) throw new Error('expected ok');
    expect(res.hull).toBeUndefined();
    expect(res.ships).toEqual([{ unit: 'frigate', count: 3 }]);
  });

  it('fail-secure: a missing / fogged fleet yields a stable code', () => {
    expect(createSelectionModel(baseState(), 'ghost', 'p1', DATA)).toEqual({
      ok: false,
      code: 'E_NO_SELECTION',
    });
  });

  it('produces a JSON-serialisable model', () => {
    const s = baseState();
    s.fleets = { f1: fleet({ id: 'f1', owner: 'p1', units: [{ unit: 'frigate', count: 2 }] }) };
    const res = createSelectionModel(s, 'f1', 'p1', DATA);
    expect(JSON.parse(JSON.stringify(res))).toEqual(res);
  });
});

describe('createBattleModel', () => {
  function orbitalScene(): GameState {
    const s = baseState();
    s.fleets = {
      f1: fleet({ id: 'f1', owner: 'p1', units: [{ unit: 'aegis', count: 3 }], battleId: 'b1' }),
      f2: fleet({ id: 'f2', owner: 'p2', units: [{ unit: 'frigate', count: 2 }], battleId: 'b1' }),
    };
    s.battles = {
      b1: {
        id: 'b1',
        location: 'Гелиос-III',
        phase: 'orbital',
        round: 2,
        nextRoundAt: 5000,
        sides: [
          { ref: { kind: 'fleet', fleetId: 'f1' }, owner: 'p1', role: 'attacker' as const },
          { ref: { kind: 'fleet', fleetId: 'f2' }, owner: 'p2', role: 'defender' as const },
        ],
      },
    };
    return s;
  }

  /** Тот же узел, но штурмующих двое (MSB-3/MSB-4 сделали это достижимым). */
  function threeSided(): GameState {
    const s = orbitalScene();
    s.fleets.f3 = fleet({
      id: 'f3',
      owner: 'p3',
      units: [{ unit: 'frigate', count: 1 }],
      battleId: 'b1',
    });
    s.players.p3 = { id: 'p3', name: 'Третий', faction: 'vanguard', status: 'active', resources: {} };
    s.battles.b1!.sides.push({
      ref: { kind: 'fleet', fleetId: 'f3' },
      owner: 'p3',
      role: 'attacker' as const,
    });
    return s;
  }

  it('MSB-6: на ДУЭЛИ список сторон — ровно [атакующий, обороняющийся]', () => {
    const res = createBattleModel(orbitalScene(), 'b1', 'p1', DATA);
    if (!res.ok) throw new Error('expected ok');
    // Требование приёмки «вид двустороннего боя не изменился ни на пиксель»: рендер
    // рисует `sides`, и на дуэли он обязан совпадать со старой парой поле в поле.
    expect(res.sides).toHaveLength(2);
    expect(res.sides[0]).toEqual(res.attacker);
    expect(res.sides[1]).toEqual(res.defender);
  });

  it('MSB-6: ТРИ стороны — три строки, у каждой своя роль', () => {
    const res = createBattleModel(threeSided(), 'b1', 'p1', DATA);
    if (!res.ok) throw new Error('expected ok');
    expect(res.sides).toHaveLength(3);
    expect(res.sides.map((x) => x.owner)).toEqual(['p1', 'p2', 'p3']);
    // Роль принадлежит СТОРОНЕ, а не месту в списке: атакующих здесь двое, и вывести
    // это из порядка нельзя — панель обязана брать роль у самой стороны.
    expect(res.sides.map((x) => x.role)).toEqual(['attacker', 'defender', 'attacker']);
    // Короткий путь остаётся ПЕРВЫМ атакующим, а не «всем штурмом».
    expect(res.attacker.owner).toBe('p1');
  });

  it('projects an orbital battle: both sides, forces, hull/shield, live round timer', () => {
    const res = createBattleModel(orbitalScene(), 'b1', 'p1', DATA);
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res).toMatchObject({ kind: 'battle', phase: 'orbital', round: 2, location: 'Гелиос-III' });
    expect(res.nextRoundAt).toBe(5000);
    // attacker = the viewer's shielded aegis wing
    expect(res.attacker).toMatchObject({ owner: 'p1', ownerName: 'Носорог-1', kind: 'fleet', mine: true });
    expect(res.attacker.units).toEqual([{ unit: 'aegis', count: 3, domain: 'space' }]);
    expect(res.attacker.hull).toEqual({ current: 30, max: 30 }); // 3×10
    expect(res.attacker.shield).toEqual({ current: 12, max: 12 }); // 3×4
    // defender = enemy frigates (no shield capacity → no shield bar)
    expect(res.defender).toMatchObject({ owner: 'p2', ownerName: 'Комета-2', mine: false });
    expect(res.defender.hull).toEqual({ current: 20, max: 20 });
    expect(res.defender.shield).toBeUndefined();
    // the sole action targets the viewer's own orbital fleet
    expect(res.retreatFleetId).toBe('f1');
  });

  it('offers retreat to whichever side the viewer owns (here the defender)', () => {
    const res = createBattleModel(orbitalScene(), 'b1', 'p2', DATA);
    if (!res.ok) throw new Error('expected ok');
    expect(res.attacker.mine).toBe(false);
    expect(res.defender.mine).toBe(true);
    expect(res.retreatFleetId).toBe('f2');
  });

  it('a spectator (owns neither side) gets no retreat target', () => {
    const res = createBattleModel(orbitalScene(), 'b1', 'p3', DATA);
    if (!res.ok) throw new Error('expected ok');
    expect(res.retreatFleetId).toBeUndefined();
  });

  it('projects a ground battle: landing force vs planet garrison (no retreat)', () => {
    const s = baseState();
    s.planets = {
      P: {
        id: 'P',
        owner: 'p2',
        position: { x: 0, y: 0 },
        resources: {},
        buildings: [],
        garrison: [{ unit: 'marine', count: 3 }],
        traits: [],
      },
    };
    s.fleets = {
      f1: fleet({ id: 'f1', owner: 'p1', landing: [{ unit: 'marine', count: 2 }], battleId: 'b1' }),
    };
    s.battles = {
      b1: {
        id: 'b1',
        location: 'P',
        phase: 'ground',
        round: 1,
        sides: [
          { ref: { kind: 'landing', fleetId: 'f1' }, owner: 'p1', role: 'attacker' as const },
          { ref: { kind: 'garrison', planetId: 'P' }, owner: 'p2', role: 'defender' as const },
        ],
      },
    };
    const res = createBattleModel(s, 'b1', 'p1', DATA);
    if (!res.ok) throw new Error('expected ok');
    expect(res.phase).toBe('ground');
    expect(res.attacker).toMatchObject({ kind: 'landing', mine: true });
    expect(res.attacker.units).toEqual([{ unit: 'marine', count: 2, domain: 'ground' }]);
    expect(res.defender).toMatchObject({ kind: 'garrison', owner: 'p2' });
    expect(res.defender.units).toEqual([{ unit: 'marine', count: 3, domain: 'ground' }]);
    // a landing force / garrison can't pull out — only an orbital ship can
    expect(res.retreatFleetId).toBeUndefined();
  });

  it('degrades gracefully without game data — no hull/shield, no stack domain', () => {
    const res = createBattleModel(orbitalScene(), 'b1', 'p1');
    if (!res.ok) throw new Error('expected ok');
    expect(res.attacker.hull).toBeUndefined();
    expect(res.attacker.shield).toBeUndefined();
    expect(res.attacker.units).toEqual([{ unit: 'aegis', count: 3 }]);
  });

  it('fail-secure: a missing / fogged battle yields a stable code', () => {
    expect(createBattleModel(orbitalScene(), 'ghost', 'p1', DATA)).toEqual({
      ok: false,
      code: 'E_NO_BATTLE',
    });
  });

  it('produces a JSON-serialisable model', () => {
    const res = createBattleModel(orbitalScene(), 'b1', 'p1', DATA);
    expect(JSON.parse(JSON.stringify(res))).toEqual(res);
  });

  // PERK-3.3: надбавка за пережитые бои приезжает в панель ЧИСЛОМ ИЗ ЯДРА.
  const VET_DATA = { ...DATA, veteran: { damagePerBattle: 0.04 } } as unknown as GameData;

  it('сторона с выслугой несёт множитель, необстрелянная — не несёт поля вовсе', () => {
    const s = orbitalScene();
    s.fleets.f1!.units = [{ unit: 'aegis', count: 3, battles: 4 }];
    const res = createBattleModel(s, 'b1', 'p1', VET_DATA);
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.attacker.veteran).toBeCloseTo(1.16, 9);
    // Отсутствие поля, а не единица: «надбавки нет» панель не должна рисовать вообще.
    expect(res.defender.veteran).toBeUndefined();
  });

  it('число принадлежит ВЛАДЕЛЬЦУ, а не строке: у двух сторон одного игрока оно общее', () => {
    // Совместный штурм (MSB-4): множитель в ядре пулится по всем силам владельца, и
    // показать сторонам разные числа значило бы соврать про то, что реально применится.
    const s = threeSided();
    s.fleets.f1!.units = [{ unit: 'aegis', count: 2, battles: 4 }];
    s.fleets.f3!.owner = 'p1';
    s.battles.b1!.sides[2]!.owner = 'p1';
    s.fleets.f3!.units = [{ unit: 'frigate', count: 2, battles: 0 }];
    const res = createBattleModel(s, 'b1', 'p1', VET_DATA);
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    const mine = res.sides.filter((sd) => sd.owner === 'p1').map((sd) => sd.veteran);
    expect(mine).toHaveLength(2);
    // 2 юнита по 4 боя + 2 юнита по 0 = 2 боя на юнит → ×1.08 у ОБЕИХ строк.
    expect(mine[0]).toBeCloseTo(1.08, 9);
    expect(mine[1]).toBeCloseTo(1.08, 9);
  });

  it('урезанный каталог без секции `veteran` не роняет окно боя', () => {
    // Панель обязана деградировать, а не падать (шапка файла). `DATA` намеренно
    // неполон — ровно на нём краш и был пойман.
    const s = orbitalScene();
    s.fleets.f1!.units = [{ unit: 'aegis', count: 3, battles: 4 }];
    const res = createBattleModel(s, 'b1', 'p1', DATA);
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.attacker.veteran).toBeUndefined();
  });
});

describe('createBattlePreviewModel', () => {
  // previewBattle (core) wants a full GameData; DATA above is intentionally a
  // narrow Pick for the other describes, so widen it once here.
  const PREVIEW_DATA = DATA as unknown as GameData;

  function world(partial: Partial<Planet> = {}): Planet {
    return {
      id: 'A',
      owner: 'p2',
      position: { x: 0, y: 0 },
      resources: {},
      buildings: [],
      garrison: [{ unit: 'sentry', count: 1 }],
      traits: [],
      ...partial,
    };
  }

  function dockedScene(fleetPartial: Partial<Fleet> = {}, planetPartial: Partial<Planet> = {}): GameState {
    const s = baseState();
    s.planets = { A: world(planetPartial) };
    s.fleets = {
      f1: fleet({
        id: 'f1',
        owner: 'p1',
        location: 'A',
        landing: [{ unit: 'raider', count: 1 }],
        ...fleetPartial,
      }),
    };
    return s;
  }

  it('forecasts a clean attacker win: no counter-fire, one round, garrison wiped', () => {
    const res = createBattlePreviewModel(dockedScene(), 'f1', 'p1', PREVIEW_DATA);
    expect(res).toMatchObject({
      ok: true,
      kind: 'preview',
      outcome: 'attacker',
      roundsEst: 1,
    });
    if (!res.ok) return;
    // sentry has 0 defense (no return fire) → the raider takes zero damage.
    expect(res.attacker).toEqual({ losses: [], lossCount: 0, damageFraction: 0 });
    // 1 sentry (5 hp) vs 10 attack → wiped in round 1.
    expect(res.defender).toEqual({
      losses: [{ unit: 'sentry', count: 1, domain: 'ground' }],
      lossCount: 1,
      damageFraction: 1,
    });
  });

  it('fail-secure: absent fleet yields a stable code', () => {
    expect(createBattlePreviewModel(baseState(), 'ghost', 'p1', PREVIEW_DATA)).toEqual({
      ok: false,
      code: 'E_NO_SELECTION',
    });
  });

  it('fail-secure: not the viewer\'s own fleet yields a stable code', () => {
    const s = dockedScene({ owner: 'p2' });
    expect(createBattlePreviewModel(s, 'f1', 'p1', PREVIEW_DATA)).toEqual({
      ok: false,
      code: 'E_FORBIDDEN',
    });
  });

  it('fail-secure: a fleet in transit is not docked anywhere to forecast', () => {
    const s = dockedScene({
      location: null,
      movement: { from: 'A', to: 'B', departedAt: 0, arrivesAt: 10 },
    });
    expect(createBattlePreviewModel(s, 'f1', 'p1', PREVIEW_DATA)).toEqual({
      ok: false,
      code: 'E_NOT_DOCKED',
    });
  });

  it('fail-secure: a fleet parked mid-lane is not docked anywhere to forecast', () => {
    const s = dockedScene({ location: null, edge: { from: 'A', to: 'B', t: 0.5 } });
    expect(createBattlePreviewModel(s, 'f1', 'p1', PREVIEW_DATA)).toEqual({
      ok: false,
      code: 'E_NOT_DOCKED',
    });
  });

  it('fail-secure: a fleet already fighting has nothing left to forecast', () => {
    const s = dockedScene({ battleId: 'b1' });
    expect(createBattlePreviewModel(s, 'f1', 'p1', PREVIEW_DATA)).toEqual({
      ok: false,
      code: 'E_NOT_DOCKED',
    });
  });

  it('fail-secure: the viewer\'s own world is not an assault target', () => {
    const s = dockedScene({}, { owner: 'p1' });
    expect(createBattlePreviewModel(s, 'f1', 'p1', PREVIEW_DATA)).toEqual({
      ok: false,
      code: 'E_NOT_HOSTILE',
    });
  });

  it('fail-secure: a non-capturable sector kind is not an assault target', () => {
    const s = dockedScene({}, { kind: 'fortress' });
    expect(createBattlePreviewModel(s, 'f1', 'p1', PREVIEW_DATA)).toEqual({
      ok: false,
      code: 'E_NOT_HOSTILE',
    });
  });

  it('a sector kind absent from game data defaults to capturable', () => {
    const s = dockedScene({}, { kind: 'unknown_kind' });
    expect(createBattlePreviewModel(s, 'f1', 'p1', PREVIEW_DATA).ok).toBe(true);
  });

  it('fail-secure: no landing force aboard means nothing to forecast', () => {
    const s = dockedScene({ landing: [] });
    expect(createBattlePreviewModel(s, 'f1', 'p1', PREVIEW_DATA)).toEqual({
      ok: false,
      code: 'E_NOTHING_TO_FORECAST',
    });
  });

  it('fail-secure: an empty garrison means nothing to forecast', () => {
    const s = dockedScene({}, { garrison: [] });
    expect(createBattlePreviewModel(s, 'f1', 'p1', PREVIEW_DATA)).toEqual({
      ok: false,
      code: 'E_NOTHING_TO_FORECAST',
    });
  });

  it('produces a JSON-serialisable model', () => {
    const res = createBattlePreviewModel(dockedScene(), 'f1', 'p1', PREVIEW_DATA);
    expect(JSON.parse(JSON.stringify(res))).toEqual(res);
  });
});

describe('resolveBattleAction', () => {
  const model = { kind: 'battle', retreatFleetId: 'f1' } as Parameters<typeof resolveBattleAction>[1];

  it('maps a retreat tap to a fleet.retreat intent', () => {
    expect(resolveBattleAction({ kind: 'retreat' }, model)).toEqual({
      ok: true,
      type: 'fleet.retreat',
      fleetId: 'f1',
    });
  });

  it('fail-secure: no retreatable fleet → stable code', () => {
    const noFleet = { kind: 'battle' } as Parameters<typeof resolveBattleAction>[1];
    expect(resolveBattleAction({ kind: 'retreat' }, noFleet)).toEqual({
      ok: false,
      code: 'E_CANNOT_RETREAT',
    });
  });
});


/* ─────────────── приказы панели флота (MIG-7) ─────────────── */

const sel = (over: Partial<FleetSelectionModel> = {}): FleetSelectionModel => ({
  kind: 'fleet',
  id: 'f1',
  owner: 'p1',
  ownerName: 'Ash',
  ownerFaction: 'vanguard',
  mine: true,
  status: 'stationed',
  location: 'A',
  ships: [],
  inCombat: false,
  ...over,
});

describe('модель знает орбитальные факты — иначе кнопкам не на чем стоять', () => {
  it('орбита и обстрел переносятся из состояния флота', () => {
    const s = baseState();
    s.fleets = { f1: fleet({ id: 'f1', owner: 'p1', orbit: 'near', bombarding: true }) };
    const res = createSelectionModel(s, 'f1', 'p1', DATA);
    expect(res.ok && res.orbit).toBe('near');
    expect(res.ok && res.bombarding).toBe(true);
  });

  it('форс-марш виден только НА СВОЁМ флоте', () => {
    // Туман уже снимает чужие записи `forcedMarch`, но модель не полагается на это:
    // ей могут подать нетуманенное состояние (так же перестрахован командующий).
    const s = baseState();
    s.fleets = { f1: fleet({ id: 'f1', owner: 'p2' }) };
    s.forcedMarch = { f1: true };
    const res = createSelectionModel(s, 'f1', 'p1', DATA);
    expect(res.ok && res.forcedMarch).toBeUndefined();
    const mineRes = createSelectionModel({ ...s, fleets: { f1: fleet({ id: 'f1', owner: 'p1' }) } }, 'f1', 'p1', DATA);
    expect(mineRes.ok && mineRes.forcedMarch).toBe(true);
  });
});

describe('resolveFleetAction', () => {
  it('чужой флот отказывает ТЕМ ЖЕ кодом, что и ядро', () => {
    // `E_NO_FLEET` намеренно не отличает «нет такого» от «не твой» (A06): иначе
    // клиент перебором id подтверждал бы существование скрытых туманом флотов.
    const out = resolveFleetAction({ kind: 'stop' }, sel({ mine: false }));
    expect(out).toEqual({ ok: false, code: 'E_NO_FLEET' });
  });

  it('«Остановить» работает только в пути', () => {
    const moving = sel({ status: 'transit', location: undefined });
    expect(resolveFleetAction({ kind: 'stop' }, moving)).toEqual({
      ok: true,
      steps: [{ type: 'fleet.stop', payload: { fleetId: 'f1' } }],
    });
    expect(resolveFleetAction({ kind: 'stop' }, sel())).toEqual({ ok: false, code: 'E_FLEET_BUSY' });
  });

  it('в бою не останавливают и не обстреливают', () => {
    for (const action of [{ kind: 'stop' } as const, { kind: 'bombard', on: true } as const])
      expect(resolveFleetAction(action, sel({ inCombat: true, orbit: 'near' }))).toEqual({
        ok: false,
        code: 'E_FLEET_BUSY',
      });
  });

  it('форс-марш НЕ требует стоянки — в этом весь его смысл', () => {
    // Ядро (`forcedMarch.ts`) проверяет только владельца: приказ ускоряет флот В ПУТИ,
    // и требование «стоять» отменяло бы его целиком.
    const out = resolveFleetAction({ kind: 'forcemarch', on: true }, sel({ status: 'transit' }));
    expect(out).toEqual({
      ok: true,
      steps: [{ type: 'fleet.forcemarch', payload: { fleetId: 'f1', on: true } }],
    });
  });

  it('обстрел ВКЛЮЧАЮТ только с орбиты, а выключают откуда угодно', () => {
    // Иначе флот, оказавшийся обстреливающим без орбиты, нечем было бы остановить.
    expect(resolveFleetAction({ kind: 'bombard', on: true }, sel())).toEqual({
      ok: false,
      code: 'E_WRONG_ORBIT',
    });
    expect(resolveFleetAction({ kind: 'bombard', on: false }, sel({ bombarding: true }))).toEqual({
      ok: true,
      steps: [{ type: 'fleet.bombard', payload: { fleetId: 'f1', on: false } }],
    });
  });

  it('штурм с орбиты — ОДИН приказ, а не с орбиты — ПАРА', () => {
    // Правило `decisions/assaultOrder.ts`: разорви пару — ядро ответит `E_WRONG_ORBIT`,
    // и игрок получит «штурм не начался» без причины.
    expect(resolveFleetAction({ kind: 'assault' }, sel({ orbit: 'near' }))).toEqual({
      ok: true,
      steps: [{ type: 'fleet.assault', payload: { fleetId: 'f1' } }],
    });
    expect(resolveFleetAction({ kind: 'assault' }, sel())).toEqual({
      ok: true,
      steps: [
        { type: 'fleet.orbit', payload: { fleetId: 'f1', orbit: 'near' } },
        { type: 'fleet.assault', payload: { fleetId: 'f1' } },
      ],
    });
  });

  it('годность самого штурма НЕ проверяется здесь — это ответ ядра', () => {
    // Ни десанта, ни враждебности мира модель не знает и знать не должна: рукописная
    // копия этих условий отстанет от ядра на первом новом правиле, и отстанет молча.
    expect(resolveFleetAction({ kind: 'assault' }, sel({ ships: [] })).ok).toBe(true);
  });
});


/* ─────────────── панель мира (MIG-8) ─────────────── */

/** Мир в снимке: минимум полей, которые читает панель. */
function planetIn(state: GameState, over: Partial<Planet> = {}): GameState {
  state.planets = {
    A: {
      id: 'A',
      owner: 'p1',
      position: { x: 0, y: 0 },
      resources: {},
      buildings: [],
      garrison: [],
      traits: [],
      ...over,
    },
  };
  return state;
}

const worldModel = (over: Partial<WorldModel> = {}): WorldModel => ({
  kind: 'world',
  id: 'A',
  owner: 'p1',
  mine: true,
  garrison: [],
  buildings: [],
  remembered: false,
  capital: 'none',
  hold: 'none',
  ...over,
});

describe('createWorldModel', () => {
  it('мира нет в снимке — отказ кодом, а не пустая панель', () => {
    expect(createWorldModel(planetIn(baseState()), 'нет-такого', 'p1', DATA)).toEqual({
      ok: false,
      code: 'E_NO_PLANET',
    });
  });

  it('ничей мир так и назван, и приказов не предлагает', () => {
    const res = createWorldModel(planetIn(baseState(), { owner: null }), 'A', 'p1', DATA);
    expect(res.ok).toBe(true);
    expect(res.ok && res.owner).toBeNull();
    expect(res.ok && res.mine).toBe(false);
    expect(res.ok && res.capital).toBe('none');
    expect(res.ok && res.hold).toBe('none');
  });

  it('владелец назван ИМЕНЕМ, а постройки и гарнизон перенесены', () => {
    const res = createWorldModel(
      planetIn(baseState(), {
        buildings: [{ type: 'mine', level: 2, hp: 10 }],
        garrison: [{ unit: 'sentry', count: 3 }],
      }),
      'A',
      'p2',
      DATA,
    );
    expect(res.ok && res.ownerName).toBe('Носорог-1');
    expect(res.ok && res.buildings).toEqual([{ type: 'mine', level: 2 }]);
    expect(res.ok && res.garrison[0]).toMatchObject({ unit: 'sentry', count: 3 });
  });

  it('память тумана отмечена — иначе панель врёт про гарнизон', () => {
    // Мир из `remembered` показан СНИМКОМ: гарнизон в нём может быть протухшим, и
    // нарисовать его как живой значит соврать про то, чего игрок не видел.
    expect(createWorldModel(planetIn(baseState()), 'A', 'p1', DATA, ['A'])).toMatchObject({
      remembered: true,
    });
    expect(createWorldModel(planetIn(baseState()), 'A', 'p1', DATA)).toMatchObject({
      remembered: false,
    });
  });

  it('обитаемый СВОЙ мир предлагает столицу, а уже назначенный — метку', () => {
    // Обитаемость спрашивается у ядра (`isInhabited`), а не переписывается здесь.
    const s = planetIn(baseState());
    expect(createWorldModel(s, 'A', 'p1', DATA)).toMatchObject({ capital: 'designate' });
    s.capital = { p1: 'A' };
    expect(createWorldModel(s, 'A', 'p1', DATA)).toMatchObject({ capital: 'marked' });
  });

  it('точка удержания за ТЕХГЕЙТОМ: без технологии предложения нет вовсе', () => {
    // Не серая кнопка, а пусто — приказа ещё не существует (`worldOrders`, правило 4).
    const s = planetIn(baseState());
    expect(createWorldModel(s, 'A', 'p1', DATA)).toMatchObject({ hold: 'none' });
  });

  it('БЕЗ данных оба предложения молчат, а не угадывают', () => {
    // «Обитаем ли мир» и «открыт ли Хранитель» — вопросы к ДАННЫМ. Без них панель
    // обязана не предлагать ничего, а не показать кнопку наугад.
    const res = createWorldModel(planetIn(baseState()), 'A', 'p1');
    expect(res.ok && res.capital).toBe('none');
    expect(res.ok && res.hold).toBe('none');
  });
});

describe('resolveWorldAction', () => {
  it('на ЧУЖОМ мире оба приказа запрещены', () => {
    for (const action of [{ kind: 'capital' } as const, { kind: 'hold', on: true } as const])
      expect(resolveWorldAction(action, worldModel({ mine: false }))).toEqual({
        ok: false,
        code: 'E_FORBIDDEN',
      });
  });

  it('столицей назначают только там, где решение это предложило', () => {
    expect(resolveWorldAction({ kind: 'capital' }, worldModel({ capital: 'designate' }))).toEqual({
      ok: true,
      steps: [{ type: 'capital.designate', payload: { planetId: 'A' } }],
    });
    // Уже столица — приказ был бы пустым; необитаемый мир ядро отвергнет само.
    for (const capital of ['marked', 'none'] as const)
      expect(resolveWorldAction({ kind: 'capital' }, worldModel({ capital })).ok).toBe(false);
  });

  it('точку СТАВЯТ по месту в лимите, а СНИМАЮТ всегда', () => {
    // Правило 6 `worldOrders`: иначе игрок, исчерпавший лимит, заперт — ни поставить
    // новую, ни убрать старую.
    expect(resolveWorldAction({ kind: 'hold', on: true }, worldModel({ hold: 'set' }))).toEqual({
      ok: true,
      steps: [{ type: 'steward.holdpoint', payload: { planetId: 'A', on: true } }],
    });
    expect(
      resolveWorldAction({ kind: 'hold', on: true }, worldModel({ hold: 'set-disabled' })),
    ).toEqual({ ok: false, code: 'E_LIMIT' });
    expect(resolveWorldAction({ kind: 'hold', on: false }, worldModel({ hold: 'clear' }))).toEqual({
      ok: true,
      steps: [{ type: 'steward.holdpoint', payload: { planetId: 'A', on: false } }],
    });
  });

  it('без технологии Хранителя точку не поставить', () => {
    expect(resolveWorldAction({ kind: 'hold', on: true }, worldModel({ hold: 'none' }))).toEqual({
      ok: false,
      code: 'E_STEWARD_LOCKED',
    });
  });
});


/* ─────────────── деление и слияние (MIG-9) ─────────────── */

/** Флот в снимке с составом; `landing` — десант в трюме. */
function fleetsIn(state: GameState, fleets: Record<string, Partial<Fleet>>): GameState {
  state.fleets = Object.fromEntries(
    Object.entries(fleets).map(([id, f]) => [
      id,
      { id, owner: 'p1', location: 'A', movement: null, units: [], traits: [], ...f } as Fleet,
    ]),
  );
  return state;
}

describe('mergeCandidates', () => {
  it('только СВОИ, только СТОЯЩИЕ там же и не в бою', () => {
    const s = fleetsIn(baseState(), {
      f1: { units: [{ unit: 'frigate', count: 2 }] },
      f2: { units: [{ unit: 'frigate', count: 1 }] }, // годится
      f3: { owner: 'p2' }, // чужой
      f4: { location: 'B' }, // в другом месте
      f5: { battleId: 'b1' }, // в бою
      f6: { location: null, movement: { from: 'A', to: 'B', departedAt: 0, arrivesAt: 9 } }, // в пути
    });
    expect(mergeCandidates(s, 'f1', 'p1').map((c) => c.id)).toEqual(['f2']);
  });

  it('сам себя в кандидаты не берёт, и у идущего якоря кандидатов нет', () => {
    const s = fleetsIn(baseState(), { f1: {}, f2: {} });
    expect(mergeCandidates(s, 'f1', 'p1').map((c) => c.id)).toEqual(['f2']);
    const moving = fleetsIn(baseState(), {
      f1: { location: null, movement: { from: 'A', to: 'B', departedAt: 0, arrivesAt: 9 } },
      f2: {},
    });
    expect(mergeCandidates(moving, 'f1', 'p1')).toEqual([]);
  });
});

describe('resolveMerge', () => {
  it('стоящие вместе сливаются СРАЗУ', () => {
    const s = fleetsIn(baseState(), { f1: {}, f2: {} });
    expect(resolveMerge(s, 'f1', 'f2', 'p1')).toEqual({
      ok: true,
      steps: [{ type: 'fleet.merge', payload: { from: 'f2', into: 'f1' } }],
    });
  });

  it('чужой якорь — отказ, а не молчаливое ничего', () => {
    const s = fleetsIn(baseState(), { f1: { owner: 'p2' }, f2: {} });
    expect(resolveMerge(s, 'f1', 'f2', 'p1')).toEqual({ ok: false, code: 'E_NO_FLEET' });
  });

  it('разнесённые флоты панель НЕ отправляет в полёт', () => {
    // Решение знает ветку «лети к якорю и слейся по прибытии», но показать её панели
    // нечем: игрок не увидит ни полёта, ни момента слияния. Честнее отказать.
    const s = fleetsIn(baseState(), { f1: {}, f2: { location: 'B' } });
    expect(resolveMerge(s, 'f1', 'f2', 'p1')).toEqual({ ok: false, code: 'E_FLEET_BUSY' });
  });
});

describe('createSplitModel', () => {
  const DUO = { f1: { units: [{ unit: 'frigate', count: 3 }] } };

  it('строка на СТЕК: один корпус с начинкой и без — две разные строки', () => {
    // Лоадаут — часть личности стека (SM-0.3): «два крейсера» ничего не значит, пока
    // не сказано КАКИЕ два.
    const s = fleetsIn(baseState(), {
      f1: {
        units: [
          { unit: 'frigate', count: 2 },
          { unit: 'frigate', count: 1, modules: ['railgun'] },
        ],
      },
    });
    const res = createSplitModel(s, 'f1', 'p1', {}, DATA);
    expect(res.ok && res.rows.length).toBe(2);
    expect(res.ok && res.rows[1]?.modules).toEqual(['railgun']);
  });

  it('идущий или дерущийся флот делить НЕЛЬЗЯ', () => {
    for (const over of [
      { movement: { from: 'A', to: 'B', departedAt: 0, arrivesAt: 9 }, location: null },
      { battleId: 'b1' },
    ])
      expect(
        createSplitModel(fleetsIn(baseState(), { f1: { ...DUO.f1, ...over } }), 'f1', 'p1', {}, DATA),
      ).toEqual({ ok: false, code: 'E_FLEET_BUSY' });
  });

  it('ноль и «всё» подтвердить нельзя — это не деление', () => {
    const s = fleetsIn(baseState(), DUO);
    const key = (createSplitModel(s, 'f1', 'p1', {}, DATA) as { rows: { key: string }[] }).rows[0]!.key;
    expect(createSplitModel(s, 'f1', 'p1', {}, DATA)).toMatchObject({ canConfirm: false });
    expect(createSplitModel(s, 'f1', 'p1', { [key]: 3 }, DATA)).toMatchObject({ canConfirm: false });
    expect(createSplitModel(s, 'f1', 'p1', { [key]: 1 }, DATA)).toMatchObject({ canConfirm: true });
  });

  it('вчерашний отбор УЖИМАЕТСЯ под живой флот, а не уезжает в отказ', () => {
    // Окно живёт поверх живого флота: пока игрок жмёт «+10», состав может измениться.
    const s = fleetsIn(baseState(), { f1: { units: [{ unit: 'frigate', count: 1 }] } });
    const res = createSplitModel(s, 'f1', 'p1', { 'ship:frigate|': 99 }, DATA);
    expect(res.ok && res.rows[0]?.take).toBe(1);
  });
});

describe('resolveSplit', () => {
  const modelOf = (state: GameState, take: Record<string, number> = {}) => {
    const res = createSplitModel(state, 'f1', 'p1', take, DATA);
    if (!res.ok) throw new Error(res.code);
    return res;
  };

  it('отбор превращается в приказ, и модули едут АДРЕСОМ стека', () => {
    const s = fleetsIn(baseState(), {
      f1: {
        units: [
          { unit: 'frigate', count: 2 },
          { unit: 'frigate', count: 2, modules: ['railgun'] },
        ],
      },
    });
    const m = modelOf(s, { 'ship:frigate|railgun': 1 });
    expect(resolveSplit(m)).toEqual({
      ok: true,
      steps: [
        {
          type: 'fleet.split',
          payload: { fleetId: 'f1', take: [{ unit: 'frigate', count: 1, modules: ['railgun'] }] },
        },
      ],
    });
  });

  it('без десанта поля takeLanding в приказе НЕТ', () => {
    const m = modelOf(fleetsIn(baseState(), { f1: { units: [{ unit: 'frigate', count: 2 }] } }), {
      'ship:frigate|': 1,
    });
    const out = resolveSplit(m);
    expect(out.ok && Object.keys(out.steps[0]!.payload)).not.toContain('takeLanding');
  });

  it('неподтверждаемый отбор даёт РАЗНЫЕ коды: «не делится» и «трюм не сходится»', () => {
    const m = modelOf(fleetsIn(baseState(), { f1: { units: [{ unit: 'frigate', count: 2 }] } }));
    expect(resolveSplit(m)).toEqual({ ok: false, code: 'E_BAD_SPLIT' });
  });
});

describe('stepSplitTake', () => {
  it('шаг меняет ТОЛЬКО свою строку и зажимается наличным', () => {
    const s = fleetsIn(baseState(), {
      f1: {
        units: [
          { unit: 'frigate', count: 2 },
          { unit: 'corvette', count: 5 },
        ],
      },
    });
    const res = createSplitModel(s, 'f1', 'p1', {}, DATA);
    if (!res.ok) throw new Error(res.code);
    const k0 = res.rows[0]!.key;
    const k1 = res.rows[1]!.key;
    expect(stepSplitTake(res, k0, 'all')).toEqual({ [k0]: 2, [k1]: 0 });
    expect(stepSplitTake(res, k1, 'inc')).toEqual({ [k0]: 0, [k1]: 1 });
    // «−» с нуля не уводит в минус.
    expect(stepSplitTake(res, k0, 'dec')).toEqual({ [k0]: 0, [k1]: 0 });
  });
});
