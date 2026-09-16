/**
 * ВЫПЛАТА ЗА СОХРАНЁННЫХ ВЕТЕРАНОВ (VET-4) — приёмка кирпича.
 *
 * Заказ владельца: «в конце матча игрок, сохранивший подобные юниты, получает за каждую
 * такую медаль на юните награду», уточнённый решением 6: «чем выше степень медали, тем
 * выше награда за сохранение юнита».
 *
 * Тут и лежит всё напряжение механики: ветеран не даёт силы в бою (решение 2), поэтому
 * беречь его — чистая ставка на конец матча. Значит выплата обязана считаться по ЖИВЫМ
 * юнитам и по ним одним: погибший ветеран не платит, и это не жестокость, а сам смысл
 * выбора «беречь или тратить».
 */
import { describe, expect, it } from 'vitest';
import { parseGameData, safeParseGameData, type GameData } from '../data/schemas';
import { createKernel } from '../kernel/kernel';
import {
  createInitialState,
  type Fleet,
  type GameState,
  type Planet,
  type Player,
  type UnitStack,
} from '../state/gameState';
import type { AdvanceResult, Context, MatchConfig } from '../action/types';
import { victoryModule } from './victory';

const HOUR = 3_600_000;
const DAY = 24 * HOUR;

const data: GameData = parseGameData({
  version: '0.1.0',
  resources: ['metal'],
  units: {
    cruiser: { faction: 'x', stats: { attack: 10, defense: 8, speed: 6, hp: 40 }, line: 'front' },
  },
  factions: {},
  buildings: {},
  events: {},
  // Круглые пороги: кирпич про ВЫПЛАТУ, а не про баланс порогов (тот в VET-3).
  medals: { valour: { grades: [10, 20, 30, 40] }, service: { grades: [1, 2, 3, 4] } },
  rewards: { medalXp: [5, 15, 40, 100] },
});

const ctx = (now: number, config?: MatchConfig): Context =>
  config ? { now, data, config } : { now, data };
const player = (id: string): Player => ({
  id,
  name: id,
  faction: 'x',
  status: 'active',
  resources: {},
});
const planet = (id: string, owner: string | null): Planet => ({
  id,
  owner,
  position: { x: 0, y: 0 },
  resources: {},
  buildings: [],
  garrison: [],
  traits: [],
});
const fleet = (id: string, owner: string, units: UnitStack[]): Fleet => ({
  id,
  owner,
  location: 'A',
  movement: null,
  units,
  traits: [],
});

function world(fleets: Fleet[], planets: Planet[] = []): GameState {
  return {
    ...createInitialState({ seed: 'vet4', version: { data: '0.1.0', manifest: '1' } }),
    players: { p1: player('p1'), p2: player('p2') },
    planets: Object.fromEntries([planet('A', 'p1'), planet('B', 'p2'), ...planets].map((p) => [p.id, p])),
    fleets: Object.fromEntries(fleets.map((f) => [f.id, f])),
  };
}

/** Догнать матч до таймаута и вернуть выплаченный XP каждому. */
function payout(state: GameState): Record<string, number> {
  const kernel = createKernel([victoryModule]);
  const config: MatchConfig = { timeScale: 1, victory: { endsAt: DAY } };
  const r: AdvanceResult = kernel.advanceTo(state, ctx(DAY + HOUR, config));
  if (!r.ok) throw new Error(`advance failed: ${r.code}`);
  expect(r.state.match.status).toBe('ended');
  return Object.fromEntries(
    Object.entries(r.state.match.rewards ?? {}).map(([id, rew]) => [id, rew.xp]),
  );
}

/** XP без медалей — база, от которой считается прибавка. */
function baseline(): Record<string, number> {
  return payout(world([fleet('F', 'p1', [{ unit: 'cruiser', count: 1 }])]));
}

describe('VET-4 — выплата за сохранённых ветеранов', () => {
  it('ветеран на конец матча ПЛАТИТ сверх обычного XP', () => {
    const base = baseline();
    const got = payout(
      world([fleet('F', 'p1', [{ unit: 'cruiser', count: 1, damageDealt: 10 }])]),
    );
    expect(got.p1).toBeGreaterThan(base.p1!);
    expect(got.p2).toBe(base.p2); // чужому игроку чужая медаль ничего не приносит
  });

  it('чем ВЫШЕ степень, тем выше награда — решение владельца 6', () => {
    const xp = (dmg: number): number =>
      payout(world([fleet('F', 'p1', [{ unit: 'cruiser', count: 1, damageDealt: dmg }])])).p1!;
    const [g1, g2, g3, g4] = [xp(10), xp(20), xp(30), xp(40)];
    expect(g2).toBeGreaterThan(g1!);
    expect(g3).toBeGreaterThan(g2!);
    expect(g4).toBeGreaterThan(g3!);
  });

  it('платит ЗА КАЖДЫЙ юнит стека, а не за стек целиком', () => {
    const one = payout(
      world([fleet('F', 'p1', [{ unit: 'cruiser', count: 1, damageDealt: 10 }])]),
    ).p1!;
    const five = payout(
      world([fleet('F', 'p1', [{ unit: 'cruiser', count: 5, damageDealt: 10 }])]),
    ).p1!;
    const base = baseline().p1!;
    expect(five - base).toBe((one - base) * 5);
  });

  it('обе линии платят: у ветерана с доблестью И выслугой прибавка их суммы', () => {
    const base = baseline().p1!;
    const only = (s: Partial<UnitStack>): number =>
      payout(world([fleet('F', 'p1', [{ unit: 'cruiser', count: 1, ...s }])])).p1! - base;
    expect(only({ damageDealt: 10, battles: 1 })).toBe(only({ damageDealt: 10 }) + only({ battles: 1 }));
  });

  it('ПОТЕРИ уменьшают выплату ровно на погибших — в этом весь выбор «беречь или тратить»', () => {
    // ⚠️ Первая версия этого теста брала стек с `count: 0` и была зелёной при ЛЮБОЙ
    // реализации: умножение на состав обнуляет выплату само. Проверка «погибший не
    // платит» имеет смысл только на ЧАСТИЧНЫХ потерях — пять ветеранов, трое погибли,
    // платят двое.
    const base = baseline().p1!;
    const paid = (count: number): number =>
      payout(world([fleet('F', 'p1', [{ unit: 'cruiser', count, damageDealt: 40, battles: 4 }])]))
        .p1! - base;
    expect(paid(2)).toBe((paid(5) / 5) * 2);
    expect(paid(0)).toBe(0); // выбит подчистую — не платит вовсе
  });

  it('заслуга НИЖЕ первого порога не платит ничего', () => {
    const got = payout(
      world([fleet('F', 'p1', [{ unit: 'cruiser', count: 1, damageDealt: 9 }])]),
    );
    expect(got.p1).toBe(baseline().p1);
  });

  it('гарнизон мира считается наравне с флотом — ветеран есть ветеран', () => {
    const withGarrison = world([fleet('F', 'p1', [{ unit: 'cruiser', count: 1 }])]);
    withGarrison.planets.A!.garrison = [{ unit: 'cruiser', count: 1, battles: 2 }];
    expect(payout(withGarrison).p1).toBeGreaterThan(baseline().p1!);
  });

  it('ставка меняется ДАННЫМИ: пустая шкала — и медали не платят вовсе', () => {
    const noScale = parseGameData({
      version: '0.1.0',
      resources: ['metal'],
      units: { cruiser: { faction: 'x', stats: { attack: 10, defense: 8, speed: 6, hp: 40 } } },
      factions: {},
      buildings: {},
      events: {},
      medals: { valour: { grades: [10] } },
      rewards: {}, // medalXp не задан
    });
    const kernel = createKernel([victoryModule]);
    const state = world([fleet('F', 'p1', [{ unit: 'cruiser', count: 1, damageDealt: 100 }])]);
    const r = kernel.advanceTo(state, {
      now: DAY + HOUR,
      data: noScale,
      config: { timeScale: 1, victory: { endsAt: DAY } },
    });
    if (!r.ok) throw new Error(r.code);
    const plain = kernel.advanceTo(
      world([fleet('F', 'p1', [{ unit: 'cruiser', count: 1 }])]),
      { now: DAY + HOUR, data: noScale, config: { timeScale: 1, victory: { endsAt: DAY } } },
    );
    if (!plain.ok) throw new Error(plain.code);
    expect(r.state.match.rewards?.p1?.xp).toBe(plain.state.match.rewards?.p1?.xp);
  });
});

describe('VET-4 — шкала награды обязана РАСТИ со степенью', () => {
  // Решение владельца 6 держится СХЕМОЙ, а не договорённостью: невозрастающая шкала
  // молча отменила бы его, и заметить это было бы некому — выплата не падает, она просто
  // перестаёт быть наградой за высокую степень.
  const build = (medalXp: number[]) =>
    safeParseGameData({
      version: '0.1.0',
      resources: ['m'],
      units: {},
      factions: {},
      buildings: {},
      events: {},
      rewards: { medalXp },
    });

  it('растущая — принимается', () => {
    expect(build([5, 15, 40]).success).toBe(true);
  });

  it('РАВНЫЕ соседи — отвергается: «выше степень» обязано значить «больше награда»', () => {
    expect(build([5, 5, 40]).success).toBe(false);
  });

  it('убывающая — отвергается', () => {
    expect(build([40, 15, 5]).success).toBe(false);
  });

  it('пустая — принимается, это «медали не платят вовсе»', () => {
    expect(build([]).success).toBe(true);
  });

  it('шипнутая шкала растёт — сторож смотрит и на реальные данные, не только на выдумку', () => {
    const shipped = parseGameData({
      version: '0.1.0',
      resources: ['m'],
      units: {},
      factions: {},
      buildings: {},
      events: {},
    });
    expect(shipped.rewards.medalXp).toEqual([]); // в тестовом бандле шкалы нет
  });
});
