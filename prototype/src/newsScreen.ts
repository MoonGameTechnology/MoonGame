/**
 * Лента новостей на «Домой» (CORP-2). На ПК — колонка справа от «Моих партий», на
 * телефоне — превью (закреплённые и три свежие) и шторка со всей лентой. Что показать, в
 * каком порядке и куда ведёт строка — `decisions/newsFeed.ts`; здесь сеть, разметка и клики.
 *
 * Ленту сервер отдаёт без входа (`GET /news`, CORP-1), поэтому её видит и гость. Всё, что
 * зависит от читателя, читается с сессией хаба и только когда она есть: членство
 * (`/corps/me`) решает «Мою корпорацию» и заявку, каталог медалей (`/medals`) даёт имя
 * награды, карточка (`/corps/:id`) — состав и влияние. Отказ этих запросов ленту не прячет:
 * строка просто остаётся без кнопок.
 *
 * Прошлую ленту неудачное обновление не стирает: новости — не приказ, и вчерашняя строка
 * честнее пустого места. Стирает её только смена сервера.
 */
import { LOCALE, t } from '../../localization/runtime';
import {
  appendNewsPage,
  newsApply,
  newsItems,
  newsLine,
  newsPlaceholder,
  newsTeaser,
  newsTotal,
  newsWhen,
  nextNewsBefore,
  NEWS_FILTER_LABEL,
  NEWS_FILTERS,
  ownCorp,
  parseNewsView,
  showOwnFilter,
  type NewsCalendar,
  type NewsFilter,
  type NewsItem,
  type NewsLine,
  type NewsMembership,
  type NewsPhrase,
  type NewsPlaceholder,
  type NewsReader,
} from '../../decisions/newsFeed';
import type {
  NewsAnnouncementKind,
  NewsCorp,
  NewsEvent,
  NewsView,
} from '../../packages/protocol/src/news';
import {
  parseCorpRecord,
  parseMedalDefs,
  parseMembership,
  parseMemberships,
  type CorpMembership,
  type CorpRecord,
} from './corp';
import { detach } from './detach';
import { esc, nfmt } from './format';

// --- таблицы ---------------------------------------------------------------------------

const ANNOUNCEMENT_ICON: Record<NewsAnnouncementKind, string> = {
  tech: '⚠',
  update: '⟳',
  event: '✦',
};
const EVENT_ICON: Record<NewsEvent['kind'], string> = {
  founded: '⬢',
  level: '▲',
  medal: '✪',
  matchup: '⚔',
  result: '⚑',
};
const NEWS_PLACEHOLDER_KEY: Record<Exclude<NewsPlaceholder, null>, string> = {
  loading: 'news.loading',
  offline: 'news.offline',
  empty: 'news.empty',
  filtered: 'news.filtered',
};
const NEWS_RESULT_LABEL: Record<NonNullable<NewsLine['result']>, string> = {
  win: 'corp.battle.win',
  loss: 'corp.battle.loss',
  draw: 'corp.battle.draw',
};

// --- время (правило 7 решения) ------------------------------------------------------------

/** Полночь сегодня и вчера и первое января по часам игрока. */
export function newsCalendar(now: number): NewsCalendar {
  const d = new Date(now);
  return {
    today: new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime(),
    yesterday: new Date(d.getFullYear(), d.getMonth(), d.getDate() - 1).getTime(),
    year: new Date(d.getFullYear(), 0, 1).getTime(),
  };
}

const FORMATS = new Map<string, Intl.DateTimeFormat>();
function dateFormat(kind: 'time' | 'date' | 'date-year'): Intl.DateTimeFormat {
  const key = `${LOCALE}:${kind}`;
  let format = FORMATS.get(key);
  if (!format) {
    format = new Intl.DateTimeFormat(
      LOCALE,
      kind === 'time'
        ? { hour: '2-digit', minute: '2-digit' }
        : kind === 'date'
          ? { day: 'numeric', month: 'short' }
          : { day: 'numeric', month: 'short', year: 'numeric' },
    );
    FORMATS.set(key, format);
  }
  return format;
}

/** Время строки: «14:05», «вчера, 22:10», «18 окт.», «18 окт. 2025 г.». */
export function newsTimeText(at: number, calendar: NewsCalendar): string {
  const when = newsWhen(at, calendar);
  if (when === 'today') return dateFormat('time').format(at);
  if (when === 'yesterday')
    return t('news.when.yesterday', { time: dateFormat('time').format(at) });
  return dateFormat(when).format(at);
}

// --- разметка ----------------------------------------------------------------------------

/** Всё, из чего рисуется лента. */
export interface NewsPaint {
  view: NewsView | null;
  /** Последнее чтение ленты не удалось. */
  failed: boolean;
  filter: NewsFilter;
  /** Нажата «Моя корпорация». */
  own: boolean;
  reader: NewsReader;
  calendar: NewsCalendar;
  /** Идёт чтение следующей страницы. */
  loadingMore: boolean;
  /** Заявка ушла и ждёт ответа: кнопки заявки погашены. */
  applying: boolean;
}

/** Фраза строки: ключ — через локаль, текст администратора — как есть. Экранируется здесь. */
export function newsPhraseHtml(phrase: NewsPhrase): string {
  return esc('key' in phrase ? t(phrase.key, phrase.vars) : phrase.text);
}

function newsIcon(item: NewsItem): string {
  return item.type === 'announcement'
    ? ANNOUNCEMENT_ICON[item.announcement.kind]
    : EVENT_ICON[item.event.kind];
}

/** Одна строка ленты: подпись раздела и время, фраза, исход своей битвы и кнопки. */
export function newsItemHtml(item: NewsItem, line: NewsLine, time: string, applying: boolean): string {
  const cls =
    `nw-it k-${line.category}` +
    (line.tone ? ` s-${line.tone}` : '') +
    (line.pinned ? ' pin' : '') +
    (line.own ? ' my' : '');
  const label = (line.pinned ? `${t('news.pinned')} · ` : '') + t(line.labelKey);
  const card = line.card;
  const acts =
    (line.result
      ? `<span class="nw-pill ${line.result}">${esc(t(NEWS_RESULT_LABEL[line.result]))}</span>`
      : '') +
    (card
      ? `<button type="button" class="btn-quiet nw-btn" data-nw-corp="${esc(card.id)}" data-nw-name="${esc(card.name)}">` +
        `${esc(t('news.card.open'))}</button>`
      : '') +
    (card && line.apply === 'can'
      ? `<button type="button" class="btn-second nw-btn" data-nw-apply="${esc(card.id)}"${applying ? ' disabled' : ''}>` +
        `${esc(t('corp.apply'))}</button>`
      : line.apply === 'sent'
        ? `<span class="nw-pill wait">${esc(t('news.applied'))}</span>`
        : '') +
    (line.battles
      ? `<button type="button" class="btn-quiet nw-btn" data-nw-battles="${line.battles}">${esc(t('news.battles'))}</button>`
      : '');
  return (
    `<article class="${cls}"><span class="nw-ic" aria-hidden="true">${newsIcon(item)}</span>` +
    `<div class="nw-b"><div class="nw-top"><span>${esc(label)}</span>` +
    (line.pinned ? '' : `<time datetime="${new Date(item.at).toISOString()}">${esc(time)}</time>`) +
    `</div><b class="nw-t">${newsPhraseHtml(line.title)}</b>` +
    (line.body ? `<p class="nw-x">${newsPhraseHtml(line.body)}</p>` : '') +
    (acts ? `<div class="nw-a">${acts}</div>` : '') +
    `</div></article>`
  );
}

function rowsHtml(items: readonly NewsItem[], p: NewsPaint): string {
  return items
    .map((it) => newsItemHtml(it, newsLine(it, p.reader), newsTimeText(it.at, p.calendar), p.applying))
    .join('');
}

function placeholderHtml(placeholder: Exclude<NewsPlaceholder, null>): string {
  return (
    `<p class="nw-empty"${placeholder === 'loading' ? ' aria-busy="true"' : ''}>` +
    `${esc(t(NEWS_PLACEHOLDER_KEY[placeholder]))}</p>`
  );
}

/** Лента целиком: заголовок, фильтры, строки и «Показать ещё» — колонка ПК и шторка. */
export function newsFeedHtml(p: NewsPaint, titleId = ''): string {
  const only = p.own ? ownCorp(p.reader.membership) : null;
  const items = p.view ? newsItems(p.view, p.filter, only) : [];
  const placeholder = newsPlaceholder(p.view, p.failed, items.length);
  const chips =
    NEWS_FILTERS.map(
      (f) =>
        `<button type="button" class="nw-chip" data-nw-filter="${f}" aria-pressed="${p.filter === f}">` +
        `${esc(t(NEWS_FILTER_LABEL[f]))}</button>`,
    ).join('') +
    (showOwnFilter(p.reader)
      ? `<button type="button" class="nw-chip mine" data-nw-own aria-pressed="${p.own}">${esc(t('news.filter.own'))}</button>`
      : '');
  const more =
    p.view && nextNewsBefore(p.view) !== null
      ? `<button type="button" class="btn-second nw-more" data-nw-more${p.loadingMore ? ' disabled aria-busy="true"' : ''}>` +
        `${esc(t(p.loadingMore ? 'news.loading' : 'news.more'))}</button>`
      : '';
  return (
    `<header class="nw-h"><h3${titleId ? ` id="${titleId}"` : ''}>${esc(t('news.title'))}</h3></header>` +
    `<div class="nw-chips" role="group" aria-label="${esc(t('news.filter.aria'))}">${chips}</div>` +
    `<div class="nw-list">${placeholder ? placeholderHtml(placeholder) : rowsHtml(items, p)}${more}</div>`
  );
}

/** Превью телефона: закреплённые, три свежие и «Вся лента» (правило 6 решения). */
export function newsTeaserHtml(p: NewsPaint): string {
  const items = p.view ? newsTeaser(p.view) : [];
  const placeholder = newsPlaceholder(p.view, p.failed, items.length);
  const total = p.view ? newsTotal(p.view) : null;
  return (
    `<header class="nw-h"><h3>${esc(t('news.title'))}</h3></header>` +
    `<div class="nw-list">${placeholder ? placeholderHtml(placeholder) : rowsHtml(items, p)}</div>` +
    (p.view && !placeholder
      ? `<button type="button" class="nw-all" data-nw-all>` +
        `${esc(total === null ? t('news.all') : t('news.all.count', { n: total }))}</button>`
      : '')
  );
}

/** Карточка корпорации: прочитанная, ещё читается или недоступна. */
export type NewsCard = { corp: CorpRecord; members: CorpMembership[] } | 'loading' | 'failed';

/** Карточка корпорации: состав, влияние, глава и заявка; своей — дверь в кабинет. */
export function newsCardHtml(
  corp: NewsCorp,
  card: NewsCard,
  reader: NewsReader,
  applying: boolean,
  titleId: string,
): string {
  const title = `<h3 id="${titleId}">${esc(typeof card === 'object' ? card.corp.name : corp.name)}</h3>`;
  if (card === 'loading' || card === 'failed')
    return (
      title +
      `<p class="nw-note"${card === 'loading' ? ' aria-busy="true"' : ''}>` +
      `${esc(t(card === 'loading' ? 'news.card.loading' : 'news.card.failed'))}</p>`
    );
  // Кандидат ещё не участник: в составе и среди глав его нет.
  const roster = card.members.filter((m) => m.role !== 'recruit');
  const chief = roster.find((m) => m.role === 'head');
  const facts = [
    t('corp.members.count', { n: roster.length }),
    t('news.card.influence', { n: nfmt(card.corp.influence) }),
    ...(chief ? [t('news.card.head', { login: chief.login })] : []),
  ];
  const apply = newsApply(corp, reader);
  const act =
    ownCorp(reader.membership) === corp.id
      ? `<button type="button" class="btn-second" data-nw-cabinet>${esc(t('hub.ally.corp'))}</button>`
      : apply === 'can'
        ? `<button type="button" class="btn-main" data-nw-apply="${esc(corp.id)}"${applying ? ' disabled' : ''}>` +
          `${esc(t('corp.apply'))}</button>`
        : apply === 'sent'
          ? `<span class="nw-pill wait">${esc(t('news.applied'))}</span>`
          : '';
  return (
    title +
    `<ul class="nw-facts">${facts.map((f) => `<li>${esc(f)}</li>`).join('')}</ul>` +
    (act ? `<div class="nw-a">${act}</div>` : '')
  );
}

// --- экран -------------------------------------------------------------------------------

/** Куда ведёт дверь в кабинет своей корпорации. */
export type NewsCorpTab = 'hq' | 'current' | 'history';

/** Что ленте нужно от хаба. */
export interface NewsHost {
  /** Колонка ленты на ПК (`#news-col`). */
  column(): HTMLElement;
  /** Превью на телефоне (`#news-teaser`). */
  teaser(): HTMLElement;
  /** Шторка над хабом (`#news-sheet`): вся лента на телефоне и карточка корпорации. */
  sheet(): HTMLElement;
  /** HTTP-адрес сервера или `null`, когда сервера нет: самой ленте сессия не нужна. */
  publicBase(): string | null;
  /** Адрес и сессия хаба; `null` — гость. */
  authorizedBase(): Promise<{ base: string; token: string } | null>;
  /** Строка игроку под хабом (ответ на заявку). */
  note(text: string): void;
  /** Текст отказа по коду `E_*`. */
  errText(code: string): string;
  /** Открыть кабинет своей корпорации: штаб, текущую битву или историю. */
  openCorp(tab: NewsCorpTab): void;
  /** Часы игрока — для «сегодня» и «вчера». */
  now(): number;
}

type NewsSheet =
  | { kind: 'feed' }
  /** `back` — карточку открыли из шторки ленты: Back возвращает к ленте. */
  | { kind: 'corp'; corp: NewsCorp; card: NewsCard; back: boolean };

type Focus = () => HTMLElement | null | undefined;

interface Answer {
  ok: boolean;
  body: unknown;
}

/** Запрос к серверу; `null` — до сервера не дошли. Не бросает. */
async function call(
  url: string,
  token?: string,
  init?: { method: string; body: unknown },
): Promise<Answer | null> {
  try {
    const res = await fetch(url, {
      method: init?.method ?? 'GET',
      headers: {
        ...(token ? { authorization: `Bearer ${token}` } : {}),
        ...(init ? { 'content-type': 'application/json' } : {}),
      },
      ...(init ? { body: JSON.stringify(init.body) } : {}),
    });
    return { ok: res.ok, body: await res.json().catch(() => null) };
  } catch {
    return null;
  }
}

const SELECTOR =
  '[data-nw-filter],[data-nw-own],[data-nw-more],[data-nw-all],[data-nw-corp],' +
  '[data-nw-apply],[data-nw-battles],[data-nw-cabinet],[data-nw-close]';

/** Подключить ленту. Вызывается один раз: вешает делегатов кликов на колонку, превью и
 *  шторку. `refresh` — при каждом заходе на «Домой»; `isOpen`/`close` — ступень Back. */
export function initNews(host: NewsHost): {
  refresh: () => Promise<void>;
  isOpen: () => boolean;
  close: () => void;
} {
  let view: NewsView | null = null;
  let viewBase: string | null = null;
  let failed = false;
  let filter: NewsFilter = 'all';
  let own = false;
  let signedIn = false;
  let membership: NewsMembership | null | undefined;
  let medalsOn = true;
  let medalNames: Record<string, string> = {};
  let medalsRead = false;
  let loadingMore = false;
  let applying = false;
  let sheet: NewsSheet | null = null;
  /** Строка о заявке внутри шторки: строка хаба под шторкой не видна. */
  let notice = '';
  /** Куда вернуть фокус, когда закроется шторка и когда карточка вернётся к ленте. */
  let opener: Focus | null = null;
  let cardOpener: Focus | null = null;
  let feedScroll = 0;
  /** Поколение чтения: ответ, обогнанный новым обновлением, выбрасывается. */
  let seq = 0;

  const reader = (): NewsReader => ({ signedIn, membership, medalNames, locale: LOCALE });

  function paint(): void {
    const r = reader();
    const p: NewsPaint = {
      view,
      failed,
      filter,
      own: own && showOwnFilter(r),
      reader: r,
      calendar: newsCalendar(host.now()),
      loadingMore,
      applying,
    };
    const column = host.column();
    const list = column.querySelector?.('.nw-list');
    const keep = list?.scrollTop ?? 0;
    column.innerHTML = newsFeedHtml(p);
    const fresh = column.querySelector?.('.nw-list');
    if (fresh) fresh.scrollTop = keep;
    host.teaser().innerHTML = newsTeaserHtml(p);

    const root = host.sheet();
    const body = root.querySelector?.('.nw-sheet-body');
    const keepSheet = body?.scrollTop ?? 0;
    root.innerHTML = sheet
      ? `<div class="nw-scrim" data-nw-close></div>` +
        `<div class="nw-sheet${sheet.kind === 'corp' ? ' card' : ''}" role="dialog" aria-modal="true" aria-labelledby="nw-sheet-title">` +
        `<div class="nw-sheet-top"><button type="button" class="btn-x" data-nw-close aria-label="${esc(t('news.close'))}">✕</button></div>` +
        `<div class="nw-sheet-body">` +
        (notice ? `<p class="nw-notice" role="status">${esc(notice)}</p>` : '') +
        (sheet.kind === 'feed'
          ? newsFeedHtml(p, 'nw-sheet-title')
          : newsCardHtml(sheet.corp, sheet.card, r, applying, 'nw-sheet-title')) +
        `</div></div>`
      : '';
    root.classList.toggle('open', sheet !== null);
    const freshSheet = root.querySelector?.('.nw-sheet-body');
    if (freshSheet) freshSheet.scrollTop = keepSheet;
  }

  function sheetBody(): Element | null | undefined {
    return host.sheet().querySelector?.('.nw-sheet-body');
  }

  function focusClose(): void {
    host.sheet().querySelector?.<HTMLElement>('.btn-x')?.focus({ preventScroll: true });
  }

  function openFeed(from: Focus): void {
    opener = from;
    sheet = { kind: 'feed' };
    notice = '';
    paint();
    const body = sheetBody();
    if (body) body.scrollTop = 0;
    focusClose();
  }

  async function openCard(corp: NewsCorp, from: Focus): Promise<void> {
    const back = sheet?.kind === 'feed';
    if (back) {
      cardOpener = from;
      feedScroll = sheetBody()?.scrollTop ?? 0;
    } else opener = from;
    const opened: Extract<NewsSheet, { kind: 'corp' }> = { kind: 'corp', corp, card: 'loading', back };
    sheet = opened;
    notice = '';
    paint();
    const body = sheetBody();
    if (body) body.scrollTop = 0;
    focusClose();
    const auth = await host.authorizedBase();
    const res = auth ? await call(`${auth.base}/corps/${encodeURIComponent(corp.id)}`, auth.token) : null;
    if (sheet !== opened) return; // карточку закрыли или открыли другую
    const answer = res?.ok ? (res.body as { corp?: unknown; members?: unknown } | null) : null;
    const record = parseCorpRecord(answer?.corp);
    opened.card = record ? { corp: record, members: parseMemberships(answer?.members) } : 'failed';
    paint();
  }

  /** Убрать шторку без возврата фокуса: игрок уходит в кабинет корпорации. */
  function dismiss(): void {
    sheet = null;
    notice = '';
    opener = null;
    cardOpener = null;
    paint();
  }

  /** Ступень Back: карточка, открытая из ленты, сначала возвращает к ленте. */
  function close(): void {
    if (!sheet) return;
    notice = '';
    if (sheet.kind === 'corp' && sheet.back) {
      sheet = { kind: 'feed' };
      paint();
      const body = sheetBody();
      if (body) body.scrollTop = feedScroll;
      cardOpener?.()?.focus({ preventScroll: true });
      cardOpener = null;
      return;
    }
    sheet = null;
    paint();
    opener?.()?.focus({ preventScroll: true });
    opener = null;
    cardOpener = null;
  }

  async function readMedals(auth: { base: string; token: string }, my: number): Promise<void> {
    if (medalsRead || !medalsOn || !view?.events.some((e) => e.kind === 'medal')) return;
    const res = await call(`${auth.base}/medals`, auth.token);
    if (my !== seq || !res?.ok) return;
    const defs = parseMedalDefs((res.body as { medals?: unknown } | null)?.medals);
    medalNames = Object.fromEntries(defs.map((m) => [m.id, m.name]));
    medalsRead = true;
    paint();
  }

  async function refresh(): Promise<void> {
    const my = ++seq;
    loadingMore = false;
    const base = host.publicBase();
    if (base !== viewBase) {
      view = null;
      viewBase = base;
      medalNames = {};
      medalsRead = false;
    }
    failed = false;
    paint();
    const [feed, auth] = await Promise.all([
      base ? call(`${base}/news`) : Promise.resolve(null),
      host.authorizedBase(),
    ]);
    if (my !== seq) return;
    const next = feed?.ok ? parseNewsView(feed.body) : null;
    if (next) view = next;
    else failed = true;
    signedIn = auth !== null;
    if (!auth) {
      membership = undefined;
      own = false;
      paint();
      return;
    }
    paint(); // лента — сразу, кнопки читателя — следом
    const me = await call(`${auth.base}/corps/me`, auth.token);
    if (my !== seq) return;
    const answer = me?.ok
      ? (me.body as { membership?: unknown; features?: { medals?: unknown } } | null)
      : null;
    const mine = me?.ok ? parseMembership(answer?.membership) : undefined;
    // Не прочитали — неизвестно, а не «без корпорации» (правило 4 решения).
    membership = mine === undefined ? undefined : mine && { corpId: mine.corpId, role: mine.role };
    medalsOn = answer?.features?.medals !== false;
    if (!showOwnFilter(reader())) own = false;
    paint();
    await readMedals(auth, my);
  }

  async function loadMore(): Promise<void> {
    const base = host.publicBase();
    const before = view ? nextNewsBefore(view) : null;
    if (loadingMore || before === null || !base || base !== viewBase) return;
    loadingMore = true;
    paint();
    const my = seq;
    const res = await call(`${base}/news?before=${before}`);
    if (my !== seq || !view) return; // ленту за это время перечитали целиком
    loadingMore = false;
    const page = res?.ok ? parseNewsView(res.body) : null;
    if (page) view = appendNewsPage(view, page);
    else host.note(t('news.offline'));
    paint();
    if (page) {
      const auth = await host.authorizedBase();
      if (auth && my === seq) await readMedals(auth, my);
    }
  }

  async function apply(corpId: string): Promise<void> {
    if (applying) return;
    applying = true;
    paint();
    const auth = await host.authorizedBase();
    const res = auth
      ? await call(`${auth.base}/corps/${encodeURIComponent(corpId)}/apply`, auth.token, {
          method: 'POST',
          body: {},
        })
      : null;
    applying = false;
    if (res?.ok) {
      membership = { corpId, role: 'recruit' }; // the row and the card say «Заявка отправлена»
      notice = '';
    } else {
      const code = (res?.body as { error?: unknown } | null)?.error;
      notice = '✖ ' + (typeof code === 'string' ? host.errText(code) : t('news.offline'));
      host.note(notice);
      if (!sheet) notice = '';
    }
    paint();
  }

  function onClick(e: Event): void {
    const b = (e.target as HTMLElement | null)?.closest?.<HTMLElement>(SELECTOR);
    if (!b || (b as HTMLButtonElement).disabled) return;
    const root = e.currentTarget as HTMLElement;
    const d = b.dataset;
    const refocus = (sel: string): void => {
      paint();
      root.querySelector?.<HTMLElement>(sel)?.focus({ preventScroll: true });
    };
    if (d.nwFilter !== undefined) {
      filter = NEWS_FILTERS.find((f) => f === d.nwFilter) ?? 'all';
      refocus(`[data-nw-filter="${filter}"]`);
    } else if (d.nwOwn !== undefined) {
      own = !own;
      refocus('[data-nw-own]');
    } else if (d.nwMore !== undefined) {
      detach('лента: следующая страница', loadMore());
    } else if (d.nwAll !== undefined) {
      openFeed(() => root.querySelector?.<HTMLElement>('[data-nw-all]'));
    } else if (d.nwCorp !== undefined) {
      const corp = { id: d.nwCorp, name: d.nwName ?? '' };
      // Id корпорации — данные сервера: в селектор его не вставляют, кнопку ищут сравнением.
      const back = (): HTMLElement | undefined =>
        Array.from(root.querySelectorAll?.<HTMLElement>('[data-nw-corp]') ?? []).find(
          (el) => el.dataset.nwCorp === corp.id,
        );
      detach('лента: карточка корпорации', openCard(corp, back));
    } else if (d.nwApply !== undefined) {
      detach('лента: заявка в корпорацию', apply(d.nwApply));
    } else if (d.nwBattles !== undefined) {
      dismiss();
      host.openCorp(d.nwBattles === 'history' ? 'history' : 'current');
    } else if (d.nwCabinet !== undefined) {
      dismiss();
      host.openCorp('hq');
    } else if (d.nwClose !== undefined) {
      close();
    }
  }

  host.column().addEventListener('click', onClick);
  host.teaser().addEventListener('click', onClick);
  host.sheet().addEventListener('click', onClick);

  return { refresh, isOpen: () => sheet !== null, close };
}
