import {
  NEWS_ANNOUNCEMENT_KINDS,
  NEWS_BODY_MAX,
  NEWS_TITLE_MAX,
  type NewsAnnouncement,
  type NewsAnnouncementKind,
  type NewsEvent,
  type NewsText,
} from '@void/protocol';
import type { MedalCatalog } from './medalCatalog';
import type { CorpAuditEntry, CorpFeedEntry, FeedEntry } from './store/types';

/**
 * CORP-1 — what the public news feed says about a corporation, and the admin's
 * announcements. Facts only: the server never writes a sentence (it has no locale of the
 * reader), the client builds each line from its own keys.
 *
 * Each fact's id is derived from the fact itself. The writes ride inside the transaction
 * that makes the fact true (the corp store's), and a store append is idempotent by id, so
 * a retried transaction or a replayed settlement still lands one row.
 */

/** The corporation exists. */
export function corpFoundedNews(corpId: string, corpName: string, at: number): CorpFeedEntry {
  return { id: `founded:${corpId}`, at, kind: 'founded', corpId, corpName };
}

/** A settled headquarters of level 2 and up is the corporation reaching that level: the
 *  corporation level IS the headquarters level. Level 1 is the free one every corporation
 *  starts with, so it is not news. */
export function corpLevelNews(
  corpId: string,
  corpName: string,
  audit: readonly CorpAuditEntry[],
): CorpFeedEntry[] {
  return audit.flatMap((entry): CorpFeedEntry[] => {
    if (entry.action !== 'building_complete' || entry.target !== 'headquarters') return [];
    const level = Number(entry.detail);
    if (!Number.isSafeInteger(level) || level < 2) return [];
    return [{ id: `level:${corpId}:${level}`, at: entry.at, kind: 'level', corpId, corpName, level }];
  });
}

/** The corp medals whose condition THIS settled match crossed for `corp` — a corp record
 *  grows by one match per settlement (and by one win for the winner), so «crossed now» is
 *  «equals the threshold now». A record that crossed before this feed existed is not
 *  announced late. */
export function corpMedalNews(
  corp: { corpId: string; name: string },
  stats: { matches: number; wins: number },
  won: boolean,
  catalog: MedalCatalog,
  at: number,
): CorpFeedEntry[] {
  return Object.values(catalog).flatMap((medal): CorpFeedEntry[] => {
    if (medal.scope !== 'corp') return [];
    const { type, count } = medal.condition;
    const crossed =
      type === 'corp_wins' ? won && stats.wins === count : stats.matches === count;
    if (!crossed) return [];
    return [
      {
        id: `medal:${corp.corpId}:${medal.id}`,
        at,
        kind: 'medal',
        corpId: corp.corpId,
        corpName: corp.name,
        medalId: medal.id,
      },
    ];
  });
}

/** A stored feed row as the wire shows it. A row this build cannot read (a kind from a
 *  newer build, a damaged detail) is left out rather than guessed at. */
export function newsEventOf(entry: FeedEntry): NewsEvent | null {
  switch (entry.kind) {
    case 'matchup':
      return {
        id: entry.id,
        at: entry.at,
        kind: 'matchup',
        challenger: { id: entry.challengerCorp, name: entry.challengerName },
        target: { id: entry.targetCorp, name: entry.targetName },
      };
    case 'result':
      return {
        id: entry.id,
        at: entry.at,
        kind: 'result',
        challenger: { id: entry.challengerCorp, name: entry.challengerName },
        target: { id: entry.targetCorp, name: entry.targetName },
        winner: entry.winnerCorp ?? null,
      };
    case 'founded':
      return { id: entry.id, at: entry.at, kind: 'founded', corp: { id: entry.corpId, name: entry.corpName } };
    case 'level':
      return entry.level === undefined
        ? null
        : {
            id: entry.id,
            at: entry.at,
            kind: 'level',
            corp: { id: entry.corpId, name: entry.corpName },
            level: entry.level,
          };
    case 'medal':
      return entry.medalId === undefined
        ? null
        : {
            id: entry.id,
            at: entry.at,
            kind: 'medal',
            corp: { id: entry.corpId, name: entry.corpName },
            medalId: entry.medalId,
          };
    default:
      return null;
  }
}

/** Everything an admin sends to publish an announcement; the server adds id and time. */
export type AnnouncementDraft = Omit<NewsAnnouncement, 'id' | 'at'>;

const DRAFT_KEYS = ['kind', 'pinned', 'until', 'title', 'body'];
// Control characters other than a line break have no business in a player-facing text.
// eslint-disable-next-line no-control-regex
const CONTROL = /[\u0000-\u0009\u000b-\u001f\u007f]/;

function isObject(raw: unknown): raw is Record<string, unknown> {
  return typeof raw === 'object' && raw !== null && !Array.isArray(raw);
}

/** Both languages of one text. Russian is the source and must be there (unless the field
 *  is optional); English may be empty — the client then shows the Russian. */
function textOf(raw: unknown, max: number, required: boolean, lines: boolean): NewsText | null {
  if (!isObject(raw) || Object.keys(raw).some((k) => k !== 'ru' && k !== 'en')) return null;
  const out: NewsText = { ru: '', en: '' };
  for (const lang of ['ru', 'en'] as const) {
    const value = raw[lang] ?? '';
    if (typeof value !== 'string') return null;
    const text = value.trim();
    if (text.length > max || CONTROL.test(text) || (!lines && text.includes('\n'))) return null;
    out[lang] = text;
  }
  return required && out.ru === '' ? null : out;
}

/** Fail-secure parse of an admin's announcement: an exact shape, a kind from the list,
 *  a title in Russian, bounded texts and a show period that has not already ended. */
export function parseAnnouncementDraft(raw: unknown, now: number): AnnouncementDraft | null {
  if (!isObject(raw) || Object.keys(raw).some((k) => !DRAFT_KEYS.includes(k))) return null;
  const { kind, pinned, until } = raw;
  if (typeof kind !== 'string' || !NEWS_ANNOUNCEMENT_KINDS.includes(kind as NewsAnnouncementKind)) {
    return null;
  }
  if (pinned !== undefined && typeof pinned !== 'boolean') return null;
  if (until !== undefined && until !== null && (!Number.isSafeInteger(until) || (until as number) <= now)) {
    return null;
  }
  const title = textOf(raw.title, NEWS_TITLE_MAX, true, false);
  const body = textOf(raw.body ?? {}, NEWS_BODY_MAX, false, true);
  if (!title || !body) return null;
  return {
    kind: kind as NewsAnnouncementKind,
    pinned: pinned ?? false,
    until: (until as number | null | undefined) ?? null,
    title,
    body,
  };
}
