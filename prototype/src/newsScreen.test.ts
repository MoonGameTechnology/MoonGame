// CORP-2 — сторож ленты новостей на «Домой». Что показать и куда ведёт строка — решения
// `decisions/newsFeed.ts` со своим тестом; здесь то, что решает ЭКРАН: время по часам
// игрока, экранирование чужих имён, кнопки по читателю, заявка и ступени Back.
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { setLocale, t } from '../../localization/runtime';
import type { NewsAnnouncement, NewsEvent, NewsView } from '../../packages/protocol/src/news';
import type { NewsReader } from '../../decisions/newsFeed';
import {
  initNews,
  newsCalendar,
  newsCardHtml,
  newsFeedHtml,
  newsTeaserHtml,
  newsTimeText,
  type NewsHost,
  type NewsPaint,
} from './newsScreen';

beforeAll(() => setLocale('ru'));

const A = { id: 'c-a', name: 'Альфа' };
const B = { id: 'c-b', name: 'Бета' };
const NOW = new Date(2026, 9, 21, 15, 30).getTime();
const founded = (id: string, at: number, corp = A): NewsEvent => ({ id, at, kind: 'founded', corp });
const view = (events: NewsEvent[], more = false, announcements: NewsAnnouncement[] = []): NewsView => ({
  serverNow: NOW,
  announcements,
  events,
  more,
});

const guest: NewsReader = { signedIn: false, membership: undefined, medalNames: {}, locale: 'ru' };
const corpless: NewsReader = { ...guest, signedIn: true, membership: null };
const reader = (corpId: string, role: 'head' | 'member' | 'recruit'): NewsReader => ({
  ...guest,
  signedIn: true,
  membership: { corpId, role },
});

function paint(over: Partial<NewsPaint> = {}): NewsPaint {
  return {
    view: view([founded('f', NOW - 60_000)]),
    failed: false,
    filter: 'all',
    own: false,
    reader: guest,
    calendar: newsCalendar(NOW),
    loadingMore: false,
    applying: false,
    ...over,
  };
}

describe('время строки — по часам игрока', () => {
  const calendar = newsCalendar(NOW);

  it('сегодня — часы, вчера — «вчера» и часы', () => {
    expect(newsTimeText(new Date(2026, 9, 21, 9, 5).getTime(), calendar)).toBe('09:05');
    expect(newsTimeText(new Date(2026, 9, 20, 22, 10).getTime(), calendar)).toBe('вчера, 22:10');
  });

  it('раньше — число и месяц, в прошлом году — ещё и год', () => {
    const october = newsTimeText(new Date(2026, 9, 18, 10, 0).getTime(), calendar);
    expect(october).toContain('18');
    expect(october).not.toContain('2026');
    expect(newsTimeText(new Date(2025, 11, 31, 10, 0).getTime(), calendar)).toContain('2025');
  });
});

describe('медали игроков в ленте', () => {
  it('локализует награду и экранирует логин', () => {
    const html = newsFeedHtml(paint({ view: view([{ id: 'player-medal', at: NOW, kind: 'player_medal', medalId: 'first', grade: 2, login: '<img src=x>', corp: A }]), reader: { ...guest, playerMedalNames: { first: 'Первый рубеж' } } }));
    expect(html).toContain('&lt;img src=x&gt;');
    expect(html).toContain('Первый рубеж');
    expect(html).not.toContain('<img src=x>');
  });
});

describe('разметка ленты', () => {
  it('имя корпорации — данные игрока: в разметку оно попадает экранированным', () => {
    const evil = { id: 'x', name: '<img src=x onerror=alert(1)>' };
    const html = newsFeedHtml(paint({ view: view([founded('f', NOW, evil)]), reader: corpless }));
    expect(html).not.toContain('<img');
    expect(html).toContain('&lt;img src=x onerror=alert(1)&gt;');
  });

  it('гостю — ни карточки, ни заявки, ни «Моей корпорации»', () => {
    const html = newsFeedHtml(paint());
    expect(html).toContain('Основана корпорация «Альфа»');
    expect(html).not.toContain('data-nw-corp');
    expect(html).not.toContain('data-nw-apply');
    expect(html).not.toContain('data-nw-own');
  });

  it('без корпорации — карточка и заявка; в корпорации — фильтр «Моя корпорация»', () => {
    const free = newsFeedHtml(paint({ reader: corpless }));
    expect(free).toContain('data-nw-corp="c-a"');
    expect(free).toContain('data-nw-apply="c-a"');
    expect(free).not.toContain('data-nw-own');
    const mine = newsFeedHtml(paint({ reader: reader('c-b', 'member') }));
    expect(mine).toContain('data-nw-own');
    expect(mine).not.toContain('data-nw-apply');
  });

  it('вместо строк — честная причина: читается, нет связи, пусто', () => {
    expect(newsFeedHtml(paint({ view: null }))).toContain(t('news.loading'));
    expect(newsFeedHtml(paint({ view: null, failed: true }))).toContain(t('news.offline'));
    expect(newsFeedHtml(paint({ view: view([]) }))).toContain(t('news.empty'));
    expect(newsFeedHtml(paint({ filter: 'battle' }))).toContain(t('news.filtered'));
  });

  it('«Показать ещё» — только пока сервер говорит, что старше есть', () => {
    expect(newsFeedHtml(paint())).not.toContain('data-nw-more');
    const more = paint({ view: view([founded('f', NOW)], true) });
    expect(newsFeedHtml(more)).toContain('data-nw-more');
    expect(newsFeedHtml({ ...more, loadingMore: true })).toContain('disabled aria-busy="true"');
  });

  it('превью телефона: «Вся лента · N» — только с точным числом', () => {
    expect(newsTeaserHtml(paint())).toContain(t('news.all.count', { n: 1 }));
    const more = newsTeaserHtml(paint({ view: view([founded('f', NOW)], true) }));
    expect(more).toContain(`>${t('news.all')}</button>`);
    expect(newsTeaserHtml(paint({ view: view([]) }))).not.toContain('data-nw-all');
  });
});

describe('карточка корпорации', () => {
  const card = {
    corp: { corpId: 'c-a', name: 'Альфа', influence: 1234 },
    members: [
      { corpId: 'c-a', accountId: '1', login: 'Вега', role: 'head' as const },
      { corpId: 'c-a', accountId: '2', login: 'Орион', role: 'member' as const },
      { corpId: 'c-a', accountId: '3', login: 'Новичок', role: 'recruit' as const },
    ],
  };

  it('состав без кандидатов, влияние и глава', () => {
    const html = newsCardHtml(A, card, corpless, false, 't');
    expect(html).toContain(t('corp.members.count', { n: 2 }));
    expect(html).toContain(t('news.card.head', { login: 'Вега' }));
    expect(html).toContain('1');
  });

  it('кнопка — по читателю: заявка, «Заявка отправлена», кабинет или ничего', () => {
    expect(newsCardHtml(A, card, corpless, false, 't')).toContain('data-nw-apply="c-a"');
    expect(newsCardHtml(A, card, reader('c-a', 'recruit'), false, 't')).toContain(t('news.applied'));
    expect(newsCardHtml(A, card, reader('c-a', 'member'), false, 't')).toContain('data-nw-cabinet');
    const elsewhere = newsCardHtml(A, card, reader('c-b', 'member'), false, 't');
    expect(elsewhere).not.toContain('data-nw-apply');
    expect(elsewhere).not.toContain('data-nw-cabinet');
  });

  it('пока читается и когда не прочиталась — так и сказано', () => {
    expect(newsCardHtml(B, 'loading', corpless, false, 't')).toContain(t('news.card.loading'));
    expect(newsCardHtml(B, 'failed', corpless, false, 't')).toContain(t('news.card.failed'));
  });
});

// --- экран целиком ---------------------------------------------------------------------

const BASE = 'https://game.test';

interface FakeEl {
  innerHTML: string;
  classList: { toggle(name: string, on: boolean): void };
  querySelector(): null;
  querySelectorAll(): never[];
  addEventListener(type: string, h: (e: Event) => void): void;
  click(data: Record<string, string>): void;
}

function fakeEl(): FakeEl {
  const handlers: Array<(e: Event) => void> = [];
  const el: FakeEl = {
    innerHTML: '',
    classList: { toggle: () => {} },
    querySelector: () => null,
    querySelectorAll: () => [],
    addEventListener: (_type, h) => void handlers.push(h),
    click: (dataset) => {
      const button = { dataset, disabled: false };
      for (const h of handlers)
        h({ target: { closest: () => button }, currentTarget: el } as unknown as Event);
    },
  };
  return el;
}

type Reply = { status: number; body: unknown };
let routes: Record<string, () => Reply | Promise<Reply>>;
let calls: Array<{ url: string; method: string; authorization?: string }>;
let column: FakeEl;
let teaser: FakeEl;
let sheet: FakeEl;
let signedIn: boolean;
let openCorp: ReturnType<typeof vi.fn>;
let notes: string[];

function screen(): ReturnType<typeof initNews> {
  const host: NewsHost = {
    column: () => column as unknown as HTMLElement,
    teaser: () => teaser as unknown as HTMLElement,
    sheet: () => sheet as unknown as HTMLElement,
    publicBase: () => BASE,
    authorizedBase: async () => (signedIn ? { base: BASE, token: 'tok' } : null),
    note: (text) => void notes.push(text),
    errText: (code) => code,
    openCorp: openCorp as unknown as NewsHost['openCorp'],
    now: () => NOW,
  };
  return initNews(host);
}

beforeEach(() => {
  column = fakeEl();
  teaser = fakeEl();
  sheet = fakeEl();
  signedIn = true;
  openCorp = vi.fn();
  notes = [];
  calls = [];
  routes = {
    'GET /news': () => ({ status: 200, body: view([founded('f', NOW - 60_000)]) }),
    'GET /corps/me': () => ({ status: 200, body: { corp: null, membership: null } }),
    'POST /corps/c-a/apply': () => ({ status: 200, body: { ok: true } }),
    'GET /corps/c-a': () => ({
      status: 200,
      body: { corp: { corpId: 'c-a', name: 'Альфа', influence: 10 }, members: [] },
    }),
  };
  vi.stubGlobal('fetch', async (url: string, init: RequestInit) => {
    const method = init.method ?? 'GET';
    const authorization = (init.headers as Record<string, string> | undefined)?.authorization;
    calls.push({ url, method, authorization });
    const route = routes[`${method} ${url.slice(BASE.length)}`];
    const reply = route ? await route() : { status: 404, body: { error: 'E_NOT_FOUND' } };
    return { ok: reply.status < 300, json: async () => reply.body };
  });
});

afterEach(() => vi.unstubAllGlobals());

describe('экран ленты', () => {
  it('передаёт сессию для закрытых наград и забывает их при выходе даже если лента недоступна', async () => {
    routes['GET /news'] = () => ({ status: 200, body: view([{ id: 'secret-medal', at: NOW, kind: 'player_medal', medalId: 'first', grade: 2, login: 'PrivatePilot', corp: A }]) });
    const news = screen();
    await news.refresh();
    expect(calls.find((c) => c.url === `${BASE}/news`)?.authorization).toBe('Bearer tok');
    expect(column.innerHTML).toContain('PrivatePilot');
    signedIn = false;
    routes['GET /news'] = () => ({ status: 503, body: {} });
    await news.refresh();
    expect(column.innerHTML).not.toContain('PrivatePilot');
    expect(teaser.innerHTML).not.toContain('PrivatePilot');
  });
  it('гость читает ленту без сессии и без запросов о членстве', async () => {
    signedIn = false;
    await screen().refresh();
    expect(column.innerHTML).toContain('Основана корпорация «Альфа»');
    expect(teaser.innerHTML).toContain('Основана корпорация «Альфа»');
    expect(calls.map((c) => c.url)).toEqual([`${BASE}/news`]);
    expect(calls[0]!.authorization).toBeUndefined();
  });

  it('членство не прочиталось — кнопки заявки нет, карточка есть', async () => {
    routes['GET /corps/me'] = () => ({ status: 500, body: null });
    await screen().refresh();
    expect(column.innerHTML).toContain('data-nw-corp="c-a"');
    expect(column.innerHTML).not.toContain('data-nw-apply');
  });

  it('заявка уходит с сессией, и строка сразу говорит «Заявка отправлена»', async () => {
    await screen().refresh();
    expect(column.innerHTML).toContain('data-nw-apply="c-a"');
    column.click({ nwApply: 'c-a' });
    await vi.waitFor(() => expect(column.innerHTML).toContain(t('news.applied')));
    expect(column.innerHTML).not.toContain('data-nw-apply');
    expect(calls).toContainEqual({ url: `${BASE}/corps/c-a/apply`, method: 'POST', authorization: 'Bearer tok' });
    expect(notes).toEqual([]); // успех говорит сама строка, без второго эха в строке хаба
  });

  it('отказ в заявке — причина в строке хаба, кнопка остаётся', async () => {
    routes['POST /corps/c-a/apply'] = () => ({ status: 409, body: { error: 'E_ALREADY_MEMBER' } });
    await screen().refresh();
    column.click({ nwApply: 'c-a' });
    await vi.waitFor(() => expect(notes).toEqual(['✖ E_ALREADY_MEMBER']));
    expect(column.innerHTML).toContain('data-nw-apply="c-a"');
    expect(column.innerHTML).not.toContain(t('news.applied'));
  });

  it('карточка из шторки ленты: первый Back — к ленте, второй закрывает', async () => {
    const news = screen();
    await news.refresh();
    teaser.click({ nwAll: '' });
    expect(news.isOpen()).toBe(true);
    expect(sheet.innerHTML).toContain('class="nw-sheet"');
    sheet.click({ nwCorp: 'c-a', nwName: 'Альфа' });
    expect(sheet.innerHTML).toContain('class="nw-sheet card"');
    await vi.waitFor(() => expect(sheet.innerHTML).toContain(t('corp.members.count', { n: 0 })));
    news.close();
    expect(sheet.innerHTML).toContain('class="nw-sheet"');
    expect(news.isOpen()).toBe(true);
    news.close();
    expect(news.isOpen()).toBe(false);
    expect(sheet.innerHTML).toBe('');
  });

  it('«К битвам» закрывает шторку и открывает кабинет на нужной вкладке', async () => {
    const news = screen();
    await news.refresh();
    teaser.click({ nwAll: '' });
    sheet.click({ nwBattles: 'history' });
    expect(news.isOpen()).toBe(false);
    expect(openCorp).toHaveBeenCalledWith('history');
  });

  it('ответ, обогнанный новым обновлением, выбрасывается', async () => {
    let finish: (r: Reply) => void = () => {};
    routes['GET /news'] = () => new Promise<Reply>((resolve) => (finish = resolve));
    const news = screen();
    const first = news.refresh();
    routes['GET /news'] = () => ({ status: 200, body: view([founded('new', NOW, B)]) });
    await news.refresh();
    finish({ status: 200, body: view([founded('old', NOW, A)]) });
    await first;
    expect(column.innerHTML).toContain('«Бета»');
    expect(column.innerHTML).not.toContain('«Альфа»');
  });
});
