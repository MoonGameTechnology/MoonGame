import { describe, it, expect } from 'vitest';
import { dropsSession, joinOutcome, joinQuery, parseJoinPass } from './joinRules';

describe('вход в матч — разбор кода ответа', () => {
  it('успех есть успех — любой 2xx', () => {
    expect(joinOutcome(200)).toBe('ok');
    expect(joinOutcome(201)).toBe('ok');
  });

  it('ОТКАЗЫ РАЗЛИЧИМЫ: закрытое окно, полные места и общий сбой — разные причины', () => {
    expect(joinOutcome(403)).toBe('entry-closed');
    expect(joinOutcome(409)).toBe('seats-full');
    expect(joinOutcome(500)).toBe('failed');
    expect(joinOutcome(404)).toBe('failed');
  });

  it('401 назван истёкшей сессией, а не «не получилось»', () => {
    expect(joinOutcome(401)).toBe('session-expired');
  });
});

describe('вход в матч — что делать с сессией', () => {
  it('ТОЛЬКО 401 СТИРАЕТ СЕССИЮ — иначе клиент вечно стучится просроченным пропуском', () => {
    expect(dropsSession(joinOutcome(401))).toBe(true);
  });

  it('прочие отказы сессию не трогают — она в порядке, закрыт вход в матч', () => {
    for (const code of [403, 409, 500, 404]) {
      expect(dropsSession(joinOutcome(code)), String(code)).toBe(false);
    }
  });

  it('успех сессию, разумеется, не стирает', () => {
    expect(dropsSession(joinOutcome(200))).toBe(false);
  });
});

describe('вход в матч — строка запроса', () => {
  it('без пожеланий — пустая строка, а не голый вопросительный знак', () => {
    expect(joinQuery()).toBe('');
    expect(joinQuery(undefined, undefined)).toBe('');
  });

  it('ПУСТЫЕ ЗНАЧЕНИЯ НЕ ПОПАДАЮТ В ЗАПРОС: `?slot=` это не «без места»', () => {
    expect(joinQuery('', '')).toBe('');
    expect(joinQuery('', 'azure')).toBe('?faction=azure');
  });

  it('место и дом передаются вместе и по отдельности', () => {
    expect(joinQuery('p2')).toBe('?slot=p2');
    expect(joinQuery('p2', 'crimson')).toBe('?slot=p2&faction=crimson');
  });

  it('значения экранируются — они уходят в URL', () => {
    expect(joinQuery('p 2&x=1')).toBe('?slot=p+2%26x%3D1');
  });
});

describe('вход в матч — пропуск', () => {
  it('целый пропуск разбирается', () => {
    expect(parseJoinPass({ token: 'T', playerId: 'p1' })).toEqual({ token: 'T', playerId: 'p1' });
  });

  it('ПОЛОВИНА ПРОПУСКА — НЕ ПРОПУСК', () => {
    expect(parseJoinPass({ token: 'T' })).toBeNull();
    expect(parseJoinPass({ playerId: 'p1' })).toBeNull();
  });

  it('пустые строки не считаются выданными', () => {
    expect(parseJoinPass({ token: '', playerId: 'p1' })).toBeNull();
    expect(parseJoinPass({ token: 'T', playerId: '' })).toBeNull();
  });

  it('чужая форма тела не роняет разбор', () => {
    expect(parseJoinPass(null)).toBeNull();
    expect(parseJoinPass({})).toBeNull();
    expect(parseJoinPass({ token: 7, playerId: 'p1' })).toBeNull();
  });
});
