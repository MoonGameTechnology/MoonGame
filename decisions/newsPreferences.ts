/** Local feed interests: categories, corporation subscriptions and explicitly read items.
 * Membership is always supplied afresh; a pending application is not a subscription. */
import type { NewsCorp } from '../packages/protocol/src/news';
import {
  newsCategory,
  newsCorps,
  ownCorp,
  type NewsCategory,
  type NewsItem,
  type NewsMembership,
} from './newsFeed';

export const NEWS_CATEGORIES: readonly NewsCategory[] = ['ann', 'corp', 'battle', 'ach'];
export const NEWS_FOLLOW_MAX = 100;
const READ_MAX = 1000;

export interface NewsPreferences {
  categories: Record<NewsCategory, boolean>;
  own: boolean;
  scope: 'all' | 'following';
  following: NewsCorp[];
  read: string[];
}

const record = (v: unknown): Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v) ? (v as Record<string, unknown>) : {};

export function parseNewsPreferences(raw: unknown): NewsPreferences {
  const v = record(raw),
    categories = record(v.categories);
  const following = new Map<string, NewsCorp>();
  for (const raw of Array.isArray(v.following) ? v.following : []) {
    const c = record(raw);
    if (
      typeof c.id === 'string' &&
      c.id.length > 0 &&
      c.id.length <= 128 &&
      typeof c.name === 'string' &&
      c.name.length > 0 &&
      c.name.length <= 64 &&
      following.size < NEWS_FOLLOW_MAX
    )
      following.set(c.id, { id: c.id, name: c.name });
  }
  return {
    categories: {
      ann: categories.ann !== false,
      corp: categories.corp !== false,
      battle: categories.battle !== false,
      ach: categories.ach !== false,
    },
    own: v.own !== false,
    scope: v.scope === 'following' ? 'following' : 'all',
    following: [...following.values()],
    read: [
      ...new Set(
        Array.isArray(v.read)
          ? v.read.filter(
              (id): id is string =>
                typeof id === 'string' && /^(event|announcement):.{1,128}$/.test(id),
            )
          : [],
      ),
    ].slice(-READ_MAX),
  };
}

export function followsNews(
  item: NewsItem,
  prefs: NewsPreferences,
  membership: NewsMembership | null | undefined,
): boolean {
  const mine = prefs.own ? ownCorp(membership) : null;
  const ids = new Set(prefs.following.map((c) => c.id));
  if (mine) ids.add(mine);
  return newsCorps(item).some((c) => ids.has(c.id));
}

/** Announcements remain available in the subscribed feed when their category is enabled. */
export function preferredNews(
  items: readonly NewsItem[],
  prefs: NewsPreferences,
  membership: NewsMembership | null | undefined,
): NewsItem[] {
  return items.filter(
    (item) =>
      prefs.categories[newsCategory(item)] &&
      (prefs.scope === 'all' ||
        item.type === 'announcement' ||
        followsNews(item, prefs, membership)),
  );
}

const itemKey = (item: NewsItem): string => `${item.type}:${item.id}`;

export function unreadNews(
  items: readonly NewsItem[],
  prefs: NewsPreferences,
  membership: NewsMembership | null | undefined,
): NewsItem[] {
  const read = new Set(prefs.read);
  return preferredNews(items, prefs, membership).filter(
    (item) => followsNews(item, prefs, membership) && !read.has(itemKey(item)),
  );
}

/** Only rows actually shown by the chosen filters are acknowledged. IDs distinguish ties. */
export function readNews(prefs: NewsPreferences, shown: readonly NewsItem[]): NewsPreferences {
  const read = new Set(prefs.read);
  for (const item of [...shown].reverse()) {
    const key = itemKey(item);
    read.delete(key);
    read.add(key);
  }
  return { ...prefs, read: [...read].slice(-READ_MAX) };
}

export function followNewsCorp(
  prefs: NewsPreferences,
  corp: NewsCorp,
  on: boolean,
): NewsPreferences {
  const following = prefs.following.filter((c) => c.id !== corp.id);
  if (on && following.length < NEWS_FOLLOW_MAX) following.push({ id: corp.id, name: corp.name });
  return { ...prefs, following };
}
