/** В памяти: объявления новостной ленты (SLIM-5). */
import type { NewsAnnouncement } from '@void/protocol';
import { type AnnouncementStore, ACTIVE_ANNOUNCEMENTS_MAX } from '../types';

/** In-memory admin announcements (CORP-1). */
export class MemoryAnnouncementStore implements AnnouncementStore {
  private readonly rows = new Map<string, { item: NewsAnnouncement; removedAt: number | null }>();

  add(announcement: NewsAnnouncement): Promise<void> {
    if (!this.rows.has(announcement.id))
      this.rows.set(announcement.id, { item: structuredClone(announcement), removedAt: null });
    return Promise.resolve();
  }

  active(now: number): Promise<NewsAnnouncement[]> {
    return Promise.resolve(
      this.newest()
        .filter((r) => r.removedAt === null && (r.item.until === null || r.item.until > now))
        .slice(0, ACTIVE_ANNOUNCEMENTS_MAX)
        .map((r) => structuredClone(r.item)),
    );
  }

  recent(limit: number): Promise<NewsAnnouncement[]> {
    return Promise.resolve(
      this.newest()
        .filter((r) => r.removedAt === null)
        .slice(0, limit)
        .map((r) => structuredClone(r.item)),
    );
  }

  remove(id: string, at: number): Promise<boolean> {
    const row = this.rows.get(id);
    if (!row || row.removedAt !== null) return Promise.resolve(false);
    row.removedAt = at;
    return Promise.resolve(true);
  }

  private newest(): Array<{ item: NewsAnnouncement; removedAt: number | null }> {
    return [...this.rows.values()].sort(
      (a, b) => b.item.at - a.item.at || (a.item.id < b.item.id ? 1 : -1),
    );
  }
}
