/**
 * Лента новостей на «Домой» (CORP-2): что показать и куда вести.
 *
 * Сервер (`GET /news`, CORP-1) отдаёт факты, а не фразы: «основана корпорация», «достигла
 * уровня 3», «назначена битва». Здесь решается всё, что между фактом и разметкой: какие
 * строки показать, в каком порядке и по какому фильтру, чья это новость и куда из неё
 * ведёт кнопка. Фразу по ключу собирает экран — текста здесь нет.
 *
 * 1. **Ответ сервера — чужие данные.** Разбор точный: сломанная запись выпадает и не
 *    роняет соседей, а сломанный конверт — это `null`, «ленты нет». «Новостей нет» и
 *    «сервер ответил непонятное» — разные состояния (`newsPlaceholder`).
 * 2. **Закреплённое — сверху, остальное — одна лента по времени.** Объявление без
 *    закрепления стоит среди событий по своему времени, а не отдельным блоком.
 * 3. **Фильтр вида и «Моя корпорация» складываются.** Объявление не принадлежит ни одной
 *    корпорации, поэтому под «Моей корпорацией» его нет.
 * 4. **«Моя» — корпорация, где игрок состоит.** Заявка ещё не членство: корпорация, куда
 *    игрок только попросился, его новостью не подсвечивается. Неизвестное членство (сервер
 *    корпораций не ответил) — не «без корпорации»: кнопки заявки нет, пока это не
 *    выяснено, иначе её увидел бы и тот, кто давно состоит в корпорации.
 * 5. **Куда ведёт новость.** О корпорации — к её карточке и заявке: карточку сервер отдаёт
 *    только вошедшему, поэтому гостю кнопки нет. О битве своей корпорации — к битвам:
 *    назначенная ведёт к текущей, итог — к истории.
 * 6. **Телефону — закреплённые и три свежие.** Число «вся лента · N» показывается только
 *    точным: пока сервер говорит, что старше есть ещё, N было бы враньём.
 * 7. **Время — как в мессенджере.** Сегодня — часы, вчера — «вчера» и часы, раньше —
 *    число и месяц, в прошлом году — ещё и год.
 */
import {
  NEWS_ANNOUNCEMENT_KINDS,
  NEWS_BODY_MAX,
  NEWS_TITLE_MAX,
  type NewsAnnouncement,
  type NewsAnnouncementKind,
  type NewsCorp,
  type NewsEvent,
  type NewsText,
  type NewsView,
} from '../packages/protocol/src/news';

/** Раздел ленты: объявления, корпорации, битвы, достижения. */
export type NewsCategory = 'ann' | 'corp' | 'battle' | 'ach';
export type NewsFilter = 'all' | NewsCategory;

/** Кнопки фильтра в порядке показа. */
export const NEWS_FILTERS: readonly NewsFilter[] = ['all', 'ann', 'corp', 'battle', 'ach'];

/** Подпись кнопки фильтра — ключ локали. Подпись раздела над строкой ленты — та же. */
export const NEWS_FILTER_LABEL: Readonly<Record<NewsFilter, string>> = {
  all: 'news.filter.all',
  ann: 'news.filter.ann',
  corp: 'news.filter.corp',
  battle: 'news.filter.battle',
  ach: 'news.filter.ach',
};

/** Подпись вида объявления — над строкой ленты и в пульте администратора. */
export const NEWS_KIND_LABEL: Readonly<Record<NewsAnnouncementKind, string>> = {
  tech: 'news.kind.tech',
  update: 'news.kind.update',
  event: 'news.kind.event',
};

/** Свежих новостей на телефоне, кроме закреплённых (правило 6). */
export const NEWS_TEASER_FRESH = 3;

// --- разбор ответа (правило 1) -------------------------------------------------------

const ID_MAX = 128;
const NAME_MAX = 64;

const record = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v);
const moment = (v: unknown): v is number =>
  typeof v === 'number' && Number.isSafeInteger(v) && v >= 0;
const idOf = (v: unknown): v is string =>
  typeof v === 'string' && v.length > 0 && v.length <= ID_MAX;

function corpOf(v: unknown): NewsCorp | null {
  if (!record(v) || !idOf(v.id)) return null;
  if (typeof v.name !== 'string' || v.name.length === 0 || v.name.length > NAME_MAX) return null;
  return { id: v.id, name: v.name, ...(v.monument === true ? { monument: true } : {}) };
}

function textOf(v: unknown, max: number, required: boolean): NewsText | null {
  if (!record(v) || typeof v.ru !== 'string' || typeof v.en !== 'string') return null;
  if (v.ru.length > max || v.en.length > max) return null;
  if (required && v.ru.trim() === '') return null;
  return { ru: v.ru, en: v.en };
}

/** Одно объявление или `null`; им же читает список пульт администратора. */
export function parseNewsAnnouncement(v: unknown): NewsAnnouncement | null {
  if (!record(v) || !idOf(v.id) || !moment(v.at) || typeof v.pinned !== 'boolean') return null;
  const kind = NEWS_ANNOUNCEMENT_KINDS.find((k) => k === v.kind);
  if (!kind) return null;
  const until = v.until === null ? null : moment(v.until) ? v.until : undefined;
  if (until === undefined) return null;
  const title = textOf(v.title, NEWS_TITLE_MAX, true);
  const body = textOf(v.body, NEWS_BODY_MAX, false);
  if (!title || !body) return null;
  return { id: v.id, at: v.at, kind, pinned: v.pinned, until, title, body };
}

function eventOf(v: unknown): NewsEvent | null {
  if (!record(v) || !idOf(v.id) || !moment(v.at)) return null;
  const { id, at } = v;
  if (v.kind === 'founded' || v.kind === 'level' || v.kind === 'medal') {
    const corp = corpOf(v.corp);
    if (!corp) return null;
    if (v.kind === 'founded') return { id, at, kind: 'founded', corp };
    if (v.kind === 'level')
      return moment(v.level) && v.level > 0 ? { id, at, kind: 'level', corp, level: v.level } : null;
    return idOf(v.medalId) ? { id, at, kind: 'medal', corp, medalId: v.medalId } : null;
  }
  if (v.kind !== 'matchup' && v.kind !== 'result') return null;
  const challenger = corpOf(v.challenger);
  const target = corpOf(v.target);
  if (!challenger || !target) return null;
  if (v.kind === 'matchup') return { id, at, kind: 'matchup', challenger, target };
  // Победитель — одна из двух сторон или никто (ничья); иное прочитать нечем.
  const winner =
    v.winner === null
      ? null
      : typeof v.winner === 'string' && (v.winner === challenger.id || v.winner === target.id)
        ? v.winner
        : undefined;
  if (winner === undefined) return null;
  return { id, at, kind: 'result', challenger, target, winner };
}

/** Ответ `GET /news` или `null`, если конверт не читается (правило 1). */
export function parseNewsView(raw: unknown): NewsView | null {
  if (!record(raw) || !moment(raw.serverNow) || typeof raw.more !== 'boolean') return null;
  if (!Array.isArray(raw.announcements) || !Array.isArray(raw.events)) return null;
  const announcements = raw.announcements.flatMap((a) => parseNewsAnnouncement(a) ?? []);
  const events = raw.events.flatMap((e) => eventOf(e) ?? []);
  return { serverNow: raw.serverNow, announcements, events, more: raw.more };
}

// --- страницы ----------------------------------------------------------------------

/** Следующая страница поверх показанных: объявления остаются с первой, события
 *  дописываются без повторов, «есть ещё» — по последней странице. */
export function appendNewsPage(view: NewsView, page: NewsView): NewsView {
  const seen = new Set(view.events.map((e) => e.id));
  return {
    serverNow: page.serverNow,
    announcements: view.announcements,
    events: [...view.events, ...page.events.filter((e) => !seen.has(e.id))],
    more: page.more,
  };
}

/** Курсор следующей страницы — момент самого старого события; `null` — грузить нечего. */
export function nextNewsBefore(view: NewsView): number | null {
  if (!view.more || view.events.length === 0) return null;
  return Math.min(...view.events.map((e) => e.at));
}

// --- строки ленты (правила 2–4, 6) ----------------------------------------------------

export type NewsItem =
  | { type: 'announcement'; id: string; at: number; pinned: boolean; announcement: NewsAnnouncement }
  | { type: 'event'; id: string; at: number; pinned: false; event: NewsEvent };

/** Членство игрока в объёме, который нужен ленте. */
export interface NewsMembership {
  corpId: string;
  role: 'head' | 'officer' | 'member' | 'recruit';
}

export function newsCategory(item: NewsItem): NewsCategory {
  if (item.type === 'announcement') return 'ann';
  const kind = item.event.kind;
  if (kind === 'founded' || kind === 'level') return 'corp';
  return kind === 'medal' ? 'ach' : 'battle';
}

/** Корпорации, о которых новость. */
export function newsCorps(item: NewsItem): NewsCorp[] {
  if (item.type === 'announcement') return [];
  const e = item.event;
  return e.kind === 'matchup' || e.kind === 'result' ? [e.challenger, e.target] : [e.corp];
}

/** Своя корпорация — где игрок состоит; заявка и неизвестность не в счёт (правило 4). */
export function ownCorp(membership: NewsMembership | null | undefined): string | null {
  return membership && membership.role !== 'recruit' ? membership.corpId : null;
}

const byFeedOrder = (a: NewsItem, b: NewsItem): number =>
  Number(b.pinned) - Number(a.pinned) ||
  b.at - a.at ||
  (a.type === b.type ? 0 : a.type === 'announcement' ? -1 : 1) ||
  (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);

/** Строки ленты (правила 2–3). `only` — id своей корпорации, когда нажата «Моя корпорация». */
export function newsItems(
  view: NewsView,
  filter: NewsFilter = 'all',
  only: string | null = null,
): NewsItem[] {
  const items: NewsItem[] = [
    ...view.announcements.map(
      (a): NewsItem => ({ type: 'announcement', id: a.id, at: a.at, pinned: a.pinned, announcement: a }),
    ),
    ...view.events.map((e): NewsItem => ({ type: 'event', id: e.id, at: e.at, pinned: false, event: e })),
  ];
  return items
    .filter((it) => filter === 'all' || newsCategory(it) === filter)
    .filter((it) => only === null || newsCorps(it).some((c) => c.id === only))
    .sort(byFeedOrder);
}

/** Лента телефона: закреплённые и три свежие (правило 6). */
export function newsTeaser(view: NewsView): NewsItem[] {
  const all = newsItems(view);
  return [...all.filter((it) => it.pinned), ...all.filter((it) => !it.pinned).slice(0, NEWS_TEASER_FRESH)];
}

/** Сколько всего новостей — только когда число точное (правило 6). */
export function newsTotal(view: NewsView): number | null {
  return view.more ? null : view.announcements.length + view.events.length;
}

/** Что показать вместо строк. `shown` — сколько строк прошло фильтр. */
export type NewsPlaceholder = 'loading' | 'offline' | 'empty' | 'filtered' | null;

export function newsPlaceholder(view: NewsView | null, failed: boolean, shown: number): NewsPlaceholder {
  if (!view) return failed ? 'offline' : 'loading';
  if (view.announcements.length + view.events.length === 0) return 'empty';
  return shown === 0 ? 'filtered' : null;
}

// --- что сказать строкой и куда она ведёт (правила 4–5) -----------------------------

/** Кто читает ленту. */
export interface NewsReader {
  /** Есть сессия: карточку корпорации и заявку сервер отдаёт только вошедшему. */
  signedIn: boolean;
  /** Членство: `null` — ни корпорации, ни заявки; `undefined` — неизвестно (правило 4). */
  membership: NewsMembership | null | undefined;
  /** Имена медалей из каталога, по id; пусто, пока каталог не прочитан. */
  medalNames: Readonly<Record<string, string>>;
  /** Язык игрока: объявление показывается на нём, если администратор его заполнил. */
  locale: string;
}

/** Фраза строки: ключ локали с подстановками или готовый текст администратора. */
export type NewsPhrase = { key: string; vars: Record<string, string | number> } | { text: string };

export interface NewsLine {
  category: NewsCategory;
  /** Вид объявления (его цвет и подпись); у события `null`. */
  tone: NewsAnnouncementKind | null;
  /** Подпись над строкой — ключ локали. */
  labelKey: string;
  pinned: boolean;
  /** Новость своей корпорации — подсвечивается. */
  own: boolean;
  title: NewsPhrase;
  body: NewsPhrase | null;
  /** Исход битвы своей корпорации; у остальных строк `null`. */
  result: 'win' | 'loss' | 'draw' | null;
  /** Корпорация, чью карточку можно открыть. */
  card: NewsCorp | null;
  /** Заявка в эту корпорацию: можно подать или уже подана. */
  apply: 'can' | 'sent' | null;
  /** Куда ведут «К битвам»: текущая битва или история. */
  battles: 'current' | 'history' | null;
}

/** Текст администратора на языке игрока; английский пуст — русский. */
export function newsText(text: NewsText, locale: string): string {
  return locale === 'en' && text.en.trim() !== '' ? text.en : text.ru;
}

/** Заявка в корпорацию для этого читателя: можно подать, уже подана или нельзя
 *  (гость, неизвестное членство, состоит в корпорации — правила 4–5). */
export function newsApply(corp: NewsCorp, reader: NewsReader): NewsLine['apply'] {
  if (!reader.signedIn || reader.membership === undefined) return null;
  if (reader.membership === null) return 'can';
  return reader.membership.role === 'recruit' && reader.membership.corpId === corp.id ? 'sent' : null;
}

/** Строка ленты для этого читателя (правила 4–5). */
export function newsLine(item: NewsItem, reader: NewsReader): NewsLine {
  const category = newsCategory(item);
  const base = { category, pinned: item.pinned, result: null, card: null, apply: null, battles: null };
  if (item.type === 'announcement') {
    const a = item.announcement;
    const body = newsText(a.body, reader.locale);
    return {
      ...base,
      tone: a.kind,
      labelKey: NEWS_KIND_LABEL[a.kind],
      own: false,
      title: { text: newsText(a.title, reader.locale) },
      body: body.trim() === '' ? null : { text: body },
    };
  }
  const mine = ownCorp(reader.membership);
  const own = mine !== null && newsCorps(item).some((c) => c.id === mine);
  const line = { ...base, tone: null, labelKey: NEWS_FILTER_LABEL[category], own, body: null };
  const e = item.event;
  if (e.kind === 'matchup' || e.kind === 'result') {
    const vs = { a: e.challenger.name, b: e.target.name };
    if (e.kind === 'matchup')
      return { ...line, title: { key: 'news.matchup', vars: vs }, battles: own ? 'current' : null };
    const winner = e.winner === e.challenger.id ? e.challenger : e.winner === e.target.id ? e.target : null;
    const loser = winner === e.challenger ? e.target : e.challenger;
    return {
      ...line,
      title: winner
        ? { key: 'news.result.win', vars: { winner: winner.name, loser: loser.name } }
        : { key: 'news.result.draw', vars: vs },
      result: own ? (winner === null ? 'draw' : winner.id === mine ? 'win' : 'loss') : null,
      battles: own ? 'history' : null,
    };
  }
  const corp = e.corp;
  const about = { card: reader.signedIn ? corp : null, apply: newsApply(corp, reader) };
  if (e.kind === 'founded') return { ...line, ...about, title: { key: 'news.founded', vars: { corp: corp.name } } };
  if (e.kind === 'level')
    return { ...line, ...about, title: { key: 'news.level', vars: { corp: corp.name, n: e.level } } };
  const medal = reader.medalNames[e.medalId];
  return {
    ...line,
    ...about,
    title: medal
      ? { key: 'news.medal.named', vars: { corp: corp.name, medal } }
      : { key: 'news.medal', vars: { corp: corp.name } },
  };
}

/** Показывать ли кнопку «Моя корпорация»: только тому, кто в корпорации состоит. */
export function showOwnFilter(reader: NewsReader): boolean {
  return ownCorp(reader.membership) !== null;
}

// --- время (правило 7) ------------------------------------------------------------------

/** Границы календаря игрока: полночь сегодня и вчера, первое января этого года. Считает
 *  их экран — у решения нет часов и часового пояса. */
export interface NewsCalendar {
  today: number;
  yesterday: number;
  year: number;
}

export type NewsWhen = 'today' | 'yesterday' | 'date' | 'date-year';

export function newsWhen(at: number, calendar: NewsCalendar): NewsWhen {
  if (at >= calendar.today) return 'today';
  if (at >= calendar.yesterday) return 'yesterday';
  return at >= calendar.year ? 'date' : 'date-year';
}
