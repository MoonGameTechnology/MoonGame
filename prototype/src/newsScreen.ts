/** News window, account-safe loading and unread badge. Rendering lives in newsView.ts. */
import { LOCALE, t } from '../../localization/runtime';
import {
  appendNewsPage,
  newsItems,
  nextNewsBefore,
  ownCorp,
  parseNewsView,
  showOwnFilter,
  NEWS_FILTERS,
  type NewsFilter,
  type NewsMembership,
  type NewsReader,
} from '../../decisions/newsFeed';
import { preferredNews, readNews, unreadNews } from '../../decisions/newsPreferences';
import type { NewsCorp, NewsView } from '../../packages/protocol/src/news';
import { PROFILE_MEDALS } from '../../packages/protocol/src/playerProfile';
import { parseCorpRecord, parseMedalDefs, parseMembership, parseMemberships } from './corp';
import { detach } from './detach';
import { esc } from './format';
import { NewsPreferenceStore } from './newsPreferences';
import {
  newsCalendar,
  newsCardHtml,
  newsFeedHtml,
  type NewsCard,
  type NewsPaint,
} from './newsView';
export {
  newsCalendar,
  newsCardHtml,
  newsFeedHtml,
  newsItemHtml,
  newsPhraseHtml,
  newsTimeText,
  type NewsPaint,
} from './newsView';

export type NewsCorpTab = 'hq' | 'current' | 'history';
export interface NewsHost {
  button(): HTMLElement;
  sheet(): HTMLElement;
  /** Stable server + account identity, never the rotating session token. */
  identity(): string;
  publicBase(): string | null;
  authorizedBase(): Promise<{ base: string; token: string } | null>;
  note(text: string): void;
  errText(code: string): string;
  openCorp(tab: NewsCorpTab): void;
  openSettings(): void;
  now(): number;
}

type NewsSheet = { kind: 'feed' } | { kind: 'corp'; corp: NewsCorp; card: NewsCard; back: boolean };
type Focus = () => HTMLElement | null | undefined;
interface Answer {
  ok: boolean;
  body: unknown;
}

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

/** One controller survives hub navigation. Refresh generations discard late account responses. */
class NewsScreen {
  readonly preferences: NewsPreferenceStore;
  private view: NewsView | null = null;
  private identity = '';
  private failed = false;
  private filter: NewsFilter = 'all';
  private own = false;
  private signedIn = false;
  private membership: NewsMembership | null | undefined;
  private medalNames: Record<string, string> = {};
  private medalsRead = false;
  private loadingMore = false;
  private applying = false;
  private applySeq = 0;
  private sheet: NewsSheet | null = null;
  private notice = '';
  private opener: Focus | null = null;
  private cardOpener: Focus | null = null;
  private feedScroll = 0;
  private seq = 0;
  private newsToken: string | undefined;
  private timer: ReturnType<typeof setTimeout> | undefined;
  private active = false;
  private activeVersion = 0;

  constructor(private readonly host: NewsHost) {
    this.preferences = new NewsPreferenceStore({
      identity: host.identity,
      authorizedBase: host.authorizedBase,
      changed: () => this.paint(),
    });
    host.button().addEventListener('click', () => {
      this.openFeed();
      detach('news: open', this.refresh());
    });
    host.sheet().addEventListener('click', (e) => this.onClick(e));
    host.sheet().addEventListener('keydown', (e) => this.trapFocus(e));
  }

  private reader(): NewsReader {
    return {
      signedIn: this.signedIn,
      membership: this.membership,
      medalNames: this.medalNames,
      locale: LOCALE,
      playerMedalNames: Object.fromEntries(
        PROFILE_MEDALS.map((m) => [m.id, t(`profile.medal.${m.id}`)]),
      ),
    };
  }

  private current(my: number, key: string): boolean {
    return my === this.seq && key === this.host.identity();
  }
  private sheetBody(): HTMLElement | null {
    return this.host.sheet().querySelector('.nw-sheet-body');
  }
  private focusClose(): void {
    this.host.sheet().querySelector<HTMLElement>('.btn-x')?.focus({ preventScroll: true });
  }

  private paint(): void {
    this.syncIdentity();
    const r = this.reader();
    let preferences = this.preferences.get();
    const items = this.view ? newsItems(this.view) : [];
    const shown = this.view
      ? preferredNews(
          newsItems(this.view, this.filter, this.own ? ownCorp(r.membership) : null),
          preferences,
          r.membership,
        )
      : [];
    if (
      this.sheet?.kind === 'feed' &&
      (typeof document === 'undefined' || document.visibilityState !== 'hidden')
    ) {
      const next = readNews(preferences, shown);
      if (next.read.join('\n') !== preferences.read.join('\n')) this.preferences.save(next, false);
      preferences = next;
    }
    const unread = unreadNews(items, preferences, r.membership).length > 0;
    const button = this.host.button();
    button.classList.toggle('has-news', unread);
    button.setAttribute('aria-label', t(unread ? 'news.unread' : 'news.open'));
    button.setAttribute('title', t(unread ? 'news.unread' : 'news.open'));
    button.setAttribute('aria-expanded', String(this.sheet !== null));
    const p: NewsPaint = {
      view: this.view,
      failed: this.failed,
      filter: this.filter,
      own: this.own && showOwnFilter(r),
      reader: r,
      calendar: newsCalendar(this.host.now()),
      loadingMore: this.loadingMore,
      applying: this.applying,
      preferences,
    };
    const root = this.host.sheet();
    const scroll = this.sheetBody()?.scrollTop ?? 0;
    // Polling replaces markup; keep keyboard focus on the same action when it still exists.
    const focused =
      typeof document !== 'undefined' ? (document.activeElement as HTMLElement | null) : null;
    const focusData = focused && root.contains?.(focused) ? { ...focused.dataset } : null;
    root.innerHTML = this.sheet
      ? `<div class="nw-scrim" data-nw-close></div>` +
        `<div class="nw-sheet${this.sheet.kind === 'corp' ? ' card' : ''}" role="dialog" aria-modal="true" aria-labelledby="nw-sheet-title">` +
        `<div class="nw-sheet-top"><button type="button" class="btn-x" data-nw-close aria-label="${esc(t('news.close'))}">✕</button></div>` +
        `<div class="nw-sheet-body">${this.notice ? `<p class="nw-notice" role="status">${esc(this.notice)}</p>` : ''}` +
        (this.sheet.kind === 'feed'
          ? newsFeedHtml(p, 'nw-sheet-title')
          : newsCardHtml(this.sheet.corp, this.sheet.card, r, this.applying, 'nw-sheet-title')) +
        `</div></div>`
      : '';
    root.classList.toggle('open', this.sheet !== null);
    const body = this.sheetBody();
    if (body) body.scrollTop = scroll;
    if (focusData)
      Array.from(root.querySelectorAll<HTMLElement>('button'))
        .find((el) => Object.entries(focusData).every(([key, val]) => el.dataset[key] === val))
        ?.focus({ preventScroll: true });
  }

  openFeed(): void {
    this.opener = () => this.host.button();
    this.sheet = { kind: 'feed' };
    this.notice = '';
    this.paint();
    const body = this.sheetBody();
    if (body) body.scrollTop = 0;
    this.focusClose();
  }

  private async openCard(corp: NewsCorp, from: Focus): Promise<void> {
    const back = this.sheet?.kind === 'feed';
    if (back) {
      this.cardOpener = from;
      this.feedScroll = this.sheetBody()?.scrollTop ?? 0;
    } else this.opener = from;
    const opened: Extract<NewsSheet, { kind: 'corp' }> = {
      kind: 'corp',
      corp,
      card: 'loading',
      back,
    };
    this.sheet = opened;
    this.notice = '';
    this.paint();
    const body = this.sheetBody();
    if (body) body.scrollTop = 0;
    this.focusClose();
    const key = this.host.identity();
    const auth = await this.host.authorizedBase();
    const res =
      auth && key === this.host.identity()
        ? await call(`${auth.base}/corps/${encodeURIComponent(corp.id)}`, auth.token)
        : null;
    if (this.sheet !== opened || key !== this.host.identity()) return;
    const answer = res?.ok ? (res.body as { corp?: unknown; members?: unknown } | null) : null;
    const record = parseCorpRecord(answer?.corp);
    opened.card = record ? { corp: record, members: parseMemberships(answer?.members) } : 'failed';
    this.paint();
  }

  private dismiss(): void {
    this.sheet = null;
    this.notice = '';
    this.opener = this.cardOpener = null;
    this.paint();
  }

  isOpen(): boolean {
    return this.sheet !== null;
  }
  close(): void {
    if (!this.sheet) return;
    this.notice = '';
    if (this.sheet.kind === 'corp' && this.sheet.back) {
      this.sheet = { kind: 'feed' };
      this.paint();
      const body = this.sheetBody();
      if (body) body.scrollTop = this.feedScroll;
      this.cardOpener?.()?.focus({ preventScroll: true });
      this.cardOpener = null;
      return;
    }
    this.sheet = null;
    this.paint();
    this.opener?.()?.focus({ preventScroll: true });
    this.opener = this.cardOpener = null;
  }

  /** Poll only while the hub is active, never overlap interval requests. */
  setActive(active: boolean): void {
    this.active = active;
    ++this.activeVersion;
    clearTimeout(this.timer);
    if (!active) {
      ++this.seq;
      this.dismiss();
      return;
    }
    this.schedule();
  }

  private schedule(): void {
    if (!this.active) return;
    const version = this.activeVersion;
    this.timer = setTimeout(() => {
      const pending =
        document.visibilityState === 'hidden' || this.isOpen() ? Promise.resolve() : this.refresh();
      detach(
        'news: poll',
        pending.finally(() => {
          if (version === this.activeVersion) this.schedule();
        }),
      );
    }, 60_000);
  }

  private async readMedals(
    auth: { base: string; token: string },
    my: number,
    key: string,
  ): Promise<void> {
    if (this.medalsRead || !this.view?.events.some((e) => e.kind === 'medal')) return;
    const res = await call(`${auth.base}/medals`, auth.token);
    if (!this.current(my, key) || !res?.ok) return;
    this.medalNames = Object.fromEntries(
      parseMedalDefs((res.body as { medals?: unknown } | null)?.medals).map((m) => [m.id, m.name]),
    );
    this.medalsRead = true;
    this.paint();
  }

  private syncIdentity(): void {
    if (this.host.identity() !== this.identity) {
      this.view = null;
      this.identity = this.host.identity();
      this.membership = undefined;
      this.signedIn = false;
      this.own = false;
      this.filter = 'all';
      this.notice = '';
      this.applying = false;
      ++this.applySeq;
      this.medalNames = {};
      this.medalsRead = false;
      if (this.sheet?.kind === 'corp') this.sheet = { kind: 'feed' };
    }
  }

  async refresh(): Promise<void> {
    this.syncIdentity();
    const my = ++this.seq,
      key = this.host.identity();
    const base = this.host.publicBase();
    // Private achievements and membership must be authorized afresh, even on network failure.
    if (this.view)
      this.view = {
        ...this.view,
        events: this.view.events.filter((e) => e.kind !== 'player_medal' || e.grade === 1),
      };
    this.loadingMore = false;
    this.failed = false;
    this.paint();
    const auth = await this.host.authorizedBase();
    if (!this.current(my, key)) return;
    this.newsToken = auth?.base === base ? auth.token : undefined;
    const [feed, me] = await Promise.all([
      base ? call(`${base}/news`, this.newsToken) : null,
      auth ? call(`${auth.base}/corps/me`, auth.token) : null,
    ]);
    if (!this.current(my, key)) return;
    const next = feed?.ok ? parseNewsView(feed.body) : null;
    if (next) this.view = next;
    else this.failed = true;
    this.signedIn = auth !== null;
    const answer = me?.ok
      ? (me.body as { membership?: unknown; features?: { medals?: unknown } } | null)
      : null;
    const mine = me?.ok ? parseMembership(answer?.membership) : undefined;
    this.membership =
      mine === undefined ? undefined : mine && { corpId: mine.corpId, role: mine.role };
    if (!showOwnFilter(this.reader())) this.own = false;
    this.paint();
    if (auth && answer?.features?.medals !== false) await this.readMedals(auth, my, key);
  }

  private async loadMore(): Promise<void> {
    const before = this.view ? nextNewsBefore(this.view) : null;
    const base = this.host.publicBase();
    if (this.loadingMore || before === null || !base) return;
    this.loadingMore = true;
    this.paint();
    const my = this.seq,
      key = this.host.identity();
    const auth = await this.host.authorizedBase();
    if (!this.current(my, key)) return;
    const token = auth?.base === base ? auth.token : undefined;
    if (token !== this.newsToken) {
      await this.refresh();
      return;
    }
    const res = await call(`${base}/news?before=${before}`, token);
    if (!this.current(my, key) || !this.view) return;
    this.loadingMore = false;
    const page = res?.ok ? parseNewsView(res.body) : null;
    if (page) {
      this.view = appendNewsPage(this.view, page);
      this.notice = '';
    } else this.notice = t('news.offline');
    this.paint();
    if (page && auth) await this.readMedals(auth, my, key);
  }

  private async apply(corpId: string): Promise<void> {
    if (this.applying) return;
    this.applying = true;
    this.paint();
    const key = this.host.identity(),
      operation = ++this.applySeq;
    const current = (): boolean => key === this.host.identity() && operation === this.applySeq;
    const auth = await this.host.authorizedBase();
    const res =
      auth && current()
        ? await call(`${auth.base}/corps/${encodeURIComponent(corpId)}/apply`, auth.token, {
            method: 'POST',
            body: {},
          })
        : null;
    if (!current()) return;
    this.applying = false;
    ++this.seq;
    this.loadingMore = false;
    if (res?.ok) {
      this.membership = { corpId, role: 'recruit' };
      this.notice = '';
    } else {
      const code = (res?.body as { error?: unknown } | null)?.error;
      this.notice = '✖ ' + (typeof code === 'string' ? this.host.errText(code) : t('news.offline'));
      this.host.note(this.notice);
    }
    this.paint();
  }

  private onClick(e: Event): void {
    const b = (e.target as HTMLElement | null)?.closest<HTMLElement>(
      '[data-nw-filter],[data-nw-own],[data-nw-more],[data-nw-corp],[data-nw-apply],[data-nw-battles],[data-nw-cabinet],[data-nw-close],[data-nw-settings]',
    );
    if (!b || (b as HTMLButtonElement).disabled) return;
    const d = b.dataset,
      root = this.host.sheet();
    if (d.nwFilter !== undefined) {
      this.filter = NEWS_FILTERS.find((f) => f === d.nwFilter) ?? 'all';
      this.paint();
    } else if (d.nwOwn !== undefined) {
      this.own = !this.own;
      this.paint();
    } else if (d.nwMore !== undefined) detach('news: next page', this.loadMore());
    else if (d.nwCorp !== undefined) {
      const corp = { id: d.nwCorp, name: d.nwName ?? '' };
      const back = (): HTMLElement | undefined =>
        Array.from(root.querySelectorAll<HTMLElement>('[data-nw-corp]')).find(
          (el) => el.dataset.nwCorp === corp.id,
        );
      detach('news: corporation card', this.openCard(corp, back));
    } else if (d.nwApply !== undefined) detach('news: apply', this.apply(d.nwApply));
    else if (d.nwBattles !== undefined) {
      this.dismiss();
      this.host.openCorp(d.nwBattles === 'history' ? 'history' : 'current');
    } else if (d.nwCabinet !== undefined) {
      this.dismiss();
      this.host.openCorp('hq');
    } else if (d.nwSettings !== undefined) {
      this.close();
      this.host.openSettings();
    } else if (d.nwClose !== undefined) this.close();
  }

  private trapFocus(e: KeyboardEvent): void {
    if (e.key !== 'Tab' || !this.sheet) return;
    const buttons = Array.from(
      this.host.sheet().querySelectorAll<HTMLElement>('button:not(:disabled)'),
    );
    const first = buttons[0],
      last = buttons[buttons.length - 1];
    if (e.shiftKey && document.activeElement === first) {
      e.preventDefault();
      last?.focus();
    } else if (!e.shiftKey && document.activeElement === last) {
      e.preventDefault();
      first?.focus();
    }
  }
}

export function initNews(host: NewsHost): NewsScreen {
  return new NewsScreen(host);
}
