import { describe, it, expect } from 'vitest';
import {
  factionBonuses,
  houseNameFor,
  rivalCount,
  seatFactionIds,
  type SeatRole,
} from './setupSeats';

const HOUSES = ['azure', 'crimson', 'amber', 'violet'];

describe('сетап — раздача домов по местам', () => {
  it('ТВОЙ дом первый, остальные идут следом', () => {
    expect(seatFactionIds('amber', HOUSES, 4)).toEqual(['amber', 'azure', 'crimson', 'violet']);
  });

  it('МЕСТ БОЛЬШЕ, ЧЕМ ДОМОВ — раздача идёт по кругу', () => {
    expect(seatFactionIds('azure', HOUSES, 6)).toEqual([
      'azure',
      'crimson',
      'amber',
      'violet',
      'azure',
      'crimson',
    ]);
  });

  it('раздача ДЕТЕРМИНИРОВАНА: тот же выбор — та же расстановка', () => {
    expect(seatFactionIds('violet', HOUSES, 10)).toEqual(seatFactionIds('violet', HOUSES, 10));
  });

  it('порядок домов в данных сохраняется — экран не тасует соперников', () => {
    expect(seatFactionIds('crimson', HOUSES, 4)).toEqual(['crimson', 'azure', 'amber', 'violet']);
  });

  it('единственный дом достаётся всем местам, а не ломает раздачу', () => {
    expect(seatFactionIds('azure', ['azure'], 3)).toEqual(['azure', 'azure', 'azure']);
  });

  it('пустой список домов не роняет экран', () => {
    expect(seatFactionIds('azure', [], 3)).toEqual(['azure', 'azure', 'azure']);
  });
});

describe('сетап — имя дома на втором круге', () => {
  it('первый круг — просто имя', () => {
    expect(houseNameFor('Azure', 0, 4)).toBe('Azure');
    expect(houseNameFor('Violet', 3, 4)).toBe('Violet');
  });

  it('ВТОРОЙ КРУГ НУМЕРУЕТСЯ — иначе два места назывались бы одинаково', () => {
    expect(houseNameFor('Azure', 4, 4)).toBe('Azure 2');
    expect(houseNameFor('Crimson', 5, 4)).toBe('Crimson 2');
    expect(houseNameFor('Azure', 8, 4)).toBe('Azure 3');
  });

  it('ноль домов не делит на ноль', () => {
    expect(houseNameFor('Azure', 3, 0)).toBe('Azure 4');
  });
});

describe('сетап — бонусы дома', () => {
  it('проценты берутся из данных и округляются', () => {
    expect(factionBonuses({ productionBonus: 0.15, radarRangeBonus: 0.075 })).toEqual([
      { kind: 'economy', pct: 15 },
      { kind: 'radar', pct: 8 },
    ]);
  });

  it('порядок строк постоянный — экономика, урон, скорость, радар', () => {
    const all = factionBonuses({
      radarRangeBonus: 0.1,
      fleetSpeedBonus: 0.1,
      combatDamageBonus: 0.1,
      productionBonus: 0.1,
    });
    expect(all.map((b) => b.kind)).toEqual(['economy', 'damage', 'speed', 'radar']);
  });

  it('НУЛЕВОЙ бонус строки не занимает', () => {
    expect(factionBonuses({ productionBonus: 0, combatDamageBonus: 0.2 })).toEqual([
      { kind: 'damage', pct: 20 },
    ]);
  });

  it('дом без пассивов даёт пустой список, а не мусор', () => {
    expect(factionBonuses(undefined)).toEqual([]);
    expect(factionBonuses({})).toEqual([]);
  });

  it('отрицательный бонус показывается наравне с положительным', () => {
    expect(factionBonuses({ productionBonus: -0.25 })).toEqual([{ kind: 'economy', pct: -25 }]);
  });
});

describe('сетап — соперники', () => {
  const slots = (...r: SeatRole[]): SeatRole[] => r;

  it('место 1 — всегда ты, в соперники не идёт', () => {
    expect(rivalCount(slots('human', 'off', 'off'))).toBe(0);
    expect(rivalCount(slots('human', 'ai', 'off', 'ai'))).toBe(2);
  });

  it('ПУСТАЯ ПЕСОЧНИЦА — законный режим: ноль соперников, а не ошибка', () => {
    expect(rivalCount(slots('human'))).toBe(0);
    expect(rivalCount(slots('human', 'off', 'off', 'off'))).toBe(0);
  });

  it('выключенные места не считаются', () => {
    expect(rivalCount(slots('human', 'off', 'ai', 'off', 'ai', 'off'))).toBe(2);
  });
});
