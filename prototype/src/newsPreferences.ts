/** Account/server-scoped local interests and the settings form. No session tokens are stored. */
import {
  followNewsCorp,
  NEWS_CATEGORIES,
  NEWS_FOLLOW_MAX,
  parseNewsPreferences,
  type NewsPreferences,
} from '../../decisions/newsPreferences';
import { NEWS_FILTER_LABEL } from '../../decisions/newsFeed';
import type { NewsCorp } from '../../packages/protocol/src/news';
import { t } from '../../localization/runtime';
import { esc } from './format';
import { detach } from './detach';
import { readRaw, writeRaw } from './prefs';
import { parseCorpSummaries } from './corp';

export interface NewsPreferencesHost {
  identity(): string;
  authorizedBase(): Promise<{ base: string; token: string } | null>;
  changed(): void;
}

export class NewsPreferenceStore {
  private key = '';
  private value = parseNewsPreferences(null);
  private directory: NewsCorp[] = [];
  private state: 'idle' | 'loading' | 'ready' | 'failed' | 'guest' = 'idle';
  private query = '';
  private directoryAt = 0;
  private paintDirectory: () => void = () => {};
  constructor(private readonly host: NewsPreferencesHost) {}

  identity(): string {
    return this.host.identity();
  }

  get(): NewsPreferences {
    const key = this.identity() + '.news';
    if (this.key !== key) {
      this.key = key;
      let raw: unknown;
      try {
        raw = JSON.parse(readRaw(key) ?? 'null');
      } catch {
        raw = null;
      }
      this.value = parseNewsPreferences(raw);
      this.directory = [];
      this.state = 'idle';
      this.query = '';
    }
    return this.value;
  }

  save(value: NewsPreferences, notify = true): void {
    this.get();
    this.value = value;
    writeRaw(this.key, JSON.stringify(value));
    if (notify) this.host.changed();
  }

  private async loadDirectory(): Promise<void> {
    if (
      this.state === 'guest' ||
      (this.state === 'ready' && Date.now() - this.directoryAt >= 60_000)
    )
      this.state = 'idle';
    if (this.state !== 'idle') return;
    const key = this.identity();
    this.state = 'loading';
    try {
      const auth = await this.host.authorizedBase();
      if (key !== this.identity()) return;
      if (!auth) {
        this.state = 'guest';
        return;
      }
      const res = await fetch(`${auth.base}/corps`, {
        headers: { authorization: `Bearer ${auth.token}` },
      });
      const body = (await res.json()) as { corps?: unknown };
      if (key !== this.identity()) return;
      if (!res.ok || !Array.isArray(body?.corps)) {
        this.state = 'failed';
        return;
      }
      this.directory = parseCorpSummaries(body.corps).map((c) => ({ id: c.corpId, name: c.name }));
      this.state = 'ready';
      this.directoryAt = Date.now();
    } catch {
      if (key === this.identity()) this.state = 'failed';
    } finally {
      if (key === this.identity()) this.paintDirectory();
    }
  }

  html(): string {
    const p = this.get();
    const check = (attr: string, label: string, checked: boolean): string =>
      `<label class="news-pref-check"><input type="checkbox" ${attr}${checked ? ' checked' : ''}><span>${esc(label)}</span></label>`;
    return (
      `<div class="news-prefs">` +
      `<fieldset><legend>${esc(t('news.preferences.categories'))}</legend><div class="news-pref-topics">` +
      NEWS_CATEGORIES.map((c) =>
        check(`data-news-category="${c}"`, t(NEWS_FILTER_LABEL[c]), p.categories[c]),
      ).join('') +
      `</div></fieldset><label class="news-pref-scope">${esc(t('news.preferences.scope'))}` +
      `<select data-news-scope><option value="all"${p.scope === 'all' ? ' selected' : ''}>${esc(t('news.preferences.all'))}</option>` +
      `<option value="following"${p.scope === 'following' ? ' selected' : ''}>${esc(t('news.preferences.following'))}</option></select></label>` +
      check('data-news-own', t('news.preferences.own'), p.own) +
      `<p class="set-sub">${esc(t('news.preferences.alerts'))}</p>` +
      `<fieldset><legend>${esc(t('news.preferences.subscriptions'))}</legend>` +
      `<div data-news-followed>${this.followedHtml(p)}</div>` +
      `<label class="news-pref-search">${esc(t('news.preferences.search'))}<input type="search" data-news-search maxlength="64" value="${esc(this.query)}"></label>` +
      `<div data-news-directory aria-live="polite">${this.directoryHtml(p)}</div></fieldset>` +
      `<p class="set-sub">${esc(t('news.preferences.local'))}</p></div>`
    );
  }

  private corpButton(c: NewsCorp, followed: boolean, disabled = false): string {
    const label = t(followed ? 'news.preferences.unfollow' : 'news.preferences.follow');
    return (
      `<div class="news-pref-corp"><span>${esc(c.name)}</span>` +
      `<button type="button" class="btn-second" data-news-follow="${esc(c.id)}" aria-label="${esc(label + ': ' + c.name)}"${disabled ? ' disabled' : ''}>${esc(label)}</button></div>`
    );
  }

  private followedHtml(p: NewsPreferences): string {
    return p.following.length
      ? p.following.map((c) => this.corpButton(c, true)).join('')
      : `<p class="set-sub">${esc(t('news.preferences.none'))}</p>`;
  }

  private directoryHtml(p: NewsPreferences): string {
    if (this.state === 'idle' || this.state === 'loading')
      return `<p aria-busy="true">${esc(t('news.loading'))}</p>`;
    if (this.state === 'guest') return `<p>${esc(t('news.preferences.guest'))}</p>`;
    if (this.state === 'failed')
      return `<p>${esc(t('news.offline'))}</p><button type="button" class="btn-second" data-news-retry>${esc(t('news.preferences.retry'))}</button>`;
    const query = this.query.trim().toLocaleLowerCase();
    const corps = this.directory
      .filter(
        (c) =>
          !p.following.some((f) => f.id === c.id) && c.name.toLocaleLowerCase().includes(query),
      )
      .slice(0, 30);
    const full = p.following.length >= NEWS_FOLLOW_MAX;
    return (
      (full ? `<p>${esc(t('news.preferences.limit', { n: NEWS_FOLLOW_MAX }))}</p>` : '') +
      (corps.length
        ? corps.map((c) => this.corpButton(c, false, full)).join('')
        : `<p class="set-sub">${esc(t('news.preferences.no-results'))}</p>`)
    );
  }

  mount(root: HTMLElement): void {
    const panel = root.querySelector<HTMLElement>('.news-prefs');
    if (!panel) return;
    const updateLists = (): void => {
      const p = this.get();
      panel.querySelector<HTMLElement>('[data-news-followed]')!.innerHTML = this.followedHtml(p);
      panel.querySelector<HTMLElement>('[data-news-directory]')!.innerHTML = this.directoryHtml(p);
    };
    this.paintDirectory = () => { if (panel.isConnected) updateLists(); };
    detach('news: corporation directory', this.loadDirectory());
    panel.addEventListener('change', (e) => {
      const input = e.target as HTMLInputElement;
      const p = this.get();
      const category = NEWS_CATEGORIES.find((c) => c === input.dataset.newsCategory);
      if (category) this.save({ ...p, categories: { ...p.categories, [category]: input.checked } });
      else if (input.hasAttribute('data-news-own')) this.save({ ...p, own: input.checked });
      else if (input.hasAttribute('data-news-scope'))
        this.save({ ...p, scope: input.value === 'following' ? 'following' : 'all' });
    });
    panel.querySelector<HTMLInputElement>('[data-news-search]')?.addEventListener('input', (e) => {
      this.query = (e.target as HTMLInputElement).value;
      updateLists();
    });
    panel.addEventListener('click', (e) => {
      const button = (e.target as HTMLElement)?.closest<HTMLButtonElement>('button');
      if (!button || button.disabled) return;
      if (button.hasAttribute('data-news-retry')) {
        this.state = 'idle';
        detach('news: corporation directory', this.loadDirectory());
        updateLists();
        return;
      }
      const id = button.dataset.newsFollow;
      const p = this.get();
      const corp = [...this.directory, ...p.following].find((c) => c.id === id);
      if (!corp) return;
      this.save(followNewsCorp(p, corp, !p.following.some((c) => c.id === id)));
      updateLists();
      // IDs come from the server: compare data values, never interpolate a CSS selector.
      Array.from(panel.querySelectorAll<HTMLButtonElement>('[data-news-follow]'))
        .find((b) => b.dataset.newsFollow === id)
        ?.focus({ preventScroll: true });
    });
  }
}
