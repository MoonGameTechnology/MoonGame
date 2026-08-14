import { describe, expect, it } from 'vitest';
import { afterTokenRefused, joinStep } from './joinGate';

const состояние = (over: Partial<Parameters<typeof joinStep>[0]> = {}) => ({
  accountsMode: true,
  serverKnown: true,
  hasSession: true,
  ...over,
});

describe('просьба вступить в матч', () => {
  it('сервер без аккаунтов — подключаемся сразу, входа он не требует', () => {
    expect(joinStep(состояние({ accountsMode: false }))).toEqual({ step: 'connect' });
    // и это верно даже когда ни сервера, ни сессии нет
    expect(joinStep({ accountsMode: false, serverKnown: false, hasSession: false })).toEqual({
      step: 'connect',
    });
  });

  it('есть сессия — идём за токеном на вступление', () => {
    expect(joinStep(состояние())).toEqual({ step: 'token' });
  });

  it('ПАРОЛЬ СПРАШИВАЮТ ТОЛЬКО ПРИ ИЗВЕСТНОМ СЕРВЕРЕ: иначе спрашивать не у кого', () => {
    expect(joinStep(состояние({ serverKnown: false, hasSession: false }))).toEqual({
      step: 'sign-in',
      password: false,
    });
    expect(joinStep(состояние({ hasSession: false }))).toEqual({ step: 'sign-in', password: true });
  });

  it('сервер неизвестен — на вход без пароля, даже если сессия откуда-то есть', () => {
    expect(joinStep(состояние({ serverKnown: false }))).toEqual({
      step: 'sign-in',
      password: false,
    });
  });
});

describe('отказ в токене на вступление', () => {
  it('СЕССИЯ ПРОПАЛА — ВХОД ПРОСРОЧЕН: зовём войти заново', () => {
    expect(afterTokenRefused(false)).toBe('sign-in');
  });

  it('СЕССИЯ НА МЕСТЕ — ЗАКРЫТ САМ МАТЧ: на карточку входа не отправляем (правило 4)', () => {
    // иначе игрок решит, что дело в пароле, и пойдёт менять его вместо выбора матча
    expect(afterTokenRefused(true)).toBe('stay');
  });
});
