import { describe, expect, it } from 'vitest';
import { lessonWaits } from './lessonPace';

const wait = { target: null, advance: { on: 'state' } };

describe('lessonWaits (темп урока)', () => {
  it('шаг без цели, который засчитывает мир, — ожидание', () => {
    expect(lessonWaits(wait)).toBe(true);
  });

  it('кнопка, точка карты и строка списка — действие игрока', () => {
    expect(lessonWaits({ ...wait, target: '[data-cmd="move"]' })).toBe(false);
    expect(lessonWaits({ ...wait, anchor: () => null })).toBe(false);
    expect(lessonWaits({ ...wait, selector: () => null })).toBe(false);
  });

  it('шаг «Далее» закрывает игрок, а не таймер', () => {
    expect(lessonWaits({ target: null, advance: { on: 'tap' } })).toBe(false);
  });

  it('нет шага — нет ожидания', () => {
    expect(lessonWaits(null)).toBe(false);
    expect(lessonWaits(undefined)).toBe(false);
  });
});
