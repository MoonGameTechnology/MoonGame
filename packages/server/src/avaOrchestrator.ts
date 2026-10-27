import {
  Rng,
  buildStateFromMap,
  getStance,
  hasFixedSides,
  seedRng,
  type Action,
  type GameData,
  type GameState,
  type MatchMap,
  type PlayerArsenal,
  type SlotAssignment,
} from '@void/shared-core';
import { pickAvaMap } from './avaMapPool';
import { mergeArsenal } from './arsenal';
import type { AvaChallengeStore, AvaRosterStore, AvaSessionStore, AvaSide } from './store';

/**
 * AVA-7 — the phase-machine step S4: turn a LOCKED matchup (a frozen roster, AVA-6) into a
 * live AvA session. Server/meta, outside the deterministic core — but the STATE it produces
 * is built by the core's pure `buildStateFromMap`, so a session is reproducible from the
 * matchup id.
 *
 * Flow (`corporation-wars.md` §4): pick a symmetric AvA map big enough for the larger side
 * (`pickAvaMap`), lay each side's roster onto that side's slots (allies grouped by
 * construction, empty slots filled by a server AI bot), build the state at a PEACEFUL
 * cross-team start (S5 — the war opens later on a timer, AVA-8), and raise the room. The
 * seating (accountId → slot) is persisted as an `AvaSession` so `resolveAvaSeat` sits each
 * returning account in THEIR slot — not a first-free seat — even across a restart.
 *
 * The room build/register/persist itself is an injected `createRoom` sink, so this stays
 * pure orchestration logic — testable without `MatchRoom`/registry/persistence. The map
 * pick is seeded by the matchup id (deterministic; re-derivable for audit).
 */

export type AvaOrchestratorError = 'E_NO_MATCHUP' | 'E_NOT_LOCKED' | 'E_NO_MAP';

/** The built session the orchestrator hands `createRoom` to actually raise (build the room,
 *  register it, persist its first snapshot). */
export interface AvaSessionSpec {
  matchId: string;
  matchupId: string;
  mapId: string;
  state: GameState;
  /** accountId → the concrete playerId (slot) they play — for seat binding / occupancy. */
  seats: Record<string, string>;
}

export interface AvaOrchestratorDeps {
  challengeStore: AvaChallengeStore;
  rosterStore: AvaRosterStore;
  sessionStore: AvaSessionStore;
  data: GameData;
  /** AvA-eligible map pool (loaded + validated at boot). */
  maps: readonly MatchMap[];
  /** The module manifest the host's rooms run (`MODULE_MANIFEST_VERSION` on this server),
   *  pinned into the built state. The loader refuses a match pinned to another module
   *  graph, so a session built under a default here could never load (CORP-4). */
  manifest: string;
  /** Build + register + persist the live room. Called once per newly-raised session. */
  createRoom: (spec: AvaSessionSpec) => Promise<void>;
  /** CORP-4: no map fits a locked roster — cancel the matchup and refund the challenge
   *  (`AvaService.cancelLocked`, exactly-once by its locked→cancelled gate; true = this
   *  call cancelled it). Absent ⇒ the sweep leaves such a matchup locked. */
  cancel?: (matchupId: string) => Promise<boolean>;
  /** Injectable clock (deterministic tests + the sweep). */
  now?: () => number;
  /** AVA-8 (S6): peace-period length — the war opens `peaceMs` after the session is
   *  raised (`corporation-wars.md` MVP-дефолт: 1 timeScale-день). */
  peaceMs?: number;
  /** AVA-8 (S6): open the war on a LIVE room — submit the system war declarations
   *  (see `warDeclarationsFor`) through the room's server-action path. True = every
   *  declaration landed (the sweep then stamps the war exactly-once); false = a
   *  transient failure, retried on the next sweep. Absent ⇒ the war sweep idles. */
  escalateWar?: (matchId: string) => Promise<boolean>;
  /** The game owns active match status; no corporate call on the war-clock path. */
  isMatchEnded?: (matchId: string) => Promise<boolean>;
  /** AVA-8 (S7): settle the ended war — `AvaService.settleMatch` (archive + record +
   *  award influence, exactly-once by the matchup's locked→ended transition).
   *  Absent ⇒ `onMatchEnded` observes nothing. */
  settle?: (matchupId: string, winnerSide: AvaSide | null) => Promise<unknown>;
  /** ARS-3: the account's ownership snapshot at launch (GDD §2 «консервация деки» —
   *  the roster lock/launch IS the snapshot instant). Attached to each HUMAN seat's
   *  `SlotAssignment.arsenal`, so `unit.build`/`hero.fit` enforce `E_NOT_OWNED`
   *  in-match; bot seats stay unrestricted (the server AI builds the slot's start
   *  roster). Absent ⇒ no snapshots (seats build unrestricted, as before). */
  arsenalOf?: (accountId: string) => Promise<PlayerArsenal>;
  /** ARS-6: corp-warehouse items rented to this account for THIS matchup (handed out
   *  by a head/officer before lock) — merged into the snapshot above, so a rented
   *  hull/module builds exactly like an owned one. Absent ⇒ no corp rentals (as
   *  before ARS-6). */
  corpRentalOf?: (accountId: string, matchupId: string) => Promise<PlayerArsenal>;
}

/** MVP peace period (`corporation-wars.md` §10: 1 timeScale-день). */
const DEFAULT_PEACE_MS = 24 * 60 * 60 * 1000;

/** The two sides of a matchup, in seating order (challenger → the first team of the map). */
const SIDES: readonly AvaSide[] = ['challenger', 'target'];

/** The id an AvA battle's match is hosted under — one per matchup, so a re-raise lands on
 *  the same room and snapshot. A host tells an AvA room from an ordinary one by it. */
export const avaMatchId = (matchupId: string): string => `ava-${matchupId}`;
export const isAvaMatchId = (matchId: string): boolean => matchId.startsWith('ava-');

/**
 * Player intents a corporations battle refuses, on both hosts. The orchestrator alone moves
 * the sides from peace to war (AVA-8), and no AI plays an absent player's seat, the Steward
 * included (corporation-wars.md §7): attacks come only from a player who is in.
 */
export const avaDeniedAction = (type: string): string | null =>
  type === 'diplomacy.declare' ? 'E_AVA_DIPLOMACY' : type === 'steward.delegate' ? 'E_AVA_STEWARD' : null;

/**
 * A side's bot plays by the same refusals as a player. Its orders reach the room through
 * the server path, past the players' deny list, so the host drops what a player would be
 * refused: the AI's own war on the race leader would end the peace before the orchestrator.
 */
export const avaBotOrders = <A extends { type: string }>(orders: readonly A[]): A[] =>
  orders.filter((order) => avaDeniedAction(order.type) === null);

export interface AvaSeating {
  /** slotId → assignment, covering EVERY slot the map declares (empties get an AI bot). */
  slots: Record<string, SlotAssignment>;
  /** accountId → the playerId (= slotId) they play. Bots are not listed. */
  seats: Record<string, string>;
}

/**
 * Lay a matchup's two-sided roster onto a symmetric AvA map (pure, exported for tests):
 * each side's accounts fill that side's slots — both sorted, so the mapping is deterministic
 * and allies land on adjacent map slots (a single front). An empty slot on a side is filled
 * by a server AI bot (`corporation-wars.md`: пустые кресла играет ИИ). `playerId = slotId`,
 * so no account id leaks into the shared match state; the loadout is the slot's own start
 * kit (a personal-arsenal snapshot is deferred — see the roadmap). Precondition, guaranteed
 * by the caller's map pick: neither side has more accounts than the map gives it slots.
 */
export function seatAvaRoster(
  map: MatchMap,
  rosterBySide: Record<AvaSide, readonly string[]>,
): AvaSeating {
  const byTeam = new Map<string, string[]>();
  for (const slotId of Object.keys(map.slots).sort()) {
    const team = map.slots[slotId]!.team;
    const list = byTeam.get(team) ?? [];
    list.push(slotId);
    byTeam.set(team, list);
  }
  const teams = [...byTeam.keys()].sort(); // stable side→team: challenger → teams[0], target → teams[1]
  const slots: Record<string, SlotAssignment> = {};
  const seats: Record<string, string> = {};
  SIDES.forEach((side, i) => {
    const teamSlots = byTeam.get(teams[i] ?? '') ?? [];
    const accounts = [...rosterBySide[side]].sort();
    teamSlots.forEach((slotId, j) => {
      const account = accounts[j];
      if (account !== undefined) {
        slots[slotId] = { playerId: slotId };
        seats[account] = slotId;
      } else {
        slots[slotId] = { playerId: `bot:${slotId}`, ai: true };
      }
    });
  });
  return { slots, seats };
}

/** CORP-4 — the mode a battle of `slotsPerSide` seats a side plays under (pure, exported
 *  for tests). A team battle is a fixed-side match (`hasFixedSides`): the roster decides
 *  the sides, and every ending counts a side as one unit. One seat a side needs no mode —
 *  the base rules already pit the two seats against each other. `null`: the game has no
 *  fixed-side mode for this format, and a team battle is never played every seat for
 *  itself (fail-secure) — the orchestrator treats it like a battle no map fits. */
export function avaModeId(slotsPerSide: number): string | undefined | null {
  if (slotsPerSide <= 1) return undefined;
  const modeId = `team_${slotsPerSide}v${slotsPerSide}`;
  return hasFixedSides(modeId) ? modeId : null;
}

export class AvaOrchestrator {
  private readonly challenges: AvaChallengeStore;
  private readonly roster: AvaRosterStore;
  private readonly sessions: AvaSessionStore;
  private readonly data: GameData;
  private readonly maps: readonly MatchMap[];
  private readonly isMatchEnded?: (matchId: string) => Promise<boolean>;
  private readonly manifest: string;
  private readonly createRoom: (spec: AvaSessionSpec) => Promise<void>;
  private readonly cancel?: (matchupId: string) => Promise<boolean>;
  private readonly now: () => number;
  private readonly peaceMs: number;
  private readonly escalateWar?: (matchId: string) => Promise<boolean>;
  private readonly settle?: (matchupId: string, winnerSide: AvaSide | null) => Promise<unknown>;
  private readonly arsenalOf?: (accountId: string) => Promise<PlayerArsenal>;
  private readonly corpRentalOf?: (accountId: string, matchupId: string) => Promise<PlayerArsenal>;

  constructor(deps: AvaOrchestratorDeps) {
    this.isMatchEnded = deps.isMatchEnded;
    this.challenges = deps.challengeStore;
    this.roster = deps.rosterStore;
    this.sessions = deps.sessionStore;
    this.data = deps.data;
    this.maps = deps.maps;
    this.manifest = deps.manifest;
    this.createRoom = deps.createRoom;
    if (deps.cancel) this.cancel = deps.cancel;
    this.now = deps.now ?? ((): number => Date.now());
    this.peaceMs = deps.peaceMs ?? DEFAULT_PEACE_MS;
    if (deps.escalateWar) this.escalateWar = deps.escalateWar;
    if (deps.settle) this.settle = deps.settle;
    if (deps.arsenalOf) this.arsenalOf = deps.arsenalOf;
    if (deps.corpRentalOf) this.corpRentalOf = deps.corpRentalOf;
  }

  /** Raise the live session for a LOCKED matchup (idempotent — an already-raised matchup
   *  returns its existing session without rebuilding). Fail-secure: a missing/unlocked
   *  matchup or no map of the needed size is rejected with a stable code. */
  async orchestrate(
    matchupId: string,
  ): Promise<
    | { ok: true; matchId: string; mapId: string; seats: Record<string, string> }
    | { ok: false; code: AvaOrchestratorError }
  > {
    const existing = await this.sessions.byMatchup(matchupId);
    if (existing) {
      return { ok: true, matchId: existing.matchId, mapId: existing.mapId, seats: existing.seats };
    }
    const matchup = await this.challenges.getChallenge(matchupId);
    if (!matchup) return { ok: false, code: 'E_NO_MATCHUP' };
    if (matchup.status !== 'locked') return { ok: false, code: 'E_NOT_LOCKED' };

    const roster = await this.roster.rosterOf(matchupId);
    const bySide: Record<AvaSide, string[]> = { challenger: [], target: [] };
    for (const row of roster) bySide[row.side].push(row.accountId);

    // Pick a symmetric 2-side map big enough for the larger roster side; the shorter side's
    // spare slots become AI bots. Seeded by the matchup id → deterministic + re-derivable.
    // A team format with no fixed-side mode has no map either (CORP-4, `avaModeId`).
    const slotsPerSide = Math.max(1, bySide.challenger.length, bySide.target.length);
    const modeId = avaModeId(slotsPerSide);
    if (modeId === null) return { ok: false, code: 'E_NO_MAP' };
    const rng = new Rng(seedRng(`ava:${matchupId}`));
    const map = pickAvaMap(this.maps, 2, slotsPerSide, rng);
    if (!map) return { ok: false, code: 'E_NO_MAP' };

    const { slots, seats } = seatAvaRoster(map, bySide);
    // ARS-3: the launch IS the snapshot instant (GDD §2 «консервация деки») — each
    // HUMAN seat's assignment carries what its account owns RIGHT NOW; later meta
    // acquisitions do not reach this session (LARS-1 will add the live build path).
    // Bot seats stay unrestricted (the server AI plays the slot's start roster).
    if (this.arsenalOf) {
      for (const [accountId, slotId] of Object.entries(seats)) {
        const assignment = slots[slotId];
        if (!assignment) continue;
        const base = await this.arsenalOf(accountId);
        // ARS-6: whatever the corp handed this account for THIS war rides in too —
        // a rented item builds exactly like an owned one (the core gate can't tell
        // them apart, by design).
        const rented = this.corpRentalOf ? await this.corpRentalOf(accountId, matchupId) : null;
        assignment.arsenal = rented ? mergeArsenal(base, rented) : base;
      }
    }
    // S5 peaceful start — cross-team stances seed at `peace` (combat-lock is free from the
    // seed; the orchestrator escalates to war on a timer in AVA-8). Each seat carries its
    // side (`Player.team`), and the mode persisted in the state makes the loader run the
    // room with fixed sides (CORP-4). The map id rides in the state too (CORP-5): the
    // match browser names the battle by it and the client reads its score limit from it.
    const state: GameState = {
      ...buildStateFromMap(map, this.data, {
        slots,
        crossTeamStart: 'peace',
        manifest: this.manifest,
      }),
      mapId: map.id,
      ...(modeId !== undefined ? { modeId } : {}),
    };
    const matchId = avaMatchId(matchupId);

    // Raise the room FIRST (persist its snapshot — idempotent by match id), then record the
    // session link. If the link insert loses a race, the room is a harmless duplicate save
    // and we return the winning session.
    await this.createRoom({ matchId, matchupId, mapId: map.id, state, seats });
    const at = this.now();
    const created = await this.sessions.create({
      matchId,
      matchupId,
      mapId: map.id,
      seats,
      at,
      warAt: at + this.peaceMs, // S6: the war opens when the peace period lapses
    });
    if (!created.ok) {
      const winner = await this.sessions.byMatchup(matchupId);
      if (winner) {
        return { ok: true, matchId: winner.matchId, mapId: winner.mapId, seats: winner.seats };
      }
    }
    return { ok: true, matchId, mapId: map.id, seats };
  }

  /** AvA-aware seat resolution for the join/handshake path: an account rostered into this
   *  AvA match plays its FIXED slot (not a first-free seat); a non-rostered account is
   *  refused. Returns `null` when `matchId` is not an AvA match at all — the caller then
   *  falls back to the normal first-come seat resolver. */
  async resolveAvaSeat(
    matchId: string,
    accountId: string,
  ): Promise<{ ok: true; playerId: string } | { ok: false; code: 'E_NOT_ROSTERED' } | null> {
    const session = await this.sessions.byMatch(matchId);
    if (!session) return null;
    const playerId = session.seats[accountId];
    if (playerId === undefined) return { ok: false, code: 'E_NOT_ROSTERED' };
    return { ok: true, playerId };
  }

  /** Raise a session for every LOCKED matchup that has none yet — idempotent + restart-safe
   *  (skips those already in the session store). The host drives it on the same interval as
   *  the challenge/roster sweeps. A matchup no map fits is cancelled with a refund rather
   *  than left locked forever (CORP-4). Returns how many sessions it raised and how many
   *  matchups it cancelled this pass. */
  async sweep(): Promise<{ raised: number; cancelled: number }> {
    const locked = await this.challenges.lockedMatchups();
    let raised = 0;
    let cancelled = 0;
    for (const matchup of locked) {
      if (await this.sessions.byMatchup(matchup.id)) continue;
      const res = await this.orchestrate(matchup.id);
      if (res.ok) raised += 1;
      else if (res.code === 'E_NO_MAP' && this.cancel && (await this.cancel(matchup.id))) {
        cancelled += 1;
      }
    }
    return { raised, cancelled };
  }

  /** AVA-8 (S6) — the war sweep: for every session whose peace period lapsed, open the
   *  war on the live room (the injected `escalateWar` submits the system declarations)
   *  and stamp it exactly-once (`markWarDeclared` — a lost race or a failed escalation
   *  leaves the session queued for the next pass). A matchup already settled/ended
   *  before its war (e.g. a timeout during peace) is stamped WITHOUT escalating —
   *  flipping stances on a finished match would be noise. */
  async sweepWar(now = this.now()): Promise<{ declared: number }> {
    if (!this.escalateWar) return { declared: 0 };
    let declared = 0;
    for (const session of await this.sessions.dueWar(now)) {
      const matchup = this.isMatchEnded ? null : await this.challenges.getChallenge(session.matchupId);
      const ended = this.isMatchEnded ? await this.isMatchEnded(session.matchId) : !!matchup && matchup.status !== 'locked';
      if (ended) {
        await this.sessions.markWarDeclared(session.matchId, this.now()); // purge the queue
        continue;
      }
      if (!(await this.escalateWar(session.matchId))) continue; // transient — retry next pass
      if (await this.sessions.markWarDeclared(session.matchId, this.now())) declared += 1;
    }
    return { declared };
  }

  /** AVA-8 (S7) — the settlement hook the host calls from the room's `end` observation:
   *  a non-AvA match is ignored; an AvA one maps the winning PLAYER (a slot id, or a
   *  `bot:`-prefixed one; null = draw/tie) to its SIDE via the session's map and settles
   *  the matchup (`settle` = `AvaService.settleMatch` — exactly-once by its own gate). */
  async onMatchEnded(matchId: string, winnerPlayerId: string | null): Promise<void> {
    if (!this.settle) return;
    const session = await this.sessions.byMatch(matchId);
    if (!session) return; // not an AvA session — nothing to settle
    const map = this.maps.find((m) => m.id === session.mapId);
    const side =
      winnerPlayerId === null || !map ? null : winnerSideOf(map, winnerPlayerId);
    await this.settle(session.matchupId, side);
  }
}

/** The side a winning PLAYER id belongs to on an AvA map (pure, exported for tests).
 *  Player ids are slot ids (`seatAvaRoster`), bots carry the `bot:` prefix; the side↔team
 *  mapping is the SAME sorted-teams rule the seating used (challenger → teams[0]). An
 *  unknown player/slot yields null — the settlement records a draw rather than guessing
 *  a winner (fail-secure: influence is never awarded on a broken mapping). */
export function winnerSideOf(map: MatchMap, winnerPlayerId: string): AvaSide | null {
  const slotId = winnerPlayerId.startsWith('bot:') ? winnerPlayerId.slice(4) : winnerPlayerId;
  const team = map.slots[slotId]?.team;
  if (team === undefined) return null;
  const teams = [...new Set(Object.values(map.slots).map((s) => s.team))].sort();
  return team === teams[0] ? 'challenger' : 'target';
}

/** The system war declarations that open an AvA war (S6) — pure, exported for the host's
 *  `escalateWar` sink and tests. The war is between the two SIDES (`Player.team`, seated
 *  from the map's slots): every active cross-side pair not yet at war gets one unilateral
 *  escalation (`diplomacy.declare` toward hostile needs no consent). A map's inhabitants
 *  carry no side, so a neutral NPC keeps its peace (CORP-4). Action ids are deterministic
 *  (`ava-war:<matchId>:<a>:<b>`), so the room's idempotency receipts absorb a
 *  re-submitted batch after a partial failure. */
export function warDeclarationsFor(
  state: GameState,
  matchId: string,
): Array<{ playerId: string; action: Action }> {
  const ids = Object.keys(state.players)
    .filter((id) => state.players[id]?.status === 'active' && state.players[id]?.team !== undefined)
    .sort();
  const out: Array<{ playerId: string; action: Action }> = [];
  for (let i = 0; i < ids.length; i++) {
    for (let j = i + 1; j < ids.length; j++) {
      const [a, b] = [ids[i]!, ids[j]!];
      if (state.players[a]!.team === state.players[b]!.team) continue; // one side
      if (getStance(state, a, b) === 'war') continue; // already at war
      out.push({
        playerId: a,
        action: {
          id: `ava-war:${matchId}:${a}:${b}`,
          type: 'diplomacy.declare',
          playerId: a,
          payload: { target: b, stance: 'war' },
          issuedAt: state.time,
        },
      });
    }
  }
  return out;
}
