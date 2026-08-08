import { describe, it, expect } from 'vitest';
import { arrivalHours, marchHours, restRouteHours } from './travelEta';

const MULT = 1.5; // форс-марш прототипа
const ЧАС = 3600_000;

describe('время в пути — остаток маршрута за текущим лейном', () => {
  it('БУСТ УСКОРЯЕТ ТОЛЬКО ОСТАТОК: он ещё не расписан сервером', () => {
    expect(restRouteHours(3, true, MULT)).toBe(2);
    expect(restRouteHours(3, false, MULT)).toBe(3);
  });

  it('ВЫКЛЮЧИЛ БУСТ — ОЦЕНКА ЧЕСТНО УДЛИНЯЕТСЯ, а не остаётся ускоренной', () => {
    expect(restRouteHours(3, false, MULT)).toBeGreaterThan(restRouteHours(3, true, MULT));
  });

  it('летим прямо в конечную — остатка нет', () => {
    expect(restRouteHours(0, true, MULT)).toBe(0);
  });

  it('маршрута за лейном нет — добавлять нечего', () => {
    expect(restRouteHours(null, true, MULT)).toBe(0);
  });
});

describe('время в пути — до конца перелёта', () => {
  it('ТЕКУЩИЙ ЛЕЙН БЕРЁТСЯ ИЗ РАСПИСАНИЯ: клиент не ускоряет то, что сервер уже обещал', () => {
    const now = 1000 * ЧАС;
    // два часа по авторитетному arrivesAt — буст на них не влияет вовсе
    expect(arrivalHours(now + 2 * ЧАС, now, ЧАС, 0)).toBe(2);
  });

  it('к прибытию прибавляется остаток маршрута', () => {
    const now = 0;
    expect(arrivalHours(2 * ЧАС, now, ЧАС, 3)).toBe(5);
  });

  it('ОЖИДАНИЕ НЕ БЫВАЕТ ОТРИЦАТЕЛЬНЫМ: кадр мог отстать от расписания', () => {
    expect(arrivalHours(-5 * ЧАС, 0, ЧАС, 0)).toBe(0);
    expect(arrivalHours(-5 * ЧАС, 0, ЧАС, 2)).toBe(2); // остаток при этом не съедается
  });

  it('уже прибыл ровно сейчас — ноль', () => {
    expect(arrivalHours(0, 0, ЧАС, 0)).toBe(0);
  });
});

describe('время в пути — оценка перелёта', () => {
  it('буст ускоряет оценку', () => {
    expect(marchHours(6, true, MULT)).toBe(4);
    expect(marchHours(6, false, MULT)).toBe(6);
  });

  it('«НЕ ЗНАЮ» — ЭТО НЕ «МГНОВЕННО»: недостижимая цель не притворяется соседней', () => {
    expect(marchHours(null, true, MULT)).toBeNull();
    expect(marchHours(null, false, MULT)).toBeNull();
  });

  it('нулевой перелёт остаётся нулевым при любом бусте', () => {
    expect(marchHours(0, true, MULT)).toBe(0);
  });
});
