import { describe, it, expect } from 'vitest';
import { parseCommanderXp, syncCommanderXp } from './commanderSync';

describe('опыт командующего — разбор ответа', () => {
  it('число берётся как есть, включая ноль', () => {
    expect(parseCommanderXp({ xp: 120 })).toBe(120);
    expect(parseCommanderXp({ xp: 0 })).toBe(0);
  });

  it('ЧУЖАЯ ФОРМА — ЭТО «ОТВЕТ НЕПОНЯТЕН», а не «опыта ноль»', () => {
    for (const body of [null, {}, { xp: '120' }, { xp: null }, [], 'нет']) {
      expect(parseCommanderXp(body), JSON.stringify(body)).toBeNull();
    }
  });

  it('NaN и бесконечность не считаются числом — иначе уровень станет «—»', () => {
    expect(parseCommanderXp({ xp: Number.NaN })).toBeNull();
    expect(parseCommanderXp({ xp: Number.POSITIVE_INFINITY })).toBeNull();
  });
});

describe('опыт командующего — сведение', () => {
  it('серверный итог больше — поднимаемся до него', () => {
    expect(syncCommanderXp(100, { xp: 250 })).toEqual({ xp: 250, changed: true });
  });

  it('ОПЫТ НЕ ПАДАЕТ: устройство уже начислило награду, сервер её ещё не зачёл', () => {
    expect(syncCommanderXp(300, { xp: 250 })).toEqual({ xp: 300, changed: false });
  });

  it('равные числа ничего не меняют — панель не дёргается впустую', () => {
    expect(syncCommanderXp(250, { xp: 250 })).toEqual({ xp: 250, changed: false });
  });

  it('НЕПОНЯТНЫЙ ОТВЕТ ОСТАВЛЯЕТ МЕСТНОЕ ЧИСЛО, а не обнуляет прогресс', () => {
    expect(syncCommanderXp(300, null)).toEqual({ xp: 300, changed: false });
    expect(syncCommanderXp(300, { xp: 'много' })).toEqual({ xp: 300, changed: false });
    expect(syncCommanderXp(300, {})).toEqual({ xp: 300, changed: false });
  });

  it('свежий командующий с нулём поднимается серверным итогом', () => {
    expect(syncCommanderXp(0, { xp: 40 })).toEqual({ xp: 40, changed: true });
  });

  it('нулевой ответ сервера не откатывает накопленное', () => {
    expect(syncCommanderXp(40, { xp: 0 })).toEqual({ xp: 40, changed: false });
  });
});
