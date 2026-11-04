import { describe, expect, it } from 'vitest';
import { loginSkeleton, reservedStaffName } from './loginIdentity';

describe('registration identity policy', () => {
  it.each([
    ['att_probe', 'аtt_prоbе'],
    ['coco', 'сосо'],
    ['pilot', 'ｐｉｌｏｔ'],
    ['orbit', 'οrbit'],
    ['Café', 'Cafe\u0301'],
    ['modern', 'rnodern'],
  ])('recognizes %s and %s as visually confusable', (a, b) => {
    expect(loginSkeleton(a)).toBe(loginSkeleton(b));
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
