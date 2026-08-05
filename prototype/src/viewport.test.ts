import { describe, it, expect } from 'vitest';
import {
  capDpr,
  isMobileViewport,
  measureViewport,
  makeStars,
  makeNebulae,
  STARS,
  NEBULAE,
  MAX_DPR,
} from './viewport';

/** Окно без браузера: только то, что замер реально читает. */
const fakeWin = (w: number, h: number, dpr: number, coarse = false) =>
  ({
    innerWidth: w,
    innerHeight: h,
    devicePixelRatio: dpr,
    matchMedia: (q: string) => ({ matches: q.includes('coarse') ? coarse : false }),
  }) as unknown as Window;

describe('вьюпорт — плотность пикселей', () => {
  it('высокий DPR срезается до потолка: цена кадра растёт как DPR²', () => {
    expect(capDpr(3)).toBe(MAX_DPR);
    expect(capDpr(4)).toBe(MAX_DPR);
  });

  it('обычные значения проходят как есть', () => {
    expect(capDpr(1)).toBe(1);
    expect(capDpr(1.5)).toBe(1.5);
    expect(capDpr(2)).toBe(2);
  });

  it('мусор от окружения читается как 1×, а не как ноль пикселей', () => {
    expect(capDpr(0)).toBe(1);
    expect(capDpr(Number.NaN)).toBe(1);
  });
});

describe('вьюпорт — телефонная раскладка', () => {
  it('узкий экран — телефон', () => {
    expect(isMobileViewport(390, 844, true)).toBe(true);
    expect(isMobileViewport(719, 900, false)).toBe(true);
  });

  it('рабочий стол — не телефон', () => {
    expect(isMobileViewport(1440, 900, false)).toBe(false);
    expect(isMobileViewport(720, 900, false)).toBe(false); // ровно на границе — уже ПК
  });

  it('ЛАНДШАФТНЫЙ телефон широкий, но низкий и под палец — всё равно телефон', () => {
    expect(isMobileViewport(844, 390, true)).toBe(true);
  });

  it('низкое окно с МЫШЬЮ остаётся десктопом — раскладка живёт на hover', () => {
    expect(isMobileViewport(1200, 400, false)).toBe(false);
  });
});

describe('вьюпорт — замер окна', () => {
  it('замер собирает размер, плотность и раскладку разом', () => {
    expect(measureViewport(fakeWin(1440, 900, 2))).toEqual({
      w: 1440,
      h: 900,
      dpr: 2,
      mobile: false,
    });
  });

  it('телефон с 3× приходит уже с потолком плотности', () => {
    const v = measureViewport(fakeWin(390, 844, 3, true));
    expect(v.dpr).toBe(MAX_DPR);
    expect(v.mobile).toBe(true);
  });

  it('вне браузера — рабочий стол по умолчанию, без падения', () => {
    expect(measureViewport(undefined)).toEqual({ w: 1280, h: 720, dpr: 1, mobile: false });
  });

  it('окно без matchMedia не роняет замер (грубого указателя просто нет)', () => {
    const win = { innerWidth: 800, innerHeight: 400, devicePixelRatio: 1 } as unknown as Window;
    expect(measureViewport(win).mobile).toBe(false);
  });
});

describe('фон галактики — детерминизм', () => {
  it('фон одинаков в каждом запуске — иначе его нельзя запечь в статический слой', () => {
    expect(makeStars(50)).toEqual(makeStars(50));
    expect(makeNebulae(5)).toEqual(makeNebulae(5));
  });

  it('раскладка та же, что была до выноса (формула фона не поехала)', () => {
    const stars = makeStars(280);
    for (const i of [0, 7, 137, 279]) {
      const x = ((Math.sin(i * 12.9898) * 43758.5453) % 1) + 1;
      expect(stars[i]!.x).toBeCloseTo(x % 1, 12);
    }
    const neb = makeNebulae(5);
    const r3 = ((Math.sin(4 * 15.913) * 11923.71) % 1) + 1;
    expect(neb[4]!.r).toBeCloseTo(160 + (r3 % 1) * 180, 10);
  });

  it('звёзды лежат в нормализованном поле, яркость — в видимом диапазоне', () => {
    for (const s of makeStars(280)) {
      expect(s.x).toBeGreaterThanOrEqual(0);
      expect(s.x).toBeLessThan(1);
      expect(s.y).toBeGreaterThanOrEqual(0);
      expect(s.y).toBeLessThan(1);
      expect(s.b).toBeGreaterThanOrEqual(0.12);
      expect(s.b).toBeLessThanOrEqual(0.57);
    }
  });

  it('туманности крупные и разноцветные — фон не одноцветный', () => {
    const neb = makeNebulae(5);
    for (const n of neb) {
      expect(n.r).toBeGreaterThanOrEqual(160);
      expect(n.r).toBeLessThanOrEqual(340);
    }
    expect(new Set(neb.map((n) => n.color)).size).toBe(2);
  });

  it('готовый фон — тот самый, что рисует статический слой', () => {
    expect(STARS.length).toBe(280);
    expect(NEBULAE.length).toBe(5);
    expect(STARS).toEqual(makeStars(280));
    expect(NEBULAE).toEqual(makeNebulae(5));
  });

  it('пустой фон допустим и не падает', () => {
    expect(makeStars(0)).toEqual([]);
    expect(makeNebulae(0)).toEqual([]);
  });
});
