/**
 * Страницы входа (REFM-218) — прямой тест владельца.
 *
 * Поля карточек и замок от двойной отправки снаружи не видны, поэтому здесь проверено то,
 * что текстом не проверить: какая стадия экрана подключения видна, какой позывной
 * подсказан, чего ждут кнопки приветствия, куда ведёт вход по позывному на сервере с
 * аккаунтами и без, что уходит в регистрацию, восстановление и сброс и куда игрок попадает
 * после них, как доигрывается заход в партию, отложенный до входа, и что заполняют двери
 * карточки. Каждый тест — свежая загрузка модуля над своей «страницей», своим хранилищем и
 * своим сервером. В конце — стык с `main.ts`.
 */
import { readFileSync } from 'node:fs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { t, LOCALE } from '../../localization/runtime';
import { readSession, saveSession } from '../../decisions/sessionStore';

const BASE = 'ws://srv.test:8080';
const HTTP = 'http://srv.test:8080';

/** Поле или блок страницы: всё, что модуль у них трогает. */
class Node {
  value = '';
  type = 'password';
  ariaLabel = '';
  ariaInvalid: string | null = null;
  title = '';
  style = { display: 'none' };
  dataset: Record<string, string> = {};
  private attributes = new Map<string, string>();
  private on = new Map<string, Array<(ev: unknown) => void>>();
  constructor(readonly id: string) {}
  addEventListener(type: string, fn: (ev: unknown) => void): void {
    this.on.set(type, [...(this.on.get(type) ?? []), fn]);
  }
  fire(type: string, ev: unknown = {}): void {
    for (const fn of this.on.get(type) ?? []) fn(ev);
  }
  setAttribute(name: string, value: string): void { this.attributes.set(name, value); }
  removeAttribute(name: string): void { this.attributes.delete(name); }
  getAttribute(name: string): string | null { return this.attributes.get(name) ?? null; }
  focus(): void {
    focused = this.id;
    this.fire('focus');
  }
}
/** Ответ сервера: только то, что читают модуль и сессия. */
interface Reply {
  ok: boolean;
  status: number;
  json(): Promise<unknown>;
}

let page: Map<string, Node>;
let cell: Map<string, string>;
let focused: string;
let calls: Array<{ path: string; body: Record<string, string> | null }>;
let server: Record<string, () => Reply | Promise<Reply>>;
let href: string;
let errors: ReturnType<typeof vi.spyOn>;

const el = (id: string): Node => {
  if (!page.has(id)) page.set(id, new Node(id));
  return page.get(id)!;
};
const reply = (status: number, body: unknown = {}): Reply => ({
  ok: status >= 200 && status < 300,
  status,
  json: async () => body,
});
const click = (id: string): void => el(id).fire('click');
const enter = (id: string): void => el(id).fire('keydown', { key: 'Enter' });
/** Дать отработать отложенным цепочкам: проба, вход, запросы. */
const settle = async (): Promise<void> => {
  for (let i = 0; i < 5; i++) await new Promise((r) => setTimeout(r, 0));
};
/** Видимые стадии экрана подключения. */
const stages = (): string[] =>
  ['cwelcome', 'cregister', 'crecover', 'creset', 'cbrowse'].filter(
    (id) => el(id).style.display !== 'none',
  );
const posted = (path: string) => calls.filter((c) => c.path === path);

beforeEach(() => {
  page = new Map();
  cell = new Map();
  focused = '';
  calls = [];
  server = {};
  href = 'https://game.test/?reset=tok-1';
  errors = vi.spyOn(console, 'error').mockImplementation(() => {});
  vi.stubGlobal('HTMLInputElement', Node);
  vi.stubGlobal('document', { getElementById: el });
  vi.stubGlobal('localStorage', {
    getItem: (k: string) => cell.get(k) ?? null,
    setItem: (k: string, v: string) => void cell.set(k, v),
    removeItem: (k: string) => void cell.delete(k),
  });
  vi.stubGlobal('fetch', async (url: string, init?: { body?: string }) => {
    const path = url.slice(HTTP.length);
    calls.push({ path, body: init?.body ? JSON.parse(init.body) : null });
    const answer = server[path];
    if (!answer) throw new TypeError('сервер не отвечает');
    return answer();
  });
  vi.stubGlobal('location', {
    get href() {
      return href;
    },
  });
  vi.stubGlobal('history', {
    replaceState: (_: unknown, __: string, url: string) => {
      href = url;
    },
  });
});
afterEach(() => {
  // Отклонение, которого не ждали, `detach` пишет в консоль — здесь это провал.
  expect(errors).not.toHaveBeenCalled();
  errors.mockRestore();
  vi.unstubAllGlobals();
});

/** Свежая загрузка страниц и сессии над игрой-заглушкой, которая записывает просьбы. */
async function boot(opts: { server?: boolean } = {}) {
  vi.resetModules();
  const acc = await import('./accountSession');
  const pages = await import('./signInPages');
  const env = {
    status: [] as string[],
    notes: [] as string[],
    nick: '',
    nickAtServer: [] as string[],
    hub: [] as Array<string | undefined>,
    joins: [] as unknown[][],
    connect: [] as boolean[],
    hubShown: [] as boolean[],
  };
  acc.initAccountSession({
    status: (text) => void env.status.push(text),
    note: (text) => void env.notes.push(text),
    welcomePassword: pages.welcomePassword,
    showSignIn: () => {},
  });
  pages.initSignInPages({
    status: (text) => void env.status.push(text),
    note: (text) => void env.notes.push(text),
    setNick: (nick) => {
      env.nick = nick;
    },
    // Как в `main.ts`: без адреса или без позывного обозревателя сервера нет.
    resolveServer: () => {
      env.nickAtServer.push(env.nick);
      return opts.server === false || !env.nick ? null : { base: BASE, nick: env.nick };
    },
    serverField: () => (opts.server === false ? '' : BASE),
    showConnect: (show) => void env.connect.push(show),
    showHub: (show) => void env.hubShown.push(show),
    openHub: (note) => void env.hub.push(note),
    connectToMatch: (...args) => void env.joins.push(args),
  });
  return { acc, pages, env };
}
/** Сервер с аккаунтами, проба уже ответила. */
async function bootAccounts() {
  const booted = await boot();
  server['/auth/status'] = () => reply(200, { enabled: true });
  booted.pages.startAuthProbe(BASE);
  await settle();
  return booted;
}
/** Вход: «не знаю такого» на логине и выданная сессия на регистрации. */
function freshAccount(token = 'jwt-new'): void {
  server['/auth/login'] = () => reply(401);
  server['/auth/register'] = () => reply(201, { token });
}

describe('REFM-218 — стадии и позывной', () => {
  it('видна ровно одна стадия экрана подключения', async () => {
    const { pages } = await boot();
    for (const stage of ['welcome', 'register', 'recover', 'reset', 'browse'] as const) {
      pages.showStage(stage);
      expect(stages()).toEqual([`c${stage === 'welcome' ? 'welcome' : stage}`]);
      // По стадии выбирается раскладка: «Матчи» — страница во весь экран (UIX-17.1).
      expect(el('connect').dataset.stage).toBe(stage);
    }
  });

  it('подсказанный позывной берётся из списка по счётчику и не повторяется', async () => {
    const { pages } = await boot();
    const first = pages.suggestCallsign();
    const second = pages.suggestCallsign();
    expect(first).toBe(`${t('callsign.rhino')}-1`);
    expect(second).toBe(`${t('callsign.comet')}-2`);
    expect(cell.get('void.newcount')).toBe('2');
  });
});

describe('REFM-218 — двери приветственной карточки', () => {
  it('позывной кладётся как есть, пустой — подсказывается', async () => {
    const { pages } = await boot();
    pages.fillWelcome('Orion', 'show');
    expect(el('cwnick').value).toBe('Orion');
    pages.fillWelcome('', 'show');
    expect(el('cwnick').value).toBe(`${t('callsign.rhino')}-1`);
  });

  it('строку пароля показывают без фокуса или прячут', async () => {
    const { pages } = await boot();
    pages.fillWelcome('Orion', 'show');
    expect([el('cwpassrow').style.display, focused]).toEqual(['flex', '']);
    pages.fillWelcome('Orion', 'hide');
    expect([el('cwpassrow').style.display, focused]).toEqual(['none', '']);
  });

  it('пароль с карточки отдаётся тому, кто спросит', async () => {
    const { pages } = await boot();
    el('cwpass').value = 'secret-pass';
    expect(pages.welcomePassword()).toBe('secret-pass');
  });
});

describe('REFM-218 — проба режима сервера', () => {
  it('новичку на сервере с аккаунтами раскрывает форму с подсказанным позывным', async () => {
    await bootAccounts();
    expect(el('cwlogin').style.display).toBe('flex');
    expect(el('cwpassrow').style.display).toBe('flex');
    expect(el('cwrecover').style.display).toBe('');
    expect(el('cwnick').value).toBe(`${t('callsign.rhino')}-1`);
  });

  it('набранный позывной не затирает', async () => {
    const { pages } = await boot();
    el('cwnick').value = 'Vega';
    server['/auth/status'] = () => reply(200, { enabled: true });
    pages.startAuthProbe(BASE);
    await settle();
    expect(el('cwnick').value).toBe('Vega');
  });

  it('запомненному позывному и серверу без аккаунтов форму не раскрывает', async () => {
    cell.set('void.nick', 'Orion');
    await bootAccounts();
    expect(el('cwlogin').style.display).toBe('none');
    expect(el('cwrecover').style.display).toBe('');
    cell.clear();
    const { pages } = await boot();
    server['/auth/status'] = () => reply(404);
    pages.startAuthProbe(BASE);
    await settle();
    expect(el('cwlogin').style.display).toBe('none');
    expect(el('cwrecover').style.display).toBe('none');
  });

  it('пустой адрес — сервер не спрашивают', async () => {
    const { pages } = await boot();
    pages.startAuthProbe('');
    await settle();
    expect(calls).toEqual([]);
  });
});

describe('REFM-218 — приветствие', () => {
  it('«Новый командир» ждёт пробу и на сервере с аккаунтами ведёт на регистрацию', async () => {
    const { pages, env } = await boot();
    let answer!: (r: Reply) => void;
    server['/auth/status'] = () => new Promise<Reply>((r) => (answer = r));
    pages.startAuthProbe(BASE);
    el('crpass').value = 'old';
    click('cnew');
    await settle();
    expect([stages(), env.hub]).toEqual([[], []]); // проба ещё летит — ни гостя, ни формы
    answer(reply(200, { enabled: true }));
    await settle();
    expect(stages()).toEqual(['cregister']);
    expect(el('crnick').value).not.toBe('');
    expect([el('crpass').value, focused, env.status.at(-1)]).toEqual(['', '', '']);
    expect(env.hub).toEqual([]);
  });

  it('«Новый командир» на сервере без аккаунтов сразу ведёт в хаб', async () => {
    const { pages, env } = await boot();
    server['/auth/status'] = () => reply(404);
    pages.startAuthProbe(BASE);
    click('cnew');
    await settle();
    expect(env.hub).toEqual([undefined]);
    expect(stages()).toEqual([]);
  });

  it('«Вход» раскрывает поле с запомненным позывным и прячет его повторно', async () => {
    cell.set('void.nick', ' Orion ');
    const { env } = await boot();
    env.status.length = 0;
    click('clogin');
    expect([el('cwlogin').style.display, el('cwnick').value, focused]).toEqual([
      'flex',
      'Orion',
      '',
    ]);
    expect(env.status).toEqual(['']);
    click('clogin');
    expect(el('cwlogin').style.display).toBe('none');
  });

  it('пустой позывной — никуда не идём, курсор в поле', async () => {
    const { env } = await bootAccounts();
    el('cwnick').value = '  ';
    click('cwgo');
    await settle();
    expect([focused, env.hub, posted('/auth/login')]).toEqual(['cwnick', [], []]);
  });

  it('без аккаунтов позывной запоминается и ведёт в хаб', async () => {
    const { pages, env } = await boot();
    server['/auth/status'] = () => reply(404);
    pages.startAuthProbe(BASE);
    el('cwnick').value = ' Orion ';
    enter('cwnick');
    await settle();
    expect([env.nick, cell.get('void.nick'), env.hub]).toEqual(['Orion', 'Orion', [undefined]]);
    expect(posted('/auth/login')).toEqual([]);
  });

  it('с аккаунтами вход идёт с паролем карточки, пароль стирается, игрок в хабе', async () => {
    const { env } = await bootAccounts();
    freshAccount();
    el('cwnick').value = 'Orion';
    el('cwpass').value = 'secret-pass';
    enter('cwpass');
    await settle();
    expect(posted('/auth/login')[0]!.body).toEqual({ login: 'Orion', password: 'secret-pass' });
    expect(readSession(localStorage, BASE)).toEqual({ login: 'Orion', token: 'jwt-new' });
    expect([cell.get('void.nick'), el('cwpass').value, env.nick]).toEqual(['Orion', '', 'Orion']);
    expect([env.status.at(-1), env.hub]).toEqual(['', [undefined]]);
  });

  it('отказ во входе оставляет на карточке с курсором в пароле', async () => {
    const { env } = await bootAccounts();
    server['/auth/login'] = () => reply(401);
    server['/auth/register'] = () => reply(409);
    el('cwnick').value = 'Orion';
    el('cwpass').value = 'wrong-pass';
    click('cwgo');
    await settle();
    expect([env.status.at(-1), focused, env.hub]).toEqual([t('acc.bad-pass'), 'cwpass', []]);
    expect(cell.has('void.nick')).toBe(false);
  });

  it.each(['cwnick', 'cwpass'])('смена %s снимает отказ для старой пары учётных данных', async (id) => {
    const { env } = await bootAccounts();
    server['/auth/login'] = () => reply(401);
    server['/auth/register'] = () => reply(409);
    el('cwnick').value = 'Orion';
    el('cwpass').value = 'wrong-pass';
    click('cwgo');
    await settle();
    expect([el('cwnick').ariaInvalid, el('cwpass').ariaInvalid, env.status.at(-1)])
      .toEqual([null, 'true', t('acc.bad-pass')]);
    el(id).value = id === 'cwnick' ? 'AnotherCommander' : 'another-secret';
    el(id).fire('input');
    expect([el('cwnick').ariaInvalid, el('cwpass').ariaInvalid, env.status.at(-1)])
      .toEqual([null, null, '']);
  });

  it.each(['click', 'enter'])(
    'сохранённая сессия не пускает с пустым паролем через %s',
    async (via) => {
      const { env } = await bootAccounts();
      saveSession(localStorage, BASE, { login: 'Orion', token: 'jwt-cached' });
      el('cwnick').value = 'Orion';
      el('cwpass').value = '';
      if (via === 'click') click('cwgo');
      else enter('cwpass');
      await settle();
      expect([env.status.at(-1), focused, env.hub, env.joins]).toEqual([
        t('acc.login-pass.rule'),
        'cwpass',
        [],
        [],
      ]);
      expect(posted('/auth/login')).toEqual([]);
      el('cwnick').value = 'AnotherCommander';
      el('cwnick').fire('input');
      expect([el('cwpass').ariaInvalid, env.status.at(-1)])
        .toEqual(['true', t('acc.login-pass.rule')]);
    },
  );

  it('сохранённая сессия не заменяет проверку неверного пароля', async () => {
    const { acc, env } = await bootAccounts();
    saveSession(localStorage, BASE, { login: 'Orion', token: 'jwt-cached' });
    acc.pendingJoinAfterAuth.remember('m-7', 'p2', 'azure', ['sc-1']);
    server['/auth/login'] = () => reply(401);
    server['/auth/register'] = () => reply(409);
    el('cwnick').value = 'Orion';
    el('cwpass').value = 'wrong-pass';
    click('cwgo');
    await settle();
    expect(posted('/auth/login')[0]?.body).toEqual({ login: 'Orion', password: 'wrong-pass' });
    expect([env.status.at(-1), focused, env.hub, env.joins]).toEqual([
      t('acc.bad-pass'),
      'cwpass',
      [],
      [],
    ]);
  });

  it('явный вход проверяет верный пароль и заменяет сохранённую сессию', async () => {
    const { env } = await bootAccounts();
    saveSession(localStorage, BASE, { login: 'Orion', token: 'jwt-cached' });
    server['/auth/login'] = () => reply(200, { token: 'jwt-fresh' });
    el('cwnick').value = 'Orion';
    el('cwpass').value = 'secret-pass';
    click('cwgo');
    await settle();
    expect(posted('/auth/login')[0]?.body).toEqual({ login: 'Orion', password: 'secret-pass' });
    expect(readSession(localStorage, BASE)).toEqual({ login: 'Orion', token: 'jwt-fresh' });
    expect(env.hub).toEqual([undefined]);
  });

  it('второй Enter, пока первый вход летит, второго запроса не шлёт', async () => {
    await bootAccounts();
    let answer!: (r: Reply) => void;
    server['/auth/login'] = () => new Promise<Reply>((r) => (answer = r));
    el('cwnick').value = 'Orion';
    el('cwpass').value = 'secret-pass';
    enter('cwpass');
    await settle();
    enter('cwpass');
    await settle();
    expect(posted('/auth/login')).toHaveLength(1);
    answer(reply(200, { token: 'jwt-1' }));
    await settle();
  });

  it('отложенный до входа заход в партию доигрывается вместо хаба', async () => {
    const { acc, env } = await bootAccounts();
    freshAccount();
    acc.pendingJoinAfterAuth.remember('m-7', 'p2', 'azure', ['sc-1']);
    el('cwnick').value = 'Orion';
    el('cwpass').value = 'secret-pass';
    click('cwgo');
    await settle();
    expect(stages()).toEqual(['cbrowse']);
    expect(env.joins).toEqual([['m-7', 'p2', 'azure', ['sc-1']]]);
    expect(env.hub).toEqual([]);
  });

  it('вход через соцсети пока ведёт в хаб с пометкой «скоро»', async () => {
    const { env } = await boot();
    click('cgoogle');
    click('capple');
    expect(env.hub).toEqual([t('auth.google.soon'), t('auth.apple.soon')]);
  });
});

describe('REFM-218 — регистрация', () => {
  async function onRegister() {
    const booted = await bootAccounts();
    click('cnew');
    await settle();
    el('crnick').value = ' Orion ';
    return booted;
  }

  it('беда формы называет своё поле и в сеть не идёт', async () => {
    const { env } = await onRegister();
    el('crpass').value = 'orbit-secret-pass';
    el('crpass2').value = 'orbit-secret-paZZ';
    click('crgo');
    await settle();
    expect([env.status.at(-1), focused]).toEqual([t('auth.pass-mismatch'), 'crpass2']);
    expect(posted('/auth/login')).toEqual([]);
    expect([el('crpass').ariaInvalid, el('crpass2').ariaInvalid]).toEqual(['true', 'true']);
    el('crpass2').value = el('crpass').value;
    el('crpass2').fire('input');
    expect([el('crpass').ariaInvalid, el('crpass2').ariaInvalid, env.status.at(-1)]).toEqual([null, null, '']);
  });

  it('нетронутая форма не красная; правило пароля и повтор обновляются при вводе', async () => {
    const { env } = await onRegister();
    expect([el('crnick').ariaInvalid, el('crpass').ariaInvalid, el('crpass2').ariaInvalid]).toEqual([null, null, null]);
    el('crpass').fire('blur');
    expect(el('crpass').ariaInvalid).toBeNull();
    el('crpass').value = 'short';
    el('crpass').fire('input');
    expect([el('crpass').ariaInvalid, el('crpass2').ariaInvalid, env.status.at(-1)])
      .toEqual(['true', null, t('acc.pass.rule')]);
    el('crpass').value = 'orbit-secret-pass';
    el('crpass').fire('input');
    expect([el('crpass').ariaInvalid, el('crpass2').ariaInvalid]).toEqual([null, null]);
    el('crpass2').value = 'orbit-other-pass';
    el('crpass2').fire('input');
    expect([el('crpass').ariaInvalid, el('crpass2').ariaInvalid]).toEqual(['true', 'true']);
    el('crpass').value = el('crpass2').value;
    el('crpass').fire('input');
    expect([el('crpass').ariaInvalid, el('crpass2').ariaInvalid]).toEqual([null, null]);
  });

  it('занятый ник красный до его исправления, остальные поля его ошибку не стирают', async () => {
    const { env } = await onRegister();
    server['/auth/login'] = () => reply(401);
    server['/auth/register'] = () => reply(409, { error: 'E_LOGIN_TAKEN' });
    el('crpass').value = el('crpass2').value = 'orbit-secret-pass';
    click('crgo');
    await settle();
    expect([el('crnick').ariaInvalid, el('crpass').ariaInvalid, focused, env.status.at(-1)])
      .toEqual(['true', null, 'crnick', t('acc.nick.taken')]);
    el('crmail').value = 'mail@example.test';
    el('crmail').fire('input');
    expect([el('crnick').ariaInvalid, env.status.at(-1)]).toEqual(['true', t('acc.nick.taken')]);
    el('crnick').value = 'AnotherCommander';
    el('crnick').fire('input');
    expect([el('crnick').ariaInvalid, env.status.at(-1)]).toEqual([null, '']);
  });

  it('отказ старой формы не меняет исправленные поля и сессию', async () => {
    const { env } = await onRegister();
    let answer!: (value: Reply) => void;
    server['/auth/login'] = () => reply(401);
    server['/auth/register'] = () => new Promise<Reply>((resolve) => { answer = resolve; });
    el('crpass').value = el('crpass2').value = 'orbit-secret-pass';
    click('crgo');
    await settle();
    el('crnick').value = 'AnotherCommander';
    el('crnick').fire('input');
    const before = env.status.at(-1);
    answer(reply(409, { error: 'E_LOGIN_TAKEN' }));
    await settle();
    expect([el('crnick').ariaInvalid, env.status.at(-1), env.hub, readSession(localStorage, BASE)])
      .toEqual([null, before, [], null]);
  });

  it.each(['crnick', 'crmail', 'crpass', 'crpass2'])(
    'успешная регистрация сохраняет созданный аккаунт после правки %s во время запроса', async (id) => {
      const { env } = await onRegister();
      let answer!: (value: Reply) => void;
      server['/auth/login'] = () => reply(401);
      server['/auth/register'] = () => new Promise<Reply>((resolve) => { answer = resolve; });
      el('crpass').value = el('crpass2').value = 'orbit-secret-pass';
      click('crgo');
      await settle();
      el(id).value = 'changed-after-submit';
      el(id).fire('input');
      answer(reply(201, { token: 'created-session' }));
      await settle();
      expect(readSession(localStorage, BASE)).toEqual({ login: 'Orion', token: 'created-session' });
      expect([cell.get('void.nick'), env.nick, env.hub, env.status.at(-1)])
        .toEqual(['Orion', 'Orion', [undefined], '']);
      expect([el('crpass').value, el('crpass2').value]).toEqual(['', '']);
    },
  );

  it.each(['leave-screen', 'replace-session'])(
    'завершение регистрации сохраняет защиту контекста: %s', async (change) => {
      const { env } = await onRegister();
      let answer!: (value: Reply) => void;
      server['/auth/login'] = () => reply(401);
      server['/auth/register'] = () => new Promise<Reply>((resolve) => { answer = resolve; });
      el('crpass').value = el('crpass2').value = 'orbit-secret-pass';
      click('crgo');
      await settle();
      const replacement = { login: 'AnotherCommander', token: 'newer-session' };
      if (change === 'leave-screen') click('crback');
      else saveSession(localStorage, BASE, replacement);
      answer(reply(201, { token: 'created-session' }));
      await settle();
      expect(readSession(localStorage, BASE)).toEqual(change === 'leave-screen' ? null : replacement);
      expect(env.hub).toEqual([]);
    },
  );

  it('несколько красных полей получают описание своей ошибки при фокусе', async () => {
    const { env } = await onRegister();
    el('crnick').value = '<bad>';
    el('crmail').value = 'invalid-email';
    el('crpass').value = el('crpass2').value = 'short';
    click('crgo');
    await settle();
    expect(['crnick', 'crmail', 'crpass'].map((id) => el(id).ariaInvalid)).toEqual(['true', 'true', 'true']);
    expect(env.status.at(-1)).toBe(t('acc.nick.rule'));
    expect(['crnick', 'crmail', 'crpass'].map((id) => el(id).getAttribute('aria-errormessage')))
      .toEqual(['cstatus', null, null]);
    el('crpass').focus();
    expect(env.status.at(-1)).toBe(t('acc.pass.rule'));
    expect(['crnick', 'crmail', 'crpass'].map((id) => el(id).getAttribute('aria-errormessage')))
      .toEqual([null, null, 'cstatus']);
    el('crmail').focus();
    expect(env.status.at(-1)).toBe(t('acc.email.rule'));
    expect(['crnick', 'crmail', 'crpass'].map((id) => el(id).getAttribute('aria-errormessage')))
      .toEqual([null, 'cstatus', null]);
    expect(['crnick', 'crmail', 'crpass'].map((id) => el(id).ariaInvalid)).toEqual(['true', 'true', 'true']);
    el('crpass').value = 'orbit-secret-pass';
    el('crpass').fire('input');
    el('crpass2').focus();
    expect(env.status.at(-1)).toBe(t('auth.pass-mismatch'));
    expect(['crnick', 'crmail', 'crpass', 'crpass2'].map((id) => el(id).getAttribute('aria-errormessage')))
      .toEqual([null, null, 'cstatus', 'cstatus']);
  });

  it('серверное требование к паролю выделяет поле даже при пройденной местной проверке', async () => {
    const { env } = await onRegister();
    server['/auth/login'] = () => reply(401);
    server['/auth/register'] = () => reply(400, { error: 'E_PASSWORD_POLICY' });
    el('crpass').value = el('crpass2').value = 'orbit-secret-pass';
    click('crgo');
    await settle();
    expect([el('crpass').ariaInvalid, focused, env.status.at(-1)])
      .toEqual(['true', 'crpass', t('acc.pass.rule')]);
    el('crmail').fire('input');
    expect(el('crpass').ariaInvalid).toBe('true');
  });

  it.each([
    ['crnick', 'f_u_c_k', 'acc.nick.blocked'],
    ['crmail', 'a@b.test\r\nBcc:x@y.test', 'acc.email.rule'],
  ])('небезопасное поле %s возвращает фокус без запроса', async (id, value, key) => {
    const { env } = await onRegister();
    el('crpass').value = el('crpass2').value = 'orbit-secret-pass';
    el(id).value = value;
    click('crgo');
    await settle();
    expect([env.status.at(-1), focused]).toEqual([t(key), id]);
    expect(posted('/auth/login')).toEqual([]);
    expect(posted('/auth/register')).toEqual([]);
  });

  it('позывной страницы доходит до сервера, почта едет в регистрацию', async () => {
    const { env } = await onRegister();
    freshAccount();
    el('crmail').value = ' me@mail.test ';
    el('crpass').value = 'orbit-secret-pass';
    el('crpass2').value = 'orbit-secret-pass';
    enter('crpass2');
    await settle();
    // Поле обозревателя заполнено ДО адреса сервера: без него регистрация упиралась в
    // «введите позывной» и до сервера не доходила.
    expect(env.nickAtServer).toEqual(['Orion']);
    expect(posted('/auth/register')[0]!.body).toEqual({
      login: 'Orion',
      password: 'orbit-secret-pass',
      email: 'me@mail.test',
    });
    expect([cell.get('void.nick'), el('crpass').value, el('crpass2').value]).toEqual([
      'Orion',
      '',
      '',
    ]);
    expect([env.status.at(-1), env.hub]).toEqual(['', [undefined]]);
  });

  it('пустая почта на сервер не уходит вовсе', async () => {
    await onRegister();
    freshAccount();
    el('crpass').value = 'orbit-secret-pass';
    el('crpass2').value = 'orbit-secret-pass';
    click('crgo');
    await settle();
    expect(posted('/auth/register')[0]!.body).toEqual({
      login: 'Orion',
      password: 'orbit-secret-pass',
    });
  });

  it('отложенный заход в партию доигрывается и после регистрации', async () => {
    const { acc, env } = await onRegister();
    freshAccount();
    acc.pendingJoinAfterAuth.remember('m-7');
    el('crpass').value = 'orbit-secret-pass';
    el('crpass2').value = 'orbit-secret-pass';
    click('crgo');
    await settle();
    expect(stages()).toEqual(['cbrowse']);
    expect(env.joins).toEqual([['m-7', undefined, undefined, undefined]]);
    expect(env.hub).toEqual([]);
  });

  it('Enter ведёт по полям, «Назад» возвращает к приветствию', async () => {
    const { env } = await onRegister();
    enter('crnick');
    expect(focused).toBe('crmail');
    enter('crmail');
    expect(focused).toBe('crpass');
    enter('crpass');
    expect(focused).toBe('crpass2');
    env.status.length = 0;
    click('crback');
    expect([stages(), env.status]).toEqual([['cwelcome'], ['']]);
  });
});

describe('REFM-218 — восстановление доступа', () => {
  it('открывается с почтой, уже набранной на регистрации', async () => {
    await boot();
    el('crmail').value = ' me@mail.test ';
    click('cwrecover');
    expect([stages(), el('crecmail').value, focused]).toEqual([
      ['crecover'],
      'me@mail.test',
      '',
    ]);
  });

  it('пустая почта — подсказка полю, без запроса', async () => {
    const { env } = await boot();
    click('crecgo');
    await settle();
    expect([env.status.at(-1), focused, calls]).toEqual([t('auth.need-mail'), 'crecmail', []]);
  });

  // Позывного на новом устройстве нет (`env.nick` пуст), а просьба всё равно уходит:
  // учётку называет почта (`serverAddress.ts`, правило 7).
  it('ответ один и тот же, дошёл запрос или нет, и позывной для него не нужен', async () => {
    const { env } = await boot();
    el('crecmail').value = 'me@mail.test';
    server['/auth/recover'] = () => reply(204);
    enter('crecmail');
    await settle();
    expect(posted('/auth/recover')[0]!.body).toEqual({ email: 'me@mail.test', locale: LOCALE });
    const answered = env.status.at(-1);
    delete server['/auth/recover'];
    click('crecgo');
    await settle();
    expect(env.status.at(-1)).toBe(answered);
    expect(answered).toBe(t('auth.recover.sent'));
  });

  it('без адреса сервера запроса нет, и это сказано вслух', async () => {
    const { env } = await boot({ server: false });
    el('crecmail').value = 'me@mail.test';
    click('crecgo');
    await settle();
    expect([calls, env.status]).toEqual([[], [t('net.need-address')]]);
  });

  it('«Назад» возвращает к раскрытой форме входа с набранным позывным', async () => {
    const { env } = await bootAccounts();
    el('cwnick').value = 'Orion';
    click('cwrecover');
    env.status.length = 0;
    click('crecback');
    expect([stages(), env.status]).toEqual([['cwelcome'], ['']]);
    expect(el('cwlogin').style.display).toBe('flex');
    expect(el('cwpassrow').style.display).toBe('flex');
    expect(el('cwnick').value).toBe('Orion');
  });
});

describe('REFM-218 — сброс пароля по ссылке', () => {
  it('ссылка открывает сцену поверх хаба и стирает токен из адреса', async () => {
    cell.set('void.nick', 'Orion');
    const { pages, env } = await boot();
    pages.openReset('tok-1');
    expect(stages()).toEqual(['creset']);
    expect([env.connect, env.hubShown]).toEqual([[true], [false]]);
    expect(href).toBe('/');
    expect([el('cresetuser').value, focused]).toEqual(['Orion', '']);
  });

  // Ссылку открывают на новом устройстве без позывного: сброс доходит до сервера, а сессия
  // сохраняется под адресом сервера (`serverAddress.ts`, правило 7).
  it('новый пароль тратит ссылку и сразу входит, позывной для этого не нужен', async () => {
    const { pages, env } = await boot();
    pages.openReset('tok-1');
    server['/auth/reset'] = () => reply(200, { login: 'Orion', token: 'jwt-reset' });
    el('cresetpass').value = 'orbit-new-secret';
    enter('cresetpass');
    expect(focused).toBe('cresetpass2');
    el('cresetpass2').value = 'orbit-new-secret';
    enter('cresetpass2');
    await settle();
    expect(posted('/auth/reset')[0]!.body).toEqual({
      token: 'tok-1',
      password: 'orbit-new-secret',
    });
    expect(readSession(localStorage, BASE)).toEqual({ login: 'Orion', token: 'jwt-reset' });
    expect([cell.get('void.nick'), env.nick]).toEqual(['Orion', 'Orion']);
    expect([env.notes, env.hub]).toEqual([['✔ ' + t('auth.reset.done')], [undefined]]);
  });

  it('пока идёт вход, сброс второй раз не отправляется — замок общий', async () => {
    const { pages } = await bootAccounts();
    let answer!: (r: Reply) => void;
    server['/auth/login'] = () => new Promise<Reply>((r) => (answer = r));
    el('cwnick').value = 'Orion';
    el('cwpass').value = 'secret-pass';
    click('cwgo');
    await settle();
    pages.openReset('tok-1');
    el('cresetpass').value = 'orbit-new-secret';
    el('cresetpass2').value = 'orbit-new-secret';
    click('cresetgo');
    await settle();
    expect(posted('/auth/reset')).toEqual([]);
    answer(reply(200, { token: 'jwt-1' }));
    await settle();
  });

  it('в архиве площадки сцены сброса нет: ссылка ничего не открывает', async () => {
    vi.stubGlobal('__SECTOR_ZERO_ONLY__', true);
    const { pages } = await boot();
    pages.openReset('tok-1');
    click('cresetgo');
    await settle();
    expect([stages(), href, calls]).toEqual([[], 'https://game.test/?reset=tok-1', []]);
  });
});

describe('REFM-218 — проводка в main.ts', () => {
  const MAIN = readFileSync(new URL('./main.ts', import.meta.url), 'utf8');

  it('поля карточек, замок и проба живут только у страниц входа', () => {
    expect(MAIN).not.toMatch(/\b(wNickInput|wPassInput|wPassRowEl|wLoginEl)\b/);
    expect(MAIN).not.toMatch(/\b(crNickInput|crMailInput|crecMailInput|cresetPassInput)\b/);
    expect(MAIN).not.toMatch(/\b(signingIn|authProbe|passwordReset)\b/);
  });

  it('функции и обработчики страниц в main.ts не объявлены', () => {
    expect(MAIN).not.toMatch(
      /function (showStage|suggestCallsign|signInByCallsign|welcomeSignIn|openRegister|submitRegister|submitRecover|openReset)\b/,
    );
    const ids = MAIN.match(/\$\('(c[a-z]+)'\)/g) ?? [];
    for (const id of ['cnew', 'clogin', 'cwgo', 'cgoogle', 'capple', 'crgo', 'crback'])
      expect(ids).not.toContain(`$('${id}')`);
    for (const id of ['cwrecover', 'crecgo', 'crecback', 'cresetgo', 'cwelcome', 'cregister'])
      expect(ids).not.toContain(`$('${id}')`);
  });

  it('страницы поднимаются до загрузочного блока, проба стартует один раз', () => {
    const init = MAIN.indexOf('initSignInPages({');
    expect(init).toBeGreaterThan(0);
    expect(init).toBeLessThan(MAIN.indexOf('if (bootReset) {'));
    expect(MAIN.match(/startAuthProbe\(/g)).toHaveLength(1);
    expect(MAIN).toMatch(/initAccountSession\(\{[\s\S]*?\n {2}welcomePassword,\n/);
  });
});

describe('password visibility', () => {
  it.each(['cwpass', 'crpass', 'crpass2', 'cresetpass', 'cresetpass2'])(
    'toggles only %s without changing the password or submitting',
    async (id) => {
      await boot();
      const input = el(id);
      const button = el(id + '-visibility');
      input.value = 'Проверка-Strong-123';
      const requests = calls.length;
      expect(input.type).toBe('password');
      click(button.id);
      expect(input.type).toBe('text');
      expect(button.ariaLabel).toBe(t('auth.password.hide'));
      expect(el(id === 'cwpass' ? 'crpass' : 'cwpass').type).toBe('password');
      click(button.id);
      expect(input.type).toBe('password');
      expect(button.ariaLabel).toBe(t('auth.password.show'));
      expect(input.value).toBe('Проверка-Strong-123');
      expect(calls).toHaveLength(requests);
    },
  );

  it('hides revealed passwords when changing auth stages', async () => {
    const { pages } = await boot();
    click('cwpass-visibility');
    expect(el('cwpass').type).toBe('text');
    pages.showStage('register');
    expect(el('cwpass').type).toBe('password');
    expect(el('cwpass-visibility').ariaLabel).toBe(t('auth.password.show'));
  });
});
