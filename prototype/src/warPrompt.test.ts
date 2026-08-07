import { describe, it, expect } from 'vitest';
import {
  assaultMovers,
  assaultTargetBlocker,
  collectBlockers,
  moveMovers,
  type FleetLike,
} from './warPrompt';

const fleet = (id: string, location: string | null): FleetLike => ({ id, location });

describe('окно войны — кто участвует в приказе', () => {
  it('ХОД В МИР, ГДЕ ФЛОТ УЖЕ СТОИТ, — НЕ ХОД: иначе войну объявят ради ничего', () => {
    const fleets = [fleet('f1', 'A'), fleet('f2', 'B'), fleet('f3', 'A')];
    expect(moveMovers(fleets, 'A')).toEqual(['f2']);
  });

  it('флот в пути считается летящим — он не «уже там»', () => {
    expect(moveMovers([fleet('f1', null)], 'A')).toEqual(['f1']);
  });

  it('никто не летит — пустой список, а не приказ впустую', () => {
    expect(moveMovers([fleet('f1', 'A')], 'A')).toEqual([]);
  });

  it('ШТУРМ — НЕ ХОД: стоящий у цели штурмует С МЕСТА и остаётся в приказе', () => {
    const fleets = [fleet('f1', 'A'), fleet('f2', 'B')];
    expect(assaultMovers(fleets)).toEqual(['f1', 'f2']);
  });

  it('порядок флотов сохраняется — приказ уходит в том же порядке, что выбран', () => {
    expect(moveMovers([fleet('b', 'X'), fleet('a', 'Y')], 'Z')).toEqual(['b', 'a']);
  });
});

describe('окно войны — кого назвать виновником', () => {
  it('ПЯТЬ ФЛОТОВ В ОДНОГО СОСЕДА — ОДНО ОБЪЯВЛЕНИЕ, а не пять строк', () => {
    const ids = ['f1', 'f2', 'f3', 'f4', 'f5'];
    expect(collectBlockers(ids, () => ['azure'])).toEqual(['azure']);
  });

  it('виновники собираются со ВСЕХ флотов, а не с первого', () => {
    const per: Record<string, string[]> = { f1: ['azure'], f2: ['crimson'], f3: [] };
    expect(collectBlockers(['f1', 'f2', 'f3'], (id) => per[id] ?? [])).toEqual([
      'azure',
      'crimson',
    ]);
  });

  it('ПОРЯДОК СТАБИЛЕН — текст окна не пляшет между открытиями', () => {
    const per: Record<string, string[]> = { f1: ['violet', 'amber'], f2: ['amber', 'violet'] };
    expect(collectBlockers(['f1', 'f2'], (id) => per[id] ?? [])).toEqual(['violet', 'amber']);
  });

  it('все проходят — виновников нет, окно не нужно', () => {
    expect(collectBlockers(['f1', 'f2'], () => [])).toEqual([]);
  });

  it('пустой приказ виновников не порождает', () => {
    expect(collectBlockers([], () => ['azure'])).toEqual([]);
  });
});

describe('окно войны — собственный виновник штурма', () => {
  // проход открыт только к тому, с кем уже воюем
  const freePassage = (owner: string): boolean => owner === 'enemy';

  it('ВЫСАДКА НА МИР НЕВРАЖДЕБНОГО — ЭТО ВОЙНА, даже когда маршрут свободен', () => {
    expect(assaultTargetBlocker('azure', 'me', freePassage)).toBe('azure');
  });

  it('мир врага штурмуют без объявления — война уже идёт', () => {
    expect(assaultTargetBlocker('enemy', 'me', freePassage)).toBeNull();
  });

  it('свой мир виновником не делает', () => {
    expect(assaultTargetBlocker('me', 'me', freePassage)).toBeNull();
  });

  it('ничейный мир — не чей-то, объявлять некому', () => {
    expect(assaultTargetBlocker(null, 'me', freePassage)).toBeNull();
    expect(assaultTargetBlocker(undefined, 'me', freePassage)).toBeNull();
  });
});
