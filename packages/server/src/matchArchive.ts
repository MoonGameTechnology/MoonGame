import { MATCH_ARCHIVE_MS } from './matchRegistry';
import type { MatchRoom } from './matchRoom';
import type { MatchSnapshot, MatchStore } from './store';
import { archiveStateBytes } from './matchArchiveMetadata';
import type { RoomRegistry } from './roomRegistry';

export const ARCHIVE_ROOM_LIMIT = 8;
export const HOST_ROOM_LIMIT = 64;
export const ARCHIVE_STATE_BYTES = 2 * 1024 * 1024;
export class ArchiveCapacityError extends Error {
  constructor() { super('E_ARCHIVE_BUSY'); }
}

/** Expiration concerns the map viewer, never career/reward retention. */
export function archiveExpired(snapshot: MatchSnapshot, now: number): boolean {
  return snapshot.status === 'ended' &&
    (snapshot.endedAt === undefined || now >= snapshot.endedAt + MATCH_ARCHIVE_MS);
}

interface ArchiveEntry { room: MatchRoom; usedAt: number }
export interface ArchiveRoomCacheOptions {
  store: MatchStore;
  viewer(snapshot: MatchSnapshot): MatchRoom;
  /** Includes live/terminal hosted rooms and slots reserved by in-flight creation. */
  otherResidents(): number;
  totalRoomLimit: number;
  maxRooms?: number;
  maxStateBytes?: number;
  idleMs?: number;
  now?: () => number;
}

/** Bounded frozen viewers. The catalog is independent: listing/restarting loads
 * zero worlds. Pending loads consume slots too, before the first async operation. */
export class ArchiveRoomCache implements RoomRegistry {
  private readonly rooms = new Map<string, ArchiveEntry>();
  private readonly loading = new Map<string, Promise<MatchRoom | undefined>>();
  private hostReservations = 0;
  private readonly now: () => number;
  private readonly maxRooms: number;
  private readonly maxStateBytes: number;
  private readonly idleMs: number;
  constructor(private readonly options: ArchiveRoomCacheOptions) {
    this.now = options.now ?? Date.now;
    this.maxRooms = options.maxRooms ?? ARCHIVE_ROOM_LIMIT;
    this.maxStateBytes = options.maxStateBytes ?? ARCHIVE_STATE_BYTES;
    this.idleMs = options.idleMs ?? 60_000;
    if (![this.maxRooms, this.maxStateBytes, options.totalRoomLimit].every((n) => Number.isSafeInteger(n) && n > 0) ||
      !Number.isFinite(this.idleMs) || this.idleMs < 0) throw new Error('E_ARCHIVE_CONFIG');
  }
  /** Resident plus reserved worlds, counting an in-flight load exactly once. */
  get size(): number {
    return this.rooms.size + [...this.loading.keys()].filter((id) => !this.rooms.has(id)).length;
  }
  get residentCount(): number { return this.options.otherResidents() + this.hostReservations + this.size; }
  /** Synchronous reservation; creators release on both success and failure. */
  reserveHostRoom(): () => void {
    if (!this.makeSpaceForRoom()) throw new ArchiveCapacityError();
    this.hostReservations++;
    let held = true;
    return () => { if (held) { held = false; this.hostReservations--; } };
  }
  private remove(id: string): void {
    const entry = this.rooms.get(id);
    if (!entry) return;
    this.rooms.delete(id);
    for (const player of entry.room.connectedPlayers()) entry.room.evict(player, 'E_ENTRY_CLOSED');
  }
  get(id: string): MatchRoom | undefined {
    const entry = this.rooms.get(id);
    if (!entry) return undefined;
    if (entry.room.endedAt === undefined || this.now() >= entry.room.endedAt + MATCH_ARCHIVE_MS) {
      this.remove(id);
      return undefined;
    }
    return entry.room;
  }
  ids(): string[] { return [...this.rooms.keys()].filter((id) => this.get(id) !== undefined); }
  retain(id: string): void { this.touch(id); }
  release(id: string): void { this.touch(id); }
  private touch(id: string): void {
    const entry = this.rooms.get(id);
    if (entry) entry.usedAt = this.now();
  }
  private evictIdle(): boolean {
    const candidates = [...this.rooms.entries()].filter(([, entry]) =>
      entry.room.peerCount === 0 && this.now() - entry.usedAt >= this.idleMs);
    candidates.sort((a,b) => a[1].usedAt - b[1].usedAt || a[0].localeCompare(b[0]));
    if (!candidates[0]) return false;
    this.remove(candidates[0][0]);
    return true;
  }
  /** Reserve a live-room slot against the same total used by archive loading. */
  makeSpaceForRoom(): boolean {
    while (this.residentCount >= this.options.totalRoomLimit) {
      if (!this.evictIdle()) return false;
    }
    return true;
  }
  async resolve(id: string): Promise<MatchRoom | undefined> {
    const current = this.get(id);
    if (current) { this.touch(id); return current; }
    const pending = this.loading.get(id);
    if (pending) return pending;
    while (this.size >= this.maxRooms) if (!this.evictIdle()) throw new ArchiveCapacityError();
    if (!this.makeSpaceForRoom()) throw new ArchiveCapacityError();
    const load = this.load(id);
    this.loading.set(id, load);
    try { return await load; }
    finally { this.loading.delete(id); }
  }
  private async load(id: string): Promise<MatchRoom | undefined> {
    // No unbounded load() fallback: size/status/retention are enforced by the store
    // BEFORE PostgreSQL sends the state blob to the game process.
    const snapshot = await this.options.store.loadArchive?.(id, this.now() - MATCH_ARCHIVE_MS, this.maxStateBytes);
    if (!snapshot || snapshot.status !== 'ended' || snapshot.state.match.status !== 'ended' ||
      archiveExpired(snapshot, this.now()) || archiveStateBytes(snapshot.state) > this.maxStateBytes) return undefined;
    const room = this.options.viewer(snapshot);
    if (room.id !== id || room.state.match.status !== 'ended') throw new Error('E_ARCHIVE_STATE');
    this.rooms.set(id, { room, usedAt: this.now() });
    return this.get(id);
  }
  pruneExpired(): string[] {
    const removed: string[] = [];
    for (const [id, entry] of this.rooms) {
      if (!this.get(id) || (entry.room.peerCount === 0 && this.now() - entry.usedAt >= this.idleMs)) {
        this.remove(id);
        removed.push(id);
      }
    }
    return removed;
  }
  async shutdown(): Promise<void> {
    await Promise.allSettled([...this.loading.values()]);
    for (const id of [...this.rooms.keys()]) this.remove(id);
  }
}
