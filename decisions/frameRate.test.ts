import { describe, expect, it } from 'vitest';
import { FRAME_RATES, frameRateOf, nextFrameSlot, type FrameSlot } from './frameRate';

describe('режимы частоты кадров', () => {
  it('нет настройки или мусор — 60; читаются только поддержанные режимы', () => {
    for (const value of [null, undefined, '', '0', '144', '60fps', 60]) {
      expect(frameRateOf(value)).toBe('60');
    }
    for (const mode of FRAME_RATES) expect(frameRateOf(mode)).toBe(mode);
  });

  for (const hz of [30, 60, 75, 90, 120, 144, 165]) {
    for (const mode of FRAME_RATES) {
      it(`${mode} на экране ${hz} Гц: без дрейфа за минуту и без лишних кадров`, () => {
        let slot: FrameSlot | null = null;
        let frames = 0;
        for (let tick = 0; tick < hz * 60; tick++) {
          const next = nextFrameSlot(slot, (tick * 1000) / hz, mode);
          if (next) {
            slot = next;
            frames++;
          }
        }
        const ceiling = mode === 'auto' ? hz : Math.min(hz, Number(mode));
        expect(Math.abs(frames - ceiling * 60)).toBeLessThanOrEqual(1);
      });
    }
  }

  it('смена режима действует на ближайшем rAF, возврат из фона не создаёт очередь кадров', () => {
    const first = nextFrameSlot(null, 0, '30')!;
    expect(nextFrameSlot(first, 8, '30')).toBeNull();
    const changed = nextFrameSlot(first, 8, '120')!;
    expect(changed.at).toBe(8);
    const resumed = nextFrameSlot(changed, 5000, '120')!;
    expect(resumed.nextAt).toBeCloseTo(5000 + 1000 / 120);
    expect(nextFrameSlot(resumed, 5000.1, '120')).toBeNull();
    expect(nextFrameSlot(resumed, 0, '120')!.at).toBe(0);
  });

  it('поздний callback рисует один кадр и держит следующий срок в будущем', () => {
    const delayed = nextFrameSlot(nextFrameSlot(null, 0, '60'), 200, '60')!;
    expect(delayed.nextAt).toBeGreaterThan(200);
    expect(nextFrameSlot(delayed, 201, '60')).toBeNull();
  });
});
