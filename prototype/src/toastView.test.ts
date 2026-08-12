import { describe, it, expect } from 'vitest';
import {
  TOAST_FADE_MS,
  TOAST_LIFE_MS,
  TOAST_MAX,
  toastClass,
  toastOverflow,
  toastText,
} from './toastView';

describe('тост — вид и текст', () => {
  it('обычный тост — просто сообщение', () => {
    expect(toastClass(false)).toBe('toast');
    expect(toastText('трюм полон', false)).toBe('трюм полон');
  });

  it('ТОСТ С ЯКОРЕМ ПОМЕЧЕН СТРЕЛКОЙ: он обещает переход к месту события', () => {
    expect(toastText('бой у C2R1', true)).toBe('бой у C2R1 ↪');
  });

  it('и выглядит кликабельным', () => {
    expect(toastClass(true)).toBe('toast jump');
  });

  it('пустое сообщение с якорем всё равно получает стрелку', () => {
    expect(toastText('', true)).toBe(' ↪');
  });
});

describe('тост — предел стопки', () => {
  it('НЕ БОЛЬШЕ ТРЁХ РАЗОМ: стопка выше перекрыла бы карту', () => {
    expect(TOAST_MAX).toBe(3);
    expect(toastOverflow(3)).toBe(0);
  });

  it('четвёртый вытесняет самый старый', () => {
    expect(toastOverflow(4)).toBe(1);
  });

  it('пачка сразу вытесняет столько, сколько нужно', () => {
    expect(toastOverflow(7)).toBe(4);
  });

  it('меньше предела — снимать нечего, и счётчик не уходит в минус', () => {
    expect(toastOverflow(0)).toBe(0);
    expect(toastOverflow(1)).toBe(0);
  });
});

describe('тост — время жизни', () => {
  it('ЖИВЁТ ОКОЛО ПЯТИ СЕКУНД И УХОДИТ САМ', () => {
    expect(TOAST_LIFE_MS).toBeGreaterThan(4000);
    expect(TOAST_LIFE_MS).toBeLessThan(7000);
  });

  it('затухание заметно короче самой жизни — это уход, а не вторая пауза', () => {
    expect(TOAST_FADE_MS).toBeGreaterThan(0);
    expect(TOAST_FADE_MS).toBeLessThan(TOAST_LIFE_MS / 4);
  });
});
