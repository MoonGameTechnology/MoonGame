import { describe, it, expect } from 'vitest';
import { MIN_PASSWORD, authOutcome, shouldRegister, validLogin, validPassword } from './authRules';

describe('учётные данные — позывной', () => {
  it('обычные позывные принимаются', () => {
    for (const ok of ['ivan', 'Иван', 'p_1', 'wing-42', 'абв'])
      expect(validLogin(ok), ok).toBe(true);
  });

  it('КИРИЛЛИЦА — полноправный позывной, а не «непонятные символы»', () => {
    expect(validLogin('Командир')).toBe(true);
  });

  it('слишком короткий и слишком длинный отсекаются', () => {
    expect(validLogin('ab')).toBe(false);
    expect(validLogin('a'.repeat(25))).toBe(false);
    expect(validLogin('a'.repeat(24))).toBe(true);
  });

  it('пробелы и пунктуация не проходят — иначе позывной не отличить от фразы', () => {
    for (const bad of ['иван петров', 'ivan!', 'ivan@mail', '', 'a b']) {
      expect(validLogin(bad), bad).toBe(false);
    }
  });
});

describe('учётные данные — пароль', () => {
  it('порог — восемь знаков', () => {
    expect(MIN_PASSWORD).toBe(8);
    expect(validPassword('1234567')).toBe(false);
    expect(validPassword('12345678')).toBe(true);
  });

  it('пустой пароль не проходит', () => {
    expect(validPassword('')).toBe(false);
  });
});

describe('вход-или-регистрация — разбор ответов', () => {
  it('токен на входе — вошли', () => {
    expect(authOutcome({ status: 200, token: 'T' })).toBe('ok');
  });

  it('токен на регистрации — учётку завели', () => {
    expect(authOutcome({ status: 401 }, { status: 200, token: 'T' })).toBe('created');
  });

  it('401 НА ВХОДЕ + 409 НА РЕГИСТРАЦИИ = НЕВЕРНЫЙ ПАРОЛЬ, а не «отказ регистрации»', () => {
    expect(authOutcome({ status: 401 }, { status: 409, error: 'E_LOGIN_TAKEN' })).toBe(
      'wrong-password',
    );
  });

  it('занятая почта названа своей причиной — она про почту, не про пароль', () => {
    expect(authOutcome({ status: 401 }, { status: 409, error: 'E_EMAIL_TAKEN' })).toBe(
      'mail-taken',
    );
  });

  it('ограничение частоты распознаётся на обоих шагах', () => {
    expect(authOutcome({ status: 429 })).toBe('rate-limited');
    expect(authOutcome({ status: 401 }, { status: 429 })).toBe('rate-limited');
  });

  it('прочий отказ входа не выдаётся за отказ регистрации', () => {
    expect(authOutcome({ status: 500 })).toBe('login-refused');
    expect(authOutcome({ status: 403 })).toBe('login-refused');
  });

  it('прочий отказ регистрации остаётся отказом регистрации', () => {
    expect(authOutcome({ status: 401 }, { status: 400 })).toBe('register-refused');
  });

  it('до регистрации не дошло — причина остаётся про вход', () => {
    expect(authOutcome({ status: 401 })).toBe('login-refused');
  });
});

describe('вход-или-регистрация — когда пробовать регистрацию', () => {
  it('только на 401: сервер не сказал «нет такого», он сказал «не пущу»', () => {
    expect(shouldRegister({ status: 401 })).toBe(true);
    expect(shouldRegister({ status: 429 })).toBe(false);
    expect(shouldRegister({ status: 500 })).toBe(false);
  });

  it('успешный вход регистрацию не запускает', () => {
    expect(shouldRegister({ status: 200, token: 'T' })).toBe(false);
  });
});
