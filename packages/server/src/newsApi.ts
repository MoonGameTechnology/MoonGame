import type { FastifyInstance } from 'fastify';
import type { NewsEvent, NewsView } from '@void/protocol';
import { newsEventOf } from './corpNews';
import type { AnnouncementStore, AvaFeedStore, FeedKind } from './store';

/**
 * CORP-1 — the PUBLIC news feed: `GET /news` answers the admin's announcements showing
 * right now and one page of public events (a corporation founded, a level, a corp medal,
 * a battle set, a battle's result), newest first. No session: the feed holds public facts
 * only, like the AvA feed it grew from (AVA-9).
 *
 *   ?limit=1..50          events per page (default 50)
 *   ?before=<at>          the next page: events strictly older than this moment
 *   ?kinds=founded,level  only these kinds of events (an unknown kind is a 400)
 *
 * Announcements come with the first page only — a «more» request wants older events,
 * not the same announcements again. The events live with the corporations; when that
 * process does not answer, the feed still serves the announcements (the game's own
 * database), with no events and nothing more to load.
 */

export interface NewsApiDeps {
  feed: Pick<AvaFeedStore, 'recent'>;
  announcements: Pick<AnnouncementStore, 'active'>;
  now?: () => number;
}

const NEWS_PAGE_MAX = 50;
const NEWS_KINDS: readonly FeedKind[] = ['founded', 'level', 'medal', 'matchup', 'result'];

export function registerNewsApi(app: FastifyInstance, deps: NewsApiDeps): void {
  const now = deps.now ?? ((): number => Date.now());
  app.get('/news', async (request, reply) => {
    const q = request.query as { limit?: string; before?: string; kinds?: string };
    const parsedLimit = Number(q.limit);
    const limit =
      q.limit !== undefined && Number.isFinite(parsedLimit)
        ? Math.min(NEWS_PAGE_MAX, Math.max(1, Math.floor(parsedLimit)))
        : NEWS_PAGE_MAX;
    const parsedBefore = Number(q.before);
    const before =
      q.before !== undefined && Number.isSafeInteger(parsedBefore) ? parsedBefore : undefined;
    const kinds = q.kinds === undefined ? undefined : q.kinds.split(',');
    if (kinds?.some((kind) => !NEWS_KINDS.includes(kind as FeedKind))) {
      return reply.code(400).send({ error: 'E_BAD_REQUEST' });
    }
    const serverNow = now();
    // One row past the page says whether older events follow.
    const rows =
      (await deps.feed
        .recent(limit + 1, before, kinds as FeedKind[] | undefined)
        .catch((error: unknown) => {
          request.log.warn({ err: error }, 'news: the corporations feed did not answer');
          return null;
        })) ?? [];
    let page = rows.slice(0, limit);
    const more = rows.length > limit;
    // The next page asks for strictly older events, so a page that ends inside one moment
    // would lose the rest of it: give that moment back whole, unless it is the whole page.
    const cut = rows[limit]?.at;
    if (cut !== undefined && page[page.length - 1]?.at === cut) {
      const kept = page.filter((row) => row.at !== cut);
      if (kept.length > 0) page = kept;
    }
    const view: NewsView = {
      serverNow,
      announcements: before === undefined ? await deps.announcements.active(serverNow) : [],
      events: page.flatMap((row): NewsEvent[] => {
        const event = newsEventOf(row);
        return event ? [event] : [];
      }),
      more,
    };
    return reply.header('cache-control', 'no-store').send(view);
  });
}
