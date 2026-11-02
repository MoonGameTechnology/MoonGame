import { describe, expect, it } from 'vitest';
import { newsItems, type NewsMembership } from './newsFeed';
import type { NewsView } from '../packages/protocol/src/news';
import {
  parseNewsPreferences,
  preferredNews,
  unreadNews,
  readNews,
  followNewsCorp,
} from './newsPreferences';

const a = { id: 'a', name: 'Alpha' };
const b = { id: 'b', name: 'Beta' };
const membership: NewsMembership = { corpId: 'a', role: 'member' };
const view: NewsView = {
  serverNow: 100,
  more: false,
  announcements: [],
  events: [
    { id: 'a-founded', at: 10, kind: 'founded', corp: a },
    { id: 'b-founded', at: 11, kind: 'founded', corp: b },
    { id: 'battle', at: 12, kind: 'matchup', challenger: b, target: a },
  ],
};
const items = newsItems(view);

describe('news preferences and unread state', () => {
  it('defaults to the entire feed, with alerts only for actual membership', () => {
    const p = parseNewsPreferences(null);
    expect(preferredNews(items, p, null)).toEqual(items);
    expect(unreadNews(items, p, membership)).toHaveLength(2);
    expect(unreadNews(items, p, { ...membership, role: 'recruit' })).toEqual([]);
    expect(unreadNews(items, p, undefined)).toEqual([]);
  });

  it('subscriptions include both battle participants and respect disabled categories', () => {
    let p = followNewsCorp(parseNewsPreferences(null), b, true);
    p = { ...p, own: false, scope: 'following', categories: { ...p.categories, battle: false } };
    expect(preferredNews(items, p, membership).map((i) => i.id)).toEqual(['b-founded']);
    expect(unreadNews(items, p, membership).map((i) => i.id)).toEqual(['b-founded']);
    expect(followNewsCorp(p, b, false).following).toEqual([]);
  });

  it('read items stay read, but a different event at the same moment remains new', () => {
    const p = readNews(parseNewsPreferences(null), items);
    expect(unreadNews(items, p, membership)).toEqual([]);
    const another = newsItems({
      ...view,
      events: [{ id: 'another', at: 10, kind: 'founded', corp: a }],
    });
    expect(unreadNews(another, p, membership)).toHaveLength(1);
    expect(parseNewsPreferences(JSON.parse(JSON.stringify(p)))).toEqual(p);
  });

  it('does not mark filtered-out events read', () => {
    const p = {
      ...parseNewsPreferences(null),
      categories: { ann: true, corp: false, battle: true, ach: true },
    };
    const read = readNews(p, preferredNews(items, p, membership));
    expect(
      unreadNews(
        items,
        { ...read, categories: { ...read.categories, corp: true } },
        membership,
      ).map((i) => i.id),
    ).toEqual(['a-founded']);
  });

  it('validates stored values, deduplicates subscriptions and bounds read history', () => {
    const p = parseNewsPreferences({
      categories: { battle: false, corp: 'false' },
      own: 'false',
      scope: 'bad',
      following: [a, a, null, { id: 'bad', name: 4 }],
      read: ['event:a', 4, null],
    });
    expect(p.categories).toEqual({ ann: true, corp: true, battle: false, ach: true });
    expect(p.own).toBe(true);
    expect(p.scope).toBe('all');
    expect(p.following).toEqual([a]);
    expect(p.read).toEqual(['event:a']);
    expect(
      readNews({ ...p, read: Array.from({ length: 1000 }, (_, i) => `event:${i}`) }, items).read,
    ).toHaveLength(1000);
  });
});
