import { describe, it, expect } from 'vitest';
import { createKernel } from '../kernel/kernel';
import { swarmMemoryModule } from './swarmMemory';
import {
  swarmAdaptModule,
  swarmAdaptDue,
  swarmKnownLevel,
  swarmModuleLevel,
  MIN_SIGNAL,
  SWARM_MEMORY_WINDOW,
} from './swarmAdapt';
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

  it('покров ВЫРАСТАЕТ на матках, где гнездо свободно (AUD-20)', () => {
    // Решение владельца 2026-09-24: до адаптации покрова нет ни на одной матке — Рой
    // шаттлы не перехватывает. Готовый проект растит его там, куда его можно поставить.
    let s = seen(MIN_SIGNAL, { modules: ['chamber'] });
    s.fleets.other = fleet('other', 'swarm', ['chamber']);
    s = apply(s, adapt(), 10);
    const done = ok(kernel.advanceTo(s, ctx(10 + 7 * MS_PER_HOUR)));
    for (const id of ['hostF', 'other']) {
      expect(done.fleets[id]?.units[0]?.modules).toEqual(['chamber', 'veil']);
      expect(done.fleets[id]?.units[0]?.moduleStars).toEqual({ veil: 1 });
    }
  });

  it('корпус, который покров не допускает, его не получает', () => {
    let s = seen(MIN_SIGNAL);
    s.fleets.escort = {
      ...fleet('escort', 'swarm', []),
      units: [{ unit: 'cruiser', count: 2 }],
    };
    s = apply(s, adapt(), 10);
    const done = ok(kernel.advanceTo(s, ctx(10 + 7 * MS_PER_HOUR)));
    expect(done.fleets.escort?.units[0]?.modules).toBeUndefined();
    expect(done.fleets.escort?.units[0]?.moduleStars).toBeUndefined();
  });

  it('готовый проект пишется в рецепт — знание переживает гибель маток', () => {
    let s = apply(seen(MIN_SIGNAL), adapt(), 10);
    s = ok(kernel.advanceTo(s, ctx(10 + 7 * MS_PER_HOUR)));
    expect(s.swarmRecipes).toEqual({ veil: 1 });
    // Все матки с покровом погибли, но следующий проект продолжает лестницу, а не
    // начинает её заново: новая камера растит уже второй уровень.
    s = apply(s, act('test.kill', 'swarm', { fleetId: 'hostF' }), s.time + 1);
    s.fleets.fresh = fleet('fresh', 'swarm', ['chamber']);
    expect(swarmKnownLevel(s, 'swarm', 'veil')).toBe(1);
    s = apply(s, adapt({ fleetId: 'fresh' }), s.time + 1);
    expect(s.swarmAdapt).toMatchObject({ level: 2, fleetId: 'fresh' });
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

describe('AUD-20 — проект едет вместе с органом, влитым в другой флот', () => {
  const merger: GameModule = {
    id: 'test-merge',
    version: '1.0.0',
    setup(api) {
      api.onAction('test.merge', (action, h) => {
        const p = action.payload as { from: string; into: string };
        const from = h.state.fleets[p.from]!;
        h.state.fleets[p.into]!.units.push(...from.units);
        delete h.state.fleets[p.from];
        h.emit('fleet.merged', { from: p.from, into: p.into, owner: 'swarm', at: 'hive' });
      });
    },
  };
  const k = createKernel([swarmMemoryModule, swarmAdaptModule, striker, merger]);

  it('слияние не хоронит оплаченный проект: уровень вырастает в новом флоте', () => {
    const s = apply(seen(MIN_SIGNAL), adapt(), 10);
    s.fleets.wave = fleet('wave', 'swarm', []);
    const r = k.applyAction(s, act('test.merge', 'swarm', { from: 'hostF', into: 'wave' }), ctx(11));
    if (!r.ok) throw new Error(r.code);
    expect(r.state.swarmAdapt?.fleetId).toBe('wave');
    const done = ok(k.advanceTo(r.state, ctx(10 + 7 * MS_PER_HOUR)));
    expect(done.swarmRecipes).toEqual({ veil: 1 });
    expect(swarmModuleLevel(done, 'swarm', 'veil')).toBe(1);
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

describe('AUD-20 — новые формы рождаются по рецепту', () => {
  const waveBell: GameModule = {
    id: 'test-wave',
    version: '1.0.0',
    setup(api) {
      api.onAction('test.wave', (action, h) => {
        const p = action.payload as { fleetId: string };
        h.state.fleets[p.fleetId] = fleet(p.fleetId, 'swarm', ['chamber']);
        h.emit('pve.wave.spawned', { owner: 'swarm', fleetId: p.fleetId, location: 'hive', wave: 1 });
      });
    },
  };
  const k = createKernel([swarmMemoryModule, swarmAdaptModule, striker, waveBell]);
  const run = (s: GameState, a: Action, at: number): GameState => {
    const r = k.applyAction(s, a, ctx(at));
    if (!r.ok) throw new Error(r.code);
    return r.state;
  };

  it('волна после адаптации выходит уже с покровом нужного уровня', () => {
    let s = apply(seen(MIN_SIGNAL), adapt(), 10);
    s = ok(kernel.advanceTo(s, ctx(10 + 7 * MS_PER_HOUR)));
    s = run(s, act('test.wave', 'swarm', { fleetId: 'w1' }), s.time + 1);
    expect(s.fleets.w1?.units[0]?.modules).toEqual(['chamber', 'veil']);
    expect(s.fleets.w1?.units[0]?.moduleStars).toEqual({ veil: 1 });
  });

  it('волна до адаптации выходит без покрова', () => {
    const s = run(seen(MIN_SIGNAL), act('test.wave', 'swarm', { fleetId: 'w1' }), 10);
    expect(s.fleets.w1?.units[0]?.modules).toEqual(['chamber']);
  });
});

describe('AUD-20 — «пора ли» решает одно правило на оба хоста', () => {
  it('окно сложности: слабый Рой помнит 4 боя, сильный — весь забег', () => {
    expect(SWARM_MEMORY_WINDOW).toEqual({ weak: 4, strong: null });
  });

  it('пол взят — заказ проекта на органе; пол не взят — ничего', () => {
    expect(swarmAdaptDue(seen(MIN_SIGNAL - 1), data, 'swarm', null)).toBeNull();
    expect(swarmAdaptDue(seen(MIN_SIGNAL), data, 'swarm', null)).toEqual({
      moduleId: 'veil',
      fleetId: 'hostF',
    });
  });

  it('узкое окно ждёт свежих боёв: старые наблюдения из него выпали', () => {
    // Окно считается в столкновениях: окно уже пола не вмещает нужного числа
    // наблюдений, сколько бы их ни было за весь забег.
    expect(swarmAdaptDue(seen(MIN_SIGNAL), data, 'swarm', MIN_SIGNAL - 1)).toBeNull();
    expect(swarmAdaptDue(seen(MIN_SIGNAL), data, 'swarm', MIN_SIGNAL)).not.toBeNull();
  });

  it('идёт проект, нет органа или не на что — не заказывает', () => {
    expect(swarmAdaptDue(apply(seen(MIN_SIGNAL), adapt(), 10), data, 'swarm', null)).toBeNull();
    expect(swarmAdaptDue(seen(MIN_SIGNAL, { modules: ['veil'] }), data, 'swarm', null)).toBeNull();
    const poor = seen(MIN_SIGNAL, { resources: { biomass: 5, metal: 5, microelectronics: 1 } });
    expect(swarmAdaptDue(poor, data, 'swarm', null)).toBeNull();
  });

  it('заказ, который выдаёт правило, ядро принимает', () => {
    const s = seen(MIN_SIGNAL);
    const due = swarmAdaptDue(s, data, 'swarm', SWARM_MEMORY_WINDOW.weak)!;
    expect(code(s, adapt({ moduleId: due.moduleId, fleetId: due.fleetId }))).toBeUndefined();
  });
});
