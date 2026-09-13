import { describe, it, expect } from 'vitest';
import { armedTap } from './armedTap';

describe('вооружённый приказ — годная цель', () => {
  it('исполняется и снимает прицел в любом режиме', () => {
    expect(armedTap('valid', false)).toBe('fire');
    expect(armedTap('valid', true)).toBe('fire');
  });
});

describe('вооружённый приказ — промах по пустоте', () => {
  it('ПУСТОТА ОТМЕНЯЕТ: игрок ткнул мимо всего — значит передумал', () => {
    expect(armedTap('none', false)).toBe('cancel');
  });

  it('ПУСТОТА СНИМАЕТ ДАЖЕ ПРОЩАЮЩИЙ РЕЖИМ: правило отмены сильнее послабления', () => {
    expect(armedTap('none', true)).toBe('cancel');
  });
});

describe('вооружённый приказ — неподходящая цель', () => {
  it('обычный режим снимается: приказ одноразовый', () => {
    expect(armedTap('wrong', false)).toBe('cancel');
  });

  it('ШТУРМ ОСТАЁТСЯ ВЗВЕДЁННЫМ: промах по цели — не отказ от приказа', () => {
    expect(armedTap('wrong', true)).toBe('keep');
  });

  it('только прощающий режим и только на неподходящей цели даёт keep', () => {
    const исходы = (['none', 'valid', 'wrong'] as const).flatMap((h) =>
      [false, true].map((f) => armedTap(h, f)),
    );
    expect(исходы.filter((o) => o === 'keep')).toHaveLength(1);
  });
});
