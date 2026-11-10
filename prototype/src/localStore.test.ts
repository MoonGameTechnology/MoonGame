import { afterEach, describe, expect, it, vi } from 'vitest';
import { readLocal, writeLocal } from './localStore';

describe('localStore', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('reads and writes through to localStorage when it works', () => {
    const map = new Map<string, string>();
    vi.stubGlobal('localStorage', {
      getItem: (k: string) => map.get(k) ?? null,
      setItem: (k: string, v: string) => void map.set(k, v),
    });
    writeLocal('void.nick', 'Ace');
    expect(readLocal('void.nick')).toBe('Ace');
  });

  it('a storage that refuses reads as empty and drops the write instead of throwing', () => {
    const refuse = (): never => {
      throw new DOMException('denied', 'SecurityError');
    };
    vi.stubGlobal('localStorage', { getItem: refuse, setItem: refuse });
    expect(readLocal('void.nick')).toBeNull();
    expect(() => writeLocal('void.nick', 'Ace')).not.toThrow();
  });
});
