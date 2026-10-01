import { describe, it, expect } from 'vitest';
import {
  UNKNOWN_OWNER,
  bakeSignature,
  ownersSignature,
  type BakeContent,
} from './staticLayerCache';

const content = (over: Partial<BakeContent> = {}): BakeContent => ({
  vw: 1000,
  vh: 800,
  dpr: 2,
  me: 'p1',
  owners: 'p1,p2,',
  starfield: true,
  ...over,
});

describe('запеканка карты — подпись владельцев', () => {
  it('подпись читает ЗНАНИЕ игрока, а не правду — иначе скрытый захват выдаст себя перерисовкой', () => {
    const правда: Record<string, string> = { a: 'p2', b: 'p2' };
    const знание: Record<string, string | null> = { a: 'p2', b: null }; // b за туманом
    const sig = ownersSignature(['a', 'b'], (id) => знание[id] ?? null);
    expect(sig).not.toContain(правда.b! + ',' + правда.b!);
    expect(sig).toBe(`p2,${UNKNOWN_OWNER},`);
  });

  it('«НЕИЗВЕСТНО» — ОТДЕЛЬНЫЙ МАРКЕР: «ничей» и «за туманом» не должны совпадать', () => {
    const ничей = ownersSignature(['a'], () => null);
    const заТуманом = ownersSignature(['a'], () => UNKNOWN_OWNER);
    expect(ничей).toBe(заТуманом); // оба неизвестны — это одно состояние
    expect(ownersSignature(['a'], () => 'p1')).not.toBe(ничей);
  });

  it('смена владельца меняет подпись, порядок узлов сохраняется', () => {
    const было = ownersSignature(['a', 'b'], (id) => (id === 'a' ? 'p1' : 'p2'));
    const стало = ownersSignature(['a', 'b'], (id) => (id === 'a' ? 'p2' : 'p1'));
    expect(было).not.toBe(стало);
  });

  it('пустая карта даёт пустую подпись', () => {
    expect(ownersSignature([], () => 'p1')).toBe('');
  });
});

describe('запеканка карты — подпись содержимого', () => {
  it('РАЗМЕР ЭКРАНА И ПЛОТНОСТЬ ПИКСЕЛЕЙ — ЧАСТЬ ПОДПИСИ: после поворота нужна новая запеканка', () => {
    expect(bakeSignature(content())).not.toBe(bakeSignature(content({ vw: 800, vh: 1000 })));
    expect(bakeSignature(content())).not.toBe(bakeSignature(content({ dpr: 1 })));
  });

  it('чужими глазами карта другая — своя сторона входит в подпись', () => {
    expect(bakeSignature(content())).not.toBe(bakeSignature(content({ me: 'p2' })));
  });

  it('звёздный фон меняет саму запеканку', () => {
    expect(bakeSignature(content())).not.toBe(bakeSignature(content({ starfield: false })));
  });

  it('одинаковое содержимое — одинаковая подпись', () => {
    expect(bakeSignature(content())).toBe(bakeSignature(content()));
  });
});
