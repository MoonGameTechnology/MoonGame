import { describe, it, expect } from 'vitest';
import {
  JUDGE_FRAMES,
  SLOW_FRAME_MS,
  SOFT_MAP_DPR,
  judgingFrames,
  mapDpr,
  mapSharp,
  sharpnessMatters,
  slowFrames,
} from './mapSharpness';

/** Кадры с одним и тем же промежутком. */
const frames = (gap: number, n = JUDGE_FRAMES): number[] => Array.from({ length: n }, () => gap);

describe('чёткость карты — суд кадров (правило 1)', () => {
  it('кадров меньше нужного — судить рано', () => {
    expect(slowFrames([])).toBeNull();
    expect(slowFrames(frames(100, JUDGE_FRAMES - 1))).toBeNull();
  });

  it('30 кадров в секунду на экране 60 Гц — не слабое, 20 — слабое', () => {
    expect(slowFrames(frames(1000 / 60))).toBe(false);
    expect(slowFrames(frames(1000 / 30))).toBe(false);
    expect(slowFrames(frames(1000 / 20))).toBe(true);
  });

  it('порог — медиана: редкие долгие кадры слабым устройство не делают', () => {
    const gaps = frames(1000 / 60);
    for (let i = 0; i < JUDGE_FRAMES / 2 - 1; i++) gaps[i] = 500;
    expect(slowFrames(gaps)).toBe(false);
    gaps[JUDGE_FRAMES / 2 - 1] = 500; // долгих кадров уже половина
    expect(slowFrames(gaps)).toBe(true);
  });

  it('промежуток ровно на пороге — ещё не слабое', () => {
    expect(slowFrames(frames(SLOW_FRAME_MS))).toBe(false);
    expect(slowFrames(frames(SLOW_FRAME_MS + 0.5))).toBe(true);
  });

  it('порядок кадров не важен, а сами кадры остаются как были', () => {
    const gaps = [...frames(16, JUDGE_FRAMES / 2), ...frames(80, JUDGE_FRAMES / 2 + 1)];
    const copy = [...gaps];
    expect(slowFrames(gaps)).toBe(true);
    expect(slowFrames([...gaps].reverse())).toBe(true);
    expect(gaps).toEqual(copy);
  });
});

describe('чёткость карты — кто решает (правила 2–3)', () => {
  it('без выбора игрока решает вердикт кадров', () => {
    expect(mapSharp(null, false)).toBe(true);
    expect(mapSharp(null, true)).toBe(false);
  });

  it('ВЫБОР ИГРОКА СИЛЬНЕЕ ВЕРДИКТА в обе стороны', () => {
    expect(mapSharp(true, true)).toBe(true);
    expect(mapSharp(false, false)).toBe(false);
  });

  it('кадры судят, только пока игрок не выбрал, вердикта нет и сеанс ещё не решил', () => {
    expect(judgingFrames(2, null, false, false)).toBe(true);
    expect(judgingFrames(2, true, false, false)).toBe(false);
    expect(judgingFrames(2, false, false, false)).toBe(false);
    expect(judgingFrames(2, null, true, false)).toBe(false);
    expect(judgingFrames(2, null, false, true)).toBe(false);
  });
});

describe('чёткость карты — плотность холста (правило 4)', () => {
  it('чёткая карта — плотность экрана, пониженная — пиксель на точку', () => {
    expect(mapDpr(2, true)).toBe(2);
    expect(mapDpr(1.5, true)).toBe(1.5);
    expect(mapDpr(2, false)).toBe(SOFT_MAP_DPR);
    expect(mapDpr(1.5, false)).toBe(SOFT_MAP_DPR);
  });

  it('экрану с плотностью не выше пониженной понижать нечего: ни тумблера, ни суда', () => {
    expect(sharpnessMatters(1)).toBe(false);
    expect(sharpnessMatters(0.75)).toBe(false);
    expect(mapDpr(0.75, false)).toBe(0.75);
    expect(judgingFrames(1, null, false, false)).toBe(false);
    expect(sharpnessMatters(1.25)).toBe(true);
  });
});
