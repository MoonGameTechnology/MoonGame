import { describe, it, expect } from 'vitest';
import { shippedGameData } from '../data/bundle';
import { doubleReward, shopCapabilities } from './sectorZeroShop';
import {
  changeSectorZeroProgress,
  freshSectorZeroProgress,
  parseSectorZeroProgress,
  WARRANTS_PER_REWARD,
  type SectorZeroProgress,
} from './sectorZeroProgress';

const data = shippedGameData();
/** Профиль сразу после расчёта третьего забега с наградой 6. */
const settled = (over: Partial<SectorZeroProgress> = {}): SectorZeroProgress => ({
  ...freshSectorZeroProgress(data, 'double'),
  nextAttempt: 4,
  settledThrough: 3,
  lastReward: 6,
  research: 10,
  warrants: 50,
  ...over,
});
const double = (p: SectorZeroProgress) =>
  changeSectorZeroProgress(p, { kind: 'double-reward' }, data);
const ads = shopCapabilities({ iap: false, rewardedAds: true });

describe('YAG-3.2 — двойная награда за забег', () => {
  it('ролик повторяет награду последнего забега: и данные, и Варранты', () => {
    const next = double(settled())!;
    expect(next.research).toBe(10 + 6);
    expect(next.warrants).toBe(50 + 6 * WARRANTS_PER_REWARD);
    expect(next.doubledThrough).toBe(3);
  });

  it('удвоить один забег дважды нельзя', () => {
    expect(double(double(settled())!)).toBeNull();
  });

  it('следующий расчёт снова открывает удвоение — уже для нового забега', () => {
    const doubled = double(settled())!;
    const nextRun = { ...doubled, nextAttempt: 5, settledThrough: 4, lastReward: 2 };
    expect(double(nextRun)?.research).toBe(doubled.research + 2);
  });

  it('удваивать нечего — отказ: забегов не было или награда нулевая', () => {
    expect(double(freshSectorZeroProgress(data, 'x'))).toBeNull();
    expect(double(settled({ lastReward: 0 }))).toBeNull();
  });

  it('ролик не трогает ничего, кроме двух кошельков и отметки', () => {
    const p = settled({ sovereigns: 4 });
    const next = double(p)!;
    expect({
      ...next,
      research: p.research,
      warrants: p.warrants,
      doubledThrough: p.doubledThrough,
    }).toEqual(p);
  });
});

describe('YAG-3.2 — отметка удвоения в сохранении', () => {
  const stored = (over: Record<string, unknown>) => JSON.stringify({ ...settled(), ...over });

  it('старый профиль без поля — ничего не удвоено', () => {
    const { doubledThrough: _drop, ...legacy } = settled();
    expect(parseSectorZeroProgress(JSON.stringify(legacy), data).doubledThrough).toBe(0);
  });

  it('отметка переживает перезагрузку — повторно удвоить после неё нельзя', () => {
    const p = parseSectorZeroProgress(stored({ doubledThrough: 3 }), data);
    expect(double(p)).toBeNull();
  });

  it('отметка из будущего срезается до расчёта — она не может заранее «съесть» удвоение', () => {
    // Иначе правленое «999» закрыло бы удвоение навсегда, а ноль и мусор открывают его
    // только для уже рассчитанного забега — ничего сверх одной награды.
    expect(parseSectorZeroProgress(stored({ doubledThrough: 999 }), data).doubledThrough).toBe(3);
    expect(parseSectorZeroProgress(stored({ doubledThrough: 'x' }), data).doubledThrough).toBe(0);
  });
});

describe('YAG-3.2 — кнопка удвоения', () => {
  it('рекламы у площадки нет — кнопки нет', () => {
    const off = shopCapabilities({ iap: true, rewardedAds: false });
    expect(doubleReward(settled(), off)).toEqual({ state: 'hidden', research: 6, warrants: 30 });
  });

  it('есть что удвоить — живая кнопка, и на ней видно, СКОЛЬКО придёт', () => {
    expect(doubleReward(settled(), ads)).toEqual({
      state: 'ready',
      research: 6,
      warrants: 6 * WARRANTS_PER_REWARD,
    });
  });

  it('уже удвоено или удваивать нечего — кнопки нет', () => {
    expect(doubleReward(double(settled())!, ads).state).toBe('hidden');
    expect(doubleReward(freshSectorZeroProgress(data, 'x'), ads).state).toBe('hidden');
  });
});
