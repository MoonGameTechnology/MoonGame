import { describe, it, expect } from 'vitest';
import { rallyOffer, rallyPick } from './rallyPoint';

describe('точка сбора — что предложить в панели мира', () => {
  it('свой мир с верфью предлагает задать точку', () => {
    expect(rallyOffer(true, true, false)).toBe('set');
  });

  it('ЧУЖОЙ МИР НЕ ПРЕДЛАГАЕТ НИЧЕГО — это приказ владельца', () => {
    expect(rallyOffer(false, true, false)).toBe('none');
    expect(rallyOffer(false, true, true)).toBe('none');
  });

  it('без верфи кнопки нет: кораблей там не строят', () => {
    expect(rallyOffer(true, false, false)).toBe('none');
  });

  it('стоящую точку можно сменить и снять, даже если верфи больше нет', () => {
    expect(rallyOffer(true, true, true)).toBe('change');
    expect(rallyOffer(true, false, true)).toBe('change');
  });
});

describe('точка сбора — тап по карте', () => {
  it('другой свой мир — приказ', () => {
    expect(rallyPick('A', { id: 'B', owner: 'me' }, 'me')).toBe('order');
  });

  it('чужой, ничей и сам мир-верфь — объяснить правило', () => {
    expect(rallyPick('A', { id: 'B', owner: 'rival' }, 'me')).toBe('not-own');
    expect(rallyPick('A', { id: 'B', owner: null }, 'me')).toBe('not-own');
    expect(rallyPick('A', { id: 'A', owner: 'me' }, 'me')).toBe('not-own');
  });

  it('промах мимо мира снимает прицел', () => {
    expect(rallyPick('A', null, 'me')).toBe('cancel');
  });
});
