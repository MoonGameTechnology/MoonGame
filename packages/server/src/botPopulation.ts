import { hasFixedSides, playablePlayerIds, type GameData, type GameState } from '@void/shared-core';
import { BOT_ROSTER_SIZE, type BotAssignment, type BotRosterStore } from './botRoster';
import { admitSeat, seatClaim, seatConfirmAction, type ClaimRoom } from './joinSeat';
import { matchProfileProgress } from './profileCredit';
import type { ProfileStore } from './profileStore';
import type { AccountStore, MatchSnapshot, MatchStore } from './store';

export interface BotPopulationConfig {
  fillPercent: number;
  activeLimit: number;
  joinMinMs: number;
  joinMaxMs: number;
}

/** Opt-in; never allocate more than 35% of a map to persistent bots. */
export function botPopulationConfig(env: Record<string, string | undefined>): BotPopulationConfig {
  const count = (key: string, fallback: number, min: number, max: number): number => {
    const raw = env[key];
    if (raw === undefined) return fallback;
    const n = Number(raw);
    if (!/^(0|[1-9]\d*)$/.test(raw) || !Number.isSafeInteger(n) || n < min || n > max)
      throw new Error(`E_BOT_CONFIG:${key}`);
    return n;
  };
  const config = {
    fillPercent: count('BOT_FILL_PERCENT', 0, 0, 35),
    activeLimit: count('BOT_ACTIVE_LIMIT', 20, 0, BOT_ROSTER_SIZE),
    joinMinMs: count('BOT_JOIN_MIN_MS', 300_000, 1_000, 3_600_000),
    joinMaxMs: count('BOT_JOIN_MAX_MS', 900_000, 1_000, 3_600_000),
  };
  if (config.joinMaxMs < config.joinMinMs) throw new Error('E_BOT_CONFIG:BOT_JOIN_MAX_MS');
  return config;
}

export function botMatchLimit(state: GameState, fillPercent: number): number {
  return Math.floor(
    (playablePlayerIds(state).length * Math.max(0, Math.min(35, fillPercent))) / 100,
  );
}

/** One arrival per real-time interval, including the first. Re-arm only after the
 * attempt completes: no overlap, backlog or restart burst, even after an outage. */
export function startBotArrivals(args: {
  config: BotPopulationConfig;
  canJoin: () => boolean;
  join: () => Promise<unknown>;
  onError: (error: unknown) => void;
  random?: () => number;
}): { stop(): void; drain(): Promise<void> } {
  let stopped = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let inFlight: Promise<void> = Promise.resolve();
  const arm = (): void => {
    if (stopped || args.config.fillPercent === 0 || args.config.activeLimit === 0) return;
    const delay =
      args.config.joinMinMs +
      Math.floor(
        (args.random ?? Math.random)() * (args.config.joinMaxMs - args.config.joinMinMs + 1),
      );
    timer = setTimeout(() => {
      inFlight = arrive().catch(args.onError);
    }, delay);
  };
  const arrive = async (): Promise<void> => {
    if (stopped || !args.canJoin()) return;
    try {
      await args.join();
    } catch (error) {
      args.onError(error);
    }
    arm();
  };
  arm();
  return {
    stop() {
      stopped = true;
      clearTimeout(timer);
    },
    // Stop first, then let an already reserved seat finish its durable admission.
    drain: () => inFlight,
  };
}

/** Ordinary PvP only; existing participants and NPC seats never count as free. */
export function botFillSeats(
  state: GameState,
  data: Pick<GameData, 'modes'>,
  taken: ReadonlySet<string>,
  fillPercent: number,
  assigned = 0,
): string[] {
  if (
    state.match.status === 'ended' ||
    state.pve ||
    hasFixedSides(state.modeId) ||
    Object.values(state.players).some((p) => p.team !== undefined) ||
    (state.modeId !== undefined && (!data.modes[state.modeId] || data.modes[state.modeId]!.pve))
  )
    return [];
  const playable = playablePlayerIds(state);
  const count = Math.max(0, botMatchLimit(state, fillPercent) - assigned);
  if (count <= 0) return [];
  return playable
    .filter((id) => {
      const p = state.players[id]!;
      return p.status === 'active' && p.claimedAt === undefined && !p.seated && !taken.has(id);
    })
    .reverse()
    .slice(0, count);
}

/** Repairs persisted assignments, then admits at most ONE new bot per call unless
 * restored is true (startup repair only). Caller serializes arrivals. Claims and confirms
 * use the same durable authoritative actions as a human seat; no synthetic socket,
 * credentials, registration rewards or human leaderboard entry is created. */
export async function prepareBotPopulation(args: {
  matchId: string;
  room: ClaimRoom;
  bots: BotRosterStore;
  accounts: AccountStore;
  data: Pick<GameData, 'modes' | 'factions'>;
  config: BotPopulationConfig;
  restored: boolean;
  now: number;
}): Promise<BotAssignment[]> {
  const { matchId, room, bots, accounts } = args;
  let assignments = await bots.assignments(matchId);
  if (room.state.match.status === 'ended') return assignments;
  if (assignments.length && !(await bots.activeMatchIds()).includes(matchId))
    throw new Error('E_BOT_ASSIGNMENT_INACTIVE');
  const admit = async (assignment: BotAssignment): Promise<void> => {
    const player = room.state.players[assignment.playerId];
    if (!player || player.npc) throw new Error('E_BOT_SEAT_CONFLICT');
    // resolveSeat normally falls back to another free place. Restrict its candidate
    // set so a persisted bot cannot silently change sides after a partial restart.
    const resolved = await accounts.resolveSeat(
      matchId,
      assignment.login,
      [assignment.playerId],
      assignment.playerId,
    );
    if (resolved === null) {
      // A human won the account-store reservation after our free-seat read. This
      // bot never owned the seat; discard only its roster reservation, even after
      // a crash between allocation and resolveSeat. Never release the human's seat.
      await bots.cancelUnclaimedAssignment(matchId, assignment.botId);
      return;
    }
    if (resolved.playerId !== assignment.playerId) throw new Error('E_BOT_SEAT_CONFLICT');
    if (player.seated) return;
    const admitted = await admitSeat({
      matchId,
      room,
      reserved: resolved.isNew,
      release: () => accounts.releaseSeat(matchId, assignment.login),
      claim: seatClaim({
        resolved,
        claimed: player.claimedAt !== undefined,
        knownFactions: Object.keys(args.data.factions),
      }),
    });
    if (!admitted.ok) {
      if (
        room.state.players[assignment.playerId]?.claimedAt === undefined &&
        (await accounts.seatOf(matchId, assignment.login)) === null
      )
        await bots.cancelUnclaimedAssignment(matchId, assignment.botId);
      throw new Error(`E_BOT_ADMISSION:${admitted.error}`);
    }
    const action = seatConfirmAction(
      matchId,
      assignment.playerId,
      room.state.time,
      room.state.players[assignment.playerId]!.claimedAt,
    );
    const confirmed = await room.submitServerAction(assignment.playerId, action);
    if (!confirmed.ok || !room.state.players[assignment.playerId]?.seated)
      throw new Error('E_BOT_CONFIRMATION');
  };
  for (const assignment of assignments) await admit(assignment);
  assignments = await bots.assignments(matchId);
  if (!args.restored && args.config.fillPercent > 0) {
    const taken = new Set((await accounts.seatedNicks(matchId)).map((s) => s.playerId));
    const seats = botFillSeats(
      room.state,
      args.data,
      taken,
      args.config.fillPercent,
      assignments.length,
    );
    if (seats.length) {
      const existing = new Set(assignments.map((a) => a.botId));
      assignments = await bots.assign(
        matchId,
        seats.slice(0, 1),
        args.config.activeLimit,
        args.now,
      );
      for (const assignment of assignments)
        if (!existing.has(assignment.botId)) await admit(assignment);
    }
  }
  return bots.assignments(matchId);
}

/** Translate the authoritative end instant to UTC using the durable clock anchor.
 * Legacy snapshots without one use the observed time, never simulation milliseconds
 * displayed as a date in 1970. */
function endedWallTime(snapshot: MatchSnapshot, now: number): number {
  const { clock, state } = snapshot;
  if (clock && state.match.endedAt !== undefined && clock.timeScale > 0) {
    const at = Math.round(
      clock.wallTime + (state.match.endedAt - clock.gameTime) / clock.timeScale,
    );
    if (Number.isSafeInteger(at) && at >= 0 && at <= 8.64e15) return at;
  }
  return now;
}

/** Caller supplies a successfully persisted terminal snapshot. Progress commits
 * FIRST; XP/history/release commit together afterwards. Either operation can be
 * replayed after a crash without double credit. A bot whose admission never
 * confirmed cannot participate after this terminal snapshot: release it without
 * inventing XP, profile progress or history. Live snapshots never release it. */
export async function settleBotMatch(args: {
  snapshot: MatchSnapshot;
  bots: BotRosterStore;
  profiles: ProfileStore;
  accounts: Pick<AccountStore, 'seatOf'>;
  now: number;
}): Promise<void> {
  const { snapshot, bots, profiles, accounts, now } = args;
  const { matchId, state } = snapshot;
  if (state.match.status !== 'ended' || snapshot.status !== 'ended') return;
  if (!(await bots.activeMatchIds()).includes(matchId)) return;
  const assignments = await bots.assignments(matchId);
  if (assignments.some((a) => !state.players[a.playerId] || state.players[a.playerId]!.npc))
    throw new Error('E_BOT_RESULT_INCOMPLETE');
  const played: BotAssignment[] = [];
  const unplayedBotIds: string[] = [];
  for (const assignment of assignments) {
    // Allocation precedes account-store reservation. A human may have won that
    // seat and confirmed it while bot admission was still awaiting resolveSeat.
    // The terminal player's `seated` flag alone does not prove bot ownership.
    const ownedSeat = await accounts.seatOf(matchId, assignment.login);
    if (ownedSeat !== null && ownedSeat !== assignment.playerId)
      throw new Error('E_BOT_SEAT_CONFLICT');
    if (ownedSeat === assignment.playerId && state.players[assignment.playerId]!.seated)
      played.push(assignment);
    else unplayedBotIds.push(assignment.botId);
  }
  const progress = played.map((a) => ({
    accountId: a.botId,
    progress: matchProfileProgress(state, a.playerId),
  }));
  const winnerExists = !!state.match.winner || (state.match.winners?.length ?? 0) > 0;
  const endedAt = endedWallTime(snapshot, now);
  const results = played.map((a, index) => ({
    botId: a.botId,
    playerId: a.playerId,
    mapId: state.mapId ?? 'legacy',
    endedAt,
    outcome: progress[index]!.progress.wins
      ? ('win' as const)
      : winnerExists
        ? ('loss' as const)
        : ('draw' as const),
    xp: state.match.rewards?.[a.playerId]?.xp ?? 0,
    place: state.match.rewards?.[a.playerId]?.place ?? null,
  }));
  await profiles.credit(matchId, progress);
  await bots.finishMatch(matchId, results, now, unplayedBotIds);
}

/** Before admitting new matches: retain live assignments, finish committed results,
 * and release only reservations whose room provably has no durable snapshot. */
interface RecoveryDeps {
  bots: BotRosterStore;
  profiles: ProfileStore;
  accounts: AccountStore;
  matches: MatchStore;
  now: () => number;
}

export async function recoverBotPopulation(args: RecoveryDeps): Promise<void> {
  for (const matchId of await args.bots.activeMatchIds()) {
    await recoverBotMatch(args, matchId);
  }
}

/** Also used after a failed, unpublished creation; do not scan other rooms while
 * another request might still be creating them. A partial durable room stays pinned. */
export async function recoverBotMatch(args: RecoveryDeps, matchId: string): Promise<void> {
  const snapshot = await args.matches.load(matchId);
  if (snapshot) {
    await settleBotMatch({
      snapshot,
      bots: args.bots,
      profiles: args.profiles,
      accounts: args.accounts,
      now: args.now(),
    });
  } else {
    for (const assignment of await args.bots.assignments(matchId)) {
      const seat = await args.accounts.seatOf(matchId, assignment.login);
      if (seat !== null && seat !== assignment.playerId) throw new Error('E_BOT_SEAT_CONFLICT');
      await args.accounts.releaseSeat(matchId, assignment.login);
    }
    await args.bots.abandonMatch(matchId);
  }
}
