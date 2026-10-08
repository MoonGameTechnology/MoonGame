/**
 * Вход в партию и выбор места (REFM-217) — прямой тест владельца.
 *
 * Оверлей мест и таймер опроса снаружи не видны, поэтому здесь проверено то, что видно
 * игре: куда ведёт заход в партию на сервере с аккаунтами и без, когда зовут на вход, что
 * показывает оверлей мест, куда уходят места сервера и когда опрос мест молчит и
 * останавливается. Сетевой цикл и экран настройки подменены записью вызовов; хранилище,
 * сессия и билет — настоящие. В конце — стык с `main.ts`.
 */
import { readFileSync } from 'node:fs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { t } from '../../localization/runtime';
import { entryOffer, type MatchSeat } from '../../decisions/entrySetup';
import { settledAddress } from '../../decisions/matchAddress';
import { saveSession } from '../../decisions/sessionStore';

const BASE = 'ws://srv.test:8080';
const HTTP = 'http://srv.test:8080';
const PAGE = 'https://game.test/?join=m1&slot=p2&faction=veyr';

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

/** Узел страницы: всё, что трогает модуль. */
interface Node {
  style: { display: string };
  innerHTML: string;
  addEventListener(type: string, fn: () => void): void;
  click(): void;
}
const node = (): Node => {
  const clicks: Array<() => void> = [];
  return {
    style: { display: 'none' },
    innerHTML: '',
    addEventListener: (type, fn) => void (type === 'click' && clicks.push(fn)),
    click: () => clicks.forEach((fn) => fn()),
  };
};

let cell: Map<string, string>;
let page: Map<string, Node>;
let server: (url: string) => Reply | Promise<Reply>;
let fetched: Array<{ url: string; auth?: string }>;
/** Что ушло сетевому циклу, экрану настройки и карточке входа (их модули подменены). */
let calls: unknown[][];
let netSetup: { matchId: string } | null;
let srv: { base: string; nick: string } | null;
let href: string;
/** Что ушло в консоль как сбой отложенной цепочки (`detach`). */
let detached: unknown[][];

const seats: MatchSeat[] = [
  { playerId: 'p1', start: 'C0R1', faction: 'veyr', taken: true },
  { playerId: 'p2', start: 'C1R1', faction: 'veyr', taken: false },
  { playerId: 'p3', start: 'C2R1', faction: 'azure', taken: false },
];

/** Дать отработать отложенным цепочкам: запросы, разбор ответа. */
const settle = async (): Promise<void> => {
  for (let i = 0; i < 5; i++) await new Promise((r) => setTimeout(r, 0));
};
const of = (name: string): unknown[][] => calls.filter((c) => c[0] === name);
const overlay = (): Node => page.get('seatpick')!;
const list = (): Node => page.get('seatpick-list')!;

beforeEach(() => {
  cell = new Map();
  page = new Map([
    ['seatpick', node()],
    ['seatpick-list', node()],
    ['seatpick-cancel', node()],
  ]);
  fetched = [];
  calls = [];
  netSetup = null;
  srv = { base: BASE, nick: 'Orion' };
  href = PAGE;
  detached = [];
  vi.spyOn(console, 'error').mockImplementation((...args: unknown[]) => void detached.push(args));
  server = () => {
    throw new Error('сервер не должны были спрашивать');
  };
  vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval'] });
  vi.stubGlobal('localStorage', {
    getItem: (k: string) => cell.get(k) ?? null,
    setItem: (k: string, v: string) => void cell.set(k, v),
    removeItem: (k: string) => void cell.delete(k),
  });
  vi.stubGlobal('document', { getElementById: (id: string) => page.get(id) ?? null });
  vi.stubGlobal('location', {
    get href() {
      return href;
    },
  });
  vi.stubGlobal('history', {
    replaceState: (_: unknown, __: string, url: string) => void (href = url),
  });
  vi.stubGlobal('fetch', async (url: string, init?: { headers?: Record<string, string> }) => {
    fetched.push({ url, auth: init?.headers?.authorization });
    return server(url);
  });
});
afterEach(() => {
  // Ни один заход не должен падать за кулисами: такой сбой игрок видит как «нажал — ничего».
  expect(detached).toEqual([]);
  vi.restoreAllMocks();
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.doUnmock('./netSession');
  vi.doUnmock('./setupScreen');
});

/** Свежая загрузка — как после перезагрузки страницы. */
async function boot() {
  vi.resetModules();
  // Сетевой цикл записывает дозвон вместе с билетом, который ему оставили к этому моменту.
  let acc: typeof import('./accountSession') | null = null;
  vi.doMock('./netSession', () => ({
    targetMatch: (id: string) => void calls.push(['targetMatch', id]),
    connect: () => void calls.push(['connect', acc?.takeJoinToken() ?? null]),
  }));
  vi.doMock('./setupScreen', () => ({
    get netSetup() {
      return netSetup;
    },
    openSetup: (from: string) => void calls.push(['openSetup', from]),
    enterNetSetup: (matchId: string, mapId: string | undefined, offer: unknown) => {
      calls.push(['enterNetSetup', matchId, mapId, offer]);
      netSetup = { matchId };
    },
    updateNetOffer: (matchId: string, offer: unknown) =>
      void calls.push(['updateNetOffer', matchId, offer]),
  }));
  acc = await import('./accountSession');
  const join = await import('./matchJoin');
  acc.initAccountSession({
    status: (text) => void calls.push(['status', text]),
    note: (text) => void calls.push(['note', text]),
    welcomePassword: () => '',
    showSignIn: (s) => void calls.push(['showSignIn', s]),
  });
  join.initMatchJoin({ resolveServer: () => srv });
  return { join, acc };
}

/** Сервер с аккаунтами: проба ответила «да», сессия этого сервера сохранена (или нет). */
async function accounts(acc: Awaited<ReturnType<typeof boot>>['acc'], session: string | null) {
  server = () => reply(200, { enabled: true });
  await acc.probeAuthMode(BASE);
  if (session) saveSession(localStorage, BASE, { login: 'Orion', token: session });
  fetched = [];
}

describe('REFM-217 — заход в партию', () => {
  it('сервер без аккаунтов: назначает партию и звонит сразу, без билета', async () => {
    const { join } = await boot();
    join.connectToMatch('m1', 'p2', 'veyr');
    await settle();
    expect(calls).toEqual([
      ['targetMatch', 'm1'],
      ['connect', null],
    ]);
    expect(fetched).toEqual([]);
    // Захват состоялся — в строке остаётся адрес партии, а не просьба занять место.
    expect(href).toBe(settledAddress(PAGE, 'm1'));
  });

  it('партию назначает сразу, ещё до ответа сервера', async () => {
    const { join, acc } = await boot();
    await accounts(acc, 'S1');
    server = () => new Promise<Reply>(() => undefined);
    join.connectToMatch('m1');
    expect(calls).toEqual([['targetMatch', 'm1']]);
  });

  it('с сессией: берёт билет на выбранное место и отдаёт его дозвону', async () => {
    const { join, acc } = await boot();
    await accounts(acc, 'S1');
    server = (url) =>
      url.includes('/join') ? reply(200, { token: 'J1', playerId: 'p2' }) : reply(404);
    join.connectToMatch('m 1', 'p2', 'veyr', ['ada']);
    await settle();
    expect(fetched).toHaveLength(1);
    expect(fetched[0]!.url).toMatch(new RegExp(`^${HTTP}/matches/m%201/join\\?`));
    expect(fetched[0]!.url).toContain('slot=p2');
    expect(fetched[0]!.url).toContain('faction=veyr');
    expect(fetched[0]!.auth).toBe('Bearer S1');
    expect(calls).toEqual([
      ['targetMatch', 'm 1'],
      ['connect', 'J1'],
    ]);
    expect(href).toBe(settledAddress(PAGE, 'm 1'));
  });

  it('без сессии: запоминает просьбу и зовёт на вход со строкой пароля', async () => {
    const { join, acc } = await boot();
    await accounts(acc, null);
    join.connectToMatch('m1', 'p2', 'veyr', ['ada']);
    await settle();
    expect(of('showSignIn')).toEqual([['showSignIn', srv]]);
    expect(of('connect')).toEqual([]);
    expect(acc.pendingJoinAfterAuth.take()).toEqual({
      matchId: 'm1',
      slot: 'p2',
      faction: 'veyr',
      scientists: ['ada'],
    });
    expect(fetched).toEqual([]);
  });

  it('без адреса сервера: зовёт на вход без строки пароля', async () => {
    const { join, acc } = await boot();
    await accounts(acc, 'S1');
    srv = null;
    join.connectToMatch('m1');
    await settle();
    expect(of('showSignIn')).toEqual([['showSignIn', null]]);
    expect(fetched).toEqual([]);
  });

  it('билет не дали, а сессия жива: остаётся на месте и не звонит', async () => {
    const { join, acc } = await boot();
    await accounts(acc, 'S1');
    server = () => reply(403);
    join.connectToMatch('m1');
    await settle();
    expect(of('showSignIn')).toEqual([]);
    expect(of('connect')).toEqual([]);
    expect(of('status')).toEqual([['status', t('acc.join-closed')]]);
    expect(href).toBe(PAGE);
  });

  it('билет не дали, потому что вход просрочен: сессия стёрта, зовёт войти заново', async () => {
    const { join, acc } = await boot();
    await accounts(acc, 'S1');
    server = () => reply(401);
    join.connectToMatch('m1', 'p2');
    await settle();
    expect(acc.sessionRecord(BASE)).toBeNull();
    expect(of('showSignIn')).toEqual([['showSignIn', srv]]);
    expect(of('connect')).toEqual([]);
    expect(acc.pendingJoinAfterAuth.take()?.slot).toBe('p2');
  });
});

describe('REFM-217 — вернуться или выбрать место', () => {
  it('своё место: сразу заход, без оверлея и без запроса мест', async () => {
    const { join } = await boot();
    join.openSessionTab('m1', true);
    await settle();
    expect(of('targetMatch')).toEqual([['targetMatch', 'm1']]);
    expect(of('connect')).toHaveLength(1);
    expect(overlay().style.display).toBe('none');
    expect(fetched).toEqual([]);
  });

  it('чужая партия: выбор места, а не заход', async () => {
    const { join } = await boot();
    server = () => reply(200, { seats, mapId: 'nexus' });
    join.openSessionTab('m1');
    await settle();
    expect(of('targetMatch')).toEqual([]);
    expect(of('enterNetSetup')).toHaveLength(1);
  });
});

describe('REFM-217 — выбор места', () => {
  it('пока места едут, оверлей стоит с приглушённой заглушкой', async () => {
    const { join } = await boot();
    server = () => new Promise<Reply>(() => undefined);
    void join.openSeatPicker('m1');
    expect(overlay().style.display).toBe('flex');
    expect(list().innerHTML).toContain(t('seatpick.loading'));
    expect(list().innerHTML).toContain('color:var(--dim)');
  });

  it('места пришли: оверлей прячется, экран открывается и получает места сервера', async () => {
    const { join } = await boot();
    list().innerHTML = '<p>дома прошлого матча</p>';
    server = () => reply(200, { seats, mapId: 'nexus' });
    await join.openSeatPicker('m1');
    expect(overlay().style.display).toBe('none');
    expect(calls).toEqual([
      ['openSetup', 'hub'],
      ['enterNetSetup', 'm1', 'nexus', entryOffer(seats)],
    ]);
    expect(fetched).toEqual([{ url: `${HTTP}/matches/m1/seats?nick=Orion`, auth: undefined }]);
  });

  it('спрашивает места, назвавшись: на хосте с учётками — сессией', async () => {
    const { join, acc } = await boot();
    await accounts(acc, 'S1');
    server = () => reply(200, { seats });
    await join.openSeatPicker('m1');
    expect(fetched).toEqual([{ url: `${HTTP}/matches/m1/seats?nick=Orion`, auth: 'Bearer S1' }]);
  });

  it('отказ сервера: красная заглушка, оверлей остаётся, экран не открывается', async () => {
    const { join } = await boot();
    server = () => reply(403);
    await join.openSeatPicker('m1');
    expect(overlay().style.display).toBe('flex');
    expect(list().innerHTML).toContain(t('seatpick.load-failed'));
    expect(list().innerHTML).toContain('color:var(--red)');
    expect(of('openSetup')).toEqual([]);
  });

  it('обрыв связи: та же красная заглушка', async () => {
    const { join } = await boot();
    server = () => {
      throw new Error('offline');
    };
    await join.openSeatPicker('m1');
    expect(overlay().style.display).toBe('flex');
    expect(list().innerHTML).toContain(t('seatpick.load-failed'));
    expect(of('openSetup')).toEqual([]);
  });

  it('без адреса сервера оверлей не поднимается и ничего не спрашивается', async () => {
    const { join } = await boot();
    srv = null;
    await join.openSeatPicker('m1');
    expect(overlay().style.display).toBe('none');
    expect(fetched).toEqual([]);
  });

  it('дверь «Назад» прячет оверлей', async () => {
    const { join } = await boot();
    server = () => reply(403);
    await join.openSeatPicker('m1');
    join.closeSeatPicker();
    expect(overlay().style.display).toBe('none');
  });

  it('кнопка «Назад» на оверлее его закрывает', async () => {
    const { join } = await boot();
    server = () => reply(403);
    await join.openSeatPicker('m1');
    page.get('seatpick-cancel')!.click();
    expect(overlay().style.display).toBe('none');
  });
});

describe('REFM-217 — опрос мест', () => {
  /** Экран открыт под партию `m1`, места пришли. */
  async function opened() {
    const b = await boot();
    server = () => reply(200, { seats, mapId: 'nexus' });
    await b.join.openSeatPicker('m1');
    calls = [];
    fetched = [];
    return b;
  }
  const taken = seats.map((s) => (s.playerId === 'p2' ? { ...s, taken: true } : s));

  it('раз в пять секунд переспрашивает места и отдаёт их экрану', async () => {
    await opened();
    server = () => reply(200, { seats: taken });
    vi.advanceTimersByTime(4_999);
    await settle();
    expect(fetched).toEqual([]);
    vi.advanceTimersByTime(1);
    await settle();
    expect(fetched).toEqual([{ url: `${HTTP}/matches/m1/seats?nick=Orion`, auth: undefined }]);
    expect(calls).toEqual([['updateNetOffer', 'm1', entryOffer(taken)]]);
  });

  it('неудачный запрос молчит: выбор игрока не трогают', async () => {
    await opened();
    server = () => reply(500);
    vi.advanceTimersByTime(5_000);
    await settle();
    server = () => {
      throw new Error('offline');
    };
    vi.advanceTimersByTime(5_000);
    await settle();
    expect(fetched).toHaveLength(2);
    expect(calls).toEqual([]);
  });

  it('экран закрыт — опрос останавливается сам', async () => {
    await opened();
    netSetup = null;
    vi.advanceTimersByTime(5_000);
    await settle();
    vi.advanceTimersByTime(20_000);
    await settle();
    expect(fetched).toEqual([]);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('дверь останавливает опрос', async () => {
    const { join } = await opened();
    join.stopNetSetupPoll();
    vi.advanceTimersByTime(20_000);
    await settle();
    expect(fetched).toEqual([]);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('новый экран заменяет прежний опрос, а не добавляет второй', async () => {
    const { join } = await opened();
    await join.openSeatPicker('m2');
    fetched = [];
    vi.advanceTimersByTime(5_000);
    await settle();
    expect(fetched.map((f) => f.url)).toEqual([`${HTTP}/matches/m2/seats?nick=Orion`]);
    expect(vi.getTimerCount()).toBe(1);
  });
});

describe('REFM-217 — стык с main.ts', () => {
  const MAIN = readFileSync(new URL('./main.ts', import.meta.url), 'utf8');
  const JOIN = readFileSync(new URL('./matchJoin.ts', import.meta.url), 'utf8');

  it('оверлей мест, опрос и заход живут только у владельца', () => {
    expect(MAIN).not.toMatch(/\b(seatpickEl|seatpickListEl|netSetupPoll|NET_SETUP_POLL_MS)\b/);
    expect(MAIN).not.toMatch(
      /\bfunction (connectToMatch|openSessionTab|openSeatPicker|startNetSetupPoll|stopNetSetupPoll|fetchSeats)\(/,
    );
    expect(MAIN).not.toMatch(/\bfunction fetchSeats\b|\bfetchSeats\(/);
  });

  it('вход подключается до загрузочного блока: ссылка на партию входит прямо оттуда', () => {
    const init = MAIN.indexOf('initMatchJoin({ resolveServer });');
    expect(init).toBeGreaterThan(0);
    expect(init).toBeLessThan(MAIN.indexOf('if (bootReset) {'));
  });

  it('«Назад» прячет оверлей дверью владельца, экран настройки останавливает опрос хуком', () => {
    expect(MAIN).toMatch(/id: 'seatpick',[^\n]*close: closeSeatPicker/);
    expect(MAIN).toContain('stopNetPoll: () => stopNetSetupPoll(),');
  });

  it('модуль не тянет `main.ts`', () => {
    expect(JOIN).not.toMatch(/from '\.\/main'/);
  });
});
