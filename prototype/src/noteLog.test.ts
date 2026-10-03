import { describe, it, expect } from 'vitest';
import { EVENT_LOG_MAX, LOG_LINES, isRepeat, pushBounded } from './noteLog';

describe('журнал — защита от повторов', () => {
  it('ДОСЛОВНЫЙ ПОВТОР ГЛУШИТСЯ: отскок каждый кадр не строчит пулемётом', () => {
    expect(isRepeat('нет места', 'нет места', 1500, 0)).toBe(true);
  });

  it('после окна тот же текст снова проходит', () => {
    expect(isRepeat('нет места', 'нет места', 2000, 0)).toBe(false);
    expect(isRepeat('нет места', 'нет места', 5000, 0)).toBe(false);
  });

  it('ГЛУШИТСЯ ТОЛЬКО ТОТ ЖЕ ТЕКСТ: другое событие молчать не должно', () => {
    expect(isRepeat('нет топлива', 'нет места', 10, 0)).toBe(false);
  });

  it('первое сообщение сессии повтором не считается', () => {
    expect(isRepeat('старт', '', 0, 0)).toBe(false);
  });

  it('окно настраивается и меряется в тех же единицах', () => {
    expect(isRepeat('x', 'x', 900, 0, 1000)).toBe(true);
    expect(isRepeat('x', 'x', 1100, 0, 1000)).toBe(false);
  });
});

describe('журнал — пределы лент', () => {
  it('экранная лента режется с ГОЛОВЫ: на виду последнее', () => {
    const строки: number[] = [];
    for (let i = 0; i < LOG_LINES + 4; i++) pushBounded(строки, i, LOG_LINES);
    expect(строки).toHaveLength(LOG_LINES);
    expect(строки[0]).toBe(4);
    expect(строки[строки.length - 1]).toBe(LOG_LINES + 3);
  });

  it('память событий держит больше экрана — дайджест читает длиннее', () => {
    expect(EVENT_LOG_MAX).toBeGreaterThan(LOG_LINES);
    const лента: number[] = [];
    for (let i = 0; i < EVENT_LOG_MAX + 2; i++) pushBounded(лента, i, EVENT_LOG_MAX);
    expect(лента).toHaveLength(EVENT_LOG_MAX);
    expect(лента[0]).toBe(2);
  });

  it('лента короче предела не режется', () => {
    const л: string[] = [];
    pushBounded(л, 'а', 5);
    pushBounded(л, 'б', 5);
    expect(л).toEqual(['а', 'б']);
  });
});
