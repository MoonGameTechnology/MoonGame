import { describe, it, expect } from 'vitest';
import { longPressAction, pressIntent, type PressInput } from './pressIntent';

const press = (over: Partial<PressInput> = {}): PressInput => ({
  touch: false,
  shift: false,
  ctrl: false,
  meta: false,
  overOwnFleet: false,
  orderArmed: false,
  ...over,
});

describe('нажатие — добор к выбору', () => {
  it('обычное нажатие заменяет выбор, а не добирает', () => {
    expect(pressIntent(press()).additive).toBe(false);
  });

  it('CTRL И ⌘ РАВНОПРАВНЫ — иначе на половине клавиатур добор молча не работает', () => {
    expect(pressIntent(press({ ctrl: true })).additive).toBe(true);
    expect(pressIntent(press({ meta: true })).additive).toBe(true);
  });

  it('Shift тоже добирает — привычка RTS', () => {
    expect(pressIntent(press({ shift: true })).additive).toBe(true);
  });
});

describe('нажатие — рамка выделения', () => {
  it('рамку открывает Shift над ПУСТЫМ местом', () => {
    expect(pressIntent(press({ shift: true })).boxSelect).toBe(true);
  });

  it('SHIFT НАД СВОИМ ФЛОТОМ — ЭТО ДОБОР, А НЕ РАМКА: резинка съела бы клик', () => {
    const intent = pressIntent(press({ shift: true, overOwnFleet: true }));
    expect(intent.boxSelect).toBe(false);
    expect(intent.additive).toBe(true);
  });

  it('Ctrl и ⌘ рамку не открывают — они только добирают', () => {
    expect(pressIntent(press({ ctrl: true })).boxSelect).toBe(false);
    expect(pressIntent(press({ meta: true })).boxSelect).toBe(false);
  });

  it('без модификаторов рамки нет', () => {
    expect(pressIntent(press()).boxSelect).toBe(false);
  });
});

describe('нажатие — удержание', () => {
  it('УДЕРЖАНИЕ — ТОЛЬКО ДЛЯ ПАЛЬЦА: у мыши для этого есть Ctrl и Shift', () => {
    expect(pressIntent(press({ touch: true })).longPress).toBe(true);
    expect(pressIntent(press({ touch: false })).longPress).toBe(false);
  });

  it('ПРИ ВООРУЖЁННОМ ПРИКАЗЕ УДЕРЖАНИЯ НЕТ — тапы принадлежат прицелу', () => {
    expect(pressIntent(press({ touch: true, orderArmed: true })).longPress).toBe(false);
  });

  it('вооружённый приказ не мешает добору и рамке — они про мышь', () => {
    const intent = pressIntent(press({ shift: true, orderArmed: true }));
    expect(intent.additive).toBe(true);
    expect(intent.boxSelect).toBe(true);
  });

  it('что сделает удержание, решает то, что под пальцем', () => {
    expect(longPressAction(true)).toBe('toggle-fleet');
    expect(longPressAction(false)).toBe('box-select');
  });
});
