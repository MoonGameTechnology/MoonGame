/**
 * БОЕВОЙ СЧЁТ ЭКСПЕДИЦИИ (PVR-6.20, заказ владельца 2026-09-25: «в окно наград вывести,
 * сколько было потеряно и уничтожено»).
 *
 * Модуль волн слушает шину и ведёт `state.pve.tally` по местам игроков. Здесь он собран
 * с тестовым источником событий — сам бой проверяют тесты боя (`killedBy` ставит место
 * урона), а этот файл отвечает за правило счёта: кому засчитать потерю и кому — победу.
 */
import { describe, expect, it } from 'vitest';
import { createKernel } from '../kernel/kernel';
import type { GameModule } from '../kernel/module';
import { pveModule } from './pve';
import { createInitialState, type GameState, type Player } from '../state/gameState';
import { parseGameData, type GameData } from '../data/schemas';
import type { Action, Context, MatchConfig } from '../action/types';
import { MS_PER_HOUR } from '../util/time';

const data: GameData = parseGameData({
  version: '0.1.0',
  resources: ['metal'],
  units: { drone: { faction: 'swarm', stats: { attack: 3, defense: 1, speed: 10 } } },
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

/** Источник событий: действие `test.emit` выпускает на шину ровно то, что ему дали. */
const emitter: GameModule = {
  id: 'emitter',
  version: '1.0.0',
  setup(api) {
    api.onAction('test.emit', (action, h) => {
      const { events } = action.payload as { events: Array<{ type: string; payload: object }> };
      for (const e of events) h.emit(e.type, e.payload);
    });
  },
};

const kernel = createKernel([emitter, pveModule]);
const ctx = (now: number, modeId?: string): Context => ({
  now,
  data,
  config: { timeScale: 1, modeId } as MatchConfig,
});

const seat = (id: string, faction: string, npc?: Player['npc']): Player => ({
  id,
  name: id,
  faction,
  status: 'active',
  resources: {},
  ...(npc ? { npc } : {}),
});

/** Забег с двумя игроками (союзный кооп), Роем и пиратами; волны уже посеяны. */
function run(modeId = 'waves'): GameState {
  const base = createInitialState({ seed: 'tally', version: { data: '0.1.0', manifest: '1' } });
  const s: GameState = {
    ...base,
    players: {
      me: seat('me', 'vanguard'),
      mate: seat('mate', 'vanguard'),
      swarm: seat('swarm', 'swarm'),
      pirates: seat('pirates', 'vanguard', 'pirate'),
    },
  };
  const r = kernel.advanceTo(s, ctx(MS_PER_HOUR, modeId));
  if (!r.ok) throw new Error(r.code);
  return r.state;
}

function emit(s: GameState, events: Array<{ type: string; payload: object }>): GameState {
  const action: Action = {
    id: 'emit',
    issuedAt: MS_PER_HOUR,
    type: 'test.emit',
    playerId: 'me',
    payload: { events },
  };
  const r = kernel.applyAction(s, action, ctx(MS_PER_HOUR, s.pve ? 'waves' : 'plain'));
  if (!r.ok) throw new Error(r.code);
  return r.state;
}

const died = (owner: string | undefined, killedBy: string | undefined, count: number) => ({
  type: 'unit.died',
  payload: {
    unit: 'drone',
    count,
    at: 'P',
    fleetId: 'f',
    ...(owner ? { owner } : {}),
    ...(killedBy ? { killedBy } : {}),
  },
});

describe('боевой счёт экспедиции — павшие юниты', () => {
  it('свой павший — «потеряно», его убийце-Рою счёта нет', () => {
    const s = emit(run(), [died('me', 'swarm', 3)]);
    expect(s.pve?.tally).toEqual({ me: { lost: 3, destroyed: 0 } });
  });

  it('павший Рой — «уничтожено» тому, чей огонь его добил', () => {
    const s = emit(run(), [
      died('swarm', 'me', 5),
      died('swarm', 'mate', 2),
      died('swarm', 'me', 1),
    ]);
    expect(s.pve?.tally).toEqual({
      me: { lost: 0, destroyed: 6 },
      mate: { lost: 0, destroyed: 2 },
    });
  });

  it('нейтральный гарнизон и пираты — тоже «уничтожено»; их собственного счёта нет', () => {
    const s = emit(run(), [
      died(undefined, 'me', 4),
      died('pirates', 'me', 2),
      died('me', 'pirates', 1),
    ]);
    expect(s.pve?.tally).toEqual({ me: { lost: 1, destroyed: 6 } });
  });

  it('павший без стрелка (огонь ничей) — только «потеряно»', () => {
    const s = emit(run(), [died('me', undefined, 2), died('swarm', undefined, 9)]);
    expect(s.pve?.tally).toEqual({ me: { lost: 2, destroyed: 0 } });
  });

  it('мусор в числе не попадает в счёт', () => {
    const bad = [0, -3, Number.NaN].map((n) => died('me', 'swarm', n));
    const s = emit(run(), [...bad, { type: 'unit.died', payload: { owner: 'me', count: '7' } }]);
    expect(s.pve?.tally).toBeUndefined();
  });
});

describe('боевой счёт экспедиции — сбитые машины челноков', () => {
  it('ответный огонь цели сбил мой вылет — мне «потеряно», стрелку «уничтожено»', () => {
    const s = emit(run(), [
      { type: 'shuttle.repelled', payload: { owner: 'me', targetOwner: 'mate', downed: 2 } },
    ]);
    expect(s.pve?.tally).toEqual({
      me: { lost: 2, destroyed: 0 },
      mate: { lost: 0, destroyed: 2 },
    });
  });

  it('точечная оборона и перехватчики: стреляет `owner`, теряет `targetOwner`', () => {
    const s = emit(run(), [
      { type: 'pd.fired', payload: { owner: 'me', targetOwner: 'swarm', downed: 3 } },
      { type: 'shuttle.intercepted', payload: { owner: 'me', targetOwner: 'swarm', downed: 1 } },
      { type: 'shuttle.intercepted', payload: { owner: 'swarm', targetOwner: 'me', downed: 4 } },
    ]);
    expect(s.pve?.tally).toEqual({ me: { lost: 4, destroyed: 4 } });
  });

  it('машины погибли вместе с портом — «потеряно» без стрелка', () => {
    const s = emit(run(), [{ type: 'shuttle.lost', payload: { owner: 'me', count: 5 } }]);
    expect(s.pve?.tally).toEqual({ me: { lost: 5, destroyed: 0 } });
  });
});

describe('боевой счёт экспедиции — где его нет', () => {
  it('матч без PvE счёта не заводит и не падает', () => {
    const s = emit(run('plain'), [died('me', 'swarm', 3)]);
    expect(s.pve).toBeUndefined();
  });

  it('старый забег без счёта начинает его с нуля', () => {
    const s = run();
    expect(s.pve?.tally).toBeUndefined();
    expect(emit(s, [died('swarm', 'me', 1)]).pve?.tally).toEqual({ me: { lost: 0, destroyed: 1 } });
  });
});
