import { describe, it, expect } from 'vitest';
import { createKernel } from '../kernel/kernel';
import { movementModule } from './movement';
import { captureOnArrivalModule } from './captureOnArrival';
import { effectsModule, type EffectImpl, type EffectOccurrence } from './effects';
import {
  createInitialState,
  type Fleet,
  type GameState,
  type Planet,
  type Player,
} from '../state/gameState';
import { parseGameData, type GameData } from '../data/schemas';
import type { GameModule } from '../kernel/module';
import type { Action, AdvanceResult, ApplyResult, Context } from '../action/types';

const HOUR = 3_600_000;

// The architecture-doc vocabulary, end to end: `infect_planet` is a RULE in
// data.events AND a TRAIT on a unit — the rule fires only for forces carrying it.
function makeData(events: Record<string, unknown>): GameData {
  return parseGameData({
    version: '0.1.0',
    resources: ['energy', 'metal', 'microelectronics'],
    units: {
      scout: { faction: 'x', stats: { attack: 1, defense: 1, speed: 10, hp: 6 } },
      plaguebearer: {
        faction: 'x',
        stats: { attack: 1, defense: 1, speed: 10, hp: 6 },
        traits: ['infect_planet'],
      },
      // BAL-4: захват прилётом требует десанта в трюме. Триггер этих тестов — сам факт
      // захвата, поэтому фикстуре нужен наземный юнит; трейт правила по-прежнему несут
      // КОРАБЛИ (`effectsModule` читает `fleet.units`), и смысл тестов не смещается.
      trooper: { faction: 'x', domain: 'ground', stats: { attack: 1, defense: 1, speed: 1, hp: 4 } },
    },
    factions: {},
    buildings: {},
    events,
    sectorKinds: {
      planet: { capturable: true, buildable: true, orbit: true },
      // Два вида-«обломка» из боевой карты: кладбище кораблей ничего не строит,
      // мёртвый мир строит только добычу. Оба захватываемы — на них и висит салваж.
      graveyard: { capturable: true, buildable: false, orbit: false },
      dead_world: { capturable: true, buildable: true, orbit: false },
    },
  });
}

const INFECT = {
  trigger: 'planet_captured',
  effect: 'add_trait',
  params: { trait: 'infected' },
  chance: 1,
};
const ANOMALY = {
  trigger: 'schedule',
  effect: 'modify_resource',
  params: { resource: 'energy', amount: 50, cadenceHours: 8 },
  chance: 1,
};

function planet(id: string, owner: string | null, x: number, kind = 'planet'): Planet {
  return {
    id,
    owner,
    position: { x, y: 0 },
    kind,
    resources: {},
    buildings: [],
    garrison: [],
    traits: [],
  };
}
function fleet(id: string, owner: string, location: string | null, units: string[]): Fleet {
  return {
    id,
    owner,
    location,
    movement: null,
    units: units.map((u) => ({ unit: u, count: 1 })),
    landing: [{ unit: 'trooper', count: 1 }], // BAL-4
    traits: [],
  };
}
function player(id: string, energy: number, status: Player['status'] = 'active'): Player {
  return { id, name: id, faction: 'x', status, resources: { energy } };
}
function baseState(planets: Planet[], fleets: Fleet[], players: Player[]): GameState {
  const s = createInitialState({ seed: 'efx', version: { data: '0.1.0', manifest: '1' } });
  return {
    ...s,
    planets: Object.fromEntries(planets.map((p) => [p.id, p])),
    fleets: Object.fromEntries(fleets.map((f) => [f.id, f])),
    players: Object.fromEntries(players.map((p) => [p.id, p])),
  };
}
const okApply = (r: ApplyResult): ApplyResult & { ok: true } => {
  if (!r.ok) throw new Error(`apply failed: ${r.code}`);
  return r;
};
const okAdvance = (r: AdvanceResult): AdvanceResult & { ok: true } => {
  if (!r.ok) throw new Error(`advance failed: ${r.code}`);
  return r;
};

/** Drive a real capture: A→B are lane-linked 30 apart, speed 10 → 3h; move F and
 *  advance past arrival. Capture-on-arrival emits `planet.captured` (no `by`). */
function captureB(
  data: GameData,
  unitTypes: string[],
  extraModules: GameModule[] = [],
  kindOfB = 'planet',
): { state: GameState; events: { type: string; payload: unknown }[] } {
  const ctx = (now: number): Context => ({ now, data });
  const a = planet('A', 'p1', 0);
  const b = planet('B', null, 30, kindOfB);
  a.links = ['B'];
  b.links = ['A'];
  const kernel = createKernel([
    movementModule,
    captureOnArrivalModule,
    effectsModule,
    ...extraModules,
  ]);
  let state = baseState([a, b], [fleet('F', 'p1', 'A', unitTypes)], [player('p1', 0)]);
  const move: Action = {
    id: 'm1',
    type: 'fleet.move',
    playerId: 'p1',
    payload: { fleetId: 'F', to: 'B' },
    issuedAt: 0,
  };
  state = okApply(kernel.applyAction(state, move, ctx(0))).state;
  const advanced = okAdvance(kernel.advanceTo(state, ctx(4 * HOUR)));
  return { state: advanced.state, events: advanced.events as { type: string; payload: unknown }[] };
}

describe('effectsModule — trait-scoped planet_captured rules (EFX-1)', () => {
  it('a capture by a force carrying the rule id as a trait applies the effect', () => {
    const { state, events } = captureB(makeData({ infect_planet: INFECT }), ['plaguebearer']);
    expect(state.planets['B']!.owner).toBe('p1');
    expect(state.planets['B']!.traits).toContain('infected');
    expect(events.some((e) => e.type === 'effect.applied')).toBe(true);
  });

  it('the same capture WITHOUT the trait leaves the rule dormant', () => {
    const { state, events } = captureB(makeData({ infect_planet: INFECT }), ['scout']);
    expect(state.planets['B']!.owner).toBe('p1');
    expect(state.planets['B']!.traits).not.toContain('infected');
    expect(events.some((e) => e.type === 'effect.applied')).toBe(false);
  });

  it('chance 0 never fires even for a trait carrier', () => {
    const { state } = captureB(makeData({ infect_planet: { ...INFECT, chance: 0 } }), [
      'plaguebearer',
    ]);
    expect(state.planets['B']!.traits).not.toContain('infected');
  });

  it('an unknown effect id makes the rule inert, never a crash', () => {
    const { state } = captureB(
      makeData({ infect_planet: { ...INFECT, effect: 'summon_dragon' } }),
      ['plaguebearer'],
    );
    expect(state.planets['B']!.owner).toBe('p1'); // capture itself unharmed
    expect(state.planets['B']!.traits).toHaveLength(0);
  });

  it('an unknown trigger vocabulary word is inert', () => {
    const { state } = captureB(
      makeData({ infect_planet: { ...INFECT, trigger: 'moon_eclipse' } }),
      ['plaguebearer'],
    );
    expect(state.planets['B']!.traits).toHaveLength(0);
  });
});

describe('effectsModule — scheduled dark events (EFX-1)', () => {
  const ctxOf =
    (data: GameData) =>
    (now: number): Context => ({ now, data });

  it('fires at every cadence crossing for each ACTIVE player (deterministic grid)', () => {
    const data = makeData({ void_anomaly: ANOMALY });
    const ctx = ctxOf(data);
    const kernel = createKernel([effectsModule]);
    const state = baseState(
      [],
      [],
      [player('p1', 0), player('p2', 0), player('dead', 0, 'defeated')],
    );
    // 0 → 25h crosses the 8h grid at 8h, 16h, 24h = 3 firings × 50 energy.
    const advanced = okAdvance(kernel.advanceTo(state, ctx(25 * HOUR)));
    expect(advanced.state.players['p1']!.resources['energy']).toBe(150);
    expect(advanced.state.players['p2']!.resources['energy']).toBe(150);
    expect(advanced.state.players['dead']!.resources['energy']).toBe(0); // defeated seats are skipped
  });

  it('no crossing → no firing; the grid is absolute, not per-span', () => {
    const data = makeData({ void_anomaly: ANOMALY });
    const ctx = ctxOf(data);
    const kernel = createKernel([effectsModule]);
    let state = baseState([], [], [player('p1', 0)]);
    state = okAdvance(kernel.advanceTo(state, ctx(5 * HOUR))).state; // 0→5h: no 8h multiple
    expect(state.players['p1']!.resources['energy']).toBe(0);
    state = okAdvance(kernel.advanceTo(state, ctx(9 * HOUR))).state; // 5→9h crosses 8h once
    expect(state.players['p1']!.resources['energy']).toBe(50);
  });

  it('a negative amount is a penalty, clamped at zero', () => {
    const data = makeData({
      void_anomaly: { ...ANOMALY, params: { resource: 'energy', amount: -100, cadenceHours: 8 } },
    });
    const kernel = createKernel([effectsModule]);
    const state = baseState([], [], [player('p1', 30)]);
    const advanced = okAdvance(kernel.advanceTo(state, ctxOf(data)(9 * HOUR)));
    expect(advanced.state.players['p1']!.resources['energy']).toBe(0);
  });

  it('a rule without a positive cadenceHours is inert', () => {
    const data = makeData({
      void_anomaly: { ...ANOMALY, params: { resource: 'energy', amount: 50 } },
    });
    const kernel = createKernel([effectsModule]);
    const state = baseState([], [], [player('p1', 0)]);
    const advanced = okAdvance(kernel.advanceTo(state, ctxOf(data)(100 * HOUR)));
    expect(advanced.state.players['p1']!.resources['energy']).toBe(0);
  });

  it('caps degenerate cadences at 100 firings per span (fail-secure)', () => {
    const data = makeData({
      void_anomaly: { ...ANOMALY, params: { resource: 'energy', amount: 50, cadenceHours: 1 } },
    });
    const kernel = createKernel([effectsModule]);
    const state = baseState([], [], [player('p1', 0)]);
    // 0 → 500h would cross 500 grid points; the cap holds it to 100.
    const advanced = okAdvance(kernel.advanceTo(state, ctxOf(data)(500 * HOUR)));
    expect(advanced.state.players['p1']!.resources['energy']).toBe(100 * 50);
  });
});

describe('effectsModule — `effect.applied` names its audience (AUD-11)', () => {
  const applied = (events: { type: string; payload: unknown }[]): Record<string, unknown>[] =>
    events
      .filter((e) => e.type === 'effect.applied')
      .map((e) => e.payload as Record<string, unknown>);

  it('a planet-scoped firing addresses the capturer', () => {
    const payloads = applied(captureB(makeData({ infect_planet: INFECT }), ['plaguebearer']).events);
    expect(payloads).toHaveLength(1);
    expect(payloads[0]!['playerId']).toBe('p1');
    expect(payloads[0]!['planetId']).toBe('B');
  });

  it('a GLOBAL scheduled firing — no planet anywhere — still addresses the struck player', () => {
    // The hole AUD-11 closed. A host routes domain events by payload key names; a dark
    // event that carries no `planetId` (there is no world involved) and no `playerId`
    // matches no rule at all, so it reaches nobody — not even the player it struck.
    const data = makeData({ void_anomaly: ANOMALY });
    const kernel = createKernel([effectsModule]);
    const state = baseState([], [], [player('p1', 0), player('p2', 0)]);
    const advanced = okAdvance(kernel.advanceTo(state, { now: 9 * HOUR, data }));
    const payloads = applied(advanced.events as { type: string; payload: unknown }[]);
    expect(payloads.map((p) => p['playerId'])).toEqual(['p1', 'p2']);
    expect(payloads.every((p) => !('planetId' in p))).toBe(true);
  });
});

// Разбор обломков: награда за взятие провинции ОПРЕДЁЛЁННОГО вида. Почему не
// `planet_captured` — тот триггер привязан к трейту ЮНИТА-захватчика («мой чумной
// корабль заражает всё, что берёт»), и вида провинции не видит вовсе. Здесь условие
// обратное: важно ЧТО взяли, а не КЕМ, поэтому это отдельный триггер, а не второй
// режим у первого — один триггер, одно правило отбора.
describe('effectsModule — province_captured rules (salvage)', () => {
  const SALVAGE = {
    trigger: 'province_captured',
    effect: 'modify_resource',
    params: { kinds: ['graveyard', 'dead_world'], resources: { metal: 40, microelectronics: 10 } },
    chance: 1,
  };

  it('взятие провинции названного вида выдаёт захватчику все ресурсы правила', () => {
    const { state, events } = captureB(
      makeData({ salvage_wrecks: SALVAGE }),
      ['scout'], // никаких трейтов: отбор идёт по виду узла, а не по составу флота
      [],
      'graveyard',
    );
    expect(state.planets['B']!.owner).toBe('p1');
    expect(state.players['p1']!.resources['metal']).toBe(40);
    expect(state.players['p1']!.resources['microelectronics']).toBe(10);
    expect(events.some((e) => e.type === 'effect.applied')).toBe(true);
  });

  it('второй вид из списка срабатывает так же', () => {
    const { state } = captureB(makeData({ salvage_wrecks: SALVAGE }), ['scout'], [], 'dead_world');
    expect(state.players['p1']!.resources['metal']).toBe(40);
  });

  it('вид вне списка не платит ничего', () => {
    const { state, events } = captureB(makeData({ salvage_wrecks: SALVAGE }), ['scout'], [], 'planet');
    expect(state.planets['B']!.owner).toBe('p1'); // сам захват не тронут
    expect(state.players['p1']!.resources['metal']).toBeUndefined();
    expect(events.some((e) => e.type === 'effect.applied')).toBe(false);
  });

  it('правило без списка видов инертно (fail-secure: пустой фильтр не значит «все»)', () => {
    const { state } = captureB(
      makeData({ salvage_wrecks: { ...SALVAGE, params: { resources: { metal: 40 } } } }),
      ['scout'],
      [],
      'graveyard',
    );
    expect(state.players['p1']!.resources['metal']).toBeUndefined();
  });

  it('chance 0 не платит', () => {
    const { state } = captureB(
      makeData({ salvage_wrecks: { ...SALVAGE, chance: 0 } }),
      ['scout'],
      [],
      'graveyard',
    );
    expect(state.players['p1']!.resources['metal']).toBeUndefined();
  });

  it('`effect.applied` называет и захватчика, и узел', () => {
    const { events } = captureB(makeData({ salvage_wrecks: SALVAGE }), ['scout'], [], 'graveyard');
    const payload = events.find((e) => e.type === 'effect.applied')!.payload as Record<
      string,
      unknown
    >;
    expect(payload['playerId']).toBe('p1');
    expect(payload['planetId']).toBe('B');
    expect(payload['ruleId']).toBe('salvage_wrecks');
  });
});

describe('effectsModule — modify_resource принимает карту ресурсов', () => {
  const ctxOf =
    (data: GameData) =>
    (now: number): Context => ({ now, data });

  it('карта `resources` начисляет несколько ресурсов одним правилом', () => {
    const data = makeData({
      windfall: {
        trigger: 'schedule',
        effect: 'modify_resource',
        params: { resources: { energy: 20, metal: 5 }, cadenceHours: 8 },
        chance: 1,
      },
    });
    const kernel = createKernel([effectsModule]);
    const advanced = okAdvance(
      kernel.advanceTo(baseState([], [], [player('p1', 0)]), ctxOf(data)(9 * HOUR)),
    );
    expect(advanced.state.players['p1']!.resources['energy']).toBe(20);
    expect(advanced.state.players['p1']!.resources['metal']).toBe(5);
  });

  it('отрицательная позиция в карте — штраф, и он тоже зажат нулём', () => {
    const data = makeData({
      windfall: {
        trigger: 'schedule',
        effect: 'modify_resource',
        params: { resources: { energy: -100 }, cadenceHours: 8 },
        chance: 1,
      },
    });
    const kernel = createKernel([effectsModule]);
    const advanced = okAdvance(
      kernel.advanceTo(baseState([], [], [player('p1', 30)]), ctxOf(data)(9 * HOUR)),
    );
    expect(advanced.state.players['p1']!.resources['energy']).toBe(0);
  });

  it('старая пара {resource, amount} продолжает работать', () => {
    const data = makeData({ void_anomaly: ANOMALY });
    const kernel = createKernel([effectsModule]);
    const advanced = okAdvance(
      kernel.advanceTo(baseState([], [], [player('p1', 0)]), ctxOf(data)(9 * HOUR)),
    );
    expect(advanced.state.players['p1']!.resources['energy']).toBe(50);
  });
});

describe('effectsModule — capability extension seam (EFX-1)', () => {
  it('a module-provided `effect.<name>` capability executes (and overrides) the vocabulary', () => {
    const seen: EffectOccurrence[] = [];
    const quakes: GameModule = {
      id: 'quakes',
      version: '0.0.1',
      setup(api) {
        const impl: EffectImpl = (occurrence, h) => {
          seen.push(occurrence);
          const p = h.state.players[occurrence.playerId];
          if (p) p.resources['energy'] = 999;
        };
        api.provideCapability('effect.quake', impl);
      },
    };
    const data = makeData({
      tremor: { trigger: 'schedule', effect: 'quake', params: { cadenceHours: 8 }, chance: 1 },
    });
    const kernel = createKernel([effectsModule, quakes]);
    const state = baseState([], [], [player('p1', 0)]);
    const advanced = okAdvance(kernel.advanceTo(state, { now: 9 * HOUR, data }));
    expect(seen).toHaveLength(1);
    expect(seen[0]!.ruleId).toBe('tremor');
    expect(advanced.state.players['p1']!.resources['energy']).toBe(999);
  });
});
