import { describe, it, expect, beforeAll } from 'vitest';
import { setLocale } from '../../localization/runtime';
import {
  factionBonuses,
  houseDisplayName,
  houseNameFor,
  rivalCount,
  seatFactionIds,
  type SeatRole,
} from './setupSeats';

const HOUSES = ['azure', 'crimson', 'amber', 'violet'];

// REFM-14: локаль прибита к RU (Node не сообщает язык браузера, рантайм ушёл бы в EN
// и утверждения про русские имена домов разъехались бы).
beforeAll(() => setLocale('ru'));

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

describe('сетап — имя дома на экране игрока', () => {
  it('имя ДАННЫХ переводится: русский игрок не читает «Azure Compact»', () => {
    expect(houseDisplayName('Azure Compact')).toBe('Лазурный пакт');
    expect(houseDisplayName('The Swarm')).toBe('Рой');
  });

  it('НОМЕР КРУГА не мешает переводу — переводится база, номер остаётся рядом', () => {
    // Слаг `data.azurecompact2` не существует, поэтому `tData()` целиком промахнулся бы
    // и отдал английское имя — номер надо отделить ДО поиска ключа.
    expect(houseDisplayName('Crimson Hegemony 2')).toBe('Багровая гегемония 2');
  });

  it('ПОЗЫВНОЙ живого игрока проходит насквозь — его переводить нельзя', () => {
    expect(houseDisplayName('Вульфакс')).toBe('Вульфакс');
    expect(houseDisplayName('Nomad 7')).toBe('Nomad 7');
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
