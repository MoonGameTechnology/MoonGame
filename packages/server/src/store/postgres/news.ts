/** Postgres: объявления новостной ленты (SLIM-5). */
import type { NewsAnnouncement, NewsAnnouncementKind } from '@void/protocol';
import type { Pool } from 'pg';
import { type AnnouncementStore, ACTIVE_ANNOUNCEMENTS_MAX } from '../types';

interface AnnouncementRow {
  id: string;
  at: string;
  kind: string;
  pinned: boolean;
  until_at: string | null;
  title_ru: string;
  title_en: string;
  body_ru: string;
  body_en: string;
}

function announcementOf(row: AnnouncementRow): NewsAnnouncement {
  return {
    id: row.id,
    at: Number(row.at),
    kind: row.kind as NewsAnnouncementKind, // the CHECK constraint admits these three only
    pinned: row.pinned,
    until: row.until_at === null ? null : Number(row.until_at),
    title: { ru: row.title_ru, en: row.title_en },
    body: { ru: row.body_ru, en: row.body_en },
  };
}

/** Postgres admin announcements (CORP-1). A removal stamps `removed_at`; the row stays. */
export class PostgresAnnouncementStore implements AnnouncementStore {
  constructor(private readonly pool: Pool) {}

  async add(a: NewsAnnouncement): Promise<void> {
    await this.pool.query(
      `INSERT INTO announcements (id, at, kind, pinned, until_at, title_ru, title_en, body_ru, body_en)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
       ON CONFLICT (id) DO NOTHING`,
      [a.id, a.at, a.kind, a.pinned, a.until, a.title.ru, a.title.en, a.body.ru, a.body.en],
    );
  }

  async active(now: number): Promise<NewsAnnouncement[]> {
    const r = await this.pool.query<AnnouncementRow>(
      `SELECT id, at, kind, pinned, until_at, title_ru, title_en, body_ru, body_en FROM announcements
       WHERE removed_at IS NULL AND (until_at IS NULL OR until_at > $1)
       ORDER BY at DESC, id DESC LIMIT $2`,
      [now, ACTIVE_ANNOUNCEMENTS_MAX],
    );
    return r.rows.map(announcementOf);
  }

  async recent(limit: number): Promise<NewsAnnouncement[]> {
    const r = await this.pool.query<AnnouncementRow>(
      `SELECT id, at, kind, pinned, until_at, title_ru, title_en, body_ru, body_en FROM announcements
       WHERE removed_at IS NULL ORDER BY at DESC, id DESC LIMIT $1`,
      [limit],
    );
    return r.rows.map(announcementOf);
  }

  async remove(id: string, at: number): Promise<boolean> {
    const r = await this.pool.query(
      `UPDATE announcements SET removed_at = $2 WHERE id = $1 AND removed_at IS NULL`,
      [id, at],
    );
    return (r.rowCount ?? 0) === 1;
  }
}
