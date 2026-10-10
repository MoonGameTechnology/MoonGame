import { describe, expect, it } from 'vitest';
import { MAP_DEEDS, mapGestures } from './mapGestures';

describe('жесты карты на первом шаге обучения', () => {
  it('под устройство: мыши колесо и Shift, пальцам щипок и удержание (правило 1)', () => {
    expect(mapGestures(true).map((g) => g.anim)).toEqual([
      'wheel',
      'drag',
      'double-click',
      'shift-box',
    ]);
    expect(mapGestures(false).map((g) => g.anim)).toEqual([
      'pinch',
      'swipe',
      'double-tap',
      'hold',
    ]);
  });

  it('четыре дела в одном порядке на обоих устройствах (правило 2)', () => {
    expect(mapGestures(true).map((g) => g.deed)).toEqual(MAP_DEEDS);
    expect(mapGestures(false).map((g) => g.deed)).toEqual(MAP_DEEDS);
  });

  it('у плитки есть и имя жеста, и его дело (правило 3)', () => {
    for (const g of [...mapGestures(true), ...mapGestures(false)]) {
      expect(g.name, g.anim).toBe(`onb.gesture.${g.anim}`);
      expect(g.does, g.anim).toBe(`onb.gesture.does.${g.deed}`);
    }
  });

  it('у одного дела на разных устройствах разные жесты, а подпись дела одна', () => {
    const pc = mapGestures(true);
    const phone = mapGestures(false);
    pc.forEach((g, i) => {
      expect(g.anim).not.toBe(phone[i]!.anim);
      expect(g.does).toBe(phone[i]!.does);
    });
  });
});
