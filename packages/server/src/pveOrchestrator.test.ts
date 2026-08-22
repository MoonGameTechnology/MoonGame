import { describe, expect, it } from 'vitest';
import {
  createInitialState,
  parseActionId,
  parseGameData,
  type Action,
  type Fleet,
  type GameData,
  type GameState,
  type Planet,
  type Player,
} from '@void/shared-core';
import { pveOrders } from './pveOrchestrator';

// pveOrchestrator — тактика NPC. Живёт на сервере и НЕ входит в реплей-контракт
// (ADR 05): это чистая функция, которая читает состояние и возвращает НАМЕРЕНИЯ.
// Поэтому её можно проверять без комнаты, сокета и часов — что здесь и делается.

const data: GameData = parseGameData({
  version: '0.1.0',
  resources: ['metal'],
  units: { drone: { faction: 'swarm', stats: { attack: 3, defense: 1, speed: 10 } } },
  factions: { swarm: { name: 'Swarm' }, vanguard: { name: 'Vanguard' } },
  buildings: {},
  events: {},
  sectorKinds: {
    planet: { capturable: true, buildable: true, orbit: true },
    void: { capturable: false, buildable: false, orbit: false },
  },
});

const player = (id: string, faction: string, status: Player['status'] = 'active'): Player => ({
  id,
  name: id,
  faction,
  status,
  resources: {},
});

const planet = (id: string, owner: string | null, x: number, kind = 'planet'): Planet => ({
  id,
  owner,
  position: { x, y: 0 },
  resources: {},
  buildings: [],
  garrison: [],
  traits: [],
  kind,
});

const fleet = (id: string, owner: string, location: string | null, extra: Partial<Fleet> = {}): Fleet => ({
  id,
  owner,
  location,
  movement: null,
  units: [{ unit: 'drone', count: 2 }],
  traits: [],
  ...extra,
});

/** PvE-мир: логово Роя в нуле, человеческие миры правее, между ними нейтральный. */
function world(over: Partial<GameState> = {}): GameState {
  return {
    ...createInitialState({ seed: 'pve-orch', version: { data: '0.1.0', manifest: '1' } }),
    players: { human: player('human', 'vanguard'), swarm: player('swarm', 'swarm') },
    planets: {
      hive: planet('hive', 'swarm', 0),
      mid: planet('mid', null, 50),
      near: planet('near', 'human', 100),
      far: planet('far', 'human', 900),
    },
    fleets: { 'pve:wave:1': fleet('pve:wave:1', 'swarm', 'hive') },
    pve: { waveNumber: 1, totalWaves: 3, npcPlayerId: 'swarm' },
    ...over,
  };
}

const orders = (state: GameState): Action[] => pveOrders(state, data, { session: 'm1', seq: 0 });

describe('pveOrchestrator — тактика волн (PVE-5.1)', () => {
  it('волна летит к БЛИЖАЙШЕМУ человеческому миру, а не к первому попавшемуся', () => {
    const out = orders(world());
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({
      type: 'fleet.move',
      playerId: 'swarm',
      payload: { fleetId: 'pve:wave:1', to: 'near' },
    });
  });

  it('людям нечего отнимать — цель нейтральный захватываемый мир', () => {
    const state = world({
      planets: {
        hive: planet('hive', 'swarm', 0),
        mid: planet('mid', null, 50),
        // `void` не захватывается — в цели он не годится, даже будучи ближе.
        rift: planet('rift', null, 10, 'void'),
      },
    });
    expect(orders(state)[0]).toMatchObject({ payload: { fleetId: 'pve:wave:1', to: 'mid' } });
  });

  it('лететь некуда — приказов нет (а не приказ в никуда)', () => {
    const state = world({
      planets: { hive: planet('hive', 'swarm', 0), rift: planet('rift', null, 10, 'void') },
    });
    expect(orders(state)).toEqual([]);
  });

  it('занятые флоты не трогаются: в пути, в бою, между узлами', () => {
    const state = world({
      fleets: {
        moving: fleet('moving', 'swarm', 'hive', {
          movement: { from: 'hive', to: 'near', departedAt: 0, arrivesAt: 10 },
        }),
        fighting: fleet('fighting', 'swarm', 'hive', { battleId: 'b1' }),
        adrift: fleet('adrift', 'swarm', null),
      },
    });
    // Приказ на занятый флот редьюсер всё равно отклонит — тратить на него
    // идемпотентный id значит платить за заведомый отказ.
    expect(orders(state)).toEqual([]);
  });

  it('чужие флоты не получают приказов — оркестратор командует ТОЛЬКО местом NPC', () => {
    const state = world({
      fleets: {
        'pve:wave:1': fleet('pve:wave:1', 'swarm', 'hive'),
        'human:1': fleet('human:1', 'human', 'near'),
      },
    });
    const out = orders(state);
    expect(out).toHaveLength(1);
    expect(out[0]?.playerId).toBe('swarm');
  });

  it('не PvE-матч / законченный матч / выбывший Рой — пусто', () => {
    expect(pveOrders(world({ pve: undefined }), data, { session: 'm1', seq: 0 })).toEqual([]);
    const ended = world();
    ended.match = { ...ended.match, status: 'ended' };
    expect(orders(ended)).toEqual([]);
    expect(
      orders(
        world({ players: { human: player('human', 'vanguard'), swarm: player('swarm', 'swarm', 'defeated') } }),
      ),
    ).toEqual([]);
  });

  it('id приказов валидны и уникальны — иначе кэш квитанций съест вторую волну как повтор', () => {
    const state = world({
      fleets: {
        'pve:wave:1': fleet('pve:wave:1', 'swarm', 'hive'),
        'pve:wave:2': fleet('pve:wave:2', 'swarm', 'hive'),
      },
    });
    const out = pveOrders(state, data, { session: 'm1', seq: 7 });
    expect(out).toHaveLength(2);
    const ids = out.map((a) => a.id);
    expect(new Set(ids).size).toBe(2);
    for (const id of ids) expect(parseActionId(id)).not.toBeNull();
    expect(parseActionId(ids[0]!)).toMatchObject({ session: 'm1', player: 'swarm', sequence: 7 });
  });

  it('детерминизм: порядок приказов не зависит от порядка ключей в состоянии', () => {
    // `Object.values` идёт по порядку вставки. Два хоста, собравшие один и тот же мир
    // в разном порядке, обязаны выдать один и тот же список приказов.
    const a = world({
      fleets: {
        'pve:wave:2': fleet('pve:wave:2', 'swarm', 'hive'),
        'pve:wave:1': fleet('pve:wave:1', 'swarm', 'hive'),
      },
    });
    const b = world({
      fleets: {
        'pve:wave:1': fleet('pve:wave:1', 'swarm', 'hive'),
        'pve:wave:2': fleet('pve:wave:2', 'swarm', 'hive'),
      },
    });
    expect(orders(a).map((o) => o.id + '→' + JSON.stringify(o.payload))).toEqual(
      orders(b).map((o) => o.id + '→' + JSON.stringify(o.payload)),
    );
  });

  it('не мутирует состояние (чистая функция)', () => {
    const state = world();
    const before = JSON.stringify(state);
    orders(state);
    expect(JSON.stringify(state)).toBe(before);
  });
});
