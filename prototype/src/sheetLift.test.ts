import { describe, it, expect } from 'vitest';
import { SHEET_HIDDEN, SHEET_TARGET, liftBy, opensNow } from './sheetLift';

const VH = 800;

describe('лист — когда вообще двигать камеру', () => {
  it('открылся прямо сейчас на телефоне — двигаем', () => {
    expect(opensNow(true, false, true)).toBe(true);
  });

  it('УЖЕ ОТКРЫТЫЙ ЛИСТ КАМЕРУ НЕ ТЯНЕТ: renderPanel гоняется каждый кадр', () => {
    expect(opensNow(true, true, true)).toBe(false);
  });

  it('НА ПК НЕ ДВИГАЕМ: там панель сбоку и карту не закрывает', () => {
    expect(opensNow(true, false, false)).toBe(false);
  });

  it('закрытие листа камеру не трогает', () => {
    expect(opensNow(false, true, true)).toBe(false);
    expect(opensNow(false, false, true)).toBe(false);
  });
});

describe('лист — на сколько поднять', () => {
  it('объект под листом поднимается в верхнюю половину', () => {
    expect(liftBy(VH * 0.8, VH)).toBeCloseTo(VH * 0.8 - VH * SHEET_TARGET);
  });

  it('ОБЪЕКТ ВЫШЕ ПОРОГА НЕ ТРОГАЕМ: он и так виден, а рывок сбивает', () => {
    expect(liftBy(VH * 0.1, VH)).toBe(0);
    expect(liftBy(0, VH)).toBe(0);
  });

  it('ровно на пороге — ещё не двигаем', () => {
    expect(liftBy(VH * SHEET_HIDDEN, VH)).toBe(0);
  });

  it('чуть ниже порога — уже двигаем, и подъём всегда положительный', () => {
    expect(liftBy(VH * SHEET_HIDDEN + 1, VH)).toBeGreaterThan(0);
  });

  it('НЕТ ЯКОРЯ — НЕТ ДВИЖЕНИЯ: флот без места на карте камеру не уводит', () => {
    expect(liftBy(null, VH)).toBe(0);
  });

  it('ПОРОГ СЧИТАЕТСЯ ОТ ВЫСОТЫ ЭКРАНА, А НЕ В ПИКСЕЛЯХ', () => {
    // одна и та же доля высоты ведёт себя одинаково на разных экранах
    expect(liftBy(400 * 0.8, 400)).toBeCloseTo(400 * 0.8 - 400 * SHEET_TARGET);
    expect(liftBy(400 * 0.8, VH)).toBe(0); // та же точка на длинном экране уже над порогом
  });
});
