import { describe, it, expect } from 'vitest';
import {
  JUDGE_FRAMES,
  SLOW_FRAME_MS,
  SOFT_MAP_DPR,
  judgingFrames,
  mapDpr,
  mapSharp,
  motionLive,
  sharpnessMatters,
  slowFrames,
  slowVerdictReach,
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

  it('кадры судят, только пока вердикту есть что поменять, его нет и сеанс ещё не решил', () => {
    const both = { sharp: true, motion: true };
    expect(judgingFrames(both, false, false)).toBe(true);
    expect(judgingFrames({ sharp: true, motion: false }, false, false)).toBe(true);
    expect(judgingFrames({ sharp: false, motion: true }, false, false)).toBe(true);
    expect(judgingFrames({ sharp: false, motion: false }, false, false)).toBe(false);
    expect(judgingFrames(both, true, false)).toBe(false);
    expect(judgingFrames(both, false, true)).toBe(false);
  });

  it('вердикт меняет чёткость, пока её не выбрали, и движение, пока его не выбрали', () => {
    expect(slowVerdictReach(2, null, null, false)).toEqual({ sharp: true, motion: true });
    expect(slowVerdictReach(2, true, null, false)).toEqual({ sharp: false, motion: true });
    expect(slowVerdictReach(2, false, null, false)).toEqual({ sharp: false, motion: true });
    expect(slowVerdictReach(2, null, true, false)).toEqual({ sharp: true, motion: false });
    expect(slowVerdictReach(2, null, false, false)).toEqual({ sharp: true, motion: false });
  });
});

describe('движение слоёв на слабом устройстве (правило 5)', () => {
  it('без выбора игрока: система просит меньше движения или устройство слабое — слои стоят', () => {
    expect(motionLive(null, false, false)).toBe(true);
    expect(motionLive(null, true, false)).toBe(false);
    expect(motionLive(null, false, true)).toBe(false);
  });

  it('ВЫБОР ИГРОКА СИЛЬНЕЕ ВЕРДИКТА и системы в обе стороны', () => {
    expect(motionLive(true, true, true)).toBe(true);
    expect(motionLive(false, false, false)).toBe(false);
  });

  it('система уже просит меньше движения — вердикту в движении менять нечего', () => {
    expect(slowVerdictReach(2, null, null, true)).toEqual({ sharp: true, motion: false });
    expect(slowVerdictReach(1, null, null, true)).toEqual({ sharp: false, motion: false });
  });
});

describe('чёткость карты — плотность холста (правило 4)', () => {
  it('чёткая карта — плотность экрана, пониженная — пиксель на точку', () => {
    expect(mapDpr(2, true)).toBe(2);
    expect(mapDpr(1.5, true)).toBe(1.5);
    expect(mapDpr(2, false)).toBe(SOFT_MAP_DPR);
    expect(mapDpr(1.5, false)).toBe(SOFT_MAP_DPR);
  });

  it('экрану с плотностью не выше пониженной понижать нечего: кадры судят его только ради движения', () => {
    expect(sharpnessMatters(1)).toBe(false);
    expect(sharpnessMatters(0.75)).toBe(false);
    expect(mapDpr(0.75, false)).toBe(0.75);
    expect(slowVerdictReach(1, null, null, false)).toEqual({ sharp: false, motion: true });
    expect(judgingFrames(slowVerdictReach(1, null, false, false), false, false)).toBe(false);
    expect(sharpnessMatters(1.25)).toBe(true);
  });
});
