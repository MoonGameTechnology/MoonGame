import { describe, expect, it } from 'vitest';
import { dropsIntents, pickEffect } from './pickApply';

describe('что следует из выбора', () => {
  it('ПУСТО ПОД ТАПОМ — полный сброс: тап по пустому месту это «отменить»', () => {
    expect(pickEffect(null)).toEqual({ kind: 'clear-all' });
  });

  it('флот — обычное выделение', () => {
    expect(pickEffect({ kind: 'fleet', id: 'f1' })).toEqual({ kind: 'fleet', id: 'f1' });
  });

  it('мир — выбор мира', () => {
    expect(pickEffect({ kind: 'planet', id: 'N1' })).toEqual({ kind: 'planet', id: 'N1' });
  });
});

describe('что теряет силу', () => {
  it('НАМЕРЕНИЯ ГАСНУТ ТОЛЬКО ПРИ ПОЛНОМ СБРОСЕ: иначе они применились бы к другому флоту', () => {
    expect(dropsIntents({ kind: 'clear-all' })).toBe(true);
  });

  it('выбор флота намерения не гасит — их гасит само выделение', () => {
    expect(dropsIntents({ kind: 'fleet', id: 'f1' })).toBe(false);
  });

  it('выбор мира намерения НЕ гасит — записано как есть, см. правило 3', () => {
    expect(dropsIntents({ kind: 'planet', id: 'N1' })).toBe(false);
  });
});
