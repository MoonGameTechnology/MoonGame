import { describe, it, expect } from 'vitest';
import { MIN_PASSWORD } from './authRules';
import {
  CALLSIGNS,
  callsignFor,
  checkRegister,
  nextCallsignNumber,
  registerPayload,
  type RegisterDraft,
} from './registerForm';

const draft = (over: Partial<RegisterDraft> = {}): RegisterDraft => ({
  nick: 'ivan',
  pass: 'longenough1',
  pass2: 'longenough1',
  email: '',
  ...over,
});

describe('регистрация — проверка формы', () => {
  it('целая форма проходит', () => {
    expect(checkRegister(draft())).toBeNull();
  });

  it('КАЖДАЯ БЕДА НАЗЫВАЕТ СВОЁ ПОЛЕ — иначе игрок перебирает поля вслепую', () => {
    expect(checkRegister(draft({ nick: '  ' }))?.field).toBe('nick');
    expect(checkRegister(draft({ pass: 'short', pass2: 'short' }))?.field).toBe('pass');
    expect(checkRegister(draft({ pass2: 'other-one-11' }))?.field).toBe('pass2');
  });

  it('ДЛИНА ПРОВЕРЯЕТСЯ ДО СОВПАДЕНИЯ: короткому паролю говорят про длину, а не про повтор', () => {
    const p = checkRegister(draft({ pass: 'abc', pass2: 'xyz' }));
    expect(p?.field).toBe('pass');
  });

  it('порог длины — общий с authRules, второй копии числа нет', () => {
    const short = 'a'.repeat(MIN_PASSWORD - 1);
    expect(checkRegister(draft({ pass: short, pass2: short }))?.field).toBe('pass');
    const ok = 'a'.repeat(MIN_PASSWORD);
    expect(checkRegister(draft({ pass: ok, pass2: ok }))).toBeNull();
  });

  it('позывной из одних пробелов — это пустой позывной', () => {
    expect(checkRegister(draft({ nick: '\t \n' }))?.key).toBe('auth.need-name');
  });
});

describe('регистрация — что уходит на сервер', () => {
  it('ПУСТАЯ ПОЧТА НЕ УХОДИТ ВОВСЕ: пустая строка — это «почта задана и она пустая»', () => {
    expect(registerPayload(draft())).toEqual({ nick: 'ivan', pass: 'longenough1' });
    expect(registerPayload(draft({ email: '   ' }))).toEqual({
      nick: 'ivan',
      pass: 'longenough1',
    });
  });

  it('заполненная почта уходит обрезанной по краям', () => {
    expect(registerPayload(draft({ email: '  a@b.c ' }))?.email).toBe('a@b.c');
  });

  it('позывной уходит без окружающих пробелов', () => {
    expect(registerPayload(draft({ nick: '  ivan  ' }))?.nick).toBe('ivan');
  });

  it('ПРОВЕРКУ НЕ ОБОЙТИ — нецелая форма не собирается в запрос', () => {
    expect(registerPayload(draft({ pass2: 'mismatch11' }))).toBeNull();
    expect(registerPayload(draft({ nick: '' }))).toBeNull();
  });
});

describe('регистрация — подсказка позывного', () => {
  it('ПОДСКАЗКА ДЕТЕРМИНИРОВАНА: один и тот же номер — одно и то же имя', () => {
    expect(callsignFor(3)).toEqual(callsignFor(3));
  });

  it('второе нажатие предлагает ДРУГОЕ имя, а не то же самое', () => {
    expect(callsignFor(1).key).not.toBe(callsignFor(2).key);
  });

  it('список кончается — счёт идёт по кругу, но номер продолжает расти', () => {
    const n = CALLSIGNS.length;
    expect(callsignFor(n + 1).key).toBe(callsignFor(1).key);
    expect(callsignFor(n + 1).suffix).toBe(n + 1);
  });

  it('ИСПОРЧЕННОЕ ХРАНИЛИЩЕ НЕ ЛОМАЕТ ЭКРАН: мусор и пусто считаются нулём', () => {
    expect(nextCallsignNumber(null)).toBe(1);
    expect(nextCallsignNumber('')).toBe(1);
    expect(nextCallsignNumber('чепуха')).toBe(1);
    expect(nextCallsignNumber('7')).toBe(8);
  });

  it('номер меньше единицы всё равно даёт первое имя, а не пустое', () => {
    expect(callsignFor(0).suffix).toBe(1);
    expect(callsignFor(-5).key).toBe(CALLSIGNS[0]);
  });

  it('в списке нет повторов — иначе подсказка «меняется», оставаясь прежней', () => {
    expect(new Set(CALLSIGNS).size).toBe(CALLSIGNS.length);
  });
});
