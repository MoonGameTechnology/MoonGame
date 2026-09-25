import { describe, it, expect } from 'vitest';
import { createKernel } from '../kernel/kernel';
import { swarmMemoryModule } from './swarmMemory';
import { swarmNetModule } from './swarmNet';
import { swarmAdaptModule, swarmAdaptDue } from './swarmAdapt';
import type { GameModule } from '../kernel/module';
import { createInitialState, type Fleet, type GameState, type Planet } from '../state/gameState';
import { parseGameData, type GameData } from '../data/schemas';
import type { Action, AdvanceResult, Context, MatchConfig } from '../action/types';
import { MS_PER_HOUR } from '../util/time';

// Сеть Роя — сценарии приёмки из `docs/swarm-behavior.md` §7. Мир — линия миров Роя:
// A(0) и C(600) с центрами данных, B(300) и D(1000) без. Ретранслятор на B связывает A и
// C (150 + 200 ≥ 300); D не достаёт никто.

const data: GameData = parseGameData({
  version: '0.1.0',
  resources: ['energy', 'biomass'],
  units: {
    relay: {
      faction: 'swarm',
      stats: { attack: 0, defense: 1, speed: 5, hp: 10 },
      relayRange: 200,
    },
    drone: { faction: 'swarm', stats: { attack: 3, defense: 1, speed: 5, hp: 10 } },
    mother: {
      faction: 'swarm',
      traits: ['brood_host'],
      slots: { defense: 1, utility: 1 },
      stats: { attack: 3, defense: 1, speed: 5, hp: 10 },
    },
    lander: {
      faction: 'swarm',
      domain: 'ground',
      stats: { attack: 1, defense: 1, speed: 1, hp: 1 },
    },
  },
  modules: {
    veil: {
      name: 'Veil',
      slot: 'defense',
      tag: 'vertical',
      effects: { stats: { pointDefense: 6 } },
      allowed: { domain: 'space', traits: ['brood_host'] },
      adaptation: { signal: 'strike', levels: [{ cost: { biomass: 10 }, hours: 6 }] },
    },
    chamber: {
      name: 'Chamber',
      slot: 'utility',
      tag: 'horizontal',
      effects: { stats: {} },
      allowed: { domain: 'space', traits: ['brood_host'] },
      brood: { unit: 'lander', intervalHours: 3 },
    },
  },
  technologies: {},
  factions: { swarm: { name: 'Swarm' }, vanguard: { name: 'Vanguard' } },
  buildings: { center: { name: 'Center', hp: 30, relayRange: 150 } },
  events: {},
  modes: {
    waves: {
      name: 'Waves',
      modules: ['pve'],
      pve: { waves: 3, npcFaction: 'swarm', waveIntervalHours: 6 },
    },
  },
});

/** Звонок — тестовый модуль: поднимает события так же, как их поднимают бой, движение и
 *  стройка. Сеть проверяется по событиям, а не по путям, которыми они рождаются. */
const bell: GameModule = {
  id: 'test-bell',
  version: '1.0.0',
  setup(api) {
    api.onAction('test.start', (_a, h) => h.emit('pve.started', { owner: 'swarm', waves: 3 }));
    api.onAction('test.hit', (a, h) => {
      const p = a.payload as { strikeId: string; targetId: string };
      h.emit('shuttle.hit', { ...p, owner: 'p1', targetOwner: 'swarm', damage: 5 });
    });
    api.onAction('test.move', (a, h) => {
      const p = a.payload as { fleetId: string; to: string };
      h.state.fleets[p.fleetId]!.location = p.to;
      h.emit('fleet.arrived', { fleetId: p.fleetId, at: p.to });
    });
    api.onAction('test.kill', (a, h) => {
      const p = a.payload as { fleetId: string };
      delete h.state.fleets[p.fleetId];
      h.emit('fleet.destroyed', { fleetId: p.fleetId, owner: 'swarm' });
    });
    api.onAction('test.raze', (a, h) => {
      const p = a.payload as { planetId: string };
      h.state.planets[p.planetId]!.buildings = [];
      h.emit('building.destroyed', { planetId: p.planetId, building: 'center', owner: 'swarm' });
    });
    api.onAction('test.wave', (a, h) => {
      const p = a.payload as { fleetId: string; at: string };
      h.state.fleets[p.fleetId] = fleet(p.fleetId, p.at, [['mother', 1, ['chamber']]]);
      h.emit('pve.wave.spawned', { owner: 'swarm', fleetId: p.fleetId, location: p.at, wave: 1 });
    });
  },
};

const kernel = createKernel([swarmMemoryModule, swarmNetModule, swarmAdaptModule, bell]);
const ctx = (now: number): Context => ({
  now,
  data,
  config: { timeScale: 1, modeId: 'waves' } as MatchConfig,
});

const planet = (id: string, x: number, buildings: string[] = []): Planet => ({
  id,
  owner: 'swarm',
  position: { x, y: 0 },
  resources: {},
  buildings: buildings.map((type) => ({ type, level: 1, hp: 30 })),
  garrison: [],
  traits: [],
});
function fleet(id: string, at: string, units: Array<[string, number, string[]?]>): Fleet {
  return {
    id,
    owner: 'swarm',
    location: at,
    movement: null,
    units: units.map(([unit, count, modules]) => ({
      unit,
      count,
      ...(modules ? { modules } : {}),
    })),
    traits: [],
  };
}

function world(fleets: Fleet[]): GameState {
  const base = createInitialState({ seed: 'net', version: { data: '0.1.0', manifest: '1' } });
  return {
    ...base,
    players: {
      p1: { id: 'p1', name: 'p1', faction: 'vanguard', status: 'active', resources: {} },
      swarm: {
        id: 'swarm',
        name: 'S',
        faction: 'swarm',
        status: 'active',
        resources: { biomass: 100 },
      },
    },
    planets: {
      A: planet('A', 0, ['center']),
      B: planet('B', 300),
      C: planet('C', 600, ['center']),
      D: planet('D', 1000),
    },
    fleets: Object.fromEntries(fleets.map((f) => [f.id, f])),
    pve: { waveNumber: 0, totalWaves: 3, npcPlayerId: 'swarm' },
  };
}

let seq = 0;
const act = (type: string, payload: unknown = {}, playerId = 'swarm'): Action => ({
  id: `t:${++seq}`,
  type,
  playerId,
  payload,
  issuedAt: 0,
});
function run(s: GameState, type: string, payload: unknown = {}): GameState {
  const r = kernel.applyAction(s, act(type, payload), ctx(s.time));
  if (!r.ok) throw new Error(r.code);
  return r.state;
}
const known = (s: GameState, holder: string): number[] => s.swarmNet?.holders[holder]?.known ?? [];
const hit = (s: GameState, n: number, targetId: string): GameState =>
  run(s, 'test.hit', { strikeId: `s${n}`, targetId });
function ok(res: AdvanceResult): GameState {
  if (!res.ok) throw new Error(res.code);
  return res.state;
}

/** Связная сеть A–B–C: ретранслятор на B, флот на A. */
const linked = (): GameState =>
  run(world([fleet('r', 'B', [['relay', 1]]), fleet('f', 'A', [['drone', 1]])]), 'test.start');

describe('§7 — опыт течёт только по связи', () => {
  it('боя не было — знания нет, сколько бы узлов ни стояло рядом', () => {
    const s = linked();
    expect(s.swarmNet).toEqual({ holders: {} });
  });

  it('отряд доставил опыт и погиб — сведения остались у получивших', () => {
    let s = hit(linked(), 1, 'f');
    expect(known(s, 'planet:A')).toEqual([1]);
    expect(known(s, 'planet:C')).toEqual([1]); // через ретранслятор на B
    s = run(s, 'test.kill', { fleetId: 'f' });
    expect(known(s, 'planet:A')).toEqual([1]);
    expect(s.swarmNet?.holders['fleet:f']).toBeUndefined();
  });

  it('изолированный отряд погиб до передачи — остальной Рой не узнал ничего', () => {
    let s = run(world([fleet('lone', 'D', [['drone', 1]])]), 'test.start');
    s = hit(s, 1, 'lone');
    expect(known(s, 'fleet:lone')).toEqual([1]);
    s = run(s, 'test.kill', { fleetId: 'lone' });
    expect(known(s, 'planet:A')).toEqual([]);
    expect(known(s, 'planet:C')).toEqual([]);
  });

  it('разорван единственный путь — старое знание осталось, новое между частями не идёт', () => {
    let s = hit(linked(), 1, 'f');
    s = run(s, 'test.kill', { fleetId: 'r' }); // ретранслятор погиб ПОСЛЕ доставки
    s = hit(s, 2, 'f');
    expect(known(s, 'planet:A')).toEqual([1, 2]);
    expect(known(s, 'planet:C')).toEqual([1]); // старое не стёрто, новое не дошло
  });

  it('уничтожен один узел, но обходной путь есть — разделения нет', () => {
    let s = run(
      world([
        fleet('r1', 'B', [['relay', 1]]),
        fleet('r2', 'B', [['relay', 1]]),
        fleet('f', 'A', [['drone', 1]]),
      ]),
      'test.start',
    );
    s = run(s, 'test.kill', { fleetId: 'r1' });
    s = hit(s, 1, 'f');
    expect(known(s, 'planet:C')).toEqual([1]);
  });

  it('отрезанная часть учится сама, независимо от другой', () => {
    let s = run(
      world([fleet('f', 'A', [['drone', 1]]), fleet('g', 'C', [['drone', 1]])]),
      'test.start',
    );
    s = hit(s, 1, 'f');
    s = hit(s, 2, 'g');
    expect(known(s, 'planet:A')).toEqual([1]);
    expect(known(s, 'planet:C')).toEqual([2]);
  });

  it('связь восстановлена — опыт объединяется, и один бой остаётся одним', () => {
    let s = run(
      world([
        fleet('f', 'A', [['drone', 1]]),
        fleet('g', 'C', [['drone', 1]]),
        fleet('r', 'D', [['relay', 1]]),
      ]),
      'test.start',
    );
    s = hit(s, 1, 'f');
    s = hit(s, 2, 'g');
    s = run(s, 'test.move', { fleetId: 'r', to: 'B' }); // ретранслятор встал между частями
    expect(known(s, 'planet:A')).toEqual([1, 2]);
    expect(known(s, 'planet:C')).toEqual([1, 2]);
    s = run(s, 'test.move', { fleetId: 'r', to: 'B' }); // повторная «передача» того же
    expect(known(s, 'planet:A')).toEqual([1, 2]);
  });

  it('снесён центр — пропало то, что было только у него; связанный центр сохранил копию', () => {
    let s = hit(linked(), 1, 'f');
    s = run(s, 'test.raze', { planetId: 'A' });
    expect(s.swarmNet?.holders['planet:A']).toBeUndefined();
    expect(known(s, 'planet:C')).toEqual([1]);
  });

  it('флот без ретранслятора передаёт опыт, только вернувшись на мир с центром', () => {
    let s = run(world([fleet('f', 'D', [['drone', 1]])]), 'test.start');
    s = hit(s, 1, 'f');
    expect(known(s, 'planet:C')).toEqual([]);
    s = run(s, 'test.move', { fleetId: 'f', to: 'C' });
    expect(known(s, 'planet:C')).toEqual([1]);
  });
});

describe('адаптация по частям сети', () => {
  /** Три удара по флоту на A: знание только у части A. */
  const struckA = (): GameState => {
    let s = run(
      world([
        fleet('organA', 'A', [['mother', 1, ['chamber']]]),
        fleet('organC', 'C', [['mother', 1, ['chamber']]]),
      ]),
      'test.start',
    );
    for (let i = 1; i <= 3; i++) s = hit(s, i, 'organA');
    return s;
  };

  it('драйвер заказывает проект только части, до которой дошёл сигнал', () => {
    expect(swarmAdaptDue(struckA(), data, 'swarm', null)).toEqual([
      { moduleId: 'veil', fleetId: 'organA' },
    ]);
  });

  it('ядро отказывает органу части, не знающей сигнала, хотя в журнале он есть', () => {
    const r = kernel.applyAction(
      struckA(),
      act('swarm.adapt', { moduleId: 'veil', fleetId: 'organC' }),
      ctx(0),
    );
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe('E_NO_SIGNAL');
  });

  it('форма вырастает только в части органа, а волна дальней части рождается без неё', () => {
    let s = run(struckA(), 'swarm.adapt', { moduleId: 'veil', fleetId: 'organA' });
    s = ok(kernel.advanceTo(s, ctx(7 * MS_PER_HOUR)));
    expect(s.fleets.organA?.units[0]?.modules).toEqual(['chamber', 'veil']);
    expect(s.fleets.organC?.units[0]?.modules).toEqual(['chamber']); // отрезан
    s = run(s, 'test.wave', { fleetId: 'waveA', at: 'A' });
    s = run(s, 'test.wave', { fleetId: 'waveC', at: 'C' });
    expect(s.fleets.waveA?.units[0]?.modules).toEqual(['chamber', 'veil']);
    expect(s.fleets.waveC?.units[0]?.modules).toEqual(['chamber']); // строит против старого
  });

  it('связь восстановлена — рецепт даёт новые формы другой части, построенные остаются', () => {
    let s = run(struckA(), 'swarm.adapt', { moduleId: 'veil', fleetId: 'organA' });
    s = ok(kernel.advanceTo(s, ctx(7 * MS_PER_HOUR)));
    s.fleets.r = fleet('r', 'D', [['relay', 1]]);
    s = run(s, 'test.move', { fleetId: 'r', to: 'B' });
    expect(s.swarmNet?.holders['planet:C']?.recipes).toEqual({ veil: 1 });
    expect(s.fleets.organC?.units[0]?.modules).toEqual(['chamber']); // построенный — как был
    s = run(s, 'test.wave', { fleetId: 'waveC', at: 'C' });
    expect(s.fleets.waveC?.units[0]?.modules).toEqual(['chamber', 'veil']);
  });

  it('проектов — по одному на часть: вторая часть растит свой параллельно', () => {
    let s = struckA();
    for (let i = 4; i <= 6; i++) s = hit(s, i, 'organC');
    expect(swarmAdaptDue(s, data, 'swarm', null)).toEqual([
      { moduleId: 'veil', fleetId: 'organA' },
      { moduleId: 'veil', fleetId: 'organC' },
    ]);
    s = run(s, 'swarm.adapt', { moduleId: 'veil', fleetId: 'organA' });
    s = run(s, 'swarm.adapt', { moduleId: 'veil', fleetId: 'organC' });
    expect(s.swarmAdapts).toHaveLength(2);
  });
});

describe('разрыв сети — событие (задача «Разорвать сеть»)', () => {
  it('мир, бывший на связи с ульем и отрезанный, помнится; починка не отменяет', () => {
    const start = world([fleet('r', 'B', [['relay', 1]])]);
    start.pve = { ...start.pve!, home: 'A' };
    let s = run(start, 'test.start');
    expect(s.swarmNet?.linked).toEqual(['A', 'B', 'C']);
    s = run(s, 'test.kill', { fleetId: 'r' });
    expect(s.swarmNet?.cut).toEqual(['B', 'C']);
    s.fleets.r2 = fleet('r2', 'D', [['relay', 1]]);
    s = run(s, 'test.move', { fleetId: 'r2', to: 'B' }); // Рой починил связь
    expect(s.swarmNet?.cut).toEqual(['B', 'C']);
  });

  it('мир, не бывавший на связи, отрезанным не считается', () => {
    const start = world([]);
    start.pve = { ...start.pve!, home: 'A' };
    const s = run(start, 'test.start');
    expect(s.swarmNet?.cut).toBeUndefined();
    expect(s.swarmNet?.linked).toEqual(['A']);
  });
});
