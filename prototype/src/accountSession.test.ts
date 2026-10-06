/**
 * Сессия аккаунта (REFM-215) — прямой тест владельца.
 *
 * Режим сервера пишет только проба, билет дозвона снаружи не виден, поэтому здесь проверено
 * то, что текстом не проверить: что значит ответ пробы, когда сессию берут из хранилища и
 * когда идут на сервер, откуда берётся пароль и что уходит в регистрацию, как отказ входа и
 * отказ в месте объясняются игроку, кто стирает сессию, что билет достаётся одному дозвону,
 * что помнит просьба войти и что остаётся в адресной строке после захвата. Каждый тест —
 * свежая загрузка модуля над своим хранилищем, своим сервером и своей «страницей».
 */
import { readFileSync } from 'node:fs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { t } from '../../localization/runtime';
import { settledAddress } from '../../decisions/matchAddress';
import { sessionKey } from '../../decisions/sessionStore';

interface Reply {
  ok: boolean;
  status: number;
  json(): Promise<unknown>;
}
interface Call {
  url: string;
  init?: { method?: string; headers?: Record<string, string>; body?: string };
}

const BASE = 'ws://srv.test:8080';
const HTTP = 'http://srv.test:8080';

let cell: Map<string, string>;
let page: Map<string, { style: { display: string }; value: string }>;
let calls: Call[];
let server: (url: string) => Reply;
let href: string;
let replaced: string[];

const reply = (status: number, body?: unknown): Reply => ({
  ok: status >= 200 && status < 300,
  status,
  json: async () => {
    if (body === undefined) throw new SyntaxError('no body');
    return body;
  },
});
const el = (id: string) => {
  if (!page.has(id)) page.set(id, { style: { display: 'unset' }, value: '' });
  return page.get(id)!;
};
/** Что ушло в теле запроса по этому пути. */
const sent = (path: string): Record<string, string> => {
  const call = calls.find((c) => c.url === `${HTTP}${path}`);
  return JSON.parse(call?.init?.body ?? 'null') as Record<string, string>;
};

beforeEach(() => {
  cell = new Map();
  page = new Map();
  calls = [];
  server = () => {
    throw new Error('сервер не должны были спрашивать');
  };
  href = 'https://game.test/';
  replaced = [];
  vi.stubGlobal('localStorage', {
    getItem: (k: string) => cell.get(k) ?? null,
    setItem: (k: string, v: string) => void cell.set(k, v),
    removeItem: (k: string) => void cell.delete(k),
  });
  vi.stubGlobal('document', { getElementById: el });
  vi.stubGlobal('fetch', async (url: string, init?: Call['init']) => {
    calls.push({ url, init });
    return server(url);
  });
  vi.stubGlobal('location', {
    get href() {
      return href;
    },
  });
  vi.stubGlobal('history', {
    replaceState: (_: unknown, __: string, url: string) => {
      replaced.push(url);
      href = url;
    },
  });
});
afterEach(() => {
  vi.unstubAllGlobals();
});

/** Свежая загрузка сессии — как после перезагрузки страницы. */
async function boot() {
  vi.resetModules();
  const acc = await import('./accountSession');
  const env = {
    status: [] as string[],
    notes: [] as string[],
    welcomePass: '',
    signIns: [] as ({ nick?: string } | null)[],
  };
  acc.initAccountSession({
    status: (text) => void env.status.push(text),
    note: (text) => void env.notes.push(text),
    welcomePassword: () => env.welcomePass,
    showSignIn: (srv) => void env.signIns.push(srv),
  });
  return { acc, env };
}

describe('REFM-215 — режим сервера', () => {
  it('до пробы режим — «не знаю», а не «аккаунтов нет»', async () => {
    const { acc } = await boot();
    expect(acc.authMode).toBe('unknown');
  });

  it('живое «да» включает аккаунты и показывает строку пароля обозревателя', async () => {
    const { acc } = await boot();
    server = () => reply(200, { enabled: true });
    expect(await acc.probeAuthMode(BASE)).toBe('accounts');
    expect(acc.authMode).toBe('accounts');
    expect(calls.map((c) => c.url)).toEqual([`${HTTP}/auth/status`]);
    expect(el('cpassrow').style.display).toBe('');
  });

  it('404 — аккаунтов нет и строка пароля спрятана; обрыв — снова «не знаю»', async () => {
    const { acc } = await boot();
    server = () => reply(404);
    expect(await acc.probeAuthMode(BASE)).toBe('nicks');
    expect(acc.authMode).toBe('nicks');
    expect(el('cpassrow').style.display).toBe('none');
    server = () => {
      throw new TypeError('Failed to fetch');
    };
    expect(await acc.probeAuthMode(BASE)).toBe('unknown');
    expect(acc.authMode).toBe('unknown');
  });
});

describe('REFM-215 — вход или регистрация', () => {
  it('своя сохранённая сессия отдаётся без запроса, чужая — нет', async () => {
    const { acc, env } = await boot();
    cell.set(sessionKey(BASE), JSON.stringify({ login: 'Ivan', token: 'T-ivan' }));
    expect(acc.sessionRecord(BASE)).toEqual({ login: 'Ivan', token: 'T-ivan' });
    expect(acc.sessionToken(BASE)).toBe('T-ivan');
    expect(await acc.ensureSession(BASE, 'ivan')).toBe('T-ivan');
    expect(calls).toEqual([]);
    // Чужой позывной на том же ноутбуке идёт на сервер со своим паролем.
    env.welcomePass = 'petr-pass';
    server = () => reply(200, { token: 'T-petr' });
    expect(await acc.ensureSession(BASE, 'Petr')).toBe('T-petr');
    expect(sent('/auth/login')).toEqual({ login: 'Petr', password: 'petr-pass' });
    expect(acc.sessionRecord(BASE)).toEqual({ login: 'Petr', token: 'T-petr' });
  });

  it('плохой позывной и короткий пароль объясняются, сервер не спрашивают', async () => {
    const { acc, env } = await boot();
    expect(await acc.ensureSession(BASE, 'ab', 'long-enough')).toBeNull();
    expect(await acc.ensureSession(BASE, 'Ivan')).toBeNull();
    expect(env.status).toEqual([t('acc.nick.rule'), t('acc.pass.rule')]);
    expect(calls).toEqual([]);
  });

  it('пароль — с карточки, иначе из строки обозревателя; явный не перебивается даже пустой', async () => {
    const { acc, env } = await boot();
    server = () => reply(200, { token: 'T' });
    el('cpass').value = 'browser-pass';
    await acc.ensureSession(BASE, 'Ivan');
    expect(sent('/auth/login').password).toBe('browser-pass');
    cell.clear();
    calls = [];
    env.welcomePass = 'welcome-pass';
    await acc.ensureSession(BASE, 'Ivan');
    expect(sent('/auth/login').password).toBe('welcome-pass');
    cell.clear();
    calls = [];
    expect(await acc.ensureSession(BASE, 'Ivan', '')).toBeNull();
    expect(env.status).toEqual([t('acc.pass.rule')]);
    expect(calls).toEqual([]);
  });

  it('вход пустил — сессия записана за позывным, регистрации и строки в ленте нет', async () => {
    const { acc, env } = await boot();
    server = () => reply(200, { token: 'T-old' });
    expect(await acc.ensureSession(BASE, 'Ivan', 'secret-pass', 'a@b.c')).toBe('T-old');
    expect(calls.map((c) => c.url)).toEqual([`${HTTP}/auth/login`]);
    expect(calls[0]!.init?.method).toBe('POST');
    expect(sent('/auth/login')).toEqual({ login: 'Ivan', password: 'secret-pass' });
    expect(JSON.parse(cell.get(sessionKey(BASE))!)).toEqual({ login: 'Ivan', token: 'T-old' });
    expect(env.notes).toEqual([]);
    expect(env.status).toEqual([]);
  });

  it('новый позывной: 401 на входе → регистрация с почтой и «Аккаунт создан»', async () => {
    const { acc, env } = await boot();
    server = (url) =>
      url.endsWith('/auth/login') ? reply(401, {}) : reply(201, { token: 'T-new' });
    expect(await acc.ensureSession(BASE, 'Ivan', 'secret-pass', 'a@b.c')).toBe('T-new');
    expect(sent('/auth/register')).toEqual({
      login: 'Ivan',
      password: 'secret-pass',
      email: 'a@b.c',
    });
    expect(acc.sessionToken(BASE)).toBe('T-new');
    expect(env.notes).toEqual(['✔ ' + t('acc.created')]);
  });

  it('401 на входе и 409 на регистрации — неверный пароль; почты не ввели — поля нет', async () => {
    const { acc, env } = await boot();
    server = (url) => (url.endsWith('/auth/login') ? reply(401) : reply(409, {}));
    expect(await acc.ensureSession(BASE, 'Ivan', 'wrong-pass')).toBeNull();
    expect(sent('/auth/register')).toEqual({ login: 'Ivan', password: 'wrong-pass' });
    expect(env.status).toEqual([t('acc.bad-pass')]);
    expect(cell.has(sessionKey(BASE))).toBe(false);
  });

  it('отказ входа не 401 до регистрации не доходит; обрыв — «сервер недоступен»', async () => {
    const { acc, env } = await boot();
    server = () => reply(429, {});
    expect(await acc.ensureSession(BASE, 'Ivan', 'secret-pass')).toBeNull();
    expect(calls.map((c) => c.url)).toEqual([`${HTTP}/auth/login`]);
    server = () => {
      throw new TypeError('Failed to fetch');
    };
    expect(await acc.ensureSession(BASE, 'Ivan', 'secret-pass')).toBeNull();
    expect(env.status).toEqual([t('acc.rate-limited'), t('acc.server-down')]);
  });
});

describe('REFM-215 — билет на место', () => {
  it('просит место с выбором и пропуском сессии, отдаёт оба поля', async () => {
    const { acc, env } = await boot();
    server = () => reply(200, { token: 'J', playerId: 'p3' });
    expect(await acc.fetchJoinToken(BASE, 'm 1', 'S', 'slot-2', 'veyr', ['ada'])).toEqual({
      token: 'J',
      playerId: 'p3',
    });
    expect(calls[0]!.url).toBe(`${HTTP}/matches/m%201/join?slot=slot-2&faction=veyr&sci=ada`);
    expect(calls[0]!.init?.headers).toEqual({ authorization: 'Bearer S' });
    expect(env.status).toEqual([]);
  });

  it('401 стирает сессию этого сервера; закрытый вход и полные места её не трогают', async () => {
    const { acc, env } = await boot();
    const rec = JSON.stringify({ login: 'Ivan', token: 'S' });
    cell.set(sessionKey(BASE), rec);
    for (const [status, key] of [
      [403, 'acc.join-closed'],
      [409, 'acc.seats-full'],
      [500, 'acc.join-failed'],
    ] as const) {
      server = () => reply(status, {});
      expect(await acc.fetchJoinToken(BASE, 'm1', 'S')).toBeNull();
      expect(env.status.at(-1)).toBe(t(key));
      expect(cell.get(sessionKey(BASE))).toBe(rec);
    }
    server = () => reply(401, {});
    expect(await acc.fetchJoinToken(BASE, 'm1', 'S')).toBeNull();
    expect(env.status.at(-1)).toBe(t('acc.session-expired'));
    expect(cell.has(sessionKey(BASE))).toBe(false);
  });

  it('половина пропуска — не пропуск; обрыв — «сервер недоступен»', async () => {
    const { acc, env } = await boot();
    server = () => reply(200, { token: 'J' });
    expect(await acc.fetchJoinToken(BASE, 'm1', 'S')).toBeNull();
    server = () => {
      throw new TypeError('Failed to fetch');
    };
    expect(await acc.fetchJoinToken(BASE, 'm1', 'S')).toBeNull();
    expect(env.status).toEqual([t('acc.server-down')]);
  });

  it('билет достаётся одному дозвону', async () => {
    const { acc } = await boot();
    expect(acc.takeJoinToken()).toBeNull();
    acc.holdJoinToken('J1');
    acc.holdJoinToken('J2');
    expect(acc.takeJoinToken()).toBe('J2');
    expect(acc.takeJoinToken()).toBeNull();
  });
});

describe('REFM-215 — просьба войти и адрес партии', () => {
  it('просьба войти запоминает партию с выбором и открывает карточку входа', async () => {
    const { acc, env } = await boot();
    acc.askSignIn('m1', 'slot-2', 'veyr', { nick: 'Ivan' }, ['ada']);
    expect(env.signIns).toEqual([{ nick: 'Ivan' }]);
    expect(acc.pendingJoinAfterAuth.take()).toEqual({
      matchId: 'm1',
      slot: 'slot-2',
      faction: 'veyr',
      scientists: ['ada'],
    });
    expect(acc.pendingJoinAfterAuth.take()).toBeNull();
    // Сервер не выбран — карточка без позывного и пароля, просьба всё равно запомнена.
    acc.askSignIn('m2', undefined, undefined, null);
    expect(env.signIns.at(-1)).toBeNull();
    expect(acc.pendingJoinAfterAuth.take()).toEqual({ matchId: 'm2' });
  });

  it('после захвата в строке остаётся адрес партии, без просьбы о месте', async () => {
    const { acc } = await boot();
    href = 'https://game.test/?join=m1&slot=slot-2&faction=veyr';
    const settled = settledAddress(href, 'm1');
    expect(settled).not.toBe(href);
    acc.claimDone('m1');
    expect(replaced).toEqual([settled]);
    // Строка уже чистая — истории не трогаем.
    acc.claimDone('m1');
    expect(replaced).toEqual([settled]);
  });

  it('без истории браузера захват не падает', async () => {
    const { acc } = await boot();
    href = 'https://game.test/?join=m1';
    vi.stubGlobal('history', {
      replaceState: () => {
        throw new Error('SecurityError');
      },
    });
    expect(() => acc.claimDone('m1')).not.toThrow();
  });
});

describe('REFM-215 — проводка в main.ts', () => {
  const MAIN = readFileSync(new URL('./main.ts', import.meta.url), 'utf8');
  const hook = /\n {2}showSignIn: \(srv\) => \{([\s\S]*?)\n {2}\},\n/.exec(MAIN)?.[1] ?? '';

  it('карточку входа показывают внутри показанного экрана подключения', () => {
    // Карточка — стадия экрана подключения: спрятанный экран прятал и её, и игрок с
    // истёкшей сессией оставался на карте прошлой партии без карточки и без причины.
    expect(hook).toContain("showStage('welcome');");
    expect(hook).toContain('showConnect(true);');
    expect(hook).not.toContain('showConnect(false);');
  });

  it('билет дозвона берут только двери владельца', () => {
    expect(MAIN).not.toMatch(/\bpendingJoinToken\b/);
    expect(MAIN).toContain(
      "dialIdentity(authMode === 'accounts', takeJoinToken(), nick, seatTicket)",
    );
    expect(MAIN.match(/holdJoinToken\(join\.token\);/g)).toHaveLength(2);
  });
});
