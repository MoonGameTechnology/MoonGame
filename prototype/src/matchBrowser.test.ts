/**
 * Обозреватель партий и «Мои партии» хаба (REFM-217, второй PR) — прямой тест владельца.
 *
 * Лента, вкладка и фильтр снаружи не видны, поэтому здесь проверено то, что видно игре:
 * что спрашивается у сервера, какие строки и кнопки встают на экран, что пишется в строку
 * статуса, куда ведут «Войти», «В архив» и пустые состояния, как фильтр сужает список и
 * переживает перезагрузку, что показывает хаб. Страница — маленький поддельный DOM; вход
 * в партию и экран настройки подменены записью вызовов, проба сервера и хранилище —
 * настоящие. В конце — стык с `main.ts`.
 */
import { readFileSync } from 'node:fs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { t, tData } from '../../localization/runtime';
import { shareAddress } from '../../decisions/matchAddress';
import { saveSession } from '../../decisions/sessionStore';
import { fmtJoinWindow, ruleSummary } from './matchRow';

const BASE = 'ws://srv.test:8080';
const HTTP = 'http://srv.test:8080';

interface Reply {
  ok: boolean;
  status: number;
  json(): Promise<unknown>;
}
const reply = (status: number, body: unknown = {}): Reply => ({
  ok: status >= 200 && status < 300,
  status,
  json: async () => body,
});

type Listener = (e: { target: El }) => void;

/** Узел поддельной страницы: ровно то, чем пользуется модуль. */
class El {
  id = '';
  className = '';
  type = '';
  checked = false;
  min = '';
  max = '';
  value = '';
  hidden = false;
  style = { display: '' };
  dataset: Record<string, string> = {};
  children: El[] = [];
  parent: El | null = null;
  private own = '';
  private markup = '';
  private on = new Map<string, Listener[]>();
  constructor(readonly tag: string) {}

  readonly classList = {
    toggle: (c: string, force?: boolean): void => {
      const rest = this.className.split(/\s+/).filter((x) => x && x !== c);
      const want = force ?? !this.has(c);
      this.className = (want ? [...rest, c] : rest).join(' ');
    },
    contains: (c: string): boolean => this.has(c),
  };
  has(c: string): boolean {
    return this.className.split(/\s+/).includes(c);
  }

  get textContent(): string {
    if (this.markup) return this.markup.replace(/<[^>]*>/g, '');
    return this.own + this.children.map((c) => c.textContent).join('');
  }
  set textContent(v: string) {
    this.own = v;
    this.markup = '';
    this.children = [];
  }
  get innerHTML(): string {
    return this.markup;
  }
  /** Разметка разбирается плоско: каждый открывающий тег с `id`/`class` — дочерний узел,
   *  чтобы модуль находил свои кнопки так же, как в браузере. */
  set innerHTML(v: string) {
    this.textContent = '';
    this.markup = v;
    for (const m of v.matchAll(/<(\w+)([^>]*)>/g)) {
      const n = new El(m[1]!);
      n.id = /\bid="([^"]*)"/.exec(m[2]!)?.[1] ?? '';
      n.className = /\bclass="([^"]*)"/.exec(m[2]!)?.[1] ?? '';
      n.parent = this;
      this.children.push(n);
    }
  }
  appendChild(c: El): El {
    c.parent = this;
    this.children.push(c);
    return c;
  }
  addEventListener(type: string, fn: Listener): void {
    this.on.set(type, [...(this.on.get(type) ?? []), fn]);
  }
  fire(type: string, target: El = this): void {
    for (const fn of this.on.get(type) ?? []) fn({ target });
  }
  /** Щелчок всплывает, как в браузере: так работают кнопки режима в `#mf-mode`. */
  click(): void {
    this.fire('click', this);
    for (let n = this.parent; n; n = n.parent) n.fire('click', this);
  }
  all(): El[] {
    return this.children.flatMap((c) => [c, ...c.all()]);
  }
  matches(simple: string): boolean {
    const m = /^(?:#([\w-]+))?(?:\.([\w-]+))?(?:\[data-(\w+)="([^"]*)"\])?$/.exec(simple);
    if (!m) throw new Error(`селектор не поддержан: ${simple}`);
    if (m[1] && this.id !== m[1]) return false;
    if (m[2] && !this.has(m[2])) return false;
    if (m[3] && this.dataset[m[3]] !== m[4]) return false;
    return true;
  }
  querySelectorAll(sel: string): El[] {
    const parts = sel.split(' ');
    const last = parts.pop()!;
    return this.all().filter((n) => {
      if (!n.matches(last)) return false;
      if (!parts.length) return true;
      for (let p = n.parent; p; p = p.parent) if (p.matches(parts[0]!)) return true;
      return false;
    });
  }
  querySelector(sel: string): El | null {
    return this.querySelectorAll(sel)[0] ?? null;
  }
  closest(sel: string): El | null {
    if (this.matches(sel)) return this;
    for (let n = this.parent; n; n = n.parent) if (n.matches(sel)) return n;
    return null;
  }
}

/** Экран подключения со стадией обозревателя и раздел «Мои партии» хаба. */
function buildPage(): El {
  const root = new El('body');
  const add = (parent: El, tag: string, props: Partial<El> = {}): El =>
    parent.appendChild(Object.assign(new El(tag), props));
  const browse = add(root, 'div', { id: 'cbrowse' });
  add(browse, 'div', { className: 'csub' });
  add(add(browse, 'div', { className: 'cfield' }), 'input', { id: 'csrv' });
  add(add(browse, 'div', { className: 'cfield' }), 'input', { id: 'cnick' });
  add(add(browse, 'div', { className: 'crow' }), 'button', { id: 'cgo' });
  for (const tab of ['available', 'active', 'archived'])
    add(browse, 'button', {
      className: tab === 'available' ? 'mtab active' : 'mtab',
      dataset: { tab },
    });
  const filter = add(browse, 'div', { id: 'mfilter' });
  const mode = add(filter, 'div', { id: 'mf-mode' });
  for (const m of ['all', 'pvp', 'pve'])
    add(mode, 'button', { className: 'mfbtn', dataset: { mode: m } });
  add(filter, 'button', { id: 'mf-map' });
  add(filter, 'div', { id: 'mf-maps' });
  add(filter, 'input', { id: 'mf-min' });
  add(filter, 'input', { id: 'mf-max' });
  add(filter, 'span', { id: 'mf-range' });
  add(browse, 'div', { id: 'match-create' });
  add(browse, 'div', { id: 'mlist' });
  add(root, 'div', { id: 'hub-mine-sec' });
  add(root, 'div', { id: 'hub-mine' });
  return root;
}

const row = (matchId: string, over: Record<string, unknown> = {}) => ({
  matchId,
  mapId: 'nexus',
  rules: { timeScale: 1, victory: { scoreLimit: 500 } },
  days: 3,
  players: { seated: 2, capacity: 8 },
  status: 'running',
  ...over,
});
type Lists = Record<'available' | 'active' | 'archived', ReturnType<typeof row>[]>;
const LISTS = (): Lists => ({
  available: [
    row('a1', { kind: 'pvp' }),
    row('a2', { kind: 'pve', mapId: 'frontier', players: { seated: 1, capacity: 4 } }),
    row('a3'),
  ],
  active: [row('m2', { status: 'ended' }), row('m1')],
  archived: [row('z1')],
});

let root: El;
let cell: Map<string, string>;
let lists: Lists;
let server: (url: string, method: string) => Reply | Promise<Reply>;
let fetched: Array<{ url: string; method: string; auth?: string }>;
/** Что ушло игре через хуки и подменённые модули. */
let calls: unknown[][];
let status: string;
let srv: { base: string; nick: string } | null;
let connectShown: boolean;
let clipboard: { writeText(s: string): Promise<void> } | undefined;
/** Что ушло в консоль как сбой отложенной цепочки (`detach`). */
let detached: unknown[][];

const $ = (id: string): El => root.all().find((n) => n.id === id)!;
const of = (name: string): unknown[][] => calls.filter((c) => c[0] === name);
const settle = async (): Promise<void> => {
  for (let i = 0; i < 6; i++) await new Promise((r) => setTimeout(r, 0));
};
/** Строки списка: подпись и кнопки. */
const rows = () =>
  $('mlist')
    .children.filter((c) => c.has('mrow'))
    .map((r) => ({ info: r.children[0]!.innerHTML, buttons: r.children[1]!.children }));
const ids = () => rows().map((r) => /class="mid">([^<]*)</.exec(r.info)?.[1]);
const tab = (name: string): El => root.querySelector(`.mtab[data-tab="${name}"]`)!;
const matchesFetches = () => fetched.filter((f) => f.url.includes('/matches?'));

beforeEach(() => {
  root = buildPage();
  cell = new Map();
  lists = LISTS();
  fetched = [];
  calls = [];
  status = '';
  srv = { base: BASE, nick: 'Orion' };
  connectShown = true;
  clipboard = { writeText: async (s) => void calls.push(['clipboard', s]) };
  detached = [];
  vi.spyOn(console, 'error').mockImplementation((...args: unknown[]) => void detached.push(args));
  // Хост без аккаунтов: проба режима отвечает «не знаю такого адреса».
  server = (url) => (url.endsWith('/auth/status') ? reply(404) : reply(200, lists));
  vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval'] });
  vi.stubGlobal('localStorage', {
    getItem: (k: string) => cell.get(k) ?? null,
    setItem: (k: string, v: string) => void cell.set(k, v),
    removeItem: (k: string) => void cell.delete(k),
  });
  vi.stubGlobal('document', {
    getElementById: (id: string) => root.all().find((n) => n.id === id) ?? null,
    querySelector: (sel: string) => root.querySelector(sel),
    querySelectorAll: (sel: string) => root.querySelectorAll(sel),
    createElement: (tag: string) => new El(tag),
    createTextNode: (text: string) => Object.assign(new El('#text'), { textContent: text }),
  });
  vi.stubGlobal('navigator', {
    get clipboard() {
      return clipboard;
    },
  });
  vi.stubGlobal(
    'fetch',
    async (url: string, init?: { method?: string; headers?: Record<string, string> }) => {
      const method = init?.method ?? 'GET';
      fetched.push({ url, method, auth: init?.headers?.authorization });
      return server(url, method);
    },
  );
});
afterEach(() => {
  // Ни один переопрос не должен падать за кулисами: игрок видит это как «нажал — ничего».
  expect(detached).toEqual([]);
  vi.restoreAllMocks();
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.doUnmock('./matchJoin');
  vi.doUnmock('./setupScreen');
});

/** Свежая загрузка — как после перезагрузки страницы. */
async function boot({ player = false } = {}) {
  vi.resetModules();
  // Перезагрузка строит страницу заново: прежние обработчики остаются со старой.
  root = buildPage();
  vi.stubGlobal('__PLAYER_BUILD__', player);
  vi.doMock('./matchJoin', () => ({
    openSessionTab: (id: string, seated = false) => void calls.push(['openSessionTab', id, seated]),
  }));
  vi.doMock('./setupScreen', () => ({
    openSetup: (from: string) => void calls.push(['openSetup', from]),
  }));
  const mb = await import('./matchBrowser');
  mb.initMatchBrowser({
    resolveServer: () => srv,
    status: (text) => {
      status = text;
      calls.push(['status', text]);
    },
    statusText: () => status,
    connectShown: () => connectShown,
    hubNote: (text) => void calls.push(['hubNote', text]),
    hubTab: (name) => void calls.push(['hubTab', name]),
    mapLabel: (id) => `карта ${id}`,
    leaveMatch: () => void calls.push(['leaveMatch']),
  });
  return mb;
}

/** Обозреватель открыт и лента пришла. */
async function browsing() {
  const mb = await boot();
  await mb.refreshMatches();
  calls = [];
  fetched = [];
  return mb;
}

describe('REFM-217 — лента обозревателя', () => {
  it('без адреса сервера ничего не спрашивает', async () => {
    const mb = await boot();
    srv = null;
    await mb.refreshMatches();
    expect(fetched).toEqual([]);
  });

  it('спрашивает режим сервера и ленту под позывным, рисует «Доступные» и запоминает адрес', async () => {
    const mb = await boot();
    await mb.refreshMatches();
    expect(fetched).toEqual([
      { url: `${HTTP}/auth/status`, method: 'GET', auth: undefined },
      { url: `${HTTP}/matches?nick=Orion`, method: 'GET', auth: undefined },
    ]);
    expect(ids()).toEqual(['a1', 'a2', 'a3']);
    expect(rows()[0]!.info).toContain('карта nexus');
    expect(rows()[1]!.info).toContain('карта frontier');
    expect(cell.get('void.server')).toBe(BASE);
    expect(cell.get('void.nick')).toBe('Orion');
  });

  it('на хосте с учётками ленту спрашивает с сессией этого позывного', async () => {
    saveSession(localStorage, BASE, { login: 'Orion', token: 'S1' });
    const mb = await boot();
    await mb.refreshMatches();
    expect(matchesFetches()).toEqual([
      { url: `${HTTP}/matches?nick=Orion`, method: 'GET', auth: 'Bearer S1' },
    ]);
  });

  it('строка статуса: «загрузка», потом чисто', async () => {
    const mb = await boot();
    await mb.refreshMatches();
    expect(of('status')).toEqual([
      ['status', t('browser.loading')],
      ['status', ''],
    ]);
  });

  it('тихий переопрос не мигает «загрузкой» над показанным списком', async () => {
    const mb = await browsing();
    await mb.refreshMatches(true);
    expect(of('status')).toEqual([['status', '']]);
  });

  it('сервер отказал: «сервер недоступен», не тупик — путь в соло', async () => {
    const mb = await boot();
    server = (url) => (url.endsWith('/auth/status') ? reply(404) : reply(500));
    await mb.refreshMatches();
    expect(status).toBe(t('acc.server-down'));
    expect($('mlist').innerHTML).toContain(t('acc.server-down'));
    expect($('match-create').style.display).toBe('none');
    $('msolo-go').click();
    expect(calls.slice(-2)).toEqual([['leaveMatch'], ['openSetup', 'hub']]);
  });

  it('связи нет вовсе: то же самое, и прежняя лента не остаётся на экране', async () => {
    const mb = await browsing();
    server = () => {
      throw new Error('offline');
    };
    await mb.refreshMatches();
    expect(status).toBe(t('acc.server-down'));
    expect(rows()).toEqual([]);
    expect($('msolo-go')).toBeDefined();
  });

  it('строка: карта, день, игроки, правила, режим и окно входа', async () => {
    lists.available = [
      row('a1', {
        modeId: 'pve_waves',
        kind: 'pve',
        entryOpen: true,
        entryClosesInMs: 30 * 3_600_000,
      }),
      row('a2', { modeId: 'duel', kind: 'pvp', entryOpen: true, entryClosesInMs: 5 * 3_600_000 }),
      row('a3', { entryOpen: false, entryClosesInMs: 0, status: 'ended' }),
    ];
    await browsing();
    const [a1, a2, a3] = rows().map((r) => r.info);
    expect(a1).toContain(
      `<span class="mmode pve">${t('browser.mode.pve')}</span> ${tData('pve_waves')} · `,
    );
    expect(a1).toContain(t('browser.day', { n: 3 }));
    expect(a1).toContain(t('browser.players', { s: 2, c: 8 }));
    expect(a1).toContain(ruleSummary({ timeScale: 1, victory: { scoreLimit: 500 } }));
    expect(a1).toContain(t('browser.running'));
    expect(a1).toContain(
      `<span class="mwin">${t('browser.join-window', { dur: fmtJoinWindow(30 * 3_600_000) })}</span>`,
    );
    expect(a2).toContain(`<span class="mmode pvp">${t('browser.mode.pvp')}</span>`);
    expect(a2).toContain('<span class="mwin soon">');
    expect(a3).toContain(`<span class="mwin shut">${t('acc.join-closed')}</span>`);
    expect(a3).toContain(t('browser.finished'));
    expect(a3).not.toContain('mmode');
  });

  it('на своих вкладках окна входа нет: возвращение им не ограничено', async () => {
    lists.active = [row('m1', { entryOpen: false, entryClosesInMs: 0 })];
    await browsing();
    tab('active').click();
    expect(rows()[0]!.info).not.toContain('mwin');
  });

  it('«Войти» на чужой партии ведёт на выбор места', async () => {
    await browsing();
    const join = rows()[0]!.buttons[0]!;
    expect(join.textContent).toBe(t('browser.join'));
    expect(rows()[0]!.buttons).toHaveLength(1);
    join.click();
    expect(calls).toEqual([['openSessionTab', 'a1', false]]);
  });

  it('«Активные»: «Продолжить» возвращает на своё место, рядом «В архив»', async () => {
    await browsing();
    tab('active').click();
    expect(tab('active').has('active')).toBe(true);
    expect(tab('available').has('active')).toBe(false);
    expect(ids()).toEqual(['m2', 'm1']);
    const [resume, archive] = rows()[1]!.buttons;
    expect(resume!.textContent).toBe(t('browser.resume'));
    expect(archive!.textContent).toBe(t('browser.archive'));
    resume!.click();
    expect(calls).toEqual([['openSessionTab', 'm1', true]]);
  });

  it('«Архив»: рядом с «Войти» — «Восстановить»', async () => {
    await browsing();
    tab('archived').click();
    expect(ids()).toEqual(['z1']);
    expect(rows()[0]!.buttons.map((b) => b.textContent)).toEqual([
      t('browser.join'),
      t('browser.restore'),
    ]);
  });

  it('«Новая партия» видна только над загруженными «Доступными»', async () => {
    await browsing();
    expect($('match-create').style.display).toBe('');
    tab('active').click();
    expect($('match-create').style.display).toBe('none');
  });

  it('строка статуса говорит «сервер недоступен» — новую партию не предлагает и над старой лентой', async () => {
    await browsing();
    // Строку пишет и сетевой цикл: обрыв сокета оставляет ленту в памяти.
    status = t('acc.server-down');
    tab('available').click();
    expect($('match-create').style.display).toBe('none');
    expect(ids()).toEqual(['a1', 'a2', 'a3']);
  });

  it('пустая вкладка: «здесь пусто» и путь в соло', async () => {
    lists.archived = [];
    await browsing();
    tab('archived').click();
    expect($('mlist').innerHTML).toContain(t('browser.empty'));
    expect($('msolo-go')).toBeDefined();
  });

  it('«Обновить список» перечитывает ленту', async () => {
    await browsing();
    $('cgo').click();
    await settle();
    expect(matchesFetches()).toHaveLength(1);
  });
});

describe('REFM-217 — архив', () => {
  it('удача: строка уходит на другую вкладку, список перечитан молча', async () => {
    await browsing();
    tab('active').click();
    server = (url) =>
      url.endsWith('/auth/status') ? reply(404) : reply(200, url.includes('/archive') ? {} : lists);
    rows()[1]!.buttons[1]!.click();
    await settle();
    expect(fetched.filter((f) => f.method === 'POST')).toEqual([
      { url: `${HTTP}/matches/m1/archive?nick=Orion`, method: 'POST', auth: undefined },
    ]);
    expect(matchesFetches()).toHaveLength(1);
    expect(status).toBe('');
  });

  it('отказ называет действие, которое не прошло', async () => {
    await browsing();
    server = (url) => (url.includes('archive') ? reply(403) : reply(404));
    tab('active').click();
    rows()[0]!.buttons[1]!.click();
    await settle();
    expect(status).toBe(t('browser.archive-failed'));
    tab('archived').click();
    rows()[0]!.buttons[1]!.click();
    await settle();
    expect(fetched.at(-1)!.url).toBe(`${HTTP}/matches/z1/unarchive?nick=Orion`);
    expect(status).toBe(t('browser.restore-failed'));
    expect(matchesFetches()).toEqual([]);
  });

  it('без адреса сервера ничего не шлёт', async () => {
    await browsing();
    tab('active').click();
    srv = null;
    rows()[0]!.buttons[1]!.click();
    await settle();
    expect(fetched).toEqual([]);
    // Чего не хватает, уже сказал разбор адреса; «связи нет» поверх было бы неправдой.
    expect(of('status')).toEqual([]);
  });

  it('обрыв связи — один текст на обе кнопки', async () => {
    await browsing();
    server = () => {
      throw new Error('offline');
    };
    tab('active').click();
    rows()[0]!.buttons[1]!.click();
    await settle();
    expect(status).toBe(t('browser.archive-error'));
  });
});

describe('REFM-217 — фильтр «Доступных»', () => {
  const mode = (m: string): El => root.querySelector(`.mfbtn[data-mode="${m}"]`)!;

  it('режим PvE оставляет PvE-партии и партии без вида; выбор запомнен', async () => {
    await browsing();
    mode('pve').click();
    expect(ids()).toEqual(['a2', 'a3']);
    expect(mode('pve').has('active')).toBe(true);
    expect(mode('all').has('active')).toBe(false);
    expect(JSON.parse(cell.get('void.filter')!).mode).toBe('pve');
  });

  it('выбор переживает перезагрузку страницы', async () => {
    await browsing();
    mode('pvp').click();
    const mb = await boot();
    await mb.refreshMatches();
    expect(ids()).toEqual(['a1', 'a3']);
  });

  it('галочки карт берутся из ленты и сужают список', async () => {
    await browsing();
    const boxes = $('mf-maps').children.map((label) => ({
      map: label.textContent,
      box: label.children[0]!,
    }));
    expect(boxes.map((b) => b.map)).toEqual(['frontier', 'nexus']);
    boxes[0]!.box.checked = true;
    boxes[0]!.box.fire('change');
    expect(ids()).toEqual(['a2']);
    expect($('mf-map').textContent).toBe(t('browser.filter.map.some', { n: 1 }));
    expect(JSON.parse(cell.get('void.filter')!).maps).toEqual(['frontier']);
    // Перерисовка строит галочки заново: те же две, и выбранная стоит.
    expect($('mf-maps').children.map((l) => [l.textContent, l.children[0]!.checked])).toEqual([
      ['frontier', true],
      ['nexus', false],
    ]);
  });

  it('карта ушла из ленты — её галочка не вычищает список', async () => {
    await browsing();
    const frontier = $('mf-maps').children[0]!.children[0]!;
    frontier.checked = true;
    frontier.fire('change');
    lists.available = [row('a1'), row('a3')];
    $('cgo').click();
    await settle();
    expect(ids()).toEqual(['a1', 'a3']);
    expect($('mf-map').textContent).toBe(t('browser.filter.map.all'));
  });

  it('ползунок игроков считает вместимость', async () => {
    await browsing();
    expect([$('mf-min').min, $('mf-max').max]).toEqual(['4', '8']);
    $('mf-min').value = '5';
    $('mf-min').fire('input');
    expect(ids()).toEqual(['a1', 'a3']);
    expect($('mf-range').textContent).toBe(t('browser.filter.range', { min: 5, max: 8 }));
  });

  it('отфильтровано всё: подсказка ослабить фильтр, без пути в соло', async () => {
    lists.available = [row('a1', { kind: 'pvp' })];
    await browsing();
    mode('pve').click();
    expect($('mlist').innerHTML).toContain(t('browser.filter.none'));
    expect($('mlist').innerHTML).not.toContain('msolo-go');
    expect($('mfilter').style.display).toBe('');
  });

  it('на «Активных» фильтра нет: панель спрятана, свои партии видны все', async () => {
    lists.active = [row('m1', { kind: 'pvp' }), row('m2', { kind: 'pve' })];
    await browsing();
    mode('pvp').click();
    tab('active').click();
    expect($('mfilter').style.display).toBe('none');
    expect(ids()).toEqual(['m1', 'm2']);
  });

  it('кнопка карт раскрывает и прячет список галочек', async () => {
    await browsing();
    $('mf-maps').style.display = 'none';
    $('mf-map').click();
    expect($('mf-maps').style.display).toBe('');
    $('mf-map').click();
    expect($('mf-maps').style.display).toBe('none');
  });
});

describe('REFM-217 — «Мои партии» хаба', () => {
  const cards = () => $('hub-mine').children.filter((c) => c.has('hm-row'));

  it('свои партии, идущие первыми; строку статуса обозревателя не трогает', async () => {
    const mb = await boot();
    await mb.refreshMyMatches();
    expect(of('status')).toEqual([]);
    expect($('hub-mine-sec').hidden).toBe(false);
    expect(cards()).toHaveLength(2);
    const first = cards()[0]!;
    expect(first.innerHTML).toContain(shareAddress(HTTP, 'm1'));
    expect(first.innerHTML).toContain('▶');
    expect(cards()[1]!.innerHTML).toContain('◼');
    const open = first.children.at(-1)!.children[0]!;
    expect(open.textContent).toBe(t('browser.resume'));
    open.click();
    expect(of('openSessionTab')).toEqual([['openSessionTab', 'm1', true]]);
  });

  it('ленты нет — раздел молчит вместе с заголовком, прежние строки уходят', async () => {
    const mb = await boot();
    await mb.refreshMyMatches();
    expect(cards()).toHaveLength(2);
    server = (url) => (url.endsWith('/auth/status') ? reply(404) : reply(500));
    await mb.refreshMyMatches();
    expect($('hub-mine-sec').hidden).toBe(true);
    expect($('hub-mine').textContent).toBe('');
    expect(status).toBe('');
  });

  it('без адреса сервера ленту не спрашивает и молчит', async () => {
    const mb = await boot();
    srv = null;
    await mb.refreshMyMatches();
    expect(fetched).toEqual([]);
    expect($('hub-mine-sec').hidden).toBe(true);
  });

  it('своих партий нет — зовёт туда, где их берут', async () => {
    lists.active = [];
    const mb = await boot();
    await mb.refreshMyMatches();
    expect($('hub-mine').innerHTML).toContain(t('hub.mine.empty'));
    $('hub-mine').querySelector('.hm-go')!.click();
    expect(of('hubTab')).toEqual([['hubTab', 'games']]);
  });

  it('адрес партии копируется; без буфера обмена — просьба скопировать из строки', async () => {
    const mb = await boot();
    await mb.refreshMyMatches();
    const copy = () => cards()[0]!.children.at(-1)!.children[1]!;
    expect(copy().textContent).toBe(t('hub.mine.copy'));
    copy().click();
    await settle();
    expect(of('clipboard')).toEqual([['clipboard', shareAddress(HTTP, 'm1')]]);
    expect(of('hubNote')).toEqual([['hubNote', t('hub.mine.copied')]]);
    clipboard = undefined;
    copy().click();
    await settle();
    expect(of('hubNote').at(-1)).toEqual(['hubNote', t('hub.mine.copy-manual')]);
  });

  it('больше трёх — «ещё N» ведёт на «Активные» обозревателя', async () => {
    lists.active = ['m1', 'm2', 'm3', 'm4', 'm5'].map((id) => row(id));
    const mb = await boot();
    await mb.refreshMyMatches();
    expect(cards()).toHaveLength(3);
    const more = $('hub-mine').children.at(-1)!;
    expect(more.textContent).toBe(t('hub.mine.more', { n: 2 }));
    more.click();
    expect(tab('active').has('active')).toBe(true);
    expect(ids()).toEqual(['m1', 'm2', 'm3', 'm4', 'm5']);
    expect(of('hubTab')).toEqual([['hubTab', 'games']]);
  });
});

describe('REFM-217 — сборка игрока', () => {
  const field = (id: string): El => $(id).closest('.cfield')!;

  it('экран — только вкладки и список: позывной, адрес, «Обновить» и подзаголовок спрятаны', async () => {
    await boot({ player: true });
    expect(field('cnick').style.display).toBe('none');
    expect(field('csrv').style.display).toBe('none');
    expect($('cgo').closest('.crow')!.style.display).toBe('none');
    expect($('cbrowse').querySelector('.csub')!.style.display).toBe('none');
  });

  it('ленты нет — всплывает строка адреса, текст беды не дублируется под списком', async () => {
    const mb = await boot({ player: true });
    server = (url) => (url.endsWith('/auth/status') ? reply(404) : reply(500));
    await mb.refreshMatches();
    expect(field('csrv').style.display).toBe('');
    expect(status).toBe('');
    expect($('mlist').innerHTML).toContain(t('browser.server-down'));
    server = (url) => (url.endsWith('/auth/status') ? reply(404) : reply(200, lists));
    await mb.refreshMatches();
    expect(field('csrv').style.display).toBe('none');
  });

  it('тихий переопрос раз в 10 с — только пока обозреватель на экране', async () => {
    await boot({ player: true });
    vi.advanceTimersByTime(9_999);
    await settle();
    expect(matchesFetches()).toEqual([]);
    vi.advanceTimersByTime(1);
    await settle();
    expect(matchesFetches()).toHaveLength(1);
    expect(of('status')).toEqual([['status', '']]);
    connectShown = false;
    vi.advanceTimersByTime(10_000);
    await settle();
    connectShown = true;
    $('cbrowse').style.display = 'none';
    vi.advanceTimersByTime(10_000);
    await settle();
    expect(matchesFetches()).toHaveLength(1);
  });

  it('новый адрес сервера перечитывает список сразу', async () => {
    await boot({ player: true });
    $('csrv').fire('change');
    await settle();
    expect(matchesFetches()).toHaveLength(1);
  });

  it('в дев-клиенте нет ни переопроса, ни прятанья строк', async () => {
    await boot();
    vi.advanceTimersByTime(30_000);
    await settle();
    expect(fetched).toEqual([]);
    expect(field('csrv').style.display).toBe('');
    expect(vi.getTimerCount()).toBe(0);
  });
});

describe('REFM-217 — дверь харнеса', () => {
  it('готовая лента встаёт на «Доступные» без похода на сервер', async () => {
    const mb = await boot();
    tab('archived').click();
    mb.showLists(lists);
    expect(fetched).toEqual([]);
    expect(ids()).toEqual(['a1', 'a2', 'a3']);
  });
});

describe('REFM-217 — стык с main.ts', () => {
  const MAIN = readFileSync(new URL('./main.ts', import.meta.url), 'utf8');
  const BROWSER = readFileSync(new URL('./matchBrowser.ts', import.meta.url), 'utf8');
  const SIZES = readFileSync(new URL('../sizetest.mjs', import.meta.url), 'utf8');

  it('лента, вкладка и фильтр живут только у владельца', () => {
    expect(MAIN).not.toMatch(/\b(matchLists|activeTab|matchFilter)\b/);
    expect(MAIN).not.toMatch(
      /\bfunction (refreshMatches|loadMatchLists|toggleArchive|saveMatchFilter|renderFilterPanel|renderMatches|renderMyMatches|refreshMyMatches)\(/,
    );
    expect(MAIN).not.toMatch(/\binterface MatchRow\b/);
  });

  it('обозреватель подключается до загрузочного блока: тот открывает хаб', () => {
    const init = MAIN.indexOf('initMatchBrowser({');
    expect(init).toBeGreaterThan(0);
    expect(init).toBeLessThan(MAIN.indexOf('if (bootReset) {'));
  });

  it('вход в обозреватель и заход домой переспрашивают ленту дверями владельца', () => {
    expect(MAIN).toContain("detach('обозреватель: список партий', refreshMatches());");
    expect(MAIN).toContain("if (tab === 'home') detach('хаб: свои партии', refreshMyMatches());");
  });

  it('харнес размеров кладёт ленту дверью, модуль не тянет `main.ts`', () => {
    expect(SIZES).toContain("import { showLists as __showLists } from './matchBrowser';");
    expect(SIZES).toContain('__showLists(lists);');
    expect(SIZES).not.toMatch(/\b(matchLists|activeTab|renderMatches)\b/);
    expect(BROWSER).not.toMatch(/from '\.\/main'/);
  });
});
