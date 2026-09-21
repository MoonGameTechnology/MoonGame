import { describe, it, expect } from 'vitest';
import { createKernel } from '../kernel/kernel';
import { swarmMemoryModule, recalled, STRIKE_KIND } from './swarmMemory';
import type { GameModule } from '../kernel/module';
import { createInitialState, type GameState, type Player } from '../state/gameState';
import { parseGameData, type GameData } from '../data/schemas';
import type { Action, Context, MatchConfig } from '../action/types';

// PVR-4.2 — Рой копит наблюдения завершённых столкновений. Мир собран из двух модулей:
// самой памяти и крошечного «звонка», который подаёт на шину то же событие, что в живой
// игре шлёт `shuttleModule`. Проверяется ПОДПИСКА памяти, а не путь удара.

const data: GameData = parseGameData({
  version: '0.1.0',
  resources: ['metal'],
  units: { drone: { faction: 'swarm', stats: { attack: 3, defense: 1, speed: 10 } } },
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

/** Звонок: подаёт `shuttle.hit` ровно с той формой, что шлёт `shuttleModule`. */
const striker: GameModule = {
  id: 'test-striker',
  version: '1.0.0',
  setup(api) {
    api.onAction('test.hit', (action, h) => {
      h.emit('shuttle.hit', action.payload);
    });
    // Событие разведки — его память слушать НЕ должна.
    api.onAction('test.scout', (action, h) => {
      h.emit('fleet.identified', action.payload);
    });
  },
};

const kernel = createKernel([swarmMemoryModule, striker]);
const ctx = (now: number, modeId = 'waves'): Context => ({
  now,
  data,
  config: { timeScale: 1, modeId } as MatchConfig,
});

function player(id: string, faction: string): Player {
  return { id, name: id, faction, status: 'active', resources: {} };
}

function world(): GameState {
  const base = createInitialState({ seed: 'memory', version: { data: '0.1.0', manifest: '1' } });
  return { ...base, players: { p1: player('p1', 'vanguard'), swarm: player('swarm', 'swarm') } };
}

let seq = 0;
const hit = (over: Record<string, unknown> = {}): Action => ({
  id: `t:p1:${++seq}`,
  issuedAt: 0,
  type: 'test.hit',
  playerId: 'p1',
  payload: { strikeId: 's1', owner: 'p1', targetId: 'f9', targetOwner: 'swarm', damage: 7, ...over },
});

function apply(s: GameState, action: Action, at = 0): GameState {
  const r = kernel.applyAction(s, action, ctx(at));
  if (!r.ok) throw new Error(`действие отклонено: ${r.code}`);
  return r.state;
}

describe('PVR-4.2 — наблюдение заводит только завершённый контакт с эффектом', () => {
  it('попадание по Рою с уроном становится наблюдением', () => {
    const s = apply(world(), hit());
    expect(s.swarmMemory?.engagements).toBe(1);
    expect(s.swarmMemory?.observations).toEqual([
      { ordinal: 1, kind: STRIKE_KIND, engagement: 'strike:s1' },
    ]);
  });

  it('удар БЕЗ урона наблюдением не является — применение без эффекта не считается', () => {
    const s = apply(world(), hit({ damage: 0 }));
    expect(s.swarmMemory).toBeUndefined();
  });

  it('попадание не по Рою память не трогает', () => {
    const s = apply(world(), hit({ targetOwner: 'p1' }));
    expect(s.swarmMemory).toBeUndefined();
  });

  it('разведка не заводит наблюдение — этого события память не слушает', () => {
    const r = kernel.applyAction(
      world(),
      { id: 't:p1:scout', issuedAt: 0, type: 'test.scout', playerId: 'p1', payload: { owner: 'p1', targetOwner: 'swarm' } },
      ctx(0),
    );
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.state.swarmMemory).toBeUndefined();
  });

  it('в матче без секции `pve` модуль инертен: Роя как противника режим не объявлял', () => {
    const r = kernel.applyAction(world(), hit(), ctx(0, 'plain'));
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.state.swarmMemory).toBeUndefined();
  });
});

describe('PVR-4.2 — повторная телеметрия не считается дважды', () => {
  it('три попадания одного вылета дают ОДНО наблюдение', () => {
    let s = apply(world(), hit());
    s = apply(s, hit({ damage: 4 }), 1);
    s = apply(s, hit({ targetId: 'f7', damage: 9 }), 2);
    expect(s.swarmMemory?.engagements).toBe(1);
    expect(s.swarmMemory?.observations).toHaveLength(1);
  });

  it('разные вылеты — разные столкновения', () => {
    let s = apply(world(), hit({ strikeId: 's1' }));
    s = apply(s, hit({ strikeId: 's2' }), 1);
    expect(s.swarmMemory?.engagements).toBe(2);
    expect(s.swarmMemory?.observations.map((o) => o.ordinal)).toEqual([1, 2]);
  });

  it('вылет без идентификатора игнорируется: повтор от нового боя не отличить', () => {
    const s = apply(world(), hit({ strikeId: '' }));
    expect(s.swarmMemory).toBeUndefined();
  });
});

describe('PVR-4.2 — окно памяти накладывает читающий, а не состояние', () => {
  function withStrikes(n: number): GameState {
    let s = world();
    for (let i = 1; i <= n; i++) s = apply(s, hit({ strikeId: `s${i}` }), i);
    return s;
  }

  it('«весь забег» видит все столкновения', () => {
    const s = withStrikes(6);
    expect(recalled(s.swarmMemory, STRIKE_KIND, null)).toBe(6);
  });

  it('окно в 4 столкновения видит только последние четыре', () => {
    const s = withStrikes(6);
    expect(recalled(s.swarmMemory, STRIKE_KIND, 4)).toBe(4);
  });

  it('окно шире истории не выдумывает наблюдений', () => {
    const s = withStrikes(2);
    expect(recalled(s.swarmMemory, STRIKE_KIND, 4)).toBe(2);
  });

  it('чужой класс оружия не вспоминается', () => {
    const s = withStrikes(3);
    expect(recalled(s.swarmMemory, 'siege', null)).toBe(0);
  });

  it('пустая память отвечает нулём, а не падает', () => {
    expect(recalled(undefined, STRIKE_KIND, null)).toBe(0);
    expect(recalled({ engagements: 0, observations: [] }, STRIKE_KIND, 4)).toBe(0);
  });

  it('ОДНО состояние — два разных вывода: глубина взгляда различает сложности', () => {
    const s = withStrikes(6);
    // Тот же забег, те же бои. `weak` помнит четыре, `strong` — все шесть.
    expect(recalled(s.swarmMemory, STRIKE_KIND, 4)).toBe(4);
    expect(recalled(s.swarmMemory, STRIKE_KIND, null)).toBe(6);
  });
});

describe('PVR-4.2 — память не переживает попытку и не течёт к игроку', () => {
  it('новая попытка начинает с пустой памяти', () => {
    const finished = apply(world(), hit());
    expect(finished.swarmMemory?.engagements).toBe(1);
    expect(world().swarmMemory).toBeUndefined(); // следующий забег — своё состояние
  });

  it('состояние сериализуемо целиком (инвариант 2: снимок забега его унесёт)', () => {
    const s = apply(world(), hit());
    const back = JSON.parse(JSON.stringify(s)) as GameState;
    expect(back.swarmMemory).toEqual(s.swarmMemory);
    expect(recalled(back.swarmMemory, STRIKE_KIND, null)).toBe(1);
  });
});
