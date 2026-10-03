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

describe('pveOrchestrator — ответ на маяк (задача владельца 2026-09-24)', () => {
  it('флот игрока на маяке — Рой шлёт туда отряд вместо обычной цели', () => {
    const beacon = { ...planet('beacon', null, 60), traits: ['beacon'] };
    const state = world({
      planets: {
        hive: planet('hive', 'swarm', 0),
        beacon,
        near: planet('near', 'human', 100),
      },
      fleets: {
        'pve:wave:1': fleet('pve:wave:1', 'swarm', 'hive'),
        you: fleet('you', 'human', 'beacon'),
      },
    });
    const out = orders(state);
    expect(out.filter((a) => (a.payload as { fleetId: string }).fleetId === 'pve:wave:1')).toEqual([
      expect.objectContaining({ type: 'fleet.move', payload: { fleetId: 'pve:wave:1', to: 'beacon' } }),
    ]);
  });
});

describe('pveOrchestrator — адаптация Роя (AUD-20)', () => {
  // Свой мир: матка с камерой вывода, модуль-ответ с лестницей и память ударов.
  const adaptData: GameData = parseGameData({
    version: '0.1.0',
    resources: ['biomass'],
    units: {
      mother: {
        faction: 'swarm',
        traits: ['brood_host'],
        slots: { defense: 1, utility: 1 },
        stats: { attack: 3, defense: 1, speed: 10 },
      },
      lander: { faction: 'swarm', domain: 'ground', stats: { attack: 1, defense: 1, speed: 1 } },
    },
    modules: {
      veil: {
        name: 'Veil',
        slot: 'defense',
        tag: 'vertical',
        effects: { stats: { pointDefense: 6 } },
        allowed: { domain: 'space', traits: ['brood_host'] },
        adaptation: { signal: 'strike', levels: [{ cost: { biomass: 30 }, hours: 6 }] },
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
    factions: { swarm: { name: 'Swarm' }, vanguard: { name: 'Vanguard' } },
    buildings: {},
    events: {},
  });
  const struck = (n: number): GameState['swarmMemory'] => ({
    engagements: n,
    observations: Array.from({ length: n }, (_, i) => ({
      ordinal: i + 1,
      kind: 'strike',
      engagement: `strike:s${i + 1}`,
    })),
  });
  const adaptWorld = (strikes: number): GameState =>
    world({
      players: {
        human: player('human', 'vanguard'),
        swarm: { ...player('swarm', 'swarm'), resources: { biomass: 100 } },
      },
      fleets: {
        organ: fleet('organ', 'swarm', 'hive', {
          units: [{ unit: 'mother', count: 1, modules: ['chamber'] }],
        }),
      },
      swarmMemory: struck(strikes),
    });
  const adaptOrders = (s: GameState, memoryWindow?: number | null): Action[] =>
    pveOrders(s, adaptData, { session: 'm1', seq: 0, memoryWindow }).filter(
      (a) => a.type === 'swarm.adapt',
    );

  it('пол наблюдений взят — драйвер заказывает проект на органе', () => {
    expect(adaptOrders(adaptWorld(3), 4)).toEqual([
      expect.objectContaining({ playerId: 'swarm', payload: { moduleId: 'veil', fleetId: 'organ' } }),
    ]);
  });

  it('пол не взят — заказа нет', () => {
    expect(adaptOrders(adaptWorld(2), 4)).toEqual([]);
  });

  it('без окна памяти Рой не адаптируется: молча «помнить всё» было бы тихой сложностью', () => {
    expect(adaptOrders(adaptWorld(3))).toEqual([]);
  });
});

describe('pveOrchestrator — площадка крепости на развилке не цель (замечание Codex на #1410)', () => {
  it('ближайшая крепость игрока на развилке не уводит волну — цель ближайший мир', () => {
    // Площадка без связей ближе любого мира: прежде волна целилась в неё и получала E_NO_ROUTE.
    const site: Planet = { ...planet('fork-near-0', 'human', 20), links: [], fork: { province: 'near', trail: 0 } };
    const s = world();
    s.planets[site.id] = site;
    const moves = orders(s).filter((a) => a.type === 'fleet.move');
    expect(moves.map((a) => (a.payload as { to: string }).to)).toEqual(['near']);
  });
});

describe('pveOrchestrator — последний контрудар главы VI (PVR-8.4)', () => {
  // Литейная у людей, доки известны: соединение из улья и построенное на заставе идут к докам.
  // Правило — `counterattackPlan` в ядре, то же у бота забега; здесь — что сервер его слушает.
  const ca = (found: Record<string, string[]>): GameState =>
    world({
      planets: {
        hive: planet('hive', 'swarm', 0),
        outpost: planet('outpost', 'swarm', 40),
        foundry: planet('foundry', 'human', 100),
        docks: planet('docks', null, 500),
      },
      fleets: {
        'pve:wave:1': fleet('pve:wave:1', 'swarm', 'hive'),
        guard: fleet('guard', 'swarm', 'hive'),
        built: fleet('built', 'swarm', 'outpost', { traits: ['rally'] }),
      },
      operation: {
        production: ['hive'],
        forces: { guard: { fleets: ['guard'], hp: 10 } },
        breakAt: 0.2,
        evacuate: 1,
        counterattack: { after: ['foundry'], target: 'docks' },
      },
      missionFacts: { found },
    });
  // Каждый курс отдельной строкой: второй приказ тому же флоту виден как лишняя строка.
  const moves = (s: GameState): string[] =>
    orders(s)
      .filter((a) => a.type === 'fleet.move')
      .map((a) => {
        const p = a.payload as { fleetId: string; to: string };
        return `${p.fleetId} → ${p.to}`;
      })
      .sort();

  it('пора — соединение и построенное идут к докам, волна — своей дорогой', () => {
    expect(moves(ca({ human: ['docks'] }))).toEqual([
      'built → docks',
      'guard → docks',
      'pve:wave:1 → foundry',
    ]);
  });

  it('флот игрока на маяке: отвечает волна, а флоты контрудара курса не меняют', () => {
    const s = ca({ human: ['docks'] });
    s.planets.beacon = { ...planet('beacon', null, 60), traits: ['beacon'] };
    s.fleets.you = fleet('you', 'human', 'beacon');
    expect(moves(s)).toEqual(['built → docks', 'guard → docks', 'pve:wave:1 → beacon']);
  });

  it('доки никому не известны — прежняя тактика: соединение к ближайшему миру, построенное в улей', () => {
    expect(moves(ca({}))).toEqual(['built → hive', 'guard → foundry', 'pve:wave:1 → foundry']);
  });
});
