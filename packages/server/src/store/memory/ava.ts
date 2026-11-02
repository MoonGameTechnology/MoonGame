/** В памяти: битвы альянсов (AvA) — вызовы, составы, итоги, медали, лента, сессии (SLIM-5). */
import {
  type AvaChallenge,
  type AvaChallengeStore,
  type AvaFeedStore,
  type AvaResult,
  type AvaResultStore,
  type AvaRosterEntry,
  type AvaRosterStore,
  type AvaSession,
  type AvaSessionStore,
  type AvaSide,
  type AvaTally,
  type FeedEntry,
  type FeedKind,
  type MatchStore,
  type Medal,
  type MedalStore,
  DEFAULT_FEED_LIMIT,
  DEFAULT_CHALLENGES_LIMIT,
  DEFAULT_LOCKED_MATCHUPS_LIMIT,
  DEFAULT_RESULTS_LIMIT,
} from '../types';

/** In-memory AvA challenge store (AVA-4) — a map plus the two structural
 *  invariants: one pending per challenger→target pair, exactly-once close. */
export class MemoryAvaChallengeStore implements AvaChallengeStore {
  private readonly rows = new Map<string, AvaChallenge>();

  createChallenge(
    challenge: AvaChallenge,
  ): Promise<{ ok: true } | { ok: false; code: 'E_ALREADY_CHALLENGED' }> {
    for (const row of this.rows.values()) {
      if (
        row.status === 'pending' &&
        row.challengerCorp === challenge.challengerCorp &&
        row.targetCorp === challenge.targetCorp
      ) {
        return Promise.resolve({ ok: false, code: 'E_ALREADY_CHALLENGED' });
      }
    }
    this.rows.set(challenge.id, { ...challenge });
    return Promise.resolve({ ok: true });
  }

  getChallenge(id: string): Promise<AvaChallenge | null> {
    const row = this.rows.get(id);
    return Promise.resolve(row ? { ...row } : null);
  }

  challengesOf(corpId: string, limit = DEFAULT_CHALLENGES_LIMIT): Promise<AvaChallenge[]> {
    const mine = [...this.rows.values()]
      .filter((r) => r.challengerCorp === corpId || r.targetCorp === corpId)
      .sort((a, b) => b.createdAt - a.createdAt || (a.id < b.id ? -1 : 1));
    return Promise.resolve(mine.slice(0, limit).map((r) => ({ ...r })));
  }

  closeChallenge(id: string, status: 'accepted' | 'declined' | 'expired'): Promise<boolean> {
    const row = this.rows.get(id);
    if (!row || row.status !== 'pending') return Promise.resolve(false);
    row.status = status;
    return Promise.resolve(true);
  }

  duePending(now: number): Promise<AvaChallenge[]> {
    return Promise.resolve(
      [...this.rows.values()]
        .filter((r) => r.status === 'pending' && r.expiresAt <= now)
        .sort((a, b) => a.expiresAt - b.expiresAt || (a.id < b.id ? -1 : 1))
        .map((r) => ({ ...r })),
    );
  }

  openRosterWindow(id: string, pauseEndsAt: number): Promise<void> {
    const row = this.rows.get(id);
    if (row && row.status === 'accepted') row.pauseEndsAt = pauseEndsAt;
    return Promise.resolve();
  }

  closeMatchup(id: string, status: 'locked' | 'cancelled'): Promise<boolean> {
    const row = this.rows.get(id);
    if (!row || row.status !== 'accepted') return Promise.resolve(false);
    row.status = status;
    return Promise.resolve(true);
  }

  dueRosters(now: number): Promise<AvaChallenge[]> {
    return Promise.resolve(
      [...this.rows.values()]
        .filter((r) => r.status === 'accepted' && r.pauseEndsAt !== undefined && r.pauseEndsAt <= now)
        .sort((a, b) => (a.pauseEndsAt ?? 0) - (b.pauseEndsAt ?? 0) || (a.id < b.id ? -1 : 1))
        .map((r) => ({ ...r })),
    );
  }

  lockedMatchups(limit = DEFAULT_LOCKED_MATCHUPS_LIMIT): Promise<AvaChallenge[]> {
    return Promise.resolve(
      [...this.rows.values()]
        .filter((r) => r.status === 'locked')
        .sort((a, b) => b.createdAt - a.createdAt || (a.id < b.id ? -1 : 1))
        .slice(0, limit)
        .map((r) => ({ ...r })),
    );
  }

  endMatchup(id: string, status: 'ended' | 'cancelled' = 'ended'): Promise<boolean> {
    const row = this.rows.get(id);
    if (!row || row.status !== 'locked') return Promise.resolve(false);
    row.status = status;
    return Promise.resolve(true);
  }
}

/** In-memory AvA result store (AVA-8) — `matchupId → result`, keyed idempotently. */
export class MemoryAvaResultStore implements AvaResultStore {
  private readonly rows = new Map<string, AvaResult>();

  record(result: AvaResult): Promise<void> {
    // The locked→ended transition guarantees one call per matchup; keep the first
    // write should it ever be called twice (idempotent by matchupId).
    if (!this.rows.has(result.matchupId)) this.rows.set(result.matchupId, structuredClone(result));
    return Promise.resolve();
  }

  get(matchupId: string): Promise<AvaResult | null> {
    const row = this.rows.get(matchupId);
    return Promise.resolve(row ? structuredClone(row) : null);
  }

  recent(limit = DEFAULT_RESULTS_LIMIT): Promise<AvaResult[]> {
    return Promise.resolve(this.newest().slice(0, limit).map((r) => structuredClone(r)));
  }

  resultsOf(
    corpId: string,
    limit = DEFAULT_RESULTS_LIMIT,
  ): Promise<Array<AvaResult & { format: number }>> {
    return Promise.resolve(
      this.newest()
        .filter((r) => r.challengerCorp === corpId || r.targetCorp === corpId)
        .slice(0, limit)
        .map((r) => ({ ...structuredClone(r), format: r.format ?? 2 })),
    );
  }

  tallyOf(corpId: string): Promise<AvaTally[]> {
    const byKey = new Map<string, AvaTally>();
    for (const r of this.rows.values()) {
      if (r.challengerCorp !== corpId && r.targetCorp !== corpId) continue;
      const opponent = r.challengerCorp === corpId ? r.targetCorp : r.challengerCorp;
      const format = r.format ?? 2;
      const key = `${opponent}\u0000${format}`;
      const row = byKey.get(key) ?? { opponent, format, wins: 0, losses: 0, draws: 0 };
      if (r.winnerCorp === null) row.draws += 1;
      else if (r.winnerCorp === corpId) row.wins += 1;
      else row.losses += 1;
      byKey.set(key, row);
    }
    return Promise.resolve(
      [...byKey.values()].sort((a, b) =>
        a.opponent < b.opponent ? -1 : a.opponent > b.opponent ? 1 : a.format - b.format,
      ),
    );
  }

  private newest(): AvaResult[] {
    return [...this.rows.values()].sort(
      (a, b) => b.at - a.at || (a.matchupId < b.matchupId ? -1 : 1),
    );
  }

  statsForCorp(corpId: string): Promise<{ matches: number; wins: number }> {
    let matches = 0;
    let wins = 0;
    for (const r of this.rows.values()) {
      if (r.challengerCorp === corpId || r.targetCorp === corpId) matches += 1;
      if (r.winnerCorp === corpId) wins += 1;
    }
    return Promise.resolve({ matches, wins });
  }
}

/** In-memory medal store (MED-1) — `accountId → medalId → medal`; the nested key is the
 *  one-per-(account,medal) idempotency invariant. */
export class MemoryMedalStore implements MedalStore {
  private readonly byAccount = new Map<string, Map<string, Medal>>();

  grant(medal: Medal): Promise<boolean> {
    let mine = this.byAccount.get(medal.accountId);
    if (!mine) {
      mine = new Map();
      this.byAccount.set(medal.accountId, mine);
    }
    if (mine.has(medal.medalId)) return Promise.resolve(false); // already earned — no dup
    mine.set(medal.medalId, { ...medal });
    return Promise.resolve(true);
  }

  has(accountId: string, medalId: string): Promise<boolean> {
    return Promise.resolve(this.byAccount.get(accountId)?.has(medalId) ?? false);
  }

  medalsOf(accountId: string): Promise<Medal[]> {
    return Promise.resolve(
      [...(this.byAccount.get(accountId)?.values() ?? [])]
        .sort((a, b) => b.at - a.at || (a.medalId < b.medalId ? -1 : 1))
        .map((m) => ({ ...m })),
    );
  }
}

/** In-memory AvA feed store (AVA-9) — an append-only list, read newest-first. */
export class MemoryAvaFeedStore implements AvaFeedStore {
  private readonly rows: FeedEntry[] = [];

  append(entry: FeedEntry): Promise<void> {
    // Idempotent by id, like the Postgres `ON CONFLICT (id) DO NOTHING`.
    if (!this.rows.some((r) => r.id === entry.id)) this.rows.push({ ...entry });
    return Promise.resolve();
  }

  recent(limit = DEFAULT_FEED_LIMIT, before?: number, kinds?: readonly FeedKind[]): Promise<FeedEntry[]> {
    return Promise.resolve(
      this.rows
        .filter((r) => (before === undefined || r.at < before) && (!kinds || kinds.includes(r.kind)))
        .sort((a, b) => b.at - a.at || (a.id < b.id ? 1 : -1))
        .slice(0, limit)
        .map((r) => ({ ...r })),
    );
  }
}

/** In-memory AvA session store (AVA-7) — `matchId → session`, with a secondary index by
 *  matchup so `create` can enforce one session per matchup as well as per match. */
export class MemoryAvaSessionStore implements AvaSessionStore {
  private readonly delivered = new Set<string>();
  constructor(private readonly matches?: MatchStore) {}
  async pendingResults(limit = 100): Promise<Array<{ matchId: string; matchupId: string; winner: string | null }>> {
    const pending: Array<{ matchId: string; matchupId: string; winner: string | null }> = [];
    if (!this.matches) return pending;
    for (const session of this.byMatchId.values()) {
      if (this.delivered.has(session.matchId)) continue;
      const snap = await this.matches.load(session.matchId);
      if (snap?.status === 'ended') pending.push({ matchId: session.matchId, matchupId: session.matchupId, winner: snap.state.match.winner ?? null });
      if (pending.length >= limit) break;
    }
    return pending;
  }
  markResultDelivered(matchId: string): Promise<void> { this.delivered.add(matchId); return Promise.resolve(); }

  private readonly byMatchId = new Map<string, AvaSession>();
  private readonly byMatchupId = new Map<string, AvaSession>();

  create(session: AvaSession): Promise<{ ok: true } | { ok: false; code: 'E_SESSION_EXISTS' }> {
    if (this.byMatchId.has(session.matchId) || this.byMatchupId.has(session.matchupId)) {
      return Promise.resolve({ ok: false, code: 'E_SESSION_EXISTS' });
    }
    const row: AvaSession = { ...session, seats: { ...session.seats } };
    this.byMatchId.set(session.matchId, row);
    this.byMatchupId.set(session.matchupId, row);
    return Promise.resolve({ ok: true });
  }

  byMatch(matchId: string): Promise<AvaSession | null> {
    const row = this.byMatchId.get(matchId);
    return Promise.resolve(row ? { ...row, seats: { ...row.seats } } : null);
  }

  byMatchup(matchupId: string): Promise<AvaSession | null> {
    const row = this.byMatchupId.get(matchupId);
    return Promise.resolve(row ? { ...row, seats: { ...row.seats } } : null);
  }

  dueWar(now: number): Promise<AvaSession[]> {
    return Promise.resolve(
      [...this.byMatchId.values()]
        .filter((r) => r.warAt !== undefined && r.warAt <= now && r.warDeclaredAt === undefined)
        .sort((a, b) => (a.warAt ?? 0) - (b.warAt ?? 0) || (a.matchId < b.matchId ? -1 : 1))
        .map((r) => ({ ...r, seats: { ...r.seats } })),
    );
  }

  markWarDeclared(matchId: string, at: number): Promise<boolean> {
    const row = this.byMatchId.get(matchId);
    if (!row || row.warAt === undefined || row.warDeclaredAt !== undefined) {
      return Promise.resolve(false);
    }
    row.warDeclaredAt = at;
    return Promise.resolve(true);
  }
}

/** In-memory AvA roster store (AVA-6) — `matchupId → accountId → entry`, plus the
 *  two structural invariants: one row per (matchup, account), guarded per-side cap. */
export class MemoryAvaRosterStore implements AvaRosterStore {
  private readonly byMatchup = new Map<string, Map<string, AvaRosterEntry>>();

  addEntry(
    entry: AvaRosterEntry,
    capPerSide: number,
  ): Promise<{ ok: true } | { ok: false; code: 'E_ALREADY_ROSTERED' | 'E_ROSTER_FULL' }> {
    let rows = this.byMatchup.get(entry.matchupId);
    if (!rows) {
      rows = new Map();
      this.byMatchup.set(entry.matchupId, rows);
    }
    if (rows.has(entry.accountId)) {
      return Promise.resolve({ ok: false, code: 'E_ALREADY_ROSTERED' });
    }
    const onSide = [...rows.values()].filter((r) => r.side === entry.side).length;
    if (onSide >= capPerSide) return Promise.resolve({ ok: false, code: 'E_ROSTER_FULL' });
    rows.set(entry.accountId, { ...entry });
    return Promise.resolve({ ok: true });
  }

  replaceSide(matchupId: string, side: AvaSide, entries: AvaRosterEntry[]): Promise<void> {
    let rows = this.byMatchup.get(matchupId);
    if (!rows) {
      rows = new Map();
      this.byMatchup.set(matchupId, rows);
    }
    for (const [accountId, row] of rows) {
      if (row.side === side) rows.delete(accountId);
    }
    for (const entry of entries) rows.set(entry.accountId, { ...entry });
    return Promise.resolve();
  }

  rosterOf(matchupId: string): Promise<AvaRosterEntry[]> {
    return Promise.resolve(
      [...(this.byMatchup.get(matchupId)?.values() ?? [])]
        .sort((a, b) => (a.side < b.side ? -1 : a.side > b.side ? 1 : a.accountId < b.accountId ? -1 : 1))
        .map((r) => ({ ...r })),
    );
  }
}
