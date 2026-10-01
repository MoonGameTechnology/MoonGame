import { describe, expect, it } from 'vitest';
import { splitSelectTarget } from './splitFollow';

describe('splitSelectTarget — выделение после раскола', () => {
  const ev = { from: 'F1', to: 'fleet:p1:5:2', owner: 'p1' };

  it('свой ожидаемый раскол выделяет отделённую часть', () => {
    expect(splitSelectTarget('F1', ev, 'p1')).toBe('fleet:p1:5:2');
  });

  it('без ожидания выделение не трогается', () => {
    expect(splitSelectTarget(null, ev, 'p1')).toBeNull();
  });

  it('раскол другого флота или чужой раскол не уводят выделение', () => {
    expect(splitSelectTarget('F2', ev, 'p1')).toBeNull();
    expect(splitSelectTarget('F1', { ...ev, owner: 'p2' }, 'p1')).toBeNull();
  });

  it('событие без id новой части ничего не выделяет', () => {
    expect(splitSelectTarget('F1', { from: 'F1', owner: 'p1' }, 'p1')).toBeNull();
  });
});
