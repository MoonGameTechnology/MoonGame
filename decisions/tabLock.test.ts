import { describe, expect, it } from 'vitest';
import { tabSuperseded } from './tabLock';

describe('AUD-29 — одна вкладка пишет Sector Zero', () => {
  it('хозяйка — она сама: писать можно', () => {
    expect(tabSuperseded('a', 'a')).toBe(false);
  });

  it('ХОЗЯЙКА ДРУГАЯ — вкладка вытеснена: её память может отставать от хранилища', () => {
    expect(tabSuperseded('a', 'b')).toBe(true);
  });

  it('хозяйки нет (хранилища нет, запись стёрта) — делить нечего, писать можно', () => {
    expect(tabSuperseded('a', null)).toBe(false);
    expect(tabSuperseded('a', '')).toBe(false);
  });
});
