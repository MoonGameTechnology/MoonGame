import { MS_PER_DAY, type GameData, type MatchConfig } from '@void/shared-core';
import type { MatchRoom } from './matchRoom';
import type { AccountStore } from './store';

/**
 * The multi-match registry behind the main-menu match browser.
 *
 * Design invariant (docs/main-menu.md §2): NONE of this lives in `GameState`. The
 * deterministic core knows nothing about menus, maps, rules-as-metadata or archive
 * flags — that is between-match meta-state. The registry holds it BESIDE each room
 * and projects read-models (the three browser tabs) + accepts fail-secure intents
 * (archive). Identity is the lightweight nick→seat from `AccountStore` (real accounts
 * are the blocker for the full menu, docs/main-menu.md §6 — this stands in for now).
 */

/** Per-match metadata the browser shows that the simulation itself doesn't carry. */
export interface MatchMeta {
  /** Label of the map/scenario the match runs (the core drops the map id at build). */
  mapId: string;
  /** The ruleset this match runs under (time scale + victory conditions). */
  rules: MatchConfig;
  /** BRW-1: the game mode this match was created with (→ `data.modes`), copied from
   *  the match's own `MatchConfig.modeId` (PVE-0.2) rather than invented here — the
   *  browser must show the mode the room actually runs, not a label beside it. Absent
   *  ⇒ no mode (every session created before modes existed). */
  modeId?: string;
  /** Wall-clock ms the match was created — for ordering and (later) honest age. */
  createdAt: number;
  /** The world-time (`GameState.time`) the match's clock began at. "Days running" is
   *  elapsed game time = `(state.time - startedAt) / MS_PER_DAY`. Default 0 (matches
   *  that start at time 0); dev matches start at the boot instant, so without this the
   *  day count would be days-since-epoch, not days-since-start. */
  startedAt?: number;
  /** Entry window (SES-2.3): how long a NEW player may still claim a free seat, in
   *  REAL milliseconds since the session was created. Absent ⇒ no window (always
   *  joinable — the default for dev / test matches). The prototype host sets it (4
   *  real days). Measured as `state.time / rules.timeScale` (real world-uptime — see
   *  {@link MatchRegistry.entryOpen}), so it survives a restart and honours the
   *  session's time scale. A RECONNECT (a nick already holding a seat) is never
   *  gated — only a first-time claim. */
  entryWindowMs?: number;
  /** Nicks that have moved this match to their OWN archive — PER-PLAYER, not global:
   *  archiving only hides the match from that one player's Available/Active tabs. */
  archivedBy?: Set<string>;
}

/** Whether a session is played against other people or against the game (BRW-1).
 *  Decided by the SERVER from the mode preset — a client must not re-derive the rule,
 *  or two surfaces would disagree about what "PvE" means. */
export type MatchKind = 'pvp' | 'pve';

/** The mode's kind, or undefined when the match has no mode / the mode is unknown.
 *  «PvE» is defined exactly once, here: the preset carries a `pve` section. */
export function matchKind(data: GameData | undefined, modeId: string | undefined): MatchKind | undefined {
  if (!data || modeId === undefined) return undefined;
  const mode = data.modes[modeId];
  if (!mode) return undefined; // unknown mode: say nothing rather than guess "pvp"
  return mode.pve ? 'pve' : 'pvp';
}

/** One row of the match browser: a server projection (read-model), not live state. */
export interface MatchSummary {
  matchId: string;
  mapId: string;
  rules: MatchConfig;
  /** Mode id this session runs (BRW-1). Absent ⇒ the match has no mode. */
  modeId?: string;
  /** PvP or PvE, derived from the mode preset by the server. Absent when the mode is
   *  absent or unknown — the browser must read that as «режим неизвестен» and leave
   *  the row unfiltered, NOT as «PvP» (the same fail-open reading `entryOpen` needs). */
  kind?: MatchKind;
  /** In-game days elapsed (`state.time / MS_PER_DAY`, floored) — "Day N" of the match. */
  days: number;
  /** Occupied vs total seats, e.g. { seated: 1, capacity: 2 }. */
  players: { seated: number; capacity: number };
  /** Simulation status (NOT the archive flag, which is per-viewer). */
  status: 'ongoing' | 'ended';
  createdAt: number;
  /** Entry window (SES-2.3): can a NEW player still claim a free seat here? True when
   *  no window is configured. A closed window keeps the match out of `available` even
   *  if it has free seats (you cannot join it any more — only the seated may return). */
  entryOpen: boolean;
  /** Real ms until the entry window closes (0 once closed; a large sentinel when no
   *  window is configured) — for the browser to show «вход открыт ещё …». */
  entryClosesInMs: number;
}

/** The three browser tabs, projected for one viewer (by nick). */
export interface MatchLists {
  available: MatchSummary[];
  active: MatchSummary[];
  archived: MatchSummary[];
}

/** Fail-secure result of an archive/restore intent (A10: a stable code, no detail). */
export type ArchiveResult = { ok: true } | { ok: false; code: 'E_NO_MATCH' | 'E_FORBIDDEN' };

interface Entry {
  room: MatchRoom;
  meta: MatchMeta;
}

export class MatchRegistry {
  private readonly entries = new Map<string, Entry>();

  /** `data` is optional so every existing caller keeps working: without it the feed
   *  simply carries no `kind` (graceful degradation), which the browser already has
   *  to handle for an older server. */
  constructor(
    readonly accounts: AccountStore,
    private readonly data?: GameData,
  ) {}

  /** Add a match (room + its meta). Re-registering the same id replaces the entry. */
  register(room: MatchRoom, meta: MatchMeta): void {
    this.entries.set(room.id, { room, meta: { ...meta, archivedBy: meta.archivedBy ?? new Set() } });
  }

  get(id: string): MatchRoom | undefined {
    return this.entries.get(id)?.room;
  }

  has(id: string): boolean {
    return this.entries.has(id);
  }

  ids(): string[] {
    return [...this.entries.keys()];
  }

  /** Real ms the session has been running, from its game clock: `state.time` is game
   *  time accrued from creation (the prototype host starts every session at game-time
   *  0), and `rules.timeScale` is the wall→game multiplier, so `state.time / timeScale`
   *  is real elapsed world-uptime. It resumes from the persisted `state.time` after a
   *  restart (the entry window can't be reopened by bouncing the server) and pauses
   *  while a session is hibernated (idle) — the window measures real time the world
   *  actually ran, which is what «сессия открыта N дней» means. */
  private realAgeMs(entry: Entry): number {
    const scale =
      entry.meta.rules.timeScale && entry.meta.rules.timeScale > 0 ? entry.meta.rules.timeScale : 1;
    return entry.room.state.time / scale;
  }

  /** SES-2.3: may a NEW player still claim a free seat in this match? An unknown match
   *  is closed (fail-secure — you cannot claim a seat in a match that isn't here). No
   *  `entryWindowMs` ⇒ always open (dev / test default). A RECONNECT is decided by the
   *  caller (a nick already holding a seat) and never reaches this gate. */
  entryOpen(matchId: string): boolean {
    const entry = this.entries.get(matchId);
    if (!entry) return false;
    if (entry.meta.entryWindowMs === undefined) return true;
    return this.realAgeMs(entry) < entry.meta.entryWindowMs;
  }

  private async summary(entry: Entry): Promise<MatchSummary> {
    const st = entry.room.state;
    const window = entry.meta.entryWindowMs;
    const open = window === undefined || this.realAgeMs(entry) < window;
    const kind = matchKind(this.data, entry.meta.modeId);
    return {
      matchId: entry.room.id,
      mapId: entry.meta.mapId,
      rules: entry.meta.rules,
      ...(entry.meta.modeId !== undefined ? { modeId: entry.meta.modeId } : {}),
      ...(kind !== undefined ? { kind } : {}),
      days: Math.max(0, Math.floor((st.time - (entry.meta.startedAt ?? 0)) / MS_PER_DAY)),
      players: {
        seated: await this.accounts.occupiedSeats(entry.room.id),
        capacity: Object.keys(st.players).length,
      },
      status: st.match.status,
      createdAt: entry.meta.createdAt,
      entryOpen: open,
      entryClosesInMs:
        window === undefined ? Number.MAX_SAFE_INTEGER : Math.max(0, window - this.realAgeMs(entry)),
    };
  }

  /**
   * Project the three tabs for one viewer:
   *  - archived: matches the viewer moved to their own archive;
   *  - active:   matches the viewer holds a seat in (and hasn't archived);
   *  - available: joinable matches (a free seat, not ended) the viewer isn't in.
   * A full match the viewer isn't in is neither joinable nor theirs, so it is omitted.
   * Without a nick (anonymous) only Available is meaningful; Active/Archived are empty.
   */
  async list(nick: string | null): Promise<MatchLists> {
    const out: MatchLists = { available: [], active: [], archived: [] };
    for (const entry of this.entries.values()) {
      const sum = await this.summary(entry);
      if (nick && entry.meta.archivedBy?.has(nick)) {
        out.archived.push(sum);
        continue;
      }
      const seat = nick ? await this.accounts.seatOf(entry.room.id, nick) : null;
      if (seat) {
        // A seated player keeps their match on Active regardless of the entry window —
        // the window only gates NEW claims, never a return to a seat you already hold.
        out.active.push(sum);
      } else if (
        sum.status !== 'ended' &&
        sum.players.seated < sum.players.capacity &&
        sum.entryOpen
      ) {
        // Joinable only while the entry window is still open (SES-2.3): a closed-window
        // match with free seats is no longer offered to newcomers.
        out.available.push(sum);
      }
    }
    // Newest first, id as a deterministic tiebreak.
    const byNewest = (a: MatchSummary, b: MatchSummary): number =>
      b.createdAt - a.createdAt || (a.matchId < b.matchId ? -1 : a.matchId > b.matchId ? 1 : 0);
    out.available.sort(byNewest);
    out.active.sort(byNewest);
    out.archived.sort(byNewest);
    return out;
  }

  /** Move a match to a player's OWN archive. Fail-secure: unknown id → E_NO_MATCH; a
   *  nick that holds no seat in the match → E_FORBIDDEN (you archive your own matches,
   *  not strangers'). Per-player — it never affects anyone else's view. Idempotent. */
  async archive(matchId: string, nick: string): Promise<ArchiveResult> {
    const entry = this.entries.get(matchId);
    if (!entry) return { ok: false, code: 'E_NO_MATCH' };
    if (!nick || !(await this.accounts.seatOf(matchId, nick))) return { ok: false, code: 'E_FORBIDDEN' };
    (entry.meta.archivedBy ??= new Set()).add(nick);
    return { ok: true };
  }

  /** Restore a match from a player's archive (the inverse of {@link archive}). */
  async unarchive(matchId: string, nick: string): Promise<ArchiveResult> {
    const entry = this.entries.get(matchId);
    if (!entry) return { ok: false, code: 'E_NO_MATCH' };
    if (!nick || !(await this.accounts.seatOf(matchId, nick))) return { ok: false, code: 'E_FORBIDDEN' };
    entry.meta.archivedBy?.delete(nick);
    return { ok: true };
  }
}
