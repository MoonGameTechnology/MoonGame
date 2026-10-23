import { describe, expect, it } from 'vitest';
import type { NewsAnnouncement, NewsEvent, NewsView } from '../packages/protocol/src/news';
import { en } from '../localization/en';
import { ru } from '../localization/ru';
import {
  NEWS_FILTER_LABEL,
  NEWS_KIND_LABEL,
  appendNewsPage,
  newsItems,
  newsLine,
  newsPlaceholder,
  newsTeaser,
  newsText,
  newsTotal,
  newsWhen,
  nextNewsBefore,
  ownCorp,
  parseNewsAnnouncement,
  parseNewsView,
  showOwnFilter,
  type NewsReader,
} from './newsFeed';

const A = { id: 'a', name: 'Альфа' };
const B = { id: 'b', name: 'Бета' };

function note(id: string, at: number, extra: Partial<NewsAnnouncement> = {}): NewsAnnouncement {
  return {
    id,
    at,
    kind: 'update',
    pinned: false,
    until: null,
    title: { ru: `Новость ${id}`, en: `News ${id}` },
    body: { ru: '', en: '' },
    ...extra,
  };
}

const founded = (id: string, at: number, corp = A): NewsEvent => ({ id, at, kind: 'founded', corp });
const matchup = (id: string, at: number): NewsEvent => ({ id, at, kind: 'matchup', challenger: A, target: B });
const result = (id: string, at: number, winner: string | null): NewsEvent => ({
  id,
  at,
  kind: 'result',
  challenger: A,
  target: B,
  winner,
});

function view(announcements: NewsAnnouncement[], events: NewsEvent[], more = false): NewsView {
  return { serverNow: 100, announcements, events, more };
}

const guest: NewsReader = { signedIn: false, membership: undefined, medalNames: {}, locale: 'ru' };
const corpless: NewsReader = { ...guest, signedIn: true, membership: null };
const member = (corpId: string, role: 'head' | 'member' | 'recruit' = 'member'): NewsReader => ({
  ...guest,
  signedIn: true,
  membership: { corpId, role },
});

describe('parseNewsView — ответ сервера читается точно', () => {
  const raw = {
    serverNow: 50,
    more: true,
    announcements: [note('n', 1, { until: 99, body: { ru: 'Текст', en: 'Text' } })],
    events: [
      founded('f', 2),
      { id: 'l', at: 3, kind: 'level', corp: A, level: 3 },
      { id: 'm', at: 4, kind: 'medal', corp: A, medalId: 'ava_first_victory' },
      matchup('s', 5),
      result('r', 6, 'b'),
      result('d', 7, null),
    ],
  };

  it('целый ответ проходит без потерь', () => {
    expect(parseNewsView(raw)).toEqual(raw);
  });

  it('сломанная запись выпадает, соседи остаются', () => {
    const parsed = parseNewsView({
      ...raw,
      announcements: [
        note('ok', 1),
        { ...note('x', 1), kind: 'ad' },
        { ...note('x', 1), title: { ru: '   ', en: 'Only English' } },
        { ...note('x', 1), title: { ru: 'x'.repeat(121), en: '' } },
        { ...note('x', 1), body: { ru: 'x'.repeat(601), en: '' } },
        { ...note('x', 1), until: 'soon' },
        { ...note('x', 1), pinned: 'yes' },
        null,
      ],
      events: [
        founded('ok', 1),
        { id: 'x', at: 1, kind: 'level', corp: A, level: 0 },
        { id: 'x', at: 1, kind: 'medal', corp: A },
        { id: 'x', at: 1, kind: 'founded', corp: { id: 'a', name: '' } },
        { id: 'x', at: -1, kind: 'founded', corp: A },
        { id: '', at: 1, kind: 'founded', corp: A },
        { ...result('x', 1, 'stranger') },
        { id: 'x', at: 1, kind: 'matchup', challenger: A },
        { id: 'x', at: 1, kind: 'gossip', corp: A },
      ],
    });
    expect(parsed?.announcements.map((a) => a.id)).toEqual(['ok']);
    expect(parsed?.events.map((e) => e.id)).toEqual(['ok']);
  });

  it('сломанный конверт — «ленты нет», а не пустая лента', () => {
    for (const bad of [null, [], 'news', { ...raw, more: 'yes' }, { ...raw, events: {} }, { ...raw, serverNow: 1.5 }])
      expect(parseNewsView(bad)).toBe(null);
  });
});

describe('parseNewsAnnouncement — список пульта читается тем же разбором', () => {
  it('целое объявление проходит; без русского заголовка или с чужим видом — нет', () => {
    const a = note('n', 1, { until: 5, pinned: true });
    expect(parseNewsAnnouncement(a)).toEqual(a);
    expect(parseNewsAnnouncement({ ...a, title: { ru: ' ', en: 'Title' } })).toBeNull();
    expect(parseNewsAnnouncement({ ...a, kind: 'promo' })).toBeNull();
  });
});

describe('порядок и фильтры', () => {
  const v = view(
    [note('pin-old', 1, { pinned: true }), note('pin-new', 2, { pinned: true }), note('plain', 5)],
    [founded('f', 6), matchup('s', 4), { id: 'm', at: 3, kind: 'medal', corp: B, medalId: 'x' }, result('r', 5, 'a')],
  );

  it('закреплённые сверху, остальное — одной лентой по времени (правило 2)', () => {
    expect(newsItems(v).map((it) => it.id)).toEqual(['pin-new', 'pin-old', 'f', 'plain', 'r', 's', 'm']);
  });

  it('фильтр по разделу', () => {
    expect(newsItems(v, 'ann').map((it) => it.id)).toEqual(['pin-new', 'pin-old', 'plain']);
    expect(newsItems(v, 'corp').map((it) => it.id)).toEqual(['f']);
    expect(newsItems(v, 'battle').map((it) => it.id)).toEqual(['r', 's']);
    expect(newsItems(v, 'ach').map((it) => it.id)).toEqual(['m']);
  });

  it('«Моя корпорация» складывается с разделом, объявлений в ней нет (правило 3)', () => {
    expect(newsItems(v, 'all', 'a').map((it) => it.id)).toEqual(['f', 'r', 's']);
    expect(newsItems(v, 'battle', 'b').map((it) => it.id)).toEqual(['r', 's']);
    expect(newsItems(v, 'ann', 'a')).toEqual([]);
  });

  it('телефону — закреплённые и три свежие (правило 6)', () => {
    expect(newsTeaser(v).map((it) => it.id)).toEqual(['pin-new', 'pin-old', 'f', 'plain', 'r']);
  });

  it('число всей ленты — только точное (правило 6)', () => {
    expect(newsTotal(v)).toBe(7);
    expect(newsTotal({ ...v, more: true })).toBe(null);
  });
});

describe('страницы', () => {
  it('следующая страница дописывает события без повторов и берёт её «есть ещё»', () => {
    const first = view([note('n', 9)], [founded('c', 3), founded('b', 2)], true);
    expect(nextNewsBefore(first)).toBe(2);
    const next = appendNewsPage(first, view([], [founded('b', 2), founded('a', 1)], false));
    expect(next.announcements.map((a) => a.id)).toEqual(['n']);
    expect(next.events.map((e) => e.id)).toEqual(['c', 'b', 'a']);
    expect(nextNewsBefore(next)).toBe(null);
  });
});

describe('newsPlaceholder — «неизвестно» не равно «пусто» (правило 1)', () => {
  it('различает загрузку, обрыв, пустую ленту и пустой фильтр', () => {
    expect(newsPlaceholder(null, false, 0)).toBe('loading');
    expect(newsPlaceholder(null, true, 0)).toBe('offline');
    expect(newsPlaceholder(view([], []), false, 0)).toBe('empty');
    expect(newsPlaceholder(view([note('n', 1)], []), false, 0)).toBe('filtered');
    expect(newsPlaceholder(view([note('n', 1)], []), true, 1)).toBe(null);
  });
});

describe('newsLine — фраза и куда ведёт новость', () => {
  const item = (e: NewsEvent) => newsItems(view([], [e]))[0]!;

  it('объявление — на языке игрока, английский пуст — русский', () => {
    const it_ = newsItems(view([note('n', 1, { kind: 'tech', body: { ru: 'Сервер', en: '' } })], []))[0]!;
    const line = newsLine(it_, { ...guest, locale: 'en' });
    expect(line).toMatchObject({ tone: 'tech', labelKey: 'news.kind.tech', title: { text: 'News n' } });
    expect(line.body).toEqual({ text: 'Сервер' });
    expect(newsLine(newsItems(view([note('n', 1)], []))[0]!, guest).body).toBe(null);
    expect(newsText({ ru: 'Р', en: '  ' }, 'en')).toBe('Р');
  });

  it('о корпорации: гостю — только фраза, вошедшему — карточка и заявка (правило 5)', () => {
    expect(newsLine(item(founded('f', 1)), guest)).toMatchObject({
      title: { key: 'news.founded', vars: { corp: 'Альфа' } },
      card: null,
      apply: null,
    });
    expect(newsLine(item(founded('f', 1)), corpless)).toMatchObject({ card: A, apply: 'can' });
    expect(newsLine(item(founded('f', 1)), member('a', 'recruit'))).toMatchObject({ apply: 'sent', own: false });
    expect(newsLine(item(founded('f', 1, B)), member('a', 'recruit'))).toMatchObject({ apply: null });
    expect(newsLine(item(founded('f', 1)), member('b'))).toMatchObject({ card: A, apply: null });
    // Членство неизвестно: заявки нет, пока не выяснено (правило 4).
    expect(newsLine(item(founded('f', 1)), { ...corpless, membership: undefined })).toMatchObject({ apply: null });
  });

  it('уровень и медаль: имя медали — когда каталог прочитан', () => {
    expect(newsLine(item({ id: 'l', at: 1, kind: 'level', corp: A, level: 4 }), guest).title).toEqual({
      key: 'news.level',
      vars: { corp: 'Альфа', n: 4 },
    });
    const medal: NewsEvent = { id: 'm', at: 1, kind: 'medal', corp: A, medalId: 'first' };
    expect(newsLine(item(medal), guest)).toMatchObject({
      category: 'ach',
      labelKey: 'news.filter.ach',
      title: { key: 'news.medal', vars: { corp: 'Альфа' } },
    });
    expect(newsLine(item(medal), { ...guest, medalNames: { first: 'Первая кровь' } }).title).toEqual({
      key: 'news.medal.named',
      vars: { corp: 'Альфа', medal: 'Первая кровь' },
    });
  });

  it('битва своей корпорации подсвечена, ведёт к битвам и знает исход', () => {
    expect(newsLine(item(matchup('s', 1)), member('a'))).toMatchObject({
      own: true,
      title: { key: 'news.matchup', vars: { a: 'Альфа', b: 'Бета' } },
      battles: 'current',
      result: null,
    });
    expect(newsLine(item(result('r', 1, 'a')), member('a'))).toMatchObject({
      title: { key: 'news.result.win', vars: { winner: 'Альфа', loser: 'Бета' } },
      result: 'win',
      battles: 'history',
    });
    expect(newsLine(item(result('r', 1, 'a')), member('b', 'head'))).toMatchObject({ result: 'loss' });
    expect(newsLine(item(result('r', 1, null)), member('b'))).toMatchObject({
      title: { key: 'news.result.draw', vars: { a: 'Альфа', b: 'Бета' } },
      result: 'draw',
    });
  });

  it('чужая битва и заявка — не своя новость (правило 4)', () => {
    for (const reader of [guest, corpless, member('c'), member('a', 'recruit')])
      expect(newsLine(item(result('r', 1, 'a')), reader)).toMatchObject({ own: false, result: null, battles: null });
    expect(ownCorp(member('a', 'recruit').membership)).toBe(null);
    expect(showOwnFilter(member('a', 'recruit'))).toBe(false);
    expect(showOwnFilter(member('a'))).toBe(true);
    expect(showOwnFilter(corpless)).toBe(false);
  });
});

describe('newsWhen — время как в мессенджере (правило 7)', () => {
  const calendar = { today: 1000, yesterday: 900, year: 100 };
  it('сегодня, вчера, дата и дата с годом', () => {
    expect(newsWhen(1000, calendar)).toBe('today');
    expect(newsWhen(999, calendar)).toBe('yesterday');
    expect(newsWhen(899, calendar)).toBe('date');
    expect(newsWhen(99, calendar)).toBe('date-year');
  });
});

describe('ключи и фразы ленты заведены в обеих локалях', () => {
  it('таблицы подписей и ключи фраз', () => {
    const keys = [
      ...Object.values(NEWS_FILTER_LABEL),
      ...Object.values(NEWS_KIND_LABEL),
      'news.founded',
      'news.level',
      'news.medal',
      'news.medal.named',
      'news.matchup',
      'news.result.win',
      'news.result.draw',
    ];
    for (const key of keys) {
      expect(ru[key], key).toBeTruthy();
      expect(en[key], key).toBeTruthy();
    }
  });
});
