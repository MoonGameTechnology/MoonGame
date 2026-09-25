import { describe, it, expect } from 'vitest';
import { createKernel } from '../kernel/kernel';
import { heroModule } from './hero';
import { createInitialState, type GameState, type Planet, type Player } from '../state/gameState';
import { parseGameData, type GameData } from '../data/schemas';
import type { Action, AdvanceResult, ApplyResult, Context } from '../action/types';

// PVR-4.7 — «Поглощение мира» Левиафана (резолюция владельца 2026-09-25: «Поглощение после
// 4 ч осады»). Не мгновенная аннигиляция, а осада: флот героя бомбардирует чужой мир, и
// через 4 часа мир мёртв, если осаду не сорвали. Срывает её всё, что прерывает
// бомбардировку: бой с флотом героя, уход с орбиты, прекращение огня, смерть героя, смена
// хозяина мира. События шины здесь подаются прямо в расписание — так тест держит договор
// модуля героев с шиной, а не чужие правила боя и движения.

const HOUR = 3_600_000;
const HERO = 'hero:swarm:boss';

const data: GameData = parseGameData({
  version: '0.1.0',
  resources: ['metal'],
  units: {
    maw: { faction: 'swarm', stats: { attack: 40, defense: 36, speed: 32, hp: 900 }, traits: ['hero'] },
  },
  heroes: { maw: { name: 'Maw', ship: { unit: 'maw' }, startAbilities: ['devour'], boss: true } },
  heroAbilities: {
    devour: { name: 'Devour', type: 'devour', cooldownHours: 1, params: { siegeHours: 4 } },
  },
  factions: { swarm: { name: 'Swarm' }, vanguard: { name: 'Vanguard' } },
  buildings: {},
  events: {},
});

const kernel = createKernel([heroModule]);
const ctx = (now: number): Context => ({ now, data });

function player(id: string, faction: string): Player {
  return { id, name: id, faction, status: 'active', resources: {} };
}
function planet(id: string, owner: string | null, x: number): Planet {
  return {
    id,
    owner,
    position: { x, y: 0 },
    links: [],
    kind: 'planet',
    planetType: 'terran',
    resources: {},
    buildings: [],
    garrison: [],
    traits: [],
  };
}
/** Улей Роя H, мир игрока A, ничей N. Флот босса стоит над A и бомбардирует его. */
function world(): GameState {
  const s = createInitialState({ seed: 'devour', version: { data: '0.1.0', manifest: '1' } });
  return {
    ...s,
    players: { swarm: player('swarm', 'swarm'), p1: player('p1', 'vanguard') },
    planets: { H: planet('H', 'swarm', 0), A: planet('A', 'p1', 100), N: planet('N', null, 200) },
    fleets: {
      maw: {
        id: 'maw',
        owner: 'swarm',
        location: 'A',
        movement: null,
        units: [{ unit: 'maw', count: 1 }],
        traits: [],
        orbit: 'near',
        bombarding: true,
      },
    },
    heroes: {
      [HERO]: {
        id: HERO,
        owner: 'swarm',
        location: 'A',
        cooldowns: {},
        alive: true,
        archetype: 'maw',
        abilities: ['devour'],
        fleetId: 'maw',
      },
    },
  };
}
function act(type: string, playerId: string, payload: unknown, seq = 1): Action {
  return { id: `s:${playerId}:${seq}`, type, playerId, payload, issuedAt: 0 };
}
const devour = (target = 'A', seq = 1): Action =>
  act('hero.ability', 'swarm', { heroId: HERO, abilityId: 'devour', target }, seq);

function ok(r: ApplyResult | AdvanceResult): { state: GameState; events: { type: string; payload: unknown }[] } {
  if (!r.ok) throw new Error(`expected ok, got ${r.code}`);
  return r;
}
function errCode(r: ApplyResult): string {
  if (r.ok) throw new Error('expected rejection, got ok');
  return r.code;
}
/** Осада, начатая в момент 0. */
function besieged(): GameState {
  return ok(kernel.applyAction(world(), devour(), ctx(0))).state;
}
/** Подать событие шины в `at` и прогнать часы до него. */
function inject(s: GameState, at: number, type: string, payload: unknown) {
  const next: GameState = {
    ...s,
    scheduled: [...s.scheduled, { id: `evt:test:${type}`, at, seq: 1_000_000, type, payload }],
  };
  return ok(kernel.advanceTo(next, ctx(at)));
}
const broken = (events: { type: string; payload: unknown }[]) =>
  events.filter((e) => e.type === 'hero.siege.broken').map((e) => (e.payload as { reason: string }).reason);

describe('«Поглощение мира» — осада вместо мгновенной аннигиляции (PVR-4.7)', () => {
  it('мир цел, пока идёт осада, и мёртв после 4 часов непрерывной бомбардировки', () => {
    const cast = ok(kernel.applyAction(world(), devour(), ctx(0)));
    expect(cast.state.planets.A!.owner).toBe('p1');
    expect(cast.state.heroes![HERO]!.siege).toEqual({ target: 'A', victim: 'p1', since: 0, until: 4 * HOUR });
    expect(cast.events.map((e) => e.type)).toContain('hero.siege.started');

    const almost = ok(kernel.advanceTo(cast.state, ctx(4 * HOUR - 1)));
    expect(almost.state.planets.A!.kind).toBe('planet');
    expect(almost.state.heroes![HERO]!.siege).toBeDefined();

    const done = ok(kernel.advanceTo(almost.state, ctx(4 * HOUR)));
    expect(done.state.planets.A!.owner).toBe(null);
    expect(done.state.planets.A!.kind).toBe('dead_world');
    expect(done.state.heroes![HERO]!.siege).toBeUndefined();
    expect(done.events.map((e) => e.type)).toEqual(expect.arrayContaining(['planet.destroyed', 'hero.siege.done']));
  });

  it('осаду начинают только над чужим миром, который флот уже бомбардирует', () => {
    const quiet = world();
    quiet.fleets.maw!.bombarding = false;
    expect(errCode(kernel.applyAction(quiet, devour(), ctx(0)))).toBe('E_NOT_BOMBARDING');

    const fighting = world();
    fighting.fleets.maw!.battleId = 'b1';
    expect(errCode(kernel.applyAction(fighting, devour(), ctx(0)))).toBe('E_IN_BATTLE');

    // Свой и ничей мир — не цель; мир, над которым флот не стоит, — вне досягаемости.
    const home = world();
    home.fleets.maw!.location = 'H';
    expect(errCode(kernel.applyAction(home, devour('H'), ctx(0)))).toBe('E_NOT_HOSTILE');
    expect(errCode(kernel.applyAction(world(), devour('N'), ctx(0)))).toBe('E_NOT_HOSTILE');
    expect(errCode(kernel.applyAction(home, devour('A'), ctx(0)))).toBe('E_OUT_OF_RANGE');

    // Идущую осаду заново не начинают, даже когда способность остыла.
    const twice = besieged();
    twice.heroes![HERO]!.cooldowns = {};
    expect(errCode(kernel.applyAction(twice, devour('A', 2), ctx(HOUR)))).toBe('E_FLEET_BUSY');
  });

  it('бой с флотом героя срывает осаду — мир переживает срок', () => {
    const s = besieged();
    s.fleets.maw!.battleId = 'b1';
    const hit = inject(s, HOUR, 'battle.started', { battleId: 'b1', location: 'A' });
    expect(hit.state.heroes![HERO]!.siege).toBeUndefined();
    expect(broken(hit.events)).toEqual(['battle']);
    // Бой кончился, флот снова бомбардирует — но осада уже сорвана, срок проходит впустую.
    const after = hit.state;
    after.fleets.maw!.battleId = null;
    after.fleets.maw!.bombarding = true;
    const deadline = ok(kernel.advanceTo(after, ctx(4 * HOUR)));
    expect(deadline.state.planets.A!.owner).toBe('p1');
    expect(deadline.state.planets.A!.kind).toBe('planet');
  });

  it('чужой бой в другом месте осаду не трогает', () => {
    const r = inject(besieged(), HOUR, 'battle.started', { battleId: 'b9', location: 'N' });
    expect(r.state.heroes![HERO]!.siege).toBeDefined();
    expect(broken(r.events)).toEqual([]);
  });

  it('уход с орбиты и прекращение огня срывают осаду, возобновление огня — нет', () => {
    expect(broken(inject(besieged(), HOUR, 'fleet.departed', { fleetId: 'maw' }).events)).toEqual(['departed']);
    expect(broken(inject(besieged(), HOUR, 'fleet.bombard', { fleetId: 'maw', on: false }).events)).toEqual([
      'ceased',
    ]);
    const on = inject(besieged(), HOUR, 'fleet.bombard', { fleetId: 'maw', on: true });
    expect(on.state.heroes![HERO]!.siege).toBeDefined();
  });

  it('смерть героя срывает осаду', () => {
    const r = inject(besieged(), HOUR, 'unit.died', { unit: 'maw', count: 1, fleetId: 'maw', owner: 'swarm' });
    expect(r.state.heroes![HERO]!.alive).toBe(false);
    expect(broken(r.events)).toEqual(['died']);
    expect(ok(kernel.advanceTo(r.state, ctx(4 * HOUR))).state.planets.A!.owner).toBe('p1');
  });

  it('мир, сменивший хозяина, уже не тот, что осаждали', () => {
    const r = inject(besieged(), HOUR, 'planet.captured', { planetId: 'A', owner: 'swarm' });
    expect(broken(r.events)).toEqual(['captured']);
  });

  it('срыв без события ловит последняя проверка в срок', () => {
    const s = besieged();
    s.fleets.maw!.location = 'H'; // флот ушёл мимо шины — проверка в срок его увидит
    const r = ok(kernel.advanceTo(s, ctx(4 * HOUR)));
    expect(broken(r.events)).toEqual(['lapsed']);
    expect(r.state.planets.A!.kind).toBe('planet');
  });

  it('сорванную осаду начинают заново — таймер идёт с начала', () => {
    const s = besieged();
    s.fleets.maw!.battleId = 'b1';
    const hit = inject(s, HOUR, 'battle.started', { battleId: 'b1', location: 'A' }).state;
    hit.fleets.maw!.battleId = null;
    hit.fleets.maw!.bombarding = true;
    const again = ok(kernel.applyAction(hit, devour('A', 2), ctx(2 * HOUR)));
    expect(again.state.heroes![HERO]!.siege?.until).toBe(6 * HOUR);
    // Срок первой осады проходит впустую: её запись заменена новой.
    const oldDue = ok(kernel.advanceTo(again.state, ctx(4 * HOUR)));
    expect(oldDue.state.planets.A!.kind).toBe('planet');
    const newDue = ok(kernel.advanceTo(oldDue.state, ctx(6 * HOUR)));
    expect(newDue.state.planets.A!.kind).toBe('dead_world');
  });
});
