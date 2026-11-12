import { describe, expect, it } from 'vitest';
import {
  HOLD_CONFIRM_MS,
  REPEAT_FASTEST_MS,
  REPEAT_START_MS,
  holdConfirmClick,
  repeatDelay,
} from './holdAction';

describe('подтверждение удержанием', () => {
  it('держать надо дольше случайного касания, но не дольше пары секунд', () => {
    expect(HOLD_CONFIRM_MS).toBeGreaterThanOrEqual(600);
    expect(HOLD_CONFIRM_MS).toBeLessThanOrEqual(2000);
  });

  it('ДОРОСШЕЕ УДЕРЖАНИЕ СЪЕДАЕТ КЛИК: действие уже исполнено', () => {
    expect(holdConfirmClick({ matured: true, fromPress: true, armed: true })).toBe('eat');
    expect(holdConfirmClick({ matured: true, fromPress: true, armed: false })).toBe('eat');
  });

  it('КОРОТКИЙ ТАП НЕ ИСПОЛНЯЕТ, ДАЖЕ ПО ПОКАЗАННОМУ ВОПРОСУ: двойной тап безопасен', () => {
    expect(holdConfirmClick({ matured: false, fromPress: true, armed: false })).toBe('arm');
    expect(holdConfirmClick({ matured: false, fromPress: true, armed: true })).toBe('arm');
  });

  it('клик без нажатия (диктор) идёт в два шага: вопрос, затем исполнение', () => {
    expect(holdConfirmClick({ matured: false, fromPress: false, armed: false })).toBe('arm');
    expect(holdConfirmClick({ matured: false, fromPress: false, armed: true })).toBe('confirm');
  });
});

describe('автоповтор «±»', () => {
  it('первый повтор ждёт паузу, отличающую удержание от тапа', () => {
    expect(repeatDelay(1)).toBe(REPEAT_START_MS);
  });

  it('дальше разгоняется и не быстрее предела', () => {
    const steps = Array.from({ length: 30 }, (_, i) => repeatDelay(i + 2));
    for (let i = 1; i < steps.length; i++) expect(steps[i]!).toBeLessThanOrEqual(steps[i - 1]!);
    expect(Math.min(...steps)).toBe(REPEAT_FASTEST_MS);
    expect(steps[0]).toBeLessThan(REPEAT_START_MS);
  });

  it('20 шагов набираются меньше чем за 2,5 с удержания', () => {
    let total = 0;
    for (let n = 1; n <= 19; n++) total += repeatDelay(n);
    expect(total).toBeLessThan(2500);
  });
});
