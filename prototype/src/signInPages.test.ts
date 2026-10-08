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

import { t } from '../../localization/runtime';
import { readSession } from '../../decisions/sessionStore';

const BASE = 'ws://srv.test:8080';
const HTTP = 'http://srv.test:8080';

/** Поле или блок страницы: всё, что модуль у них трогает. */
class Node {
  value = '';
  style = { display: 'none' };
  private on = new Map<string, Array<(ev: unknown) => void>>();
  constructor(readonly id: string) {}
  addEventListener(type: string, fn: (ev: unknown) => void): void {
    this.on.set(type, [...(this.on.get(type) ?? []), fn]);
  }
  fire(type: string, ev: unknown = {}): void {
    for (const fn of this.on.get(type) ?? []) fn(ev);
  }
  focus(): void {
    focused = this.id;
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
    pages.fillWelcome('Orion', 'focus');
    expect(el('cwnick').value).toBe('Orion');
    pages.fillWelcome('', 'focus');
    expect(el('cwnick').value).toBe(`${t('callsign.rhino')}-1`);
  });

  it('строку пароля показывают с курсором, без курсора или прячут', async () => {
    const { pages } = await boot();
    pages.fillWelcome('Orion', 'focus');
    expect([el('cwpassrow').style.display, focused]).toEqual(['flex', 'cwpass']);
    focused = '';
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
    cell.clear();
    const { pages } = await boot();
    server['/auth/status'] = () => reply(404);
    pages.startAuthProbe(BASE);
    await settle();
    expect(el('cwlogin').style.display).toBe('none');
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
    expect([el('crpass').value, focused, env.status.at(-1)]).toEqual(['', 'crpass', '']);
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
      'cwnick',
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
    el('crpass').value = 'secret-pass';
    el('crpass2').value = 'secret-paZZ';
    click('crgo');
    await settle();
    expect([env.status.at(-1), focused]).toEqual([t('auth.pass-mismatch'), 'crpass2']);
    expect(posted('/auth/login')).toEqual([]);
  });

  it('позывной страницы доходит до сервера, почта едет в регистрацию', async () => {
    const { env } = await onRegister();
    freshAccount();
    el('crmail').value = ' me@mail.test ';
    el('crpass').value = 'secret-pass';
    el('crpass2').value = 'secret-pass';
    enter('crpass2');
    await settle();
    // Поле обозревателя заполнено ДО адреса сервера: без него регистрация упиралась в
    // «введите позывной» и до сервера не доходила.
    expect(env.nickAtServer).toEqual(['Orion']);
    expect(posted('/auth/register')[0]!.body).toEqual({
      login: 'Orion',
      password: 'secret-pass',
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
    el('crpass').value = 'secret-pass';
    el('crpass2').value = 'secret-pass';
    click('crgo');
    await settle();
    expect(posted('/auth/register')[0]!.body).toEqual({ login: 'Orion', password: 'secret-pass' });
  });

  it('отложенный заход в партию доигрывается и после регистрации', async () => {
    const { acc, env } = await onRegister();
    freshAccount();
    acc.pendingJoinAfterAuth.remember('m-7');
    el('crpass').value = 'secret-pass';
    el('crpass2').value = 'secret-pass';
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
    click('crrecover');
    expect([stages(), el('crecmail').value, focused]).toEqual([
      ['crecover'],
      'me@mail.test',
      'crecmail',
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
    expect(posted('/auth/recover')[0]!.body).toEqual({ email: 'me@mail.test' });
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

  it('«Назад» возвращает к приветствию', async () => {
    const { env } = await boot();
    click('crrecover');
    env.status.length = 0;
    click('crecback');
    expect([stages(), env.status]).toEqual([['cwelcome'], ['']]);
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
    expect([el('cresetuser').value, focused]).toEqual(['Orion', 'cresetpass']);
  });

  // Ссылку открывают на новом устройстве без позывного: сброс доходит до сервера, а сессия
  // сохраняется под адресом сервера (`serverAddress.ts`, правило 7).
  it('новый пароль тратит ссылку и сразу входит, позывной для этого не нужен', async () => {
    const { pages, env } = await boot();
    pages.openReset('tok-1');
    server['/auth/reset'] = () => reply(200, { login: 'Orion', token: 'jwt-reset' });
    el('cresetpass').value = 'new-secret';
    enter('cresetpass');
    expect(focused).toBe('cresetpass2');
    el('cresetpass2').value = 'new-secret';
    enter('cresetpass2');
    await settle();
    expect(posted('/auth/reset')[0]!.body).toEqual({ token: 'tok-1', password: 'new-secret' });
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
    el('cresetpass').value = 'new-secret';
    el('cresetpass2').value = 'new-secret';
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
    for (const id of ['crrecover', 'crecgo', 'crecback', 'cresetgo', 'cwelcome', 'cregister'])
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
