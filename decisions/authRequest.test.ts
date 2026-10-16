import { describe, expect, it } from 'vitest';
import { mintedToken, passwordFrom, registerExtra } from './authRequest';

describe('откуда берётся пароль', () => {
  it('явного нет — берём карточку входа', () => {
    expect(passwordFrom(undefined, 'с-карточки')).toBe('с-карточки');
  });

  it('карточка пуста — пустая строка, а не undefined: дальше её проверит validPassword', () => {
    expect(passwordFrom(undefined, '')).toBe('');
  });

  it('ЯВНЫЙ ПАРОЛЬ ГЛАВНЕЕ КАРТОЧКИ', () => {
    expect(passwordFrom('явный', 'с-карточки')).toBe('явный');
  });

  it('ЯВНЫЙ ПУСТОЙ — тоже главнее: он обязан дойти до проверки, а не подмениться', () => {
    expect(passwordFrom('', 'с-карточки')).toBe('');
  });
});

describe('что добавляется к телу регистрации', () => {
  it('почта введена — уходит', () => {
    expect(registerExtra('a@b.c')).toEqual({ email: 'a@b.c' });
  });

  it('ПОЧТЫ НЕТ — НЕТ И ПОЛЯ: пустой адрес записался бы на учётку', () => {
    expect(registerExtra(undefined)).toEqual({});
    expect(registerExtra('')).toEqual({});
  });
});

describe('какой ответ становится пропуском', () => {
  it('ВХОД ПЕРВЫМ: учётка уже была — токен оттуда', () => {
    expect(mintedToken({ token: 'вход' }, { token: 'регистрация' })).toBe('вход');
  });

  it('вход не дал токена — берём у регистрации (первый вход создаёт учётку)', () => {
    expect(mintedToken({}, { token: 'регистрация' })).toBe('регистрация');
  });

  it('регистрации не было вовсе — только вход', () => {
    expect(mintedToken({ token: 'вход' })).toBe('вход');
    expect(mintedToken({})).toBe(null);
  });

  it('токена нет нигде — null, а не undefined: причину назовёт authRules', () => {
    expect(mintedToken({}, {})).toBe(null);
  });
});
