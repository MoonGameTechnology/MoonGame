import { describe, expect, it } from 'vitest';
import { SEAT_PIPS_MAX, filterControls, seatPips, tabCounts } from './matchesPage';

describe('числа на вкладках «Матчей»', () => {
  const lists = { available: [1, 2, 3, 4, 5], active: [1, 2], archived: [] };

  it('ЧИСЛО — СКОЛЬКО СТРОК ПОКАЖЕТ ВКЛАДКА: у «Доступных» — после фильтра', () => {
    expect(tabCounts(lists, 3)).toEqual({ available: 3, active: 2, archived: 0 });
  });

  it('ленты нет — чисел нет: «0» значило бы «пусто», а сервер мог не ответить', () => {
    expect(tabCounts(null, 0)).toEqual({ available: null, active: null, archived: null });
  });

  it('вкладки, которой сервер не прислал, — ноль, а не пропуск', () => {
    expect(tabCounts({ available: [1] }, 1)).toEqual({ available: 1, active: 0, archived: 0 });
  });
});

describe('места в строке матча', () => {
  it('МЕСТА ТОЧКАМИ: занятые впереди, свободные за ними', () => {
    expect(seatPips(1, 4)).toEqual([true, false, false, false]);
    expect(seatPips(4, 4)).toEqual([true, true, true, true]);
    expect(seatPips(0, 2)).toEqual([false, false]);
  });

  it('больше восьми мест — только число: 20 и 50 точек не читаются', () => {
    expect(seatPips(3, SEAT_PIPS_MAX)).toHaveLength(SEAT_PIPS_MAX);
    expect(seatPips(3, 20)).toBeNull();
    expect(seatPips(12, 50)).toBeNull();
  });

  it('занятых не больше, чем кресел, и не меньше нуля; кривая вместимость — без точек', () => {
    expect(seatPips(9, 4)).toEqual([true, true, true, true]);
    expect(seatPips(-1, 2)).toEqual([false, false]);
    expect(seatPips(1, 0)).toBeNull();
    expect(seatPips(1, 2.5)).toBeNull();
  });
});

describe('какие контролы фильтра нужны', () => {
  const лента = { maps: 3, players: { min: 2, max: 6 }, kinds: true };

  it('есть из чего выбирать — все три контрола и панель', () => {
    expect(filterControls(лента)).toEqual({ mode: true, maps: true, players: true, any: true });
  });

  it('КОНТРОЛ БЕЗ ВЫБОРА НЕ ПОКАЗЫВАЕТСЯ: одна карта, одна вместимость, ни одного вида', () => {
    expect(filterControls({ ...лента, maps: 1 }).maps).toBe(false);
    expect(filterControls({ ...лента, players: { min: 4, max: 4 } }).players).toBe(false);
    expect(filterControls({ ...лента, kinds: false }).mode).toBe(false);
  });

  it('нет ни одного контрола — нет и панели', () => {
    expect(filterControls({ maps: 1, players: { min: 2, max: 2 }, kinds: false })).toEqual({
      mode: false,
      maps: false,
      players: false,
      any: false,
    });
  });
});
