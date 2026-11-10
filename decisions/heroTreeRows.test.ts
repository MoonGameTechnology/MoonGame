import { describe, expect, it } from 'vitest';
import { heroTreeRows } from './heroTreeRows';

describe('дерево героя рядами плиток', () => {
  it('ряд продолжает самая длинная цепочка, боковой узел уходит своим рядом', () => {
    expect(
      heroTreeRows({
        lace: { requires: [] },
        uplink: { requires: ['lace'] },
        helm: { requires: ['lace'] },
        sustained: { requires: ['helm'] },
        open: { requires: ['sustained'] },
      }),
    ).toEqual([
      { from: null, items: ['lace', 'helm', 'sustained', 'open'] },
      { from: 'lace', items: ['uplink'] },
    ]);
  });

  it('каждый узел ровно один раз, даже с двумя родителями', () => {
    const rows = heroTreeRows({
      a: { requires: [] },
      b: { requires: [] },
      both: { requires: ['a', 'b'] },
    });
    expect(rows.flatMap((r) => r.items).sort()).toEqual(['a', 'b', 'both']);
    expect(rows[0]).toEqual({ from: null, items: ['a', 'both'] });
  });

  it('родитель вне ветки не мешает: узел считается корнем своей ветки', () => {
    expect(heroTreeRows({ child: { requires: ['elsewhere'] } })).toEqual([
      { from: null, items: ['child'] },
    ]);
  });

  it('цикл в данных не вешает обход и не теряет узлы', () => {
    const rows = heroTreeRows({ x: { requires: ['y'] }, y: { requires: ['x'] } });
    expect(rows.flatMap((r) => r.items).sort()).toEqual(['x', 'y']);
  });
});
