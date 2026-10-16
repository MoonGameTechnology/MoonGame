import { describe, expect, it } from 'vitest';
import {
  passwordIssue,
  validLoginPassword,
  validLogin,
  blockedPublicName,
  parseRecoveryEmail,
  sanitizeChatText,
  closedInput,
} from './inputPolicy';

describe('new password policy and legacy authentication', () => {
  it('accepts long phrases and Unicode without composition rules', () => {
    for (const p of [
      'тихая орбита над луной',
      'a quiet orbit above the moon',
      '星空の下を静かに進む艦隊の物語',
    ])
      expect(passwordIssue(p)).toBeNull();
    expect(passwordIssue('some-long-passphrase'.padEnd(128, '!'))).toBeNull();
    expect(passwordIssue('some-long-passphrase'.padEnd(129, '!'))).toBe('length');
  });
  it('rejects short, common, repeating and invisible/control input', () => {
    expect(passwordIssue('elevenchars')).toBe('length');
    for (const p of [
      '123456789012',
      'Password123456!',
      '  Password123456!  ',
      '  abcdabcdabcd  ',
      'qwerty12345678',
      'abcdabcdabcd',
      ' '.repeat(12),
    ])
      expect(passwordIssue(p), p).toBe('weak');
    for (const p of ['valid phrase\u0000here', 'valid phrase\u202Ehere', 'valid phrase\uD800here'])
      expect(passwordIssue(p)).toBe('characters');
  });
  it('does not silently trim or rewrite a password, and admits legacy passwords at login', () => {
    expect(passwordIssue('  a long password  ')).toBeNull();
    expect(validLoginPassword('old-pass')).toBe(true);
    expect(validLoginPassword('12345678')).toBe(true);
    expect(validLoginPassword('x'.repeat(129))).toBe(false);
  });
});

describe('public names', () => {
  it('supports ordinary names without substring false positives', () => {
    for (const name of [
      'Носорог-1',
      'Assassin',
      'Scunthorpe',
      'Shell',
      'Dickinson',
      'Иван',
      'Корабль',
    ]) {
      expect(validLogin(name)).toBe(true);
      expect(blockedPublicName(name), name).toBe(false);
    }
  });
  it('detects RU/EN insults, digit suffixes, separators and script/width substitutions', () => {
    for (const name of [
      'Идиот42',
      'Долбоёб42',
      'У_е_б_о_к',
      'Motherfucker',
      'Д_у_р_а_к',
      'мудак',
      'mуdаk',
      'х_у_й',
      'cyka',
      'suka',
      'fUcK',
      'f_u_c_k',
      'ＦＵＣＫ',
      'sh1t',
      'the_bitch',
      'asshole99',
      'fuck_you',
    ])
      expect(blockedPublicName(name), name).toBe(true);
  });
  it('rejects markup, controls, invisible characters and oversized identifiers', () => {
    for (const name of ['<img>', 'ab\u0000c', 'ab\u200Bc', 'ab\u202Ec', 'a'.repeat(25)])
      expect(validLogin(name)).toBe(false);
  });
});

describe('field-specific input handling', () => {
  it('bounds and normalizes recovery email without accepting header/HTML payloads', () => {
    expect(parseRecoveryEmail('  A@example.com  ')).toBe('A@example.com');
    expect(parseRecoveryEmail(undefined)).toBeUndefined();
    for (const value of [
      'a@example.com\r\nBcc:b@x.com',
      '<img>@x.com',
      'a\u200B@x.com',
      'x'.repeat(255),
      7,
    ])
      expect(parseRecoveryEmail(value)).toBeNull();
  });
  it('rejects arrays and extra properties in closed request bodies', () => {
    expect(closedInput({ login: 'ok' }, ['login'])).toBe(true);
    expect(closedInput([], ['login'])).toBe(false);
    expect(closedInput({ login: 'ok', admin: true }, ['login'])).toBe(false);
    expect(closedInput(JSON.parse('{"__proto__":{}}'), ['login'])).toBe(false);
  });
  it('removes control/bidi tricks and clamps by code points while preserving plain text', () => {
    expect(sanitizeChatText('  hello\u0000\u200B\u202E world\r\nnext\tline  ', 100)).toBe(
      'hello world\nnext\tline',
    );
    expect(sanitizeChatText('😀😀😀', 2)).toBe('😀😀');
    expect(sanitizeChatText('<b>hello</b> & "quotes"', 100)).toBe('<b>hello</b> & "quotes"');
    expect(sanitizeChatText('\u0000\u200B', 100)).toBe('');
  });
});
