import { describe, it, expect } from 'vitest';

import { isSealedBorder, type SealSide } from './sealedBorder';

const side = (id: string, over: Partial<SealSide> = {}): SealSide => ({
  id,
  impassable: false,
  seen: true,
  ...over,
});

describe('isSealedBorder — граница как барьер', () => {
  it('без объяснения от мира барьера нет', () => {
    // Старая карта со своим списком путей печатей не носит. Расхождение мозаики и
    // списка — не повод рисовать стену: так вся песочница стала бы лабиринтом.
    expect(isSealedBorder(side('a'), side('b'))).toBe(false);
  });

  it('печать местности в состоянии закрывает границу', () => {
    expect(isSealedBorder(side('a', { sealed: ['b'] }), side('b', { sealed: ['a'] }))).toBe(true);
  });

  it('хватает печати с ОДНОЙ стороны: полузакрытых дверей не бывает', () => {
    // Двусторонность гарантирует ядро, но старый снимок мог донести половину.
    expect(isSealedBorder(side('a', { sealed: ['b'] }), side('b'))).toBe(true);
    expect(isSealedBorder(side('a'), side('b', { sealed: ['a'] }))).toBe(true);
  });

  it('печать смотрит на СОСЕДА, а не просто на непустой список', () => {
    expect(isSealedBorder(side('a', { sealed: ['c'] }), side('b', { sealed: ['d'] }))).toBe(false);
  });

  it('непроходимая сторона объясняет барьер и без печати', () => {
    expect(isSealedBorder(side('a', { impassable: true }), side('b'))).toBe(true);
    expect(isSealedBorder(side('a'), side('b', { impassable: true }))).toBe(true);
  });

  it('неразведанная сторона — «неизвестно», а не «закрыто»', () => {
    // Туман не должен выдавать знание о мире: барьер — это подтверждённый факт.
    expect(isSealedBorder(side('a', { sealed: ['b'] }), side('b', { seen: false }))).toBe(false);
    expect(isSealedBorder(side('a', { seen: false, impassable: true }), side('b'))).toBe(false);
  });

  it('решение симметрично: стороны можно поменять местами', () => {
    const a = side('a', { sealed: ['b'] });
    const b = side('b', { seen: false });
    expect(isSealedBorder(a, b)).toBe(isSealedBorder(b, a));
  });
});
