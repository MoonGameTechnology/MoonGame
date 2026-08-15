import { describe, expect, it } from 'vitest';
import { navHintKey } from './navHint';
import { overlayMode } from './tourGate';

describe('подсказка про управление картой', () => {
  it('ПОД УСТРОЙСТВО: мыши — про колесо, пальцам — про щипок', () => {
    expect(navHintKey(true)).toBe('onb.tour.first.nav.mouse');
    expect(navHintKey(false)).toBe('onb.tour.first.nav.touch');
  });

  it('ключи разные — иначе на телефоне читали бы про колесо', () => {
    expect(navHintKey(true)).not.toBe(navHintKey(false));
  });
});

describe('шаг подсказки не запирает экран', () => {
  const подсказка = { advance: { on: 'tap' }, hands: true } as const;

  it('ПРОБОВАТЬ МОЖНО СРАЗУ: HUD остаётся живым, хотя шаг закрывается «Далее»', () => {
    expect(overlayMode(подсказка, false)).toBe('free');
    expect(overlayMode(подсказка, true)).toBe('free');
  });

  it('обычный шаг «Далее» по-прежнему модальный — там пробовать нечего', () => {
    expect(overlayMode({ advance: { on: 'tap' } }, false)).toBe('modal');
  });
});
