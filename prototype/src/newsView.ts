import { corpShowcaseHtml } from './corpFacilitiesView';
/** News dialog markup; decisions and user interests are shared pure functions. */
import { LOCALE, t } from '../../localization/runtime';
import {
  newsApply,
  newsItems,
  newsCorps,
  newsLine,
  newsPlaceholder,
  newsWhen,
  nextNewsBefore,
  NEWS_FILTER_LABEL,
  NEWS_FILTERS,
  ownCorp,
  showOwnFilter,
  type NewsCalendar,
  type NewsFilter,
  type NewsItem,
  type NewsLine,
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
import { type CorpMembership, type CorpRecord } from './corp';
import { esc, nfmt } from './format';
import { preferredNews, type NewsPreferences } from '../../decisions/newsPreferences';

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
  player_medal: '✪',
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
  preferences?: NewsPreferences;
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
export function newsItemHtml(
  item: NewsItem,
  line: NewsLine,
  time: string,
  applying: boolean,
): string {
  const cls =
    `nw-it k-${line.category}` +
    (line.tone ? ` s-${line.tone}` : '') +
    (line.pinned ? ' pin' : '') +
    (line.own ? ' my' : '') +
    (newsCorps(item).some((c) => c.monument) ? ' corp-monument' : '');
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
    .map((it) =>
      newsItemHtml(it, newsLine(it, p.reader), newsTimeText(it.at, p.calendar), p.applying),
    )
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
  const raw = p.view ? newsItems(p.view, p.filter, only) : [];
  const items = p.preferences ? preferredNews(raw, p.preferences, p.reader.membership) : raw;
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
    `<header class="nw-h"><h3${titleId ? ` id="${titleId}"` : ''}>${esc(t('news.title'))}</h3><button type="button" class="btn-quiet nw-btn" data-nw-settings>${esc(t('news.preferences'))}</button></header>` +
    `<div class="nw-chips" role="group" aria-label="${esc(t('news.filter.aria'))}">${chips}</div>` +
    `<div class="nw-list">${placeholder ? placeholderHtml(placeholder) : rowsHtml(items, p)}${more}</div>`
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
    corpShowcaseHtml(card.corp) +
    `<ul class="nw-facts">${facts.map((f) => `<li>${esc(f)}</li>`).join('')}</ul>` +
    (act ? `<div class="nw-a">${act}</div>` : '')
  );
}
