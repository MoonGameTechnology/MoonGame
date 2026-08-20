import { describe, expect, it } from 'vitest';
import { authStatusUrl, identityMode, revealSignup, type ProbeResponse } from './identityProbe';

const ответ = (ok: boolean, body: unknown): (() => Promise<ProbeResponse>) => {
  return () => Promise.resolve({ ok, json: () => Promise.resolve(body) });
};

describe('адрес пробы', () => {
  it('тот же сервер, что и сокет — схема меняется на http', () => {
    expect(authStatusUrl('ws://host:8788')).toBe('http://host:8788/auth/status');
    expect(authStatusUrl('wss://void.example')).toBe('https://void.example/auth/status');
  });
});

describe('что означает проба /auth/status', () => {
  it('ЖИВОЕ «ДА»: только оно включает режим аккаунтов', async () => {
    await expect(identityMode(ответ(true, { enabled: true }))).resolves.toBe('accounts');
  });

  it('сервер ответил «нет» — позывные', async () => {
    await expect(identityMode(ответ(true, { enabled: false }))).resolves.toBe('nicks');
  });

  it('404 С ОБЫЧНОЙ РАЗДАЧИ — это ответ «аккаунтов тут нет», а не беда', async () => {
    await expect(identityMode(ответ(false, { enabled: true }))).resolves.toBe('nicks');
  });

  it('тело у ответа «не 2xx» не читают вовсе — иначе HTML-404 бросил бы SyntaxError', async () => {
    let читали = false;
    const html = (): Promise<ProbeResponse> =>
      Promise.resolve({
        ok: false,
        json: () => {
          читали = true;
          return Promise.reject(new SyntaxError('<!doctype html>'));
        },
      });
    await expect(identityMode(html)).resolves.toBe('nicks');
    expect(читали).toBe(false);
  });

  it('НЕ ДОШЛИ ДО СЕРВЕРА — позывные, а не запертый вход', async () => {
    await expect(identityMode(() => Promise.reject(new Error('offline')))).resolves.toBe('nicks');
  });

  it('тело не разобралось у ответа 2xx — тоже позывные', async () => {
    const битое = (): Promise<ProbeResponse> =>
      Promise.resolve({ ok: true, json: () => Promise.reject(new SyntaxError('нет JSON')) });
    await expect(identityMode(битое)).resolves.toBe('nicks');
  });

  it('«почти да» не считается: строка, единица и отсутствие поля — позывные', async () => {
    for (const enabled of ['true', 1, undefined, null, {}]) {
      await expect(identityMode(ответ(true, { enabled }))).resolves.toBe('nicks');
    }
  });
});

describe('раскрывать ли форму на приветственной карточке', () => {
  it('НОВИЧОК НА СЕРВЕРЕ С АККАУНТАМИ: раскрываем', () => {
    expect(revealSignup('accounts', '')).toBe(true);
  });

  it('позывной запомнен — карточку пропустили, раскрывать нечего', () => {
    expect(revealSignup('accounts', 'Гончая')).toBe(false);
  });

  it('пробелы вместо позывного — всё-таки новичок', () => {
    expect(revealSignup('accounts', '   ')).toBe(true);
  });

  it('без аккаунтов пароль не спрашивают ни у кого', () => {
    expect(revealSignup('nicks', '')).toBe(false);
    expect(revealSignup('nicks', 'Гончая')).toBe(false);
  });
});
