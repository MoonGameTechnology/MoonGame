import { describe, it, expect } from 'vitest';
import { deepClone, deepEqual, deepFreeze, shareImmutable } from './clone';
import { hashJson } from '../state/hash';

describe('deepClone', () => {
  it('produces an equal but fully independent copy', () => {
    const src = { a: 1, b: { c: [1, 2, 3] }, d: null, e: 'x' };
    const copy = deepClone(src);

    expect(copy).toEqual(src);
    expect(copy).not.toBe(src);
    expect(copy.b).not.toBe(src.b);
    expect(copy.b.c).not.toBe(src.b.c);

    copy.b.c.push(4);
    expect(src.b.c).toEqual([1, 2, 3]); // original untouched
  });

  it('returns primitives unchanged', () => {
    expect(deepClone(42)).toBe(42);
    expect(deepClone('hello')).toBe('hello');
    expect(deepClone(null)).toBe(null);
    expect(deepClone(true)).toBe(true);
  });

  it('clones nested arrays of objects', () => {
    const src = [{ x: 1 }, { x: 2 }];
    const copy = deepClone(src);
    copy[0]!.x = 99;
    expect(src[0]!.x).toBe(1);
  });
});

describe('deepEqual', () => {
  it('compares primitives and null strictly', () => {
    expect(deepEqual(1, 1)).toBe(true);
    expect(deepEqual('a', 'a')).toBe(true);
    expect(deepEqual(null, null)).toBe(true);
    expect(deepEqual(1, '1')).toBe(false);
    expect(deepEqual(null, {})).toBe(false);
    expect(deepEqual(0, -0)).toBe(true); // === semantics, like the stringify it replaces
  });

  it('compares nested structures and short-circuits on any difference', () => {
    const a = { p: { x: 1, list: [{ unit: 'cruiser', count: 2 }] } };
    expect(deepEqual(a, { p: { x: 1, list: [{ unit: 'cruiser', count: 2 }] } })).toBe(true);
    expect(deepEqual(a, { p: { x: 1, list: [{ unit: 'cruiser', count: 3 }] } })).toBe(false);
    expect(deepEqual(a, { p: { x: 1, list: [] } })).toBe(false);
  });

  it('ignores object key order (logical equality, matching hashState)', () => {
    expect(deepEqual({ a: 1, b: 2 }, { b: 2, a: 1 })).toBe(true);
  });

  it('treats an undefined-valued key as absent (JSON semantics)', () => {
    expect(deepEqual({ a: 1, hp: undefined }, { a: 1 })).toBe(true);
    expect(deepEqual({ a: 1 }, { a: 1, hp: undefined })).toBe(true);
    expect(deepEqual({ a: 1, hp: 0 }, { a: 1 })).toBe(false);
  });

  it('keeps array order significant and distinguishes arrays from objects', () => {
    expect(deepEqual([1, 2], [2, 1])).toBe(false);
    expect(deepEqual([1, 2], [1, 2])).toBe(true);
    expect(deepEqual([], {})).toBe(false);
    expect(deepEqual({}, [])).toBe(false);
  });

  it('never matches a key through the prototype chain', () => {
    expect(deepEqual({ constructor: 'x' }, {})).toBe(false);
    expect(deepEqual({}, { constructor: 'x' })).toBe(false);
  });
});

describe('deepFreeze', () => {
  it('freezes the whole object graph', () => {
    const obj = deepFreeze({ a: { b: { c: 1 } }, list: [{ z: 1 }] });
    expect(Object.isFrozen(obj)).toBe(true);
    expect(Object.isFrozen(obj.a)).toBe(true);
    expect(Object.isFrozen(obj.a.b)).toBe(true);
    expect(Object.isFrozen(obj.list)).toBe(true);
    expect(Object.isFrozen(obj.list[0])).toBe(true);
  });
});

describe('shareImmutable — a subtree the clone shares instead of copying (ROADS-7)', () => {
  it('deepClone hands the marked subtree back as is and still copies the rest', () => {
    const roads = shareImmutable({
      crossings: { B: { x: 1, y: 2 } },
      trails: [{ exits: ['B'], fork: null }],
    });
    const state = { planet: { id: 'A', roads }, owner: { name: 'p1' } };
    const copy = deepClone(state);
    expect(copy.planet.roads).toBe(roads);
    expect(copy.planet).not.toBe(state.planet);
    expect(copy.owner).not.toBe(state.owner);
  });

  it('the shared value is frozen through and through — sharing cannot leak a mutation', () => {
    const roads = shareImmutable({ trails: [{ exits: ['B'], fork: { x: 1, y: 2 } }] });
    expect(Object.isFrozen(roads.trails[0]!.fork)).toBe(true);
    expect(() => {
      (roads.trails[0]!.fork as { x: number }).x = 9;
    }).toThrow(TypeError);
  });

  it('the mark is invisible to keys, JSON and the state hash', () => {
    const plain = { crossings: { B: { x: 1, y: 2 } }, trails: [{ exits: ['B'], fork: null }] };
    const marked = shareImmutable(JSON.parse(JSON.stringify(plain)) as typeof plain);
    expect(Object.keys(marked)).toEqual(Object.keys(plain));
    expect(JSON.stringify(marked)).toBe(JSON.stringify(plain));
    expect(hashJson(marked)).toBe(hashJson(plain));
    expect(deepEqual(marked, plain)).toBe(true);
  });

  it('a value frozen WITHOUT the mark is still copied — the purity tests keep their meaning', () => {
    const frozen = deepFreeze({ a: { b: 1 } });
    const copy = deepClone(frozen);
    expect(copy).not.toBe(frozen);
    expect(copy.a).not.toBe(frozen.a);
    expect(Object.isFrozen(copy)).toBe(false);
  });

  it('a JSON round trip drops the mark: the copy is cloned like everything else', () => {
    const marked = shareImmutable({ a: { b: 1 } });
    const revived = JSON.parse(JSON.stringify(marked)) as typeof marked;
    expect(deepClone(revived)).not.toBe(revived);
  });

  it('an already frozen, unmarked object does not throw; its children are still shared', () => {
    const inner = { x: 1 };
    const outer = Object.freeze({ inner });
    expect(() => shareImmutable(outer)).not.toThrow();
    expect(deepClone(outer)).not.toBe(outer);
    expect(deepClone(outer).inner).toBe(inner);
  });
});
