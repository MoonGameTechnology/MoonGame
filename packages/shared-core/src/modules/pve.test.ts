import { describe, it, expect } from 'vitest';
import { createKernel } from '../kernel/kernel';
import { pveModule } from './pve';
import { createInitialState, type GameState, type Planet, type Player } from '../state/gameState';
import { parseGameData, type GameData } from '../data/schemas';
import type { AdvanceResult, Context, MatchConfig } from '../action/types';
import { deepFreeze } from '../util/clone';
import { MS_PER_HOUR } from '../util/time';

// pveModule — общий NPC-враг, приходящий волнами по расписанию (PVE-3). Мир собран
// из одного модуля: это и есть доказательство изоляции (модуль ни от кого не зависит).

const data: GameData = parseGameData({
  version: '0.1.0',
  resources: ['metal'],
  units: { drone: { faction: 'swarm', stats: { attack: 3, defense: 1, speed: 10 } } },
  factions: {
    swarm: { name: 'Swarm', startingLoadout: { fleet: [{ unit: 'drone', count: 2 }] } },
    vanguard: { name: 'Vanguard' },
  },
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

const kernel = createKernel([pveModule]);
const ctx = (now: number, modeId?: string): Context => ({
  now,
  data,
  config: { timeScale: 1, modeId } as MatchConfig,
});

function player(id: string, faction: string): Player {
  return { id, name: id, faction, status: 'active', resources: {} };
}
function planet(id: string, owner: string | null): Planet {
  return {
    id,
    owner,
    position: { x: 0, y: 0 },
    resources: {},
    buildings: [],
    garrison: [],
    traits: [],
    kind: 'planet',
  };
}

function world(): GameState {
  const base = createInitialState({ seed: 'pve', version: { data: '0.1.0', manifest: '1' } });
  return {
    ...base,
    players: { human: player('human', 'vanguard'), swarm: player('swarm', 'swarm') },
    planets: { home: planet('home', 'human'), hive: planet('hive', 'swarm') },
  };
}

/** Двигает мир до `to`, начиная со свежего состояния (или переданного). */
function advance(to: number, modeId?: string, from: GameState = world()): AdvanceResult {
  return kernel.advanceTo(from, ctx(to, modeId));
}
function ok(res: AdvanceResult): GameState {
  if (!res.ok) throw new Error('advance failed: ' + res.code);
  return res.state;
}

/** Мир, у которого модуль УЖЕ завёл счётчик и взвёл первую волну (на 6ч). Заведение
 *  и приход волны — два разных продвижения часов: ядро не переигрывает спан, который
 *  только что прошло, поэтому событие, поставленное внутри `time.advanced`, ждёт
 *  следующего вызова. Это и есть живой режим сервера — часы идут постоянно. */
const seeded = (): GameState => ok(advance(MS_PER_HOUR, 'waves'));

describe('pveModule — волны (PVE-3)', () => {
  it('матч без PvE-режима не получает ни state.pve, ни расписания', () => {
    // Механику включают ДАННЫЕ: у режима `plain` нет секции `pve`, значит модуль здесь
    // не существует для игры. То же и без режима вовсе.
    for (const modeId of ['plain', undefined]) {
      const state = ok(advance(MS_PER_HOUR, modeId));
      expect({ modeId, pve: state.pve, scheduled: state.scheduled.length }).toEqual({
        modeId,
        pve: undefined,
        scheduled: 0,
      });
    }
  });

  it('PvE-режим заводит счётчик и ставит первую волну в расписание', () => {
    const state = ok(advance(MS_PER_HOUR, 'waves'));
    // Первая волна отсчитывается от НАЧАЛА спана, а не от его конца: иначе матч,
    // восстановленный и догнавший неделю одним вызовом, отодвинул бы стартовую волну
    // на неделю вперёд.
    expect(state.pve).toEqual({
      waveNumber: 0,
      totalWaves: 2,
      npcPlayerId: 'swarm',
      nextWaveAt: 6 * MS_PER_HOUR,
    });
    expect(state.scheduled.map((s) => s.type)).toEqual(['pve.wave']);
  });

  it('нет места под фракцию Роя — модуль остаётся инертным, а не выдумывает врага', () => {
    const solo = { ...world(), players: { human: player('human', 'vanguard') } };
    const state = ok(advance(MS_PER_HOUR, 'waves', solo));
    expect(state.pve).toBeUndefined();
    expect(state.scheduled).toEqual([]);
  });

  it('пришедшая волна спавнит флот NPC и ставит следующую', () => {
    const state = ok(advance(8 * MS_PER_HOUR, 'waves', seeded()));
    expect(state.pve?.waveNumber).toBe(1);
    const waves = Object.values(state.fleets).filter((f) => f.owner === 'swarm');
    expect(waves).toHaveLength(1);
    expect(waves[0]?.location).toBe('hive'); // мир, который держит NPC
    // Волна N — это N стартовых составов фракции: ramp живёт в контенте, не в коде.
    expect(waves[0]?.units).toEqual([{ unit: 'drone', count: 2 }]);
    expect(state.pve?.nextWaveAt).toBe(12 * MS_PER_HOUR); // следующая взведена
  });

  it('вторая волна крепче первой и на ней штурм кончается', () => {
    const state = ok(advance(20 * MS_PER_HOUR, 'waves', seeded()));
    expect(state.pve?.waveNumber).toBe(2); // totalWaves достигнут
    expect(state.pve?.nextWaveAt).toBeUndefined(); // больше ничего не взводится
    expect(state.scheduled).toEqual([]);
    expect(state.fleets['pve:wave:2']?.units).toEqual([{ unit: 'drone', count: 4 }]);
  });

  it('дальнейший ход времени волн больше не приносит (штурм закончен)', () => {
    const after = ok(advance(200 * MS_PER_HOUR, 'waves', seeded()));
    expect(after.pve?.waveNumber).toBe(2);
    expect(Object.keys(after.fleets).filter((id) => id.startsWith('pve:wave:')).sort()).toEqual([
      'pve:wave:1',
      'pve:wave:2',
    ]);
  });

  it('детерминизм: членение advance не меняет результат', () => {
    // Волны едут по `schedule`, а не по «тикам», поэтому один прыжок и четыре шага
    // обязаны сойтись бит-в-бит.
    const oneJump = ok(advance(20 * MS_PER_HOUR, 'waves', seeded()));
    let stepwise = seeded();
    for (const hrs of [7, 11, 15, 20]) {
      stepwise = ok(advance(hrs * MS_PER_HOUR, 'waves', stepwise));
    }
    expect(JSON.stringify(stepwise.pve)).toBe(JSON.stringify(oneJump.pve));
    expect(JSON.stringify(stepwise.fleets)).toBe(JSON.stringify(oneJump.fleets));
  });

  it('не мутирует вход', () => {
    const frozen = deepFreeze(world());
    expect(kernel.advanceTo(frozen, ctx(20 * MS_PER_HOUR, 'waves')).ok).toBe(true);
  });
});
