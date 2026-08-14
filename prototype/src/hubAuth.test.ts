import { describe, expect, it } from 'vitest';
import { authorizedBase } from './hubAuth';

const httpBase = (b: string) => b.replace(/^ws/, 'http');
const полный = { server: { base: 'wss://srv' }, accountsMode: true, token: 'tok' };

describe('авторизованный адрес вкладки хаба', () => {
  it('все три условия есть — вкладка идёт в сеть от имени аккаунта', () => {
    expect(authorizedBase(полный, httpBase)).toEqual({ base: 'https://srv', token: 'tok' });
  });

  it('НЕТ СЕРВЕРА — ГОСТЬ: иначе вкладка стучится в никуда', () => {
    expect(authorizedBase({ ...полный, server: null }, httpBase)).toBeNull();
  });

  it('РЕЖИМ АККАУНТОВ НЕ ПОДТВЕРЖДЁН — ГОСТЬ: тот же адрес бывает поднят без аккаунтов', () => {
    expect(authorizedBase({ ...полный, accountsMode: false }, httpBase)).toBeNull();
  });

  it('НЕТ СЕССИИ — ГОСТЬ, а не запрос без токена: иначе сервер ответит 401 вместо «войдите»', () => {
    expect(authorizedBase({ ...полный, token: null }, httpBase)).toBeNull();
    expect(authorizedBase({ ...полный, token: '' }, httpBase)).toBeNull();
  });

  it('ТРИ ОТКАЗА ЧИТАЮТСЯ ОДИНАКОВО — гостевое состояние, а не разные ошибки (правило 3)', () => {
    const отказы = [
      authorizedBase({ ...полный, server: null }, httpBase),
      authorizedBase({ ...полный, accountsMode: false }, httpBase),
      authorizedBase({ ...полный, token: null }, httpBase),
    ];
    expect(отказы).toEqual([null, null, null]);
  });

  it('адрес приводится к http тем же преобразованием, что и остальной клиент', () => {
    expect(
      authorizedBase({ ...полный, server: { base: 'ws://localhost:8080' } }, httpBase),
    ).toEqual({ base: 'http://localhost:8080', token: 'tok' });
  });
});
