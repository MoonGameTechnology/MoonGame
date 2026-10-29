/**
 * CORP-1 — the public news feed (`GET /news`). Facts, never sentences: the client builds
 * every line from its own locale keys, so an English-speaking player reads the feed in
 * English. The one exception is an announcement — the admin's own words, written in both
 * languages up front (the client falls back to Russian when the English is left empty).
 */

export type NewsAnnouncementKind = 'tech' | 'update' | 'event';
export const NEWS_ANNOUNCEMENT_KINDS: readonly NewsAnnouncementKind[] = ['tech', 'update', 'event'];

/** Longest announcement title and body, per language. */
export const NEWS_TITLE_MAX = 120;
export const NEWS_BODY_MAX = 600;

export interface NewsText {
  ru: string;
  en: string;
}

export interface NewsAnnouncement {
  id: string;
  at: number;
  kind: NewsAnnouncementKind;
  /** Pinned: shown above the events while it lasts. */
  pinned: boolean;
  /** Shown until this moment (exclusive); null — until an admin removes it. */
  until: number | null;
  title: NewsText;
  body: NewsText;
}

/** A corporation as the event saw it: the name is the one it had at that moment. */
export interface NewsCorp {
  id: string;
  name: string;
  monument?: boolean;
}

export type NewsEvent =
  | { id: string; at: number; kind: 'founded'; corp: NewsCorp }
  /** The corporation reached this level (= its headquarters level, 2 and up). */
  | { id: string; at: number; kind: 'level'; corp: NewsCorp; level: number }
  /** The corporation's battle record reached the condition of this corp medal. */
  | { id: string; at: number; kind: 'medal'; corp: NewsCorp; medalId: string }
  /** A battle between two corporations is set (the challenge was accepted). */
  | { id: string; at: number; kind: 'matchup'; challenger: NewsCorp; target: NewsCorp }
  /** A battle ended; `winner` is a corp id, null for a draw. */
  | {
      id: string;
      at: number;
      kind: 'result';
      challenger: NewsCorp;
      target: NewsCorp;
      winner: string | null;
    };

export interface NewsView {
  serverNow: number;
  /** Announcements showing right now, newest first. Only on the first page (no `before`). */
  announcements: NewsAnnouncement[];
  /** One page of events, newest first; the next page is `?before=<at of the last one>`. */
  events: NewsEvent[];
  /** Older events may follow: ask for the next page. */
  more: boolean;
}
