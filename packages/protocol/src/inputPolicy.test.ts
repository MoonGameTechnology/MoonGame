import { describe, expect, it } from 'vitest';
import {
  passwordIssue,
  validLoginPassword,
  validLogin,
  blockedPublicName,
  parseRecoveryEmail,
  sanitizeChatText,
  censorChatText,
  containsBlockedLanguage,
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
      ' '.repeat(11) + 'a',
      'İ'.repeat(6) + ' '.repeat(6),
      'a' + ' '.repeat(11),
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
      'FÜCK',
      'İdiot',
      'shít',
      'huy',
      'Идиот١',
      'ИдиотⅨ',
      'Идиот¼',
      'sh1t𐒠',
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
    expect(sanitizeChatText('one\u2028two\u2029three', 100)).toBe('one\ntwo\nthree');
    expect(sanitizeChatText('😀😀😀', 2)).toBe('😀😀');
    expect(sanitizeChatText('<b>hello</b> & "quotes"', 100)).toBe('<b>hello</b> & "quotes"');
    expect(sanitizeChatText('\u0000\u200B', 100)).toBe('');
  });
});


describe('multilingual public text moderation', () => {
  it('rejects explicit standalone abuse in multiple languages and scripts', () => {
    for (const name of [
      'Scheiße', 'SCHEISSE', 'Connard', 'Gilipollas', 'Caralho',
      'Vaffanculo', 'Kurwa', 'Йобаний', 'OROSPU', '씨발', '傻逼',
      'मादरचोद', 'شرموطة',
      'fυck', // Greek upsilon used to impersonate a Latin u
    ]) {
      expect(blockedPublicName(name), name).toBe(true);
    }
  });

  it('preserves legitimate names even when a substring resembles an insult', () => {
    for (const safe of [
      'Scunthorpe', 'Assassin', 'Classical', 'Dickinson',
      'Merdeka', 'Shitake', 'Fukushima', 'Корабль',
    ]) {
      expect(blockedPublicName(safe), safe).toBe(false);
      expect(containsBlockedLanguage(safe), safe).toBe(false);
    }
  });

  it('censors complete words, obfuscated letters and multilingual insults but keeps context', () => {
    expect(censorChatText('Hello f.u.c.k and KURWA!', 240)).toBe('Hello *** and ***!');
    expect(censorChatText('S h 1 t', 240)).toBe('***');
    expect(censorChatText('你这个傻逼！', 240)).toBe('你这个***！');
    expect(censorChatText('씨발놈', 240)).toBe('***놈');
    expect(censorChatText('f💥u💥c💥k', 240)).toBe('***');
    expect(censorChatText('sh\u200Bit in the chat', 240)).toBe('*** in the chat');
    expect(censorChatText('You are a connard, Scunthorpe.', 240))
      .toBe('You are a ***, Scunthorpe.');
    expect(censorChatText('Clean text', 240)).toBe('Clean text');
    expect(containsBlockedLanguage('KurWa')).toBe(true);
    expect(containsBlockedLanguage('No profanity here')).toBe(false);
  });

  it('does not let masking bypass the existing trim and length cap', () => {
    expect(censorChatText('  fuck\u0000  ', 240)).toBe('***');
    expect(censorChatText('hello '.repeat(100), 6)).toBe('hello');
  });
});
