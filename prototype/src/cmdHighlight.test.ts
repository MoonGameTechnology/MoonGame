import { describe, it, expect } from 'vitest';
import { allOn } from './cmdHighlight';

describe('cmdHighlight — групповая подсветка', () => {
  it('горит, когда включено у ВСЕХ (правило 1)', () => {
    expect(allOn(['a', 'b', 'c'], () => true)).toBe(true);
  });

  it('НЕ горит, когда включено хоть не у всех — иначе кнопка соврала бы про группу', () => {
    expect(allOn(['a', 'b', 'c'], (id) => id !== 'b')).toBe(false);
  });

  it('одного включённого из десяти мало', () => {
    const ids = Array.from({ length: 10 }, (_, i) => `f${i}`);
    expect(allOn(ids, (id) => id === 'f3')).toBe(false);
  });

  it('пустое выделение НЕ горит, хотя every на пустом истинно (правило 2)', () => {
    expect([].every(() => false)).toBe(true); // ловушка, от которой защищаемся
    expect(allOn([], () => true)).toBe(false);
    expect(allOn([], () => false)).toBe(false);
  });

  it('одиночное выделение горит по своему единственному флоту', () => {
    expect(allOn(['a'], () => true)).toBe(true);
    expect(allOn(['a'], () => false)).toBe(false);
  });

  it('признак спрашивается по КАЖДОМУ элементу, а не угадывается (правило 3)', () => {
    const спрошено: string[] = [];
    allOn(['a', 'b', 'c'], (id) => {
      спрошено.push(id);
      return true;
    });
    expect(спрошено).toEqual(['a', 'b', 'c']);
  });

  it('работает не только по строкам — элемент любой', () => {
    expect(allOn([{ p: true }, { p: true }], (o) => o.p)).toBe(true);
    expect(allOn([{ p: true }, { p: false }], (o) => o.p)).toBe(false);
  });
});
