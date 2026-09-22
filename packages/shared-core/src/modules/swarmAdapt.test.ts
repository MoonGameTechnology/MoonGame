import { describe, it, expect } from 'vitest';
import { createKernel } from '../kernel/kernel';
import { swarmMemoryModule } from './swarmMemory';
import { swarmAdaptModule, swarmModuleLevel, MIN_SIGNAL } from './swarmAdapt';
import type { GameModule } from '../kernel/module';
import { createInitialState, type Fleet, type GameState, type Player } from '../state/gameState';
import { parseGameData, type GameData } from '../data/schemas';
import type { Action, AdvanceResult, Context, MatchConfig } from '../action/types';
import { MS_PER_HOUR } from '../util/time';

// PVR-4.3 — от подтверждённого сигнала до усиленного модуля. Мир собран из памяти,
// адаптации и «звонка», который подаёт удары: проверяется ЦЕПОЧКА, а не путь удара.

const data: GameData = parseGameData({
  version: '0.1.0',
  resources: ['biomass', 'metal', 'microelectronics'],
  units: {
    mother: {
      faction: 'swarm',
      traits: ['brood_host'],
      slots: { defense: 1, utility: 2 },
      stats: { attack: 12, defense: 14, speed: 40, hp: 60 },
    },
    lander: { faction: 'swarm', domain: 'ground', stats: { attack: 8, defense: 5, speed: 1, hp: 16 } },
    cruiser: { faction: 'vanguard', stats: { attack: 16, defense: 14, speed: 40, hp: 60 } },
  },
  modules: {
    veil: {
      name: 'Veil',
      slot: 'defense',
      tag: 'vertical',
      effects: { stats: { pointDefense: 6 } },
      allowed: { domain: 'space', traits: ['brood_host'] },
      adaptation: {
        signal: 'strike',
        levels: [
          { cost: { biomass: 30, metal: 20, microelectronics: 8 }, hours: 6 },
          { cost: { biomass: 55, metal: 35, microelectronics: 14 }, hours: 9 },
        ],
      },
    },
    chamber: {
      name: 'Chamber',
      slot: 'utility',
      tag: 'horizontal',
      effects: { stats: {} },
      allowed: { domain: 'space', traits: ['brood_host'] },
      brood: { unit: 'lander', intervalHours: 3 },
    },
    plain: { name: 'Plain', slot: 'utility', tag: 'horizontal', effects: { stats: {} } },
  },
  technologies: {},
  factions: { swarm: { name: 'Swarm' }, vanguard: { name: 'Vanguard' } },
  buildings: {},
  events: {},
  modes: {
    waves: {
      name: 'Waves',
      modules: ['pve'],
      pve: { waves: 2, npcFaction: 'swarm', waveIntervalHours: 6 },
    },
    plain: { name: 'Plain' },
  },
});

const striker: GameModule = {
  id: 'test-striker',
  version: '1.0.0',
  setup(api) {
    api.onAction('test.hit', (action, h) => h.emit('shuttle.hit', action.payload));
    api.onAction('test.kill', (action, h) => {
      const p = action.payload as { fleetId: string };
      delete h.state.fleets[p.fleetId];
      h.emit('fleet.destroyed', { fleetId: p.fleetId, owner: 'swarm' });
    });
  },
};

const kernel = createKernel([swarmMemoryModule, swarmAdaptModule, striker]);
const ctx = (now: number, modeId = 'waves'): Context => ({
  now,
  data,
  config: { timeScale: 1, modeId } as MatchConfig,
});

function player(id: string, faction: string, resources: Record<string, number> = {}): Player {
  return { id, name: id, faction, status: 'active', resources };
}

function fleet(id: string, owner: string, modules: string[]): Fleet {
  return {
    id,
    owner,
    location: 'hive',
    movement: null,
    units: [{ unit: 'mother', count: 2, modules }],
    landing: [],
    traits: [],
  };
}

const RICH = { biomass: 200, metal: 200, microelectronics: 60 };

function world(over: { resources?: Record<string, number>; modules?: string[] } = {}): GameState {
  const base = createInitialState({ seed: 'adapt', version: { data: '0.1.0', manifest: '1' } });
  return {
    ...base,
    players: {
      p1: player('p1', 'vanguard'),
      swarm: player('swarm', 'swarm', { ...RICH, ...over.resources }),
    },
    fleets: { hostF: fleet('hostF', 'swarm', over.modules ?? ['veil', 'chamber']) },
  };
}

let seq = 0;
const act = (type: string, playerId: string, payload: unknown): Action => ({
  id: `t:${playerId}:${++seq}`,
  issuedAt: 0,
  type,
  playerId,
  payload,
});

const hit = (strikeId: string) =>
  act('test.hit', 'p1', { strikeId, owner: 'p1', targetId: 'hostF', targetOwner: 'swarm', damage: 7 });

const adapt = (over: Record<string, unknown> = {}) =>
  act('swarm.adapt', 'swarm', { moduleId: 'veil', fleetId: 'hostF', ...over });

/** Время по умолчанию берётся ИЗ СОСТОЯНИЯ: ядро не принимает приказ в прошлое, а
 *  каждое наблюдение сдвигает часы вперёд. */
function apply(s: GameState, action: Action, at = s.time): GameState {
  const r = kernel.applyAction(s, action, ctx(at));
  if (!r.ok) throw new Error(`отклонено: ${r.code}`);
  return r.state;
}
function code(s: GameState, action: Action, at = s.time): string | undefined {
  const r = kernel.applyAction(s, action, ctx(at));
  return r.ok ? undefined : r.code;
}
/** Мир, в котором класс наблюдён ровно `n` раз. */
function seen(n: number, over = {}): GameState {
  let s = world(over);
  for (let i = 1; i <= n; i++) s = apply(s, hit(`s${i}`), i);
  return s;
}
function ok(res: AdvanceResult): GameState {
  if (!res.ok) throw new Error('advance failed: ' + res.code);
  return res.state;
}

describe('PVR-4.3 — право на адаптацию проверяет ядро', () => {
  it('без наблюдений проект не открыть', () => {
    expect(code(world(), adapt())).toBe('E_NO_SIGNAL');
  });

  it('наблюдений меньше пола — всё ещё отказ', () => {
    expect(code(seen(MIN_SIGNAL - 1), adapt())).toBe('E_NO_SIGNAL');
  });

  it('пол взят — проект открывается и ОПЛАЧИВАЕТСЯ', () => {
    const s = apply(seen(MIN_SIGNAL), adapt(), 10);
    expect(s.swarmAdapt).toMatchObject({ moduleId: 'veil', level: 1, fleetId: 'hostF' });
    expect(s.players.swarm?.resources).toMatchObject({
      biomass: RICH.biomass - 30,
      metal: RICH.metal - 20,
      microelectronics: RICH.microelectronics - 8,
    });
  });

  it('второй проект поверх идущего отклонён — один запас не тратится дважды', () => {
    const s = apply(seen(MIN_SIGNAL), adapt(), 10);
    expect(code(s, adapt(), 11)).toBe('E_ADAPT_BUSY');
  });

  it('человеческая фракция формы Роя не заказывает', () => {
    const s = seen(MIN_SIGNAL);
    expect(code(s, act('swarm.adapt', 'p1', { moduleId: 'veil', fleetId: 'hostF' }))).toBe(
      'E_NOT_SWARM',
    );
  });

  it('в матче без Роя действия нет вовсе', () => {
    const r = kernel.applyAction(seen(MIN_SIGNAL), adapt(), ctx(10, 'plain'));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe('E_NOT_PVE');
  });

  it('модуль без лестницы ответом не является', () => {
    expect(code(seen(MIN_SIGNAL), adapt({ moduleId: 'plain' }))).toBe('E_NO_ADAPTATION');
  });

  it('без живого органа выращивать некому', () => {
    const s = seen(MIN_SIGNAL, { modules: ['veil'] }); // камеры на флоте нет
    expect(code(s, adapt())).toBe('E_NO_ORGAN');
  });

  it('чужой и отсутствующий флот — один код, без разведки существования', () => {
    const s = seen(MIN_SIGNAL);
    expect(code(s, adapt({ fleetId: 'нет-такого' }))).toBe('E_NO_ORGAN');
  });

  it('не хватает ресурсов — отказ, и запас не тронут', () => {
    const s = seen(MIN_SIGNAL, { resources: { biomass: 5, metal: 5, microelectronics: 1 } });
    expect(code(s, adapt())).toBe('E_NO_FUNDS');
    expect(s.players.swarm?.resources.biomass).toBe(5);
  });
});

describe('PVR-4.3 — проект доходит до уровня в бою', () => {
  it('по истечении срока уровень встаёт на стеки Роя', () => {
    const s = apply(seen(MIN_SIGNAL), adapt(), 10);
    expect(swarmModuleLevel(s, 'swarm', 'veil')).toBe(0); // ещё растёт
    const done = ok(kernel.advanceTo(s, ctx(10 + 7 * MS_PER_HOUR)));
    expect(swarmModuleLevel(done, 'swarm', 'veil')).toBe(1);
    expect(done.swarmAdapt).toBeUndefined();
  });

  it('до срока уровня нет — время и есть цена адаптации', () => {
    const s = apply(seen(MIN_SIGNAL), adapt(), 10);
    const early = ok(kernel.advanceTo(s, ctx(10 + 5 * MS_PER_HOUR)));
    expect(swarmModuleLevel(early, 'swarm', 'veil')).toBe(0);
    expect(early.swarmAdapt).toBeDefined();
  });

  it('уровень получают только стеки, несущие ЭТОТ модуль', () => {
    let s = seen(MIN_SIGNAL);
    s.fleets.other = fleet('other', 'swarm', ['chamber']); // камера есть, покрова нет
    s = apply(s, adapt(), 10);
    const done = ok(kernel.advanceTo(s, ctx(10 + 7 * MS_PER_HOUR)));
    expect(done.fleets.hostF?.units[0]?.moduleStars).toEqual({ veil: 1 });
    expect(done.fleets.other?.units[0]?.moduleStars).toBeUndefined();
  });

  it('второй шаг лестницы поднимает уровень до 2, третьего шага нет', () => {
    let s = apply(seen(MIN_SIGNAL), adapt(), 10);
    s = ok(kernel.advanceTo(s, ctx(10 + 7 * MS_PER_HOUR)));
    s = apply(s, adapt(), s.time + 1);
    s = ok(kernel.advanceTo(s, ctx(s.time + 10 * MS_PER_HOUR)));
    expect(swarmModuleLevel(s, 'swarm', 'veil')).toBe(2);
    expect(code(s, adapt(), s.time + 1)).toBe('E_ADAPT_MAXED');
  });
});

describe('PVR-4.3 — потеря органа прекращает незавершённый проект', () => {
  it('гибель носителя снимает проект сразу', () => {
    let s = apply(seen(MIN_SIGNAL), adapt(), 10);
    expect(s.swarmAdapt).toBeDefined();
    s = apply(s, act('test.kill', 'swarm', { fleetId: 'hostF' }), 11);
    expect(s.swarmAdapt).toBeUndefined();
  });

  it('и уровень из отложенного события уже не выпускается', () => {
    let s = apply(seen(MIN_SIGNAL), adapt(), 10);
    s = apply(s, act('test.kill', 'swarm', { fleetId: 'hostF' }), 11);
    const after = ok(kernel.advanceTo(s, ctx(10 + 7 * MS_PER_HOUR)));
    expect(swarmModuleLevel(after, 'swarm', 'veil')).toBe(0);
  });

  it('потраченное не возвращается: потери это потери, а не скрытый второй ресурс', () => {
    let s = apply(seen(MIN_SIGNAL), adapt(), 10);
    const paid = s.players.swarm?.resources.biomass;
    s = apply(s, act('test.kill', 'swarm', { fleetId: 'hostF' }), 11);
    expect(s.players.swarm?.resources.biomass).toBe(paid);
    expect(paid).toBe(RICH.biomass - 30);
  });
});
