import { describe, expect, it } from 'vitest';
import { overlayMode } from './tourGate';

const тап = { advance: { on: 'tap' } } as const;
const действие = { advance: { on: 'action' } } as const;
const состояние = { advance: { on: 'state' } } as const;

describe('что обучение позволяет нажимать', () => {
  it('шаг «Далее» — модальный: ход один, случайный тап мимо ничего не заказывает', () => {
    expect(overlayMode(тап, true)).toBe('modal');
    expect(overlayMode({ ...тап, gate: true }, true)).toBe('modal');
  });

  it('ЗАПЕРТЫЙ ШАГ пропускает только подсвеченное место', () => {
    expect(overlayMode({ ...действие, gate: true }, true)).toBe('gate');
    expect(overlayMode({ ...состояние, gate: true }, true)).toBe('gate');
  });

  it('ЗАПЕРЕТЬ МОЖНО ТОЛЬКО НАЙДЕННОЕ МЕСТО: иначе игрок заперт насмерть', () => {
    // панель перерисовалась, цели в этом кадре нет — запирать нечего и некуда нажимать
    expect(overlayMode({ ...действие, gate: true }, false)).toBe('free');
    expect(overlayMode({ ...состояние, gate: true }, false)).toBe('free');
  });

  it('шаг без запрета оставляет HUD свободным: до места ещё надо добраться', () => {
    expect(overlayMode(действие, true)).toBe('free');
    expect(overlayMode(состояние, true)).toBe('free');
    expect(overlayMode(состояние, false)).toBe('free');
  });
});
