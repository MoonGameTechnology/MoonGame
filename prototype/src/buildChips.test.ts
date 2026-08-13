import { describe, it, expect } from 'vitest';
import {
  CHIP_FALLBACK,
  CHIP_MIN_FONT,
  chipFontPx,
  chipGlyph,
  chipMetrics,
  chipXs,
  chipY,
  chipsShown,
} from './buildChips';

describe('значки построек — когда ряд рисуется', () => {
  it('ПОД ТУМАНОМ РЯДА НЕТ: состав чужой системы — разведданные, за которые платят', () => {
    expect(chipsShown(false, 3, 1)).toBe(false);
  });

  it('НА СХЕМАТИЧНОМ ВИДЕ РЯДА НЕТ: строка плиток наваливается на сжавшийся маркер', () => {
    expect(chipsShown(true, 3, 0)).toBe(false);
  });

  it('нет построек — нет ряда', () => {
    expect(chipsShown(true, 0, 1)).toBe(false);
  });

  it('опознанный мир с постройками на детальном виде — рисуем', () => {
    expect(chipsShown(true, 1, 1)).toBe(true);
  });

  it('ИСЧЕРПЫВАЮЩЕ: рисуем ровно при всех трёх условиях сразу', () => {
    const drawn: string[] = [];
    for (const kn of [true, false])
      for (const count of [2, 0])
        for (const detail of [1, 0])
          if (chipsShown(kn, count, detail)) drawn.push(`${kn}/${count}/${detail}`);
    expect(drawn).toEqual(['true/2/1']);
  });
});

describe('значки построек — раскладка ряда', () => {
  it('РЯД ЦЕНТРИРОВАН ПОД УЗЛОМ: иначе мир будто съезжает вбок при каждой достройке', () => {
    for (const count of [1, 2, 3, 4, 7]) {
      const xs = chipXs(count, 100, 1);
      const mid = (xs[0]! + xs[xs.length - 1]!) / 2;
      expect(mid).toBeCloseTo(100, 10);
    }
  });

  it('одна постройка стоит ровно под центром', () => {
    expect(chipXs(1, 250, 1)).toEqual([250]);
  });

  it('соседние плитки разнесены на шаг', () => {
    const { step } = chipMetrics(1);
    const xs = chipXs(4, 0, 1);
    for (let i = 1; i < xs.length; i++) expect(xs[i]! - xs[i - 1]!).toBeCloseTo(step, 10);
  });

  it('порядок построек сохраняется — ряд идёт слева направо', () => {
    const xs = chipXs(5, 0, 1);
    expect([...xs].sort((a, b) => a - b)).toEqual(xs);
  });

  it('пустой ряд — пустой список', () => {
    expect(chipXs(0, 100, 1)).toEqual([]);
  });

  it('РЯД СЖИМАЕТСЯ ВМЕСТЕ С УЗЛОМ: на дальнем зуме плитки не должны стать крупнее мира', () => {
    const near = chipXs(5, 0, 1);
    const far = chipXs(5, 0, 0.45);
    const width = (xs: number[]) => xs[xs.length - 1]! - xs[0]!;
    expect(width(far)).toBeCloseTo(width(near) * 0.45, 10);
    expect(chipMetrics(0.45).half).toBeLessThan(chipMetrics(1).half);
  });

  it('центр ряда не уезжает при сжатии', () => {
    const xs = chipXs(6, 320, 0.45);
    expect((xs[0]! + xs[xs.length - 1]!) / 2).toBeCloseTo(320, 10);
  });
});

describe('значки построек — где ряд по высоте', () => {
  it('РЯД ПОД УЗЛОМ, А НЕ НА НЁМ: он подпись к миру, а не часть его искусства', () => {
    expect(chipY(100, 13, 1)).toBeGreaterThan(100 + 13);
  });

  it('отступ сжимается вместе с узлом', () => {
    const gap = (scale: number) => chipY(100, 13 * scale, scale) - 100 - 13 * scale;
    expect(gap(0.45)).toBeCloseTo(gap(1) * 0.45, 10);
  });
});

describe('значки построек — кегль', () => {
  it('У КЕГЛЯ ЕСТЬ ПОЛ: буква мельче семи пикселей читается как сор, а не как значок', () => {
    expect(chipFontPx(0.1)).toBe(CHIP_MIN_FONT);
    expect(chipFontPx(0)).toBe(CHIP_MIN_FONT);
  });

  it('кегль никогда не проваливается ниже пола ни при каком масштабе', () => {
    for (let s = 0; s <= 1.5; s += 0.05)
      expect(chipFontPx(s)).toBeGreaterThanOrEqual(CHIP_MIN_FONT);
  });

  it('на полном масштабе кегль базовый и растёт вместе с узлом', () => {
    expect(chipFontPx(1)).toBe(11);
    expect(chipFontPx(1.5)).toBeGreaterThan(chipFontPx(1));
  });

  it('кегль — целое число пикселей', () => {
    for (const s of [0.45, 0.7, 0.93, 1.31]) expect(Number.isInteger(chipFontPx(s))).toBe(true);
  });
});

describe('значки построек — глиф', () => {
  it('НЕЗНАКОМЫЙ ТИП — ЗАГЛУШКА, А НЕ ПРОПУСК: пропуск соврал бы о количестве построек', () => {
    expect(chipGlyph(undefined)).toBe(CHIP_FALLBACK);
  });

  it('известный тип рисуется своим значком', () => {
    expect(chipGlyph('⛏')).toBe('⛏');
  });
});
