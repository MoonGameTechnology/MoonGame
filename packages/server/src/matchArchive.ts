import { MATCH_ARCHIVE_MS, MatchRegistry, sessionMeta } from './matchRegistry';
import type { MatchRoom } from './matchRoom';
import type { MatchSnapshot, MatchStore } from './store';

/** Expiration concerns the map viewer, never career/reward retention. */
export function archiveExpired(snapshot: MatchSnapshot, now: number): boolean {
  return snapshot.status === 'ended' &&
    (snapshot.endedAt === undefined || now >= snapshot.endedAt + MATCH_ARCHIVE_MS);
}

/** Restore frozen viewers without starting AI, clocks, rewards or snapshot writers. */
export async function restoreMatchArchives(
  registry: MatchRegistry,
  store: MatchStore,
  viewer: (snapshot: MatchSnapshot) => MatchRoom,
  now: () => number = Date.now,
): Promise<number> {
  const ids = await store.endedMatchIds?.(now() - MATCH_ARCHIVE_MS) ?? [];
  let restored = 0;
  for (const id of ids) {
    if (registry.has(id)) continue;
    const snapshot = await store.load(id);
    if (!snapshot || snapshot.status !== 'ended' || archiveExpired(snapshot, now())) continue;
    const room = viewer(snapshot);
    registry.register(room, {
      ...sessionMeta(room, {
        timeScale: snapshot.clock?.timeScale ?? 1,
        createdAt: snapshot.createdAt ?? snapshot.endedAt!,
        entryWindowMs: 0,
      }),
      endedAt: snapshot.endedAt,
    });
    restored++;
  }
  return restored;
}
