import { describe, expect, it } from 'vitest';
import { wingOrderRow } from './wingOrderRow';

describe('ряд приказов эскадры', () => {
  it('до трёх приказов — все на виду, без «Ещё»', () => {
    expect(wingOrderRow(0)).toEqual({ main: 0, more: false });
    expect(wingOrderRow(3)).toEqual({ main: 3, more: false });
  });

  it('больше трёх — две первые и «Ещё», как у флота', () => {
    expect(wingOrderRow(4)).toEqual({ main: 2, more: true });
    expect(wingOrderRow(7)).toEqual({ main: 2, more: true });
  });
});
