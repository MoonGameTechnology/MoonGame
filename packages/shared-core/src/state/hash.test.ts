import { describe, expect, it } from 'vitest';
import { createInitialState, type GameState, type Planet, type Player } from './gameState';
import { applyDelta, diffState } from './delta';
import { hashJson, hashJsonJob, hashState, hashStateJob } from './hash';

function player(id: string): Player {
  return {
    id,
    name: `name-${id}`,
    faction: 'vanguard',
    status: 'active',
    resources: { credits: 100, metal: 50 },
  };
}

function planet(id: string, owner: string | null): Planet {
  return {
    id,
    owner,
    position: { x: 1, y: 2 },
    links: ['a', 'b'],
    resources: { ore: 3 },
    buildings: [{ type: 'mine', level: 1, hp: 10 }],
    garrison: [{ unit: 'militia', count: 2 }],
    traits: [],
  };
}

function fixtureState(): GameState {
  const base = createInitialState({ seed: 'hash-fixture', version: { data: '1', manifest: '1' } });
  return {
    ...base,
    players: { p1: player('p1'), p2: player('p2') },
    planets: { home: planet('home', 'p1'), nexus: planet('nexus', null) },
  };
}

/** Rebuild every object with its keys in reverse insertion order (arrays kept) —
 *  a logically identical state whose key order differs everywhere. */
function reorderKeys(value: unknown): unknown {
  if (Array.isArray(value)) {
    return (value as unknown[]).map(reorderKeys);
  }
  if (value !== null && typeof value === 'object') {
    const obj = value as Record<string, unknown>;
    const out: Record<string, unknown> = {};
    for (const key of Object.keys(obj).reverse()) {
      out[key] = reorderKeys(obj[key]);
    }
    return out;
  }
  return value;
}

describe('hashState', () => {
  // Golden: locks the digest algorithm + canonical serialization. If this changes
  // unintentionally, cross-version hash comparison is invalid — change on purpose.
  // Last deliberate change: added GameState.startedAt (match-start anchor for dayGate).
  it('is a stable golden digest of a fixture state', () => {
    expect(hashState(fixtureState())).toBe('0e9f320374ccc4');
  });

  it('is independent of object key order (server-built vs delta-reconstructed)', () => {
    const state = fixtureState();
    expect(hashState(reorderKeys(state) as GameState)).toBe(hashState(state));
  });

  it('matches across a diffState/applyDelta round-trip (the desync property)', () => {
    const prev = fixtureState();
    const next: GameState = {
      ...prev,
      players: { p1: { ...player('p1'), resources: { credits: 999, metal: 50 } }, p2: player('p2') },
    };
    const reconstructed = applyDelta(prev, diffState(prev, next));
    expect(hashState(reconstructed)).toBe(hashState(next));
  });

  it('changes when any field changes', () => {
    const a = fixtureState();
    const b: GameState = {
      ...a,
      players: { p1: { ...player('p1'), name: 'changed' }, p2: player('p2') },
    };
    expect(hashState(b)).not.toBe(hashState(a));
  });

  it('is deterministic (same input → same digest)', () => {
    expect(hashState(fixtureState())).toBe(hashState(fixtureState()));
  });
});

// MP-4 uses this generic primitive directly (hashGameDataBundle, data/loadGameData.ts) —
// hashState is now just hashJson(state), so these pin the primitive on its own terms.
describe('hashJson', () => {
  it('is deterministic (same input → same digest)', () => {
    const value = { units: { frigate: { hp: 10 } }, resources: ['credits', 'metal'] };
    expect(hashJson(value)).toBe(hashJson(value));
  });

  it('is independent of object key order', () => {
    const a = { units: { frigate: { hp: 10, attack: 5 } }, version: '1' };
    const b = { version: '1', units: { frigate: { attack: 5, hp: 10 } } };
    expect(hashJson(a)).toBe(hashJson(b));
  });

  it('changes when any field changes', () => {
    const a = { units: { frigate: { hp: 10 } } };
    const b = { units: { frigate: { hp: 11 } } };
    expect(hashJson(a)).not.toBe(hashJson(b));
  });

  it('agrees with hashState on a GameState value (same primitive)', () => {
    const state = fixtureState();
    expect(hashJson(state)).toBe(hashState(state));
  });
});

/** The digest as it was first written: build the canonical text, then hash it. The
 *  streaming walker must stay equal to it byte for byte — the golden above pins one
 *  value, this pins the whole mapping. */
function referenceHash(value: unknown): string {
  const text = (v: unknown): string => {
    if (v === null || typeof v === 'number' || typeof v === 'boolean') return String(v);
    if (typeof v === 'string') return JSON.stringify(v);
    if (Array.isArray(v)) {
      // By index, not `map`: a hole reads as `null`, as it always has.
      let out = '[';
      for (let i = 0; i < v.length; i++) out += (i > 0 ? ',' : '') + text(v[i]);
      return out + ']';
    }
    if (typeof v === 'object') {
      const obj = v as Record<string, unknown>;
      const keys = Object.keys(obj)
        .filter((k) => obj[k] !== undefined)
        .sort();
      return '{' + keys.map((k) => JSON.stringify(k) + ':' + text(obj[k])).join(',') + '}';
    }
    return 'null';
  };
  const input = text(value);
  let h1 = 0xdeadbeef;
  let h2 = 0x41c6ce57;
  for (let i = 0; i < input.length; i++) {
    const ch = input.charCodeAt(i);
    h1 = Math.imul(h1 ^ ch, 2654435761);
    h2 = Math.imul(h2 ^ ch, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507);
  h1 ^= Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507);
  h2 ^= Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return (4294967296 * (2097151 & h2) + (h1 >>> 0)).toString(16).padStart(14, '0');
}

/** A seeded random JSON tree: nested objects and arrays of every primitive kind. */
function randomTree(seed: number, depth = 4): unknown {
  let x = seed >>> 0 || 1;
  const rnd = (): number => {
    x ^= x << 13;
    x ^= x >>> 17;
    x ^= x << 5;
    return (x >>> 0) / 4294967296;
  };
  const leaf = (): unknown => {
    const pick = Math.floor(rnd() * 8);
    if (pick === 0) return null;
    if (pick === 1) return rnd() < 0.5;
    if (pick === 2) return Math.floor(rnd() * 2000) - 1000;
    if (pick === 3) return rnd() * 1e6 - 5e5;
    if (pick === 4) return undefined;
    if (pick === 5) return 'id-' + Math.floor(rnd() * 99);
    if (pick === 6) return 'кириллица "кавычки" \\ \n\u0001 ☄';
    return '';
  };
  const node = (d: number): unknown => {
    if (d === 0 || rnd() < 0.25) return leaf();
    const n = Math.floor(rnd() * 6);
    if (rnd() < 0.4) return Array.from({ length: n }, () => node(d - 1));
    const obj: Record<string, unknown> = {};
    for (let i = 0; i < n; i++) obj['k' + Math.floor(rnd() * 20) + (rnd() < 0.2 ? '"\\' : '')] = node(d - 1);
    return obj;
  };
  return node(depth);
}

describe('hashJson — streamed, never building the text', () => {
  it('matches the text-then-hash reference on states and random trees', () => {
    expect(hashState(fixtureState())).toBe(referenceHash(fixtureState()));
    for (let seed = 1; seed <= 300; seed++) {
      const tree = randomTree(seed);
      expect(hashJson(tree)).toBe(referenceHash(tree));
    }
  });

  it('matches the reference on the edge values of String() and JSON.stringify()', () => {
    const sparse: unknown[] = [1];
    sparse[3] = 2;
    const edges: unknown[] = [
      -0,
      Number.NaN,
      Number.POSITIVE_INFINITY,
      1e21,
      5e-7,
      [],
      {},
      [[], [{}], { a: [] }],
      [undefined, () => 1, null],
      { a: undefined, b: null, c: () => 1 },
      sparse,
      { '': 1, 'a"b': 2, 'б': 3, 'B': 4, '\u2028': 5 },
      'plain',
      '\ud83d\ude80 \ud800',
    ];
    for (const value of edges) expect(hashJson(value)).toBe(referenceHash(value));
    expect(hashJson(edges)).toBe(referenceHash(edges));
  });

  it('gives the same digest in slices of any size, and null until it is done', () => {
    const state = fixtureState();
    const whole = hashState(state);
    for (const budget of [1, 2, 7, 64]) {
      const job = hashStateJob(state);
      let slices = 0;
      let digest: string | null = null;
      while (digest === null) {
        digest = job.step(budget);
        slices++;
      }
      expect(digest).toBe(whole);
      expect(job.step(budget)).toBe(whole); // a finished job keeps its answer
      if (budget === 1) expect(slices).toBeGreaterThan(20);
    }
    for (let seed = 1; seed <= 50; seed++) {
      const tree = randomTree(seed, 5);
      const job = hashJsonJob(tree);
      let digest: string | null = null;
      while (digest === null) digest = job.step(3);
      expect(digest).toBe(hashJson(tree));
    }
  });

  it('a primitive root is done on the first step', () => {
    expect(hashJsonJob('x').step(1)).toBe(hashJson('x'));
    expect(hashJsonJob(42).step(0)).toBe(referenceHash(42));
  });
});
