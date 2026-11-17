import { describe, expect, it } from 'vitest';
import { badgeAt, badgeTap, hangarBadge, parkedState } from './hangarBadge';

describe('hangarBadge', () => {
  it('no squadrons → no badge', () => {
    expect(hangarBadge({ squadronIds: [], blocked: 'empty', refueling: 0 })).toBeNull();
  });

  it('one badge per base, counted, ready when some squadron can launch', () => {
    expect(hangarBadge({ squadronIds: ['a', 'b'], blocked: null, refueling: 1 })).toEqual({
      count: 2,
      ready: true,
      squadronIds: ['a', 'b'],
    });
    expect(hangarBadge({ squadronIds: ['a', 'b'], blocked: null, refueling: 2 })?.ready).toBe(
      false,
    );
    expect(hangarBadge({ squadronIds: ['a'], blocked: 'busy', refueling: 0 })?.ready).toBe(false);
  });
});

describe('parkedState', () => {
  it('names the reason in its own word, refuel with its deadline', () => {
    expect(parkedState(null, undefined, 100)).toEqual({ kind: 'ready' });
    expect(parkedState(null, 100, 100)).toEqual({ kind: 'ready' }); // срок вышел ровно сейчас
    expect(parkedState(null, 160, 100)).toEqual({ kind: 'refueling', readyAt: 160 });
  });

  it('a carrier in battle outranks the refuel: it still blocks after the tank is full', () => {
    expect(parkedState('busy', 160, 100)).toEqual({ kind: 'busy' });
  });
});

describe('badgeAt', () => {
  const hits = [
    { x: 100, y: 100, halfW: 22, halfH: 22, squadronIds: ['a'] },
    { x: 130, y: 100, halfW: 22, halfH: 22, squadronIds: ['b'] },
  ];
  it('takes the nearest badge whose target covers the tap', () => {
    expect(badgeAt(hits, 104, 100)?.squadronIds).toEqual(['a']);
    expect(badgeAt(hits, 126, 100)?.squadronIds).toEqual(['b']);
  });
  it('misses outside every target', () => {
    expect(badgeAt(hits, 100, 140)).toBeNull();
  });
});

describe('badgeTap', () => {
  it('a single squadron is picked at once', () => {
    expect(badgeTap(['a'], null, true)).toEqual({ pick: 'a' });
    expect(badgeTap(['a'], 'a', false)).toEqual({ pick: 'a' });
  });
  it('phone: several open a list', () => {
    expect(badgeTap(['a', 'b'], null, true)).toEqual({ list: ['a', 'b'] });
  });
  it('PC: repeat tap cycles, a fresh tap starts from the first', () => {
    expect(badgeTap(['a', 'b', 'c'], null, false)).toEqual({ pick: 'a' });
    expect(badgeTap(['a', 'b', 'c'], 'a', false)).toEqual({ pick: 'b' });
    expect(badgeTap(['a', 'b', 'c'], 'c', false)).toEqual({ pick: 'a' });
    expect(badgeTap(['a', 'b', 'c'], 'zzz', false)).toEqual({ pick: 'a' });
  });
  it('nothing under the badge → nothing', () => {
    expect(badgeTap([], null, false)).toBeNull();
  });
});
