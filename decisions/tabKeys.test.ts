import { describe, expect, it } from 'vitest';
import { tabKeyIndex } from './tabKeys';

describe('клавиши полосы вкладок', () => {
  it('стрелки ходят по кругу', () => {
    expect(tabKeyIndex('ArrowRight', 2, 3)).toBe(0);
    expect(tabKeyIndex('ArrowLeft', 0, 3)).toBe(2);
    expect(tabKeyIndex('ArrowRight', 0, 3)).toBe(1);
  });
  it('Home и End ведут к краям', () => {
    expect(tabKeyIndex('Home', 2, 3)).toBe(0);
    expect(tabKeyIndex('End', 0, 3)).toBe(2);
  });
  it('прочие клавиши и пустая полоса вкладку не меняют', () => {
    expect(tabKeyIndex('Enter', 1, 3)).toBeNull();
    expect(tabKeyIndex('ArrowRight', 0, 0)).toBeNull();
  });
});
