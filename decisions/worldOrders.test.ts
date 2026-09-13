import { describe, it, expect } from 'vitest';
import { capitalOffer, holdOffer } from './worldOrders';

describe('панель мира — столица', () => {
  it('свой обитаемый мир можно назначить', () => {
    expect(capitalOffer(true, false, true)).toBe('designate');
  });

  it('текущая столица показывает метку, а не кнопку', () => {
    expect(capitalOffer(true, true, true)).toBe('marked');
  });

  it('ТОЛЬКО ОБИТАЕМЫЙ: в столице возрождается герой, на пустом камне ему негде', () => {
    expect(capitalOffer(true, false, false)).toBe('none');
  });

  it('ЧУЖОЙ МИР НЕ ПРЕДЛАГАЕТ НИЧЕГО — это приказ владельца', () => {
    expect(capitalOffer(false, false, true)).toBe('none');
    expect(capitalOffer(false, true, true)).toBe('none');
  });
});

describe('панель мира — точка удержания', () => {
  it('свой мир с технологией и свободным лимитом — можно поставить', () => {
    expect(holdOffer(true, true, false, 1, 3)).toBe('set');
  });

  it('БЕЗ ТЕХНОЛОГИИ ПУСТО, А НЕ СЕРАЯ КНОПКА: приказа ещё не существует', () => {
    expect(holdOffer(true, false, false, 0, 3)).toBe('none');
  });

  it('чужой мир точку не предлагает', () => {
    expect(holdOffer(false, true, false, 0, 3)).toBe('none');
  });

  it('ОТМЕЧЕННЫЙ ПРЕДЛАГАЕТ СНЯТЬ, а не поставить второй раз', () => {
    expect(holdOffer(true, true, true, 3, 3)).toBe('clear');
  });

  it('ЛИМИТ ГАСИТ КНОПКУ, НО НЕ ПРЯЧЕТ: игрок видит, почему поставить нельзя', () => {
    expect(holdOffer(true, true, false, 3, 3)).toBe('set-disabled');
    expect(holdOffer(true, true, false, 4, 3)).toBe('set-disabled');
  });

  it('СНЯТЬ МОЖНО И НА ИСЧЕРПАННОМ ЛИМИТЕ — иначе игрок запрётся', () => {
    expect(holdOffer(true, true, true, 99, 3)).toBe('clear');
  });
});
