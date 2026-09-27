import { describe, expect, it } from 'vitest';
import {
  buildStateFromMap,
  parseMatchMap,
  setStance,
  type AllyOperation,
  type GameState,
} from '../packages/shared-core/src/index';
import { shippedGameData } from '../data/bundle';
import mapJson from '../data/maps/pve-4.json';
import {
  allyActiveOp,
  allyOwnTarget,
  GATHER_LIMIT_HOURS,
  planAllyOperation,
} from './allyOperation';

// Операция союзника главы IV (PVR-7.4, §6.5) — чистое решение на настоящей карте `pve-4`:
// что выполнять, какими флотами и в каком шаге операция. Бот и карточка зовут одно и то же.

const data = shippedGameData();
const HOUR = 3_600_000;

/** Мир после встречи: игрок и союзник в союзе, факт контакта записан. */
function met(): GameState {
  const s = buildStateFromMap(parseMatchMap(mapJson), data);
  setStance(s, 'p1', 'ally', 'alliance');
  // Войну Рою объявляет PvE-модуль на первом шаге часов — здесь это сделано руками.
  setStance(s, 'swarm', 'ally', 'war');
  setStance(s, 'swarm', 'p1', 'war');
  return { ...s, missionFacts: { contacted: { p1: ['rendezvous'] } } };
}
const withOrder = (s: GameState, op: Partial<AllyOperation>): GameState => ({
  ...s,
  allyOps: { ally: { by: 'p1', kind: 'attack', issuedAt: s.time, ...op } as AllyOperation },
});
const typesOf = (actions: { type: string }[]): string[] => actions.map((a) => a.type);

describe('операция союзника — что выполнять', () => {
  it('до встречи союзник ничего не ведёт', () => {
    const s = buildStateFromMap(parseMatchMap(mapJson), data);
    expect(allyActiveOp(s, 'ally')).toBeNull();
    expect(planAllyOperation(s, 'ally', data)).toMatchObject({
      step: 'idle',
      source: 'none',
      actions: [],
    });
  });

  it('после встречи без приказа — своя задача: ближайшая станция с признаком задачи', () => {
    const s = met();
    expect(allyOwnTarget(s, 'ally')).toBe('station_west');
    expect(allyActiveOp(s, 'ally')).toMatchObject({
      source: 'own',
      op: { kind: 'attack', planet: 'station_west' },
    });
    // Первую вернули — дальше вторая; обе свои — задача исчерпана, союзник держит район.
    const one: GameState = {
      ...s,
      planets: { ...s.planets, station_west: { ...s.planets.station_west!, owner: 'ally' } },
    };
    expect(allyOwnTarget(one, 'ally')).toBe('station_east');
    const both: GameState = {
      ...one,
      planets: { ...one.planets, station_east: { ...one.planets.station_east!, owner: 'ally' } },
    };
    expect(allyActiveOp(both, 'ally')).toBeNull();
  });

  it('приказ игрока важнее своей задачи', () => {
    const s = withOrder(met(), { kind: 'scout', planet: 'hive' });
    expect(allyActiveOp(s, 'ally')).toMatchObject({
      source: 'order',
      op: { kind: 'scout', planet: 'hive' },
    });
  });
});

describe('операция союзника — как выполнять', () => {
  it('разведка: у союзника один флот — сперва отделить быстрый корабль, потом лететь', () => {
    const s = withOrder(met(), { kind: 'scout', planet: 'hive' });
    const plan = planAllyOperation(s, 'ally', data);
    expect(plan).toMatchObject({
      step: 'gather',
      reason: 'detaching',
      source: 'order',
      target: 'hive',
    });
    expect(typesOf(plan.actions)).toEqual(['fleet.split']);
    // Отделили — малый флот идёт к цели.
    const split = {
      ...s,
      fleets: {
        ...s.fleets,
        ally_1: {
          ...s.fleets.ally_1!,
          units: [
            { unit: 'cruiser', count: 2 },
            { unit: 'frigate', count: 1 },
          ],
        },
        ally_s: {
          ...s.fleets.ally_1!,
          id: 'ally_s',
          units: [{ unit: 'frigate', count: 1 }],
          landing: [],
        },
      },
    };
    const go = planAllyOperation(split, 'ally', data);
    expect(go).toMatchObject({ step: 'advance', group: ['ally_s'] });
    expect(go.actions).toEqual([
      expect.objectContaining({ type: 'fleet.move', payload: { fleetId: 'ally_s', to: 'hive' } }),
    ]);
  });

  it('атака без сведений о цели — сперва разведка', () => {
    const s = withOrder(met(), { kind: 'attack', planet: 'archive' });
    expect(planAllyOperation(s, 'ally', data)).toMatchObject({
      step: 'gather',
      reason: 'scouting',
    });
  });

  it('атака видимой слабой цели — выдвижение группой; сильной — сбор, а затянувшийся сбор — «нужна помощь»', () => {
    const s = withOrder(met(), { kind: 'attack', planet: 'station_west' });
    // Цель видна союзнику (общий обзор), гарнизон мал, космоса нет — группа выходит.
    const seen = new Set(['station_west']);
    const plan = planAllyOperation(s, 'ally', data, seen);
    expect(plan.step).toBe('advance');
    expect(typesOf(plan.actions)).toContain('fleet.move');
    // У цели сильный флот Роя — сил мало: сбор у дома.
    const guarded = {
      ...s,
      fleets: {
        ...s.fleets,
        sw: {
          id: 'sw',
          owner: 'swarm',
          location: 'station_west',
          movement: null,
          units: [{ unit: 'cruiser', count: 20 }],
          traits: [],
        },
      },
    } as GameState;
    expect(planAllyOperation(guarded, 'ally', data, seen)).toMatchObject({
      step: 'gather',
      reason: 'need-ships',
    });
    const late = { ...guarded, time: guarded.time + (GATHER_LIMIT_HOURS + 1) * HOUR };
    expect(planAllyOperation(late, 'ally', data, seen)).toMatchObject({
      step: 'blocked',
      reason: 'too-strong',
    });
  });

  it('охрана: группа идёт к цели и держится у неё', () => {
    const s = withOrder(met(), { kind: 'guard', planet: 'rendezvous' });
    const go = planAllyOperation(s, 'ally', data);
    expect(go).toMatchObject({ step: 'advance', group: ['ally_1'] });
    const there = {
      ...s,
      fleets: { ...s.fleets, ally_1: { ...s.fleets.ally_1!, location: 'rendezvous' } },
    };
    expect(planAllyOperation(there, 'ally', data)).toMatchObject({
      step: 'execute',
      group: ['ally_1'],
      actions: [],
    });
  });

  it('сила — по статам, а не по числу корпусов: охранять идёт ударный флот, а не рой дронов', () => {
    const s = withOrder(met(), { kind: 'guard', planet: 'rendezvous' });
    // Шесть дронов — корпусов больше, чем у ударного флота (4), а силы втрое меньше.
    const drones = {
      ...s,
      fleets: {
        ...s.fleets,
        ally_dr: {
          id: 'ally_dr',
          owner: 'ally',
          location: 'ally_base',
          movement: null,
          units: [{ unit: 'scout_drone', count: 6 }],
          traits: [],
        },
      },
    } as GameState;
    expect(planAllyOperation(drones, 'ally', data)).toMatchObject({
      step: 'advance',
      group: ['ally_1'],
    });
  });

  it('ударная группа — все свободные флоты; дом держит гарнизон, а не флот в запасе', () => {
    const s = withOrder(met(), { kind: 'attack', planet: 'station_west' });
    const two = {
      ...s,
      fleets: {
        ...s.fleets,
        ally_2: { ...s.fleets.ally_1!, id: 'ally_2', location: 'ally_field', landing: [] },
      },
    } as GameState;
    const plan = planAllyOperation(two, 'ally', data, new Set(['station_west']));
    expect(plan.group.sort()).toEqual(['ally_1', 'ally_2']);
  });

  it('кораблей нет — «задача недоступна» с причиной, а не вечный сбор', () => {
    const s = withOrder(met(), { kind: 'guard', planet: 'rendezvous' });
    const { ally_1: _gone, ...rest } = s.fleets;
    void _gone;
    expect(planAllyOperation({ ...s, fleets: rest }, 'ally', data)).toMatchObject({
      step: 'blocked',
      reason: 'no-forces',
    });
  });

  it('решение чистое: вход не меняется, повтор даёт тот же план', () => {
    const s = withOrder(met(), { kind: 'scout', planet: 'hive' });
    const before = JSON.stringify(s);
    // Id приказа — счётчик строителя, а не часть решения: сравниваем решение без него.
    const bare = (p: ReturnType<typeof planAllyOperation>) => ({
      ...p,
      actions: p.actions.map(({ type, payload }) => ({ type, payload })),
    });
    const a = planAllyOperation(s, 'ally', data);
    expect(JSON.stringify(s)).toBe(before);
    expect(bare(planAllyOperation(s, 'ally', data))).toEqual(bare(a));
  });
});
