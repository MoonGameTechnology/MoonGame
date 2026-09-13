import { describe, it, expect } from 'vitest';
import {
  anyToken,
  clearSession,
  parseSession,
  readSession,
  saveSession,
  sessionKey,
  tokenFor,
  type KeyValueStore,
} from './sessionStore';

/** Хранилище в памяти — то же поведение, что у `localStorage`, но без DOM. */
function memStore(seed: Record<string, string> = {}): KeyValueStore & { dump: () => typeof seed } {
  const map = new Map(Object.entries(seed));
  return {
    getItem: (k) => map.get(k) ?? null,
    setItem: (k, v) => void map.set(k, v),
    removeItem: (k) => void map.delete(k),
    dump: () => Object.fromEntries(map),
  };
}

const SRV = 'https://play.example';
const OTHER = 'http://localhost:8787';

describe('сессия — ключ на сервер', () => {
  it('АДРЕС ВХОДИТ В КЛЮЧ: токен dev-сервера не уедет на боевой', () => {
    expect(sessionKey(SRV)).not.toBe(sessionKey(OTHER));
    const store = memStore();
    saveSession(store, SRV, { login: 'ivan', token: 'T-prod' });
    expect(anyToken(store, OTHER)).toBeNull();
    expect(anyToken(store, SRV)).toBe('T-prod');
  });

  it('очистка забывает ТОЛЬКО свой сервер', () => {
    const store = memStore();
    saveSession(store, SRV, { login: 'ivan', token: 'T-prod' });
    saveSession(store, OTHER, { login: 'ivan', token: 'T-dev' });
    clearSession(store, SRV);
    expect(anyToken(store, SRV)).toBeNull();
    expect(anyToken(store, OTHER)).toBe('T-dev');
  });
});

describe('сессия — токен принадлежит позывному', () => {
  const store = () => {
    const s = memStore();
    saveSession(s, SRV, { login: 'ivan', token: 'T-ivan' });
    return s;
  };

  it('свой позывной получает свой токен', () => {
    expect(tokenFor(store(), SRV, 'ivan')).toBe('T-ivan');
  });

  it('ЧУЖОЙ ПОЗЫВНОЙ НЕ ПОЛУЧАЕТ НИЧЕГО — иначе вход под чужим именем', () => {
    expect(tokenFor(store(), SRV, 'petr')).toBeNull();
  });

  it('регистр в позывном не разводит одного игрока на двоих', () => {
    expect(tokenFor(store(), SRV, 'IVAN')).toBe('T-ivan');
    expect(tokenFor(store(), SRV, 'Ivan')).toBe('T-ivan');
  });

  it('НЕкритичный путь берёт любой токен сервера — но не решает, кто ты', () => {
    expect(anyToken(store(), SRV)).toBe('T-ivan');
    expect(tokenFor(store(), SRV, 'petr')).toBeNull(); // а вот тут уже строго
  });
});

describe('сессия — разбор записи', () => {
  it('пустое хранилище — сессии нет', () => {
    expect(parseSession(null)).toBeNull();
    expect(readSession(memStore(), SRV)).toBeNull();
  });

  it('ЛЕГАСИ голый JWT читается как «нет сессии», а не как чужая учётка', () => {
    expect(parseSession('"eyJhbGciOi.токен"')).toBeNull();
    expect(parseSession('eyJhbGciOi.токен')).toBeNull(); // даже не JSON
  });

  it('битый JSON не роняет разбор', () => {
    expect(parseSession('{«не json»')).toBeNull();
  });

  it('запись без логина или без токена не считается сессией', () => {
    expect(parseSession(JSON.stringify({ token: 'T' }))).toBeNull();
    expect(parseSession(JSON.stringify({ login: 'ivan' }))).toBeNull();
    expect(parseSession(JSON.stringify({ login: 7, token: 'T' }))).toBeNull();
  });

  it('целая запись разбирается', () => {
    expect(parseSession(JSON.stringify({ login: 'ivan', token: 'T' }))).toEqual({
      login: 'ivan',
      token: 'T',
    });
  });
});

describe('сессия — что попадает в хранилище', () => {
  it('ПАРОЛЬ НЕ ХРАНИТСЯ: в записи ровно логин и токен', () => {
    const store = memStore();
    saveSession(store, SRV, {
      login: 'ivan',
      token: 'T',
      ...({ password: 'секрет' } as object),
    } as never);
    const raw = store.dump()[sessionKey(SRV)]!;
    expect(Object.keys(JSON.parse(raw)).sort()).toEqual(['login', 'token']);
    expect(raw).not.toContain('секрет');
  });

  it('повторное сохранение заменяет запись, а не копит их', () => {
    const store = memStore();
    saveSession(store, SRV, { login: 'ivan', token: 'T1' });
    saveSession(store, SRV, { login: 'petr', token: 'T2' });
    expect(Object.keys(store.dump())).toHaveLength(1);
    expect(tokenFor(store, SRV, 'petr')).toBe('T2');
    expect(tokenFor(store, SRV, 'ivan')).toBeNull();
  });
});
