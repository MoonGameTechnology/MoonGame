/** В памяти: партии и квитанции действий (SLIM-5). */
import { retainedPin } from '../../rulesets/snapshot';
import {
  archiveMetadataOf,
  archiveStateBytes,
  type ArchiveSummaryMetadata,
} from '../../matchArchiveMetadata';
import { MAX_META_ACTIVITY_FACTS_PER_ROLE } from '../../metaEconomyActivity';
import type { MatchSnapshot, MatchStore, ReceiptStore, StoredReceipt } from '../types';

/** In-memory match store — the default for dev/tests (a restart still loses the
 *  match; for durability use the Postgres adapter). Clones on save so the stored
 *  snapshot can't be mutated by the live room afterwards. */
export class MemoryMatchStore implements MatchStore {
  private readonly snaps = new Map<string, MatchSnapshot>();

  hasPinnedMatches(): Promise<boolean> { return Promise.resolve([...this.snaps.values()].some(s => !!s.ruleset)); }

  economyMatchIds(after = '', limit = 100): Promise<string[]> {
    const size = Number.isSafeInteger(limit) ? Math.min(100, Math.max(1, limit)) : 100;
    return Promise.resolve([...this.snaps.keys()].filter((id) => id > after).sort().slice(0, size));
  }

  load(matchId: string): Promise<MatchSnapshot | null> {
    const snap = this.snaps.get(matchId);
    return Promise.resolve(snap ? clone(snap) : null);
  }

  loadArchive(matchId: string, since: number, maxBytes: number): Promise<MatchSnapshot | null> {
    const snapshot = this.snaps.get(matchId);
    if (!snapshot || snapshot.status !== 'ended' || snapshot.endedAt === undefined ||
      snapshot.endedAt <= since || archiveStateBytes(snapshot.state) > maxBytes) return Promise.resolve(null);
    return Promise.resolve(clone(snapshot));
  }

  archiveMetadata(ids: readonly string[], since: number): Promise<ArchiveSummaryMetadata[]> {
    const rows: ArchiveSummaryMetadata[] = [];
    for (const id of ids) {
      const snapshot = this.snaps.get(id);
      if (!snapshot || snapshot.status !== 'ended' || snapshot.endedAt === undefined || snapshot.endedAt <= since) continue;
      rows.push({ ...archiveMetadataOf(snapshot), matchId: id,
        createdAt: snapshot.createdAt ?? snapshot.endedAt, endedAt: snapshot.endedAt, seated: 0 });
    }
    return Promise.resolve(rows);
  }

  save(snapshot: MatchSnapshot): Promise<void> {
    const prepared = this.prepareSnapshot(snapshot);
    if (prepared) this.snaps.set(snapshot.matchId, prepared);
    return Promise.resolve();
  }

  saveWithReceipt(snapshot: MatchSnapshot, receipt: StoredReceipt, receipts: ReceiptStore): Promise<void> {
    if (!(receipts instanceof MemoryReceiptStore)) return Promise.reject(new Error('E_MATCH_COMMIT_BACKEND'));
    const prepared = this.prepareSnapshot(snapshot);
    if (!prepared) return Promise.reject(new Error('E_MATCH_COMMIT_STALE'));
    // Prepare both detached values before changing either map. Publishing them is
    // synchronous, so no reader or failed clone can observe half of a command.
    const publishReceipt = receipts.prepareSave(snapshot.matchId, receipt);
    this.snaps.set(snapshot.matchId, prepared);
    publishReceipt();
    return Promise.resolve();
  }

  private prepareSnapshot(snapshot: MatchSnapshot): MatchSnapshot | null {
    const prev = this.snaps.get(snapshot.matchId);
    if (!prev || snapshot.seq >= prev.seq) {
      const ruleset = retainedPin(snapshot, prev?.ruleset);
      const economyObservations = { ...snapshot.economyObservations, ...prev?.economyObservations };
      const economyActivity: Record<string, string[]> = {};
      for (const [key, ids] of Object.entries(prev?.economyActivity ?? {})) economyActivity[key] = [...ids];
      for (const [key, ids] of Object.entries(snapshot.economyActivity ?? {})) {
        economyActivity[key] = [...new Set([...(economyActivity[key] ?? []), ...ids])].slice(0, MAX_META_ACTIVITY_FACTS_PER_ROLE);
      }
      return clone({
        ...snapshot,
        ...(ruleset ? { ruleset } : {}),
        ...((snapshot.matchRewardProgress ?? prev?.matchRewardProgress)
          ? { matchRewardProgress: snapshot.matchRewardProgress ?? prev?.matchRewardProgress } : {}),
        createdAt: prev?.createdAt ?? snapshot.createdAt ?? Date.now(),
        ...(snapshot.status === 'ended'
          ? { endedAt: prev?.endedAt ?? snapshot.endedAt ?? Date.now() }
          : {}),
        ...(Object.keys(economyObservations).length ? { economyObservations } : {}),
        ...(Object.keys(economyActivity).length ? { economyActivity } : {}),
      }); // optimistic: keep the newest while retaining committed reward evidence
    }
    return null;
  }

  ongoingMatchIds(): Promise<string[]> {
    const ids: string[] = [];
    for (const snap of this.snaps.values()) if (snap.status !== 'ended') ids.push(snap.matchId);
    return Promise.resolve(ids);
  }

  endedMatchIds(since: number): Promise<string[]> {
    return Promise.resolve([...this.snaps.values()]
      .filter((s) => s.status === 'ended' && s.endedAt !== undefined && s.endedAt > since)
      .sort((a, b) => b.endedAt! - a.endedAt! || a.matchId.localeCompare(b.matchId))
      .map((s) => s.matchId));
  }

  ping(): Promise<boolean> {
    return Promise.resolve(true); // no external dependency to be down
  }
}

/** In-memory receipt store — `matchId → actionId → receipt`. */
export class MemoryReceiptStore implements ReceiptStore {
  private readonly byMatch = new Map<string, Map<string, StoredReceipt>>();

  loadAll(matchId: string): Promise<StoredReceipt[]> {
    return Promise.resolve([...(this.byMatch.get(matchId)?.values() ?? [])]);
  }

  save(matchId: string, receipt: StoredReceipt): Promise<void> {
    this.prepareSave(matchId, receipt)();
    return Promise.resolve();
  }

  /** Stage a detached receipt for the paired match adapter's synchronous commit. */
  prepareSave(matchId: string, receipt: StoredReceipt): () => void {
    const detached = structuredClone(receipt);
    const initial = this.byMatch.get(matchId) ?? new Map<string, StoredReceipt>();
    return () => {
      const current = this.byMatch.get(matchId) ?? initial;
      if (!current.has(detached.actionId)) current.set(detached.actionId, detached);
      this.byMatch.set(matchId, current);
    };
  }
}

// GameState is JSON-serializable by invariant, so a JSON round-trip is a safe clone.
function clone(snap: MatchSnapshot): MatchSnapshot {
  return JSON.parse(JSON.stringify(snap)) as MatchSnapshot;
}
