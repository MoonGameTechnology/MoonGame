import { afterEach, describe, expect, it } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';
import type { NewsAnnouncement, NewsView } from '@void/protocol';
import { registerNewsApi } from './newsApi';
import {
  MemoryAnnouncementStore,
  MemoryAvaFeedStore,
  type AvaFeedStore,
  type FeedEntry,
} from './store';

// CORP-1 — `GET /news`: the admin's announcements showing now + one page of public events.

let app: FastifyInstance | null = null;
afterEach(async () => {
  await app?.close();
  app = null;
});

const NOW = 10_000;

function founded(id: string, at: number): FeedEntry {
  return { id, at, kind: 'founded', corpId: `c-${id}`, corpName: `Corp ${id}` };
}

function announcement(id: string, at: number, extra: Partial<NewsAnnouncement> = {}): NewsAnnouncement {
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

async function server(
  rows: FeedEntry[],
  notes: NewsAnnouncement[] = [],
  feed?: Pick<AvaFeedStore, 'recent'>,
): Promise<FastifyInstance> {
  const events = new MemoryAvaFeedStore();
  for (const row of rows) await events.append(row);
  const announcements = new MemoryAnnouncementStore();
  for (const note of notes) await announcements.add(note);
  app = Fastify();
  registerNewsApi(app, { feed: feed ?? events, announcements, now: () => NOW });
  return app;
}

async function news(s: FastifyInstance, query = ''): Promise<NewsView> {
  const res = await s.inject({ method: 'GET', url: `/news${query}` });
  expect(res.statusCode).toBe(200);
  expect(res.headers['cache-control']).toBe('no-store');
  return res.json<NewsView>();
}

describe('GET /news', () => {
  it('answers the announcements showing now and the events newest first, no session needed', async () => {
    const s = await server(
      [founded('a', 1), founded('b', 3), founded('c', 2)],
      [
        announcement('old', 1),
        announcement('new', 2, { pinned: true }),
        announcement('over', 3, { until: NOW }), // its period ended at this very moment
      ],
    );
    const view = await news(s);
    expect(view.serverNow).toBe(NOW);
    expect(view.announcements.map((a) => a.id)).toEqual(['new', 'old']);
    expect(view.events.map((e) => e.id)).toEqual(['b', 'c', 'a']);
    expect(view.events[0]).toEqual({
      id: 'b',
      at: 3,
      kind: 'founded',
      corp: { id: 'c-b', name: 'Corp b' },
    });
    expect(view.more).toBe(false);
  });

  it('pages by `before`; the announcements come with the first page only', async () => {
    const s = await server([founded('a', 1), founded('b', 2), founded('c', 3)], [announcement('x', 1)]);
    const first = await news(s, '?limit=2');
    expect(first.events.map((e) => e.id)).toEqual(['c', 'b']);
    expect(first.more).toBe(true);
    const next = await news(s, `?limit=2&before=${first.events[1]!.at}`);
    expect(next.announcements).toEqual([]);
    expect(next.events.map((e) => e.id)).toEqual(['a']);
    expect(next.more).toBe(false);
  });

  it('a page that would end inside one moment gives that moment back whole', async () => {
    const s = await server([founded('a', 1), founded('b', 2), founded('c', 2), founded('d', 3)]);
    const first = await news(s, '?limit=2');
    expect(first.events.map((e) => e.id)).toEqual(['d']);
    expect(first.more).toBe(true);
    const next = await news(s, `?limit=2&before=${first.events[0]!.at}`);
    expect(next.events.map((e) => e.id)).toEqual(['c', 'b']);
    expect(next.more).toBe(true);
    const last = await news(s, `?limit=2&before=${next.events[1]!.at}`);
    expect(last.events.map((e) => e.id)).toEqual(['a']);
    expect(last.more).toBe(false);
  });

  it('a page that is all one moment serves the moment whole, past the limit', async () => {
    // One settlement writes its result and medals at one moment; a small page must not
    // leave the rest of that moment behind a `before` cursor that skips it.
    const s = await server([founded('o', 4), founded('p', 5), founded('q', 5), founded('r', 5)]);
    const first = await news(s, '?limit=2');
    expect(first.events.map((e) => e.id)).toEqual(['r', 'q', 'p']);
    expect(first.more).toBe(true);
    const next = await news(s, `?limit=2&before=${first.events[2]!.at}`);
    expect(next.events.map((e) => e.id)).toEqual(['o']);
    expect(next.more).toBe(false);
    await app?.close();
    const only = await server([founded('p', 5), founded('q', 5), founded('r', 5)]);
    const all = await news(only, '?limit=1');
    expect(all.events.map((e) => e.id)).toEqual(['r', 'q', 'p']);
    expect(all.more).toBe(false);
  });

  it('narrows to the asked kinds; an unknown kind is a bad request', async () => {
    const s = await server([
      founded('a', 1),
      { id: 'l', at: 2, kind: 'level', corpId: 'c-a', corpName: 'Corp a', level: 2 },
      {
        id: 'r',
        at: 3,
        kind: 'result',
        challengerCorp: 'x',
        challengerName: 'X',
        targetCorp: 'y',
        targetName: 'Y',
        winnerCorp: 'x',
      },
    ]);
    expect((await news(s, '?kinds=level,result')).events.map((e) => e.id)).toEqual(['r', 'l']);
    for (const kinds of ['spam', 'level,', '']) {
      const res = await s.inject({ method: 'GET', url: `/news?kinds=${kinds}` });
      expect(res.statusCode).toBe(400);
    }
  });

  it('clamps the page size and ignores a cursor that is not a moment', async () => {
    const rows = Array.from({ length: 60 }, (_, i) => founded(`e${i}`, i + 1));
    const s = await server(rows);
    expect((await news(s, '?limit=500')).events).toHaveLength(50);
    expect((await news(s, '?limit=0')).events).toHaveLength(1);
    expect((await news(s, '?limit=abc')).events).toHaveLength(50);
    const view = await news(s, '?before=soon');
    expect(view.events[0]!.id).toBe('e59');
    expect(view.announcements).toEqual([]);
  });

  it('without the corporations the feed still serves the announcements', async () => {
    const down: Pick<AvaFeedStore, 'recent'> = {
      recent: () => Promise.reject(new Error('E_CORPORATIONS_UNAVAILABLE')),
    };
    const s = await server([], [announcement('tech', 1, { kind: 'tech' })], down);
    const view = await news(s);
    expect(view.announcements.map((a) => a.id)).toEqual(['tech']);
    expect(view.events).toEqual([]);
    expect(view.more).toBe(false);
  });
});
