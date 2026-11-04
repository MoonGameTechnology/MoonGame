import { describe, expect, it } from 'vitest';
import { loginSkeleton, loginSkeletons, reservedStaffName } from './loginIdentity';
import { validLogin } from './inputPolicy';
import confusables from './unicode-confusables.json';

describe('registration identity policy', () => {
  it('preserves all pinned Unicode mappings whose two sides are valid handles', () => {
    const missed: string[][] = [];
    let checked = 0;
    for (const [source, target] of Object.entries(confusables.mapping)) {
      const a = `x${source}xx`,
        b = `x${target}xx`;
      if (!validLogin(a) || !validLogin(b)) continue;
      checked++;
      const keys = new Set(loginSkeletons(a));
      if (!loginSkeletons(b).some((key) => keys.has(key))) missed.push([source, target]);
    }
    expect(checked).toBeGreaterThan(2000);
    expect({ count: missed.length, examples: missed.slice(0, 20) }).toEqual({
      count: 0,
      examples: [],
    });
  });
  it('preserves role tokens through all valid mapped glyphs, including separators', () => {
    const missed: string[] = [];
    for (const name of ['admin', 'moderator', 'official', 'support', 'op-admin', 'администратор']) {
      for (const form of new Set([name, name.toUpperCase(), ...loginSkeletons(name)])) {
        for (const [source, target] of Object.entries(confusables.mapping)) {
          if (!form.includes(target)) continue;
          const alias = form.replace(target, source);
          if (validLogin(alias) && !reservedStaffName(alias)) missed.push(alias);
        }
      }
    }
    expect({ count: missed.length, examples: missed.slice(0, 20) }).toEqual({
      count: 0,
      examples: [],
    });
  });
  it.each([
    ['foco', 'foϲo'],
    ['OFFICIAL', 'OFFIϹIAL'],
    ['MODERATOR', 'МODERATOR'],
    ['MangoDrive', 'МangoDrive'],
    ['vector', 'νector'],
    ['att_probe', 'аtt_prоbе'],
    ['coco', 'сосо'],
    ['pilot', 'ｐｉｌｏｔ'],
    ['orbit', 'οrbit'],
    ['Café', 'Cafe\u0301'],
    ['modern', 'rnodern'],
  ])('recognizes %s and %s as visually confusable', (a, b) => {
    const keys = new Set(loginSkeletons(a));
    expect(loginSkeletons(b).some((key) => keys.has(key))).toBe(true);
  });
  it('keeps unrelated international names distinct', () => {
    expect(new Set(['Роман', 'Алексей', '星空', 'orbit', 'fox'].map(loginSkeleton)).size).toBe(5);
  });
  it.each([
    'moderator',
    'administrator',
    'op-admin',
    'аdmin',
    'admin123',
    'поддержка',
    'МОДЕРАТОР',
  ])('reserves %s', (name) => {
    expect(reservedStaffName(name)).toBe(true);
  });
  it.each(['Admiral', 'AdministratorFan', 'Роман', 'Supporter', '星空'])('permits %s', (name) => {
    expect(reservedStaffName(name)).toBe(false);
  });
});
