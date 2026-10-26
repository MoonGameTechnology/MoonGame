/**
 * Обозреватель партий и «Мои партии» хаба (REFM-217, второй PR) — прямой тест владельца.
 *
 * Лента, вкладка и фильтр снаружи не видны, поэтому здесь проверено то, что видно игре:
 * что спрашивается у сервера, какие строки и кнопки встают на экран, что пишется в строку
 * статуса, куда ведут «Войти», «В архив» и пустые состояния, как фильтр сужает список и
 * переживает перезагрузку, когда видна карточка с адресом сервера и когда тикает переопрос
 * (UIX-17.1), что показывает хаб. Страница — маленький поддельный DOM; вход
 * в партию и экран настройки подменены записью вызовов, проба сервера и хранилище —
 * настоящие. В конце — стык с `main.ts`.
 */
import { readFileSync } from 'node:fs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { t, tData } from '../../localization/runtime';
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

type Listener = (e: { target: El; preventDefault(): void }) => void;

/** Стиль узла: `display` и пользовательские свойства (`--lo`/`--hi` дорожки игроков). */
class Style {
  display = '';
  props: Record<string, string> = {};
  setProperty(name: string, value: string): void {
    this.props[name] = value;
  }
}

/** Узел поддельной страницы: ровно то, чем пользуется модуль. */
class El {
  id = '';
  className = '';
  type = '';
  checked = false;
  min = '';
  max = '';
  value = '';
  title = '';
  hidden = false;
  style = new Style();
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
    if (!this.markup) return this.own + this.children.map((c) => c.textContent).join('');
    // Текст разметки — всё вне `<…>`, как его прочтёт игрок.
    let text = '';
    let inTag = false;
    for (const ch of this.markup) {
      if (ch === '<') inTag = true;
      else if (ch === '>') inTag = false;
      else if (!inTag) text += ch;
    }
    return text;
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
    for (const fn of this.on.get(type) ?? []) fn({ target, preventDefault: () => {} });
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
  const hidden = (): Style => Object.assign(new Style(), { display: 'none' });
  const browse = add(root, 'div', { id: 'cbrowse' });
  // Позывной — спрятанный носитель состояния, на странице его нет (UIX-17.1).
  add(add(browse, 'form', { className: 'mcarry', hidden: true }), 'input', { id: 'cnick' });
  for (const tab of ['available', 'active', 'archived'])
    add(add(browse, 'button', {
      className: tab === 'available' ? 'mtab active' : 'mtab',
      dataset: { tab },
    }), 'i', { className: 'mcount' });
  // Карточка «Сервер не отвечает» с полем адреса: в разметке спрятана.
  const card = add(browse, 'div', { id: 'msrv', style: hidden() });
  add(add(card, 'label', { className: 'cfield' }), 'input', { id: 'csrv' });
  add(card, 'button', { id: 'cgo' });
  const filter = add(browse, 'div', { id: 'mfilter', style: hidden() });
  const mode = add(filter, 'div', { id: 'mf-mode' });
  for (const m of ['all', 'pvp', 'pve'])
    add(mode, 'button', { className: 'mfbtn', dataset: { mode: m } });
  const mapbox = add(filter, 'div', { id: 'mf-mapbox' });
  add(mapbox, 'button', { id: 'mf-map' });
  add(mapbox, 'div', { id: 'mf-maps' });
  const players = add(filter, 'div', { id: 'mf-players' });
  add(players, 'span', { id: 'mf-range' });
  const dual = add(players, 'div', { id: 'mf-dual' });
  add(dual, 'input', { id: 'mf-min' });
  add(dual, 'input', { id: 'mf-max' });
  const num = add(browse, 'form', { id: 'mnum', style: hidden() });
  add(num, 'input', { id: 'mnum-in' });
  add(num, 'button', { id: 'mnum-go' });
  add(browse, 'div', { id: 'mlist' });
  add(browse, 'div', { id: 'match-create', style: hidden() });
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
/** Поддельный `document`: в нём же фокус — пока игрок правит адрес, переопрос ждёт. */
let doc: { activeElement: El | null } & Record<string, unknown>;

const $ = (id: string): El => root.all().find((n) => n.id === id)!;
const of = (name: string): unknown[][] => calls.filter((c) => c[0] === name);
const settle = async (): Promise<void> => {
  for (let i = 0; i < 6; i++) await new Promise((r) => setTimeout(r, 0));
};
/** Строки списка: номер партии, подпись и кнопки. */
const rows = () =>
  $('mlist')
    .children.filter((c) => c.has('mrow'))
    .map((r) => ({
      id: r.dataset.match,
      row: r,
      info: r.children[0]!.innerHTML,
      buttons: r.children[1]!.children,
    }));
const ids = () => rows().map((r) => r.id);
const tab = (name: string): El => root.querySelector(`.mtab[data-tab="${name}"]`)!;
/** Числа на ярлыках вкладок; пустая строка — числа нет. */
const counts = () =>
  ['available', 'active', 'archived'].map((name) => tab(name).querySelector('.mcount')!.textContent);
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
  doc = {
    activeElement: null,
    getElementById: (id: string) => root.all().find((n) => n.id === id) ?? null,
    querySelector: (sel: string) => root.querySelector(sel),
    querySelectorAll: (sel: string) => root.querySelectorAll(sel),
    createElement: (tag: string) => new El(tag),
    createTextNode: (text: string) => Object.assign(new El('#text'), { textContent: text }),
  };
  vi.stubGlobal('document', doc);
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
  vi.doUnmock('./matchDescription');
});

/** Свежая загрузка — как после перезагрузки страницы. У сборок одна страница (UIX-17.1), поэтому
 *  загрузка одна. */
async function boot() {
  vi.resetModules();
  // Перезагрузка строит страницу заново: прежние обработчики остаются со старой.
  root = buildPage();
  vi.doMock('./matchJoin', () => ({
    openSessionTab: (id: string, seated = false) => void calls.push(['openSessionTab', id, seated]),
  }));
  vi.doMock('./setupScreen', () => ({
    openSetup: (from: string) => void calls.push(['openSetup', from]),
  }));
  vi.doMock('./matchDescription', () => ({
    isMatchDescriptionOpen: () => !!doc.descriptionOpen,
    openMatchDescription: (match: { matchId: string }, label: string) =>
      void calls.push(['description', match.matchId, label]),
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

  it('сервер отказал: карточка с адресом, беда названа один раз, не тупик — путь в соло', async () => {
    const mb = await boot();
    server = (url) => (url.endsWith('/auth/status') ? reply(404) : reply(500));
    await mb.refreshMatches();
    expect($('msrv').style.display).toBe('');
    // Карточка и есть сообщение о беде: строку статуса с тем же текстом гасят, под списком его нет.
    expect(of('status').at(-2)).toEqual(['status', t('acc.server-down')]);
    expect(status).toBe('');
    expect($('mlist').innerHTML).not.toContain(t('acc.server-down'));
    expect($('mlist').innerHTML).not.toContain(t('browser.server-down'));
    expect($('match-create').style.display).toBe('none');
    expect($('mfilter').style.display).toBe('none');
    expect(counts()).toEqual(['', '', '']);
    $('msolo-go').click();
    expect(calls.slice(-2)).toEqual([['leaveMatch'], ['openSetup', 'hub']]);
  });

  it('связи нет вовсе: то же самое, и прежняя лента не остаётся на экране', async () => {
    const mb = await browsing();
    server = () => {
      throw new Error('offline');
    };
    await mb.refreshMatches();
    expect($('msrv').style.display).toBe('');
    expect(rows()).toEqual([]);
    expect($('msolo-go')).toBeDefined();
  });

  it('карточка переживает смену вкладок и уходит, как только лента пришла', async () => {
    const mb = await boot();
    server = (url) => (url.endsWith('/auth/status') ? reply(404) : reply(500));
    await mb.refreshMatches();
    tab('active').click();
    expect($('msrv').style.display).toBe('');
    server = (url) => (url.endsWith('/auth/status') ? reply(404) : reply(200, lists));
    await mb.refreshMatches();
    expect($('msrv').style.display).toBe('none');
    expect(ids()).toEqual(['m2', 'm1']);
  });

  it('числа на вкладках: сколько строк покажет каждая, у «Доступных» — после фильтра', async () => {
    await browsing();
    expect(counts()).toEqual(['3', '2', '1']);
    root.querySelector('.mfbtn[data-mode="pvp"]')!.click();
    expect(counts()).toEqual(['2', '2', '1']);
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
      `<span class="mmode pve">${t('browser.mode.pve')}</span><span class="mmodename">${tData('pve_waves')}</span>`,
    );
    expect(a1).toContain(t('browser.day', { n: 3 }));
    // Места точками: две занятые из восьми, число рядом, словами — в подсказке.
    expect(a1).toContain(
      `<span class="mseats" title="${t('browser.seats', { s: 2, c: 8 })}" aria-label="${t('browser.seats', { s: 2, c: 8 })}">` +
        '<i class="on"></i>'.repeat(2) +
        '<i></i>'.repeat(6) +
        '<b>2/8</b></span>',
    );
    expect(a1).toContain(ruleSummary({ timeScale: 1, victory: { scoreLimit: 500 } }, 'pve'));
    expect(a1).not.toContain(t('browser.description.score', { n: 500 }));
    // Идущий матч — обычное состояние: «идёт» на каждой строке было шумом.
    expect(a1).not.toContain(t('browser.running'));
    expect(a1).toContain(
      `<span class="mwin">${t('browser.join-window', { dur: fmtJoinWindow(30 * 3_600_000) })}</span>`,
    );
    expect(a2).toContain(`<span class="mmode pvp">${t('browser.mode.pvp')}</span>`);
    expect(a2).toContain('<span class="mwin soon">');
    expect(a3).toContain(`<span class="mwin shut">${t('acc.join-closed')}</span>`);
    expect(a3).toContain(`<span class="mended">${t('browser.finished')}</span>`);
    expect(a3).not.toContain('mmode');
  });

  it('номера партии в строке нет: он в подсказке строки, для разговора с поддержкой', async () => {
    await browsing();
    const first = rows()[0]!;
    expect(first.info).not.toContain('a1');
    expect(first.row.title).toBe('a1');
  });

  it('больше восьми мест — без точек, только число', async () => {
    lists.available = [row('big', { players: { seated: 7, capacity: 20 } })];
    await browsing();
    expect(rows()[0]!.info).toContain('<b>7/20</b>');
    expect(rows()[0]!.info).not.toContain('<i');
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
    expect(rows()[0]!.buttons).toHaveLength(2);
    expect(rows()[0]!.row.className).toBe('mrow mrow-2');
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
    // Двум кнопкам на телефоне нужен свой ряд: рядом с картой они сжали бы имя.
    expect(rows()[1]!.row.className).toBe('mrow mrow-2');
    resume!.click();
    expect(calls).toEqual([['openSessionTab', 'm1', true]]);
  });

  it('поле номера: своя партия — возврат на место, чужая — вход, мусор — подсказка', async () => {
    await browsing();
    $('mnum-in').value = '№ m1';
    $('mnum').fire('submit');
    $('mnum-in').value = 'a1';
    $('mnum').fire('submit');
    expect(of('openSessionTab')).toEqual([
      ['openSessionTab', 'm1', true],
      ['openSessionTab', 'a1', false],
    ]);
    $('mnum-in').value = 'не номер!';
    $('mnum').fire('submit');
    expect(of('openSessionTab')).toHaveLength(2);
    expect(status).toBe(t('browser.number.bad'));
  });

  it('«Архив»: рядом с «Войти» — «Восстановить»', async () => {
    await browsing();
    tab('archived').click();
    expect(ids()).toEqual(['z1']);
    expect(rows()[0]!.buttons.map((b) => b.textContent)).toEqual([
      t('browser.join'),
      t('browser.restore'),
      t('browser.description'),
    ]);
  });

  it('описание доступно во всех вкладках и в хабе без входа в матч', async () => {
    const mb = await browsing();
    for (const name of ['available', 'active', 'archived']) {
      tab(name).click();
      const first = rows()[0]!;
      first.buttons.at(-1)!.click();
      expect(of('description').at(-1)).toEqual(['description', first.id, 'карта nexus']);
    }
    await mb.refreshMyMatches();
    $('hub-mine').querySelector('.mdescription')!.click();
    expect(of('description').at(-1)).toEqual(['description', 'm1', 'карта nexus']);
    expect(of('openSessionTab')).toEqual([]);
  });

  it('переопрос не заменяет кнопку под открытым описанием', async () => {
    const mb = await browsing();
    const first = rows()[0]!.row;
    doc.descriptionOpen = true;
    vi.advanceTimersByTime(10_000);
    await settle();
    expect(matchesFetches()).toHaveLength(0);
    await mb.refreshMatches(true);
    expect(rows()[0]!.row).toBe(first);
    doc.descriptionOpen = false;
    await mb.refreshMatches(true);
    expect(rows()[0]!.row).not.toBe(first);
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

  it('открытых матчей нет: так и сказано, и путь в соло', async () => {
    lists.available = [];
    await browsing();
    expect($('mlist').innerHTML).toContain(t('browser.empty.available'));
    $('msolo-go').click();
    expect(calls.slice(-2)).toEqual([['leaveMatch'], ['openSetup', 'hub']]);
    // Свой матч заводят здесь же: «Новый матч» на месте.
    expect($('match-create').style.display).toBe('');
  });

  it('своих матчей нет: «Найти матч» ведёт на «Доступные»', async () => {
    lists.active = [];
    await browsing();
    tab('active').click();
    expect($('mlist').innerHTML).toContain(t('browser.empty.active'));
    expect($('mlist').innerHTML).not.toContain('msolo-go');
    $('mfind-go').click();
    expect(tab('available').has('active')).toBe(true);
    expect(ids()).toEqual(['a1', 'a2', 'a3']);
  });

  it('пустой архив: только сообщение — вкладки стоят прямо над ним', async () => {
    lists.archived = [];
    await browsing();
    tab('archived').click();
    expect($('mlist').innerHTML).toContain(t('browser.empty.archived'));
    expect($('mlist').innerHTML).not.toContain('<button');
  });

  it('«Подключиться» в карточке сервера перечитывает ленту', async () => {
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
    // Имя карты — то же, что в заголовке строки.
    expect(boxes.map((b) => b.map)).toEqual(['карта frontier', 'карта nexus']);
    boxes[0]!.box.checked = true;
    boxes[0]!.box.fire('change');
    expect(ids()).toEqual(['a2']);
    expect($('mf-map').textContent).toBe(t('browser.filter.map.some', { n: 1 }));
    expect(JSON.parse(cell.get('void.filter')!).maps).toEqual(['frontier']);
    // Перерисовка строит галочки заново: те же две, и выбранная стоит.
    expect($('mf-maps').children.map((l) => [l.textContent, l.children[0]!.checked])).toEqual([
      ['карта frontier', true],
      ['карта nexus', false],
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

  it('ползунок игроков считает вместимость; полоса — между бегунками', async () => {
    await browsing();
    expect([$('mf-min').min, $('mf-max').max]).toEqual(['4', '8']);
    expect($('mf-dual').style.props).toEqual({ '--lo': '0', '--hi': '1' });
    $('mf-min').value = '5';
    $('mf-min').fire('input');
    expect(ids()).toEqual(['a1', 'a3']);
    expect($('mf-range').textContent).toBe(t('browser.filter.range', { min: 5, max: 8 }));
    expect($('mf-dual').style.props).toEqual({ '--lo': '0.25', '--hi': '1' });
    // Бегунки разъехались наоборот — полоса всё равно от меньшего к большему.
    $('mf-max').value = '4';
    $('mf-max').fire('input');
    expect($('mf-range').textContent).toBe(t('browser.filter.range', { min: 4, max: 5 }));
    expect($('mf-dual').style.props).toEqual({ '--lo': '0', '--hi': '0.25' });
  });

  it('контрол без выбора не показывается: одна карта и одна вместимость', async () => {
    lists.available = [row('a1', { kind: 'pvp' }), row('a3')];
    await browsing();
    expect($('mfilter').style.display).toBe('');
    expect($('mf-mode').style.display).toBe('');
    expect($('mf-mapbox').style.display).toBe('none');
    expect($('mf-players').style.display).toBe('none');
  });

  it('выбирать не из чего вовсе — панели фильтра нет', async () => {
    lists.available = [row('a1'), row('a3')];
    await browsing();
    expect($('mfilter').style.display).toBe('none');
    expect(ids()).toEqual(['a1', 'a3']);
  });

  it('отфильтровано всё: «ничего не найдено» и сброс фильтра, без пути в соло', async () => {
    lists.available = [row('a1', { kind: 'pvp' })];
    await browsing();
    mode('pve').click();
    expect($('mlist').innerHTML).toContain(t('browser.filter.none'));
    expect($('mlist').innerHTML).not.toContain('msolo-go');
    expect($('mfilter').style.display).toBe('');
    $('mreset-go').click();
    expect(ids()).toEqual(['a1']);
    expect(mode('all').has('active')).toBe(true);
    expect(JSON.parse(cell.get('void.filter')!).mode).toBe('all');
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
    // Под партией — её номер, а не адрес (плейтест 2026-10-17).
    expect(first.innerHTML).toContain('№ m1');
    expect(first.innerHTML).not.toContain('/game/');
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

  it('номер партии копируется; без буфера обмена — просьба скопировать из строки', async () => {
    const mb = await boot();
    await mb.refreshMyMatches();
    const copy = () => cards()[0]!.children.at(-1)!.children[1]!;
    expect(copy().textContent).toBe(t('hub.mine.copy'));
    copy().click();
    await settle();
    expect(of('clipboard')).toEqual([['clipboard', 'm1']]);
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

describe('UIX-17.1 — одна страница у обеих сборок', () => {
  it('позывного и пароля на странице нет, адрес — только когда сервер не ответил', async () => {
    const mb = await boot();
    expect($('cnick').closest('.mcarry')!.hidden).toBe(true);
    await mb.refreshMatches();
    expect($('msrv').style.display).toBe('none');
  });

  it('тихий переопрос раз в 10 с — с первого открытия страницы и только пока она на экране', async () => {
    // До первого открытия таймера нет вовсе: тому, кто в «Матчи» не заходит, он не нужен.
    await boot();
    vi.advanceTimersByTime(30_000);
    await settle();
    expect(matchesFetches()).toEqual([]);
    await browsing();
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

  it('пока игрок правит адрес, переопрос ждёт; новый адрес перечитывает список сразу', async () => {
    await browsing();
    doc.activeElement = $('csrv');
    vi.advanceTimersByTime(20_000);
    await settle();
    expect(matchesFetches()).toEqual([]);
    $('csrv').fire('change');
    await settle();
    expect(matchesFetches()).toHaveLength(1);
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
  // Заход домой — у хаба (`hubScreen.ts`, REFM-220).
  const HUB = readFileSync(new URL('./hubScreen.ts', import.meta.url), 'utf8');
  // Вход в обозреватель — у экрана подключения (`connectScreen.ts`, REFM-247).
  const CONNECT = readFileSync(new URL('./connectScreen.ts', import.meta.url), 'utf8');
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
    expect(CONNECT).toContain("detach('обозреватель: список партий', refreshMatches());");
    expect(HUB).toContain("if (tab === 'home') detach('хаб: свои партии', refreshMyMatches());");
  });

  it('харнес размеров кладёт ленту дверью, модуль не тянет `main.ts`', () => {
    expect(SIZES).toContain("import { showLists as __showLists } from './matchBrowser';");
    expect(SIZES).toContain('__showLists(lists);');
    expect(SIZES).not.toMatch(/\b(matchLists|activeTab|renderMatches)\b/);
    expect(BROWSER).not.toMatch(/from '\.\/main'/);
  });
});
