import { describe, it, expect } from 'vitest';
import { parseGameData, type GameData } from '../data/schemas';
import type { UnitStack } from '../state/gameState';
import {
  classShares,
  hasGroundTargets,
  splitDealt,
  statVs,
  targetClassOf,
  targetedVolley,
} from './groundTargets';
import { damageByClass } from './combat';
import { COMBAT_UNIT_CAP } from './stacks';

const data: GameData = parseGameData({
  version: '0.1.0',
  resources: ['metal'],
  units: {
    ship: { faction: 'x', stats: { attack: 7, defense: 3, speed: 1, hp: 10 } },
    tank: {
      faction: 'x',
      domain: 'ground',
      kind: 'vehicle',
      stats: {
        attack: 20,
        defense: 10,
        attackVsInfantry: 20,
        attackVsVehicle: 2,
        defenseVsInfantry: 10,
        defenseVsVehicle: 1,
        speed: 1,
        hp: 30,
      },
    },
    rifle: {
      faction: 'x',
      domain: 'ground',
      kind: 'infantry',
      stats: { attack: 4, defense: 4, attackVsVehicle: 12, speed: 1, hp: 10 },
    },
  },
  factions: {},
  buildings: {},
  events: {},
});
const st = (list: Array<[string, number]>): UnitStack[] =>
  list.map(([unit, count]) => ({ unit, count }));

describe('урон по роду войск — чистое правило', () => {
  it('класс цели: наземный — его род, остальное — other', () => {
    expect(targetClassOf(data.units.tank)).toBe('vehicle');
    expect(targetClassOf(data.units.rifle)).toBe('infantry');
    expect(targetClassOf(data.units.ship)).toBe('other');
    expect(targetClassOf(undefined)).toBe('other');
  });

  it('не объявленное число — прежний стат', () => {
    const rifle = data.units.rifle!.stats as Record<string, number>;
    expect(statVs(rifle, 'attack', 'vehicle')).toBe(12);
    expect(statVs(rifle, 'attack', 'infantry')).toBe(4);
    expect(statVs(rifle, 'defense', 'vehicle')).toBe(4);
    expect(statVs(rifle, 'attack', 'other')).toBe(4);
  });

  it('доли — по пулу корпуса, а не по числу машин', () => {
    // 1 танк (30) + 3 стрелка (30): поровну, хотя машин вчетверо меньше.
    const shares = classShares(
      st([
        ['tank', 1],
        ['rifle', 3],
      ]),
      data,
    );
    expect(shares.vehicle).toBeCloseTo(0.5, 12);
    expect(shares.infantry).toBeCloseTo(0.5, 12);
    expect(shares.other).toBe(0);
  });

  it('залп по флоту — прежний залп, бит в бит', () => {
    const shot = targetedVolley(
      st([
        ['tank', 2],
        ['ship', 3],
      ]),
      st([['ship', 1]]),
      data,
      'attack',
    );
    expect(shot.total).toBe(2 * 20 + 3 * 7);
    expect(shot.pools).toEqual({ infantry: 0, vehicle: 0, other: 61 });
    expect(hasGroundTargets(st([['ship', 1]]), data)).toBe(false);
  });

  it('разложение по классам — точное разложение залпа', () => {
    const shot = targetedVolley(
      st([
        ['tank', 3],
        ['rifle', 5],
      ]),
      st([
        ['tank', 1],
        ['rifle', 3],
      ]),
      data,
      'attack',
    );
    expect(shot.pools.infantry + shot.pools.vehicle).toBeCloseTo(shot.total, 9);
    // Против брони стрелок (12) полезнее танка (2), против пехоты — наоборот.
    expect(shot.pools.infantry).toBeCloseTo(0.5 * (3 * 20 + 5 * 4), 9);
    expect(shot.pools.vehicle).toBeCloseTo(0.5 * (3 * 2 + 5 * 12), 9);
  });

  it('кап линии огня выбирает стрелков по урону против ЭТОГО состава', () => {
    const shooters = st([
      ['tank', COMBAT_UNIT_CAP],
      ['rifle', COMBAT_UNIT_CAP],
    ]);
    expect(targetedVolley(shooters, st([['tank', 1]]), data, 'attack').total).toBe(
      COMBAT_UNIT_CAP * 12,
    );
    expect(targetedVolley(shooters, st([['rifle', 1]]), data, 'attack').total).toBe(
      COMBAT_UNIT_CAP * 20,
    );
  });

  it('splitDealt не теряет и не чеканит урон, а один класс получает его ровно', () => {
    const one = splitDealt({ infantry: 0, vehicle: 0, other: 5 }, 5, 7.3);
    expect(one.other).toBe(7.3);
    const two = splitDealt({ infantry: 1, vehicle: 2, other: 0 }, 3, 10);
    expect(two.infantry + two.vehicle).toBe(10);
    expect(two.infantry).toBeCloseTo(10 / 3, 12);
    expect(splitDealt({ infantry: 0, vehicle: 0, other: 0 }, 0, 5)).toEqual({
      infantry: 0,
      vehicle: 0,
      other: 0,
    });
  });

  it('урон ложится только на свой род', () => {
    const units = st([
      ['tank', 2],
      ['rifle', 2],
    ]);
    const { survivors, deaths } = damageByClass(
      units,
      { infantry: 10, vehicle: 0, other: 0 },
      data,
    );
    expect(deaths).toEqual([{ unit: 'rifle', count: 1 }]);
    expect(survivors.find((s) => s.unit === 'tank')?.count).toBe(2);
    expect(survivors.find((s) => s.unit === 'tank')?.hp).toBeUndefined();
  });
});
