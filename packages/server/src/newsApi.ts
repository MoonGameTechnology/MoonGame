import type { FastifyInstance, FastifyRequest } from 'fastify';
import type { NewsEvent, NewsView } from '@void/protocol';
import { newsEventOf } from './corpNews';
import type { AnnouncementStore, AvaFeedStore, FeedKind } from './store';
import type { MetaEconomyStore } from './metaEconomyStore';

/**
 * CORP-1 / CORP-12 — the news feed: `GET /news` answers the admin's announcements showing
 * right now and one page of public events (a corporation founded, a level, a corp medal,
 * a battle set, a battle's result), newest first. Guests receive public facts and class I
 * player medals. Classes II/III require verified current corporation membership; the
 * database filters them before the page boundary is calculated.
 *
 *   ?limit=1..50          events per page (default 50); a page never ends inside one
 *                         moment, so a moment bigger than the limit comes whole
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
  monumentsOf?(ids: readonly string[]): Promise<string[]>;
  now?: () => number;
  playerMedals?: Pick<MetaEconomyStore, 'recentPlayerMedals'>;
  identify?(request: FastifyRequest): Promise<{ accountId: string } | null>;
  membershipOf?(accountId: string): Promise<{ corpId: string; role: string } | null>;
}

const NEWS_PAGE_MAX = 50;
const NEWS_KINDS: readonly NewsEvent['kind'][] = ['founded', 'level', 'medal', 'matchup', 'result', 'player_medal'];

export function registerNewsApi(app: FastifyInstance, deps: NewsApiDeps): void {
  const now = deps.now ?? ((): number => Date.now());
  app.get('/news', async (request, reply) => {
    const q = request.query as { limit?: string; before?: string; kinds?: unknown };
    if (q.kinds !== undefined && typeof q.kinds !== 'string') {
      return reply.code(400).send({ error: 'E_BAD_REQUEST' });
    }
    const parsedLimit = Number(q.limit);
    const limit =
      q.limit !== undefined && Number.isFinite(parsedLimit)
        ? Math.min(NEWS_PAGE_MAX, Math.max(1, Math.floor(parsedLimit)))
        : NEWS_PAGE_MAX;
    const parsedBefore = Number(q.before);
    const before =
      q.before !== undefined && Number.isSafeInteger(parsedBefore) ? parsedBefore : undefined;
    const kinds = q.kinds === undefined ? undefined : q.kinds.split(',');
    if (kinds?.some((kind) => !NEWS_KINDS.includes(kind as NewsEvent['kind']))) {
      return reply.code(400).send({ error: 'E_BAD_REQUEST' });
    }
    const serverNow = now();
    let corpId: string | null = null;
    try {
      const who = request.headers.authorization ? await deps.identify?.(request) : null;
      const member = who ? await deps.membershipOf?.(who.accountId) : null;
      if (member && ['head', 'officer', 'member'].includes(member.role)) corpId = member.corpId;
    } catch {
      // No verified current membership: public events only, including during an outage.
    }
    const corpKinds = kinds?.filter((k) => k !== 'player_medal') as FeedKind[] | undefined;
    const read = async (count: number): Promise<NewsEvent[] | null> => {
      const [corp, medals] = await Promise.all([
        corpKinds?.length === 0 ? [] : deps.feed.recent(count, before, corpKinds).catch(() => deps.playerMedals ? null : []),
        deps.playerMedals && (!kinds || kinds.includes('player_medal'))
          ? deps.playerMedals.recentPlayerMedals(count, before, corpId).catch(() => null) : [],
      ]);
      // A shared cursor cannot advance past an unread source. The client keeps
      // its previous page on failure and can retry the same request.
      if (corp === null || medals === null) return null;
      return [...corp.flatMap((row) => { const e = newsEventOf(row); return e ? [e] : []; }), ...medals]
        .sort((a, b) => b.at - a.at || b.id.localeCompare(a.id)).slice(0, count);
    };
    // One row past the page says whether older events follow.
    const rows = await read(limit + 1);
    if (rows === null) return reply.code(503).send({ error: 'E_NEWS_UNAVAILABLE' });
    let page = rows.slice(0, limit);
    let more = rows.length > limit;
    // The next page asks for strictly older events, so a page that ends inside one moment
    // would lose the rest of it: that moment opens the next page whole instead.
    const cut = rows[limit]?.at;
    if (cut !== undefined && page[page.length - 1]?.at === cut) {
      const kept = page.filter((row) => row.at !== cut);
      if (kept.length > 0) page = kept;
      else {
        // The whole page is one moment (one settlement writes a result and its medals at
        // once): serve the moment whole, past the limit, up to the page bound.
        const whole = await read(NEWS_PAGE_MAX + 1);
        if (whole === null) return reply.code(503).send({ error: 'E_NEWS_UNAVAILABLE' });
        if (whole) {
          page = whole.filter((row) => row.at === cut).slice(0, NEWS_PAGE_MAX);
          more = whole.length > page.length;
        }
      }
    }
    const view: NewsView = {
      serverNow,
      announcements: before === undefined ? await deps.announcements.active(serverNow) : [],
      events: page,
      more,
    };
    const corps = view.events.flatMap((e) => e.kind === 'matchup' || e.kind === 'result' ? [e.challenger, e.target] : e.corp ? [e.corp] : []);
    const monuments = new Set(await deps.monumentsOf?.([...new Set(corps.map((c) => c.id))]).catch(() => []) ?? []);
    for (const corp of corps) if (monuments.has(corp.id)) corp.monument = true;
    return reply.header('cache-control', 'no-store').send(view);
  });
}
