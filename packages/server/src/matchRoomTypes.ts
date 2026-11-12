/**
 * The public shapes of `MatchRoom` (`matchRoom.ts`): its construction options, the socket
 * it talks to, what an action submission returns and the observation stream a host writes
 * to metrics. Types only — `matchRoom.ts` re-exports them, so importers keep importing
 * from there.
 */
import type {
  Action,
  Context,
  DomainEvent,
  GameData,
  GameState,
  Kernel,
  PlayerId,
  PlayerReward,
} from '@void/shared-core';
import type { ActionGate } from '@void/action-layer';
import type { ClientPerfMessage, MatchRulesCatalog } from '@void/protocol';
import type { ChatMessage } from './protocol';
import type { ArsenalStore, MatchSnapshot, StoredReceipt } from './store';
import type { CareerLedger } from './playerCareer';
import type { EphemeralStore } from './ephemeral';
import type { MatchRewardProgress } from './matchRewardProgress';
import type { MatchRewardPolicy } from './matchRewardPolicy';
import type { MatchRulesetBinding } from './rulesets/types';
import type { SecurityAudit } from './securityAudit';
import type { RulesetProjection } from './rulesets/projection';

export interface RoomPeer {
  /** `compress: false` keeps this one message out of socket compression (a `ws` option). */
  send(data: string, options?: { compress?: boolean }): void;
  close?(code?: number, reason?: string): void;
  readonly readyState?: number;
  /** Bytes queued but not yet flushed to the socket (a `ws` getter). When this
   *  backs up the peer isn't draining — the room drops it rather than grow memory
   *  unbounded. Absent (e.g. an in-memory test peer) ⇒ backpressure is not enforced. */
  readonly bufferedAmount?: number;
}

export interface MatchRoomOptions {
  id: string;
  initialState: GameState;
  ruleset?: MatchRulesetBinding;
  rulesCatalog?: MatchRulesCatalog;
  projection?: RulesetProjection;
  kernel: Kernel;
  data: GameData;
  config?: Context['config'];
  now?: () => number;
  maxPayloadBytes?: number;
  /** Lobby gate: the world clock stays FROZEN until every listed player is
   *  connected, and re-freezes if one drops (`now` is then read as raw wall-clock
   *  and only accrues while all are present). Omit ⇒ the clock runs freely. */
  waitForPlayers?: PlayerId[];
  /** Manual-start lobby: the world clock stays FROZEN until the host (the first
   *  player to connect) sends a `start` message — then it runs and never re-freezes.
   *  Snapshots carry a `lobby` roster so the client can show who's in + a Start
   *  button. Mutually exclusive with `waitForPlayers` (this takes precedence). */
  manualStart?: boolean;
  /** Start the match ALREADY RUNNING, its clock anchored at `initialState.time`
   *  and accruing scaled elapsed time from construction. With `manualStart` this
   *  resumes a restored match past its lobby (no fresh Start press); WITHOUT
   *  `manualStart` it is the no-lobby session mode (SES-2.1, Iron Order model):
   *  the world runs from the moment the session is created — a fresh world begins
   *  at Day 1 right away, a restored one continues from its saved instant, and
   *  `timeScale` applies. Omit both flags ⇒ the clock is raw wall time (the
   *  production entry seeds `initialState.time = Date.now()` instead). */
  initiallyStarted?: boolean;
  /** Durable anchor for a scaled/lobby clock; absent on legacy snapshots. */
  initialClock?: MatchSnapshot['clock'];
  initialCreatedAt?: number;
  initialEndedAt?: number;
  initialCareer?: CareerLedger;
  initialMatchRewardProgress?: MatchRewardProgress;
  matchRewardPolicy?: MatchRewardPolicy;
  initialEconomyActivity?: MatchSnapshot['economyActivity'];
  careerAccounts?: Record<string, string>;
  /** Attach `hashState(view)` to snapshots so the client can detect desync: every full
   *  snapshot (welcome, resync) and one delta per player every `STATE_HASH_EVERY_MS`.
   *  Default: on when `NODE_ENV=production` (see the constructor). */
  emitStateHash?: boolean;
  /** Fog for the HOST's own state keys. `visibleView` projects the core's keys and passes
   *  a host extension (a top-level key the host's modules keep, e.g. the prototype's
   *  `approval`: every bot's opinion of every seat) through untouched, so a host whose
   *  extension holds per-seat secrets narrows it here. Applied to every view the room
   *  sends (welcome, resync and each delta baseline) before the snapshot hash, so the
   *  client's reconstruction still hashes the same. Must be pure: return the narrowed
   *  view, leave the input untouched. Omit ⇒ the core projection alone. */
  hostFog?: (view: GameState, viewerId: PlayerId) => GameState;
  /** Reject a second LIVE connection to an already-occupied player slot, so two
   *  people cannot command the same empire. A slot frees the moment its peer
   *  disconnects, so reconnect-after-drop still works. Default false. */
  singlePeerPerPlayer?: boolean;
  /** Static team assignment (playerId → teamId): same team = allies who see each
   *  other's pings. Omit ⇒ no allies (only self sees own pings). Stopgap until a
   *  real diplomacy relation exists (then read it instead in `areAllied`). */
  teams?: Record<PlayerId, string>;
  /** Ping time-to-live in ms (default 5 minutes). */
  pingTtlMs?: number;
  /** Where ephemeral match data (pings, …) lives. Defaults to an in-memory store;
   *  swap a Redis-backed impl in to share it across server processes (the seam from
   *  docs/tech-stack.md — no room-logic change). */
  ephemeral?: EphemeralStore;
  /** Player-action deny-list (AVA-8): a WIRE rule applied in `receive` to both the
   *  bare and the gated path — return a stable reject code to refuse that action
   *  TYPE from players, or null/undefined to allow it. Server-internal drivers
   *  (`submitAction`/`submitServerAction` — AI, standing orders, the AvA war
   *  escalation) do not pass through `receive` and stay unaffected; e.g. an AvA
   *  room denies `diplomacy.declare` because the orchestrator owns the stances. */
  denyPlayerActions?: (type: string) => string | null | undefined;
  /** Action types a player may send on the BARE path (no `GATE`). Defaults to the gate's
   *  own catalog (`CLIENT_ACTION_TYPES`), so a host-issued type is refused from the wire
   *  with or without the gate. Only rooms over a toy test kernel override it. */
  clientActionTypes?: readonly string[];
  /** Observation-only room-event stream for metrics/playtest logging (M0). */
  observe?: (event: RoomObservation) => void;
  /** Accepted human chat only, after sanitizing, rate limiting and relay. The host
   *  may schedule an NPC response; server messages never re-enter this callback. */
  onChat?: (message: Readonly<ChatMessage>) => void;
  /** Server-owned speakers (for example persistent bots). Omit to disable the
   *  internal DM sender; a wire peer can never choose a different sender. */
  serverChatAllowed?: (playerId: PlayerId) => boolean;
  securityAudit?: SecurityAudit;
  /** Deterministic-replay recorder (RPL-2): receives every advance boundary the room
   *  actually executed (pure `{at}` entries — timer ticks and pre-action catch-ups)
   *  and every SUCCESSFULLY applied action (`{at, action}` at its effective instant,
   *  `max(serverNow, state.time)`). Feed the entries into `ReplayLog.steps` as-is:
   *  advance boundaries are part of the log BY CONTRACT — span accrual is float-
   *  partition-sensitive (see shared-core replay.ts), so the log must mirror what
   *  the room did, not an idealized timeline. A same-instant terminal event keeps
   *  its advance request horizon so replay executes that event. Covers players, server drivers
   *  (`submitServerAction`) and both the sync and durable apply paths. */
  record?: (step: { at: number; action?: Action }) => void;
  /** Seed the idempotency receipts (e.g. rehydrated from a ReceiptStore on restart),
   *  so an action deduped before a crash stays deduped after it. */
  initialReceipts?: ActionReceipt[];
  /** Resume the action counter (e.g. from a persisted `MatchSnapshot.seq`). Without
   *  it a restarted room restarts `seq` at 0, and an optimistic-by-seq store would
   *  drop its post-restart saves until the counter climbed back past the stored one.
   *  Default 0 (a fresh match). */
  initialSeq?: number;
  /** STRICT commit-before-broadcast (risk14). When set, a player action is routed
   *  through an async, per-room-serialized path that AWAITS this durable write of the
   *  new snapshot + receipt BEFORE committing state or broadcasting the delta — so a
   *  peer never sees state the store hasn't accepted, and a crash can't lose an acked
   *  action. A rejecting/throwing write commits nothing and the action is retriable.
   *  Omit ⇒ the current synchronous path (broadcast then persist-after via `observe`),
   *  which every existing test and the tick/driver path keep using unchanged. */
  persist?: (snapshot: MatchSnapshot, receipt: StoredReceipt) => Promise<void>;
  /** Opt-in `@void/action-layer` front-door (SV-1.1). When set, this room accepts
   *  gated `action.v1` envelope messages and refuses bare `action` messages: every
   *  action is validated → authorized → sequence-checked → deduped BEFORE the reducer,
   *  yielding stable `E_*` codes with no internal leak. `receive` must be passed the
   *  connection's `sessionId` (the transport binds it at handshake). Omit ⇒ the current
   *  bare-action path (no envelope), which every existing caller keeps using unchanged.
   *  Combining `gate` with `persist` routes an accepted action through the durable
   *  commit-before-broadcast path (serialized in the mailbox so the sequence reservation
   *  and the persist are atomic); without `persist`, the gated apply is synchronous. A
   *  server-issued `sessionId` (never client-chosen — it keys the sequence cursor and
   *  authorizes the envelope, SV-1.1-live-A) must reach `receive`. The gate's in-memory
   *  stores are bounded (SV-1.1-live-B: FIFO receipts + LRU cursors) and need NO
   *  cross-restart durability: they are keyed by the per-connection `sessionId`, so a
   *  restart or hibernation drops them exactly when the sessions they track also end — a
   *  reconnect mints a fresh `sessionId` → a fresh cursor and a fresh `actionId` namespace,
   *  so no post-loss action can hit a lost entry (verified). */
  gate?: ActionGate;
  /** Cap on retained idempotency receipts; past it the oldest are evicted (FIFO).
   *  Bounds memory for a long match — a retried action older than the last N is no
   *  longer deduped (idempotency is needed for minutes, not forever). Default 10000. */
  maxReceipts?: number;
  /** Per-player action rate limit: at most `actionRateMax` submits per
   *  `actionRateWindowMs`. A flood past it is rejected transiently (no receipt — a
   *  genuine retry after backoff still lands). Defaults: 20 per 1000ms. */
  actionRateMax?: number;
  actionRateWindowMs?: number;
  /** Wall-clock → game-clock multiplier for the running match clock (NOT the kernel's
   *  duration `config.timeScale`): >1 fast-forwards the whole world for playtests, so a
   *  real minute becomes many game-hours and fleets/builds/economy resolve on-screen.
   *  1 = real-time. Honoured whenever the clock is anchored/gated — a lobby gate
   *  (`manualStart` / `waitForPlayers`) OR the no-lobby auto-start mode
   *  (`initiallyStarted`, SES-2.1). Inert for a plain free-running room, which reads
   *  raw wall time. */
  timeScale?: number;
  /** LARS-1 — live build-catalog ownership. When set, a `unit.build` whose hull/
   *  modules aren't (yet) in the seat's boot-time arsenal snapshot (ARS-3) gets one
   *  fresh `ArsenalStore.listOf(accountId)` read before the gate gets to reject it;
   *  if the account now owns more, an internal `arsenal.sync` action (bypassing the
   *  ActionGate, like the AI/patrol drivers) refreshes `Player.arsenal` first, so a
   *  module bought mid-match is buildable without a new match. Needs the peer's
   *  `accountId` (passed to `addPeer`) and only runs on the durable (`persist`)
   *  paths — the sync itself must be a real, broadcast, hash-consistent action, not
   *  a silent state patch. No `arsenalStore`, no `accountId`, or no snapshot on the
   *  seat ⇒ unchanged ARS-3 behaviour (graceful degradation). */
  arsenalStore?: ArsenalStore;
  /**
   * PVE-5.2 — server-side orders (an AI / orchestrator) the room submits for itself
   * after each clock tick. Given the current state and the next free action sequence,
   * it returns INTENTS; the room feeds them through `submitServerAction`, so they take
   * the ordinary path — gate, reducer, receipts, broadcast — and the engine never
   * learns an AI exists.
   *
   * The room owns the call site on purpose. `tick()` is synchronous while
   * `submitServerAction` is not (on a durable room it serialises through the actor
   * mailbox, commit-before-broadcast), so a caller doing this from outside would be
   * racing the room's own commit — the exact shape of the silent-state-loss bug the
   * mailbox exists to prevent. Here the submit rides that same mailbox, and a
   * re-entrancy flag keeps a second batch from being computed on a state whose first
   * batch has not landed yet.
   *
   * Returning `[]` costs nothing, so a host can wire this unconditionally: a PvP match
   * simply produces no orders.
   */
  serverOrders?: (state: GameState, seq: number) => Action[];
}

export interface ActionReceipt {
  actionId: string;
  playerId: PlayerId;
  seq: number;
  ok: boolean;
  code?: string;
}

/** Observation-only stream of room events for metrics/playtest logging (M0). The
 *  callback never feeds back into the room — it just sees what happened. */
export type RoomObservation =
  /** `accountId` — who sits in the seat, when the handshake proved an account. SERVER-
   *  INTERNAL: a host that writes the stream to disk must not write it raw — PTM-0.2
   *  turns it into the analytics pseudonym (`analyticsActor.ts`) and drops it. */
  | { kind: 'join'; playerId: PlayerId; accountId?: string }
  | { kind: 'leave'; playerId: PlayerId }
  | { kind: 'lobby'; waiting: boolean }
  | {
      kind: 'action';
      actionId: string;
      playerId: PlayerId;
      type: string;
      ok: boolean;
      seq: number;
      code?: string;
      /** True when this action's receipt was ALREADY durably persisted by the
       *  commit-before-broadcast `persist` callback (the gated durable path). A host
       *  that persists receipts from `observe` must skip those to avoid a double write
       *  (the sync path — server drivers, ungated actions — leaves this false). */
      durable?: boolean;
    }
  /** Terminal match report. `rewards` is the session-end table the core computed
   *  (SES-2: place + XP per seated player, GDD §3.4) — the host banks each seat's XP
   *  onto its account here (EC-*: `CommanderStore.creditMatch`, idempotent per match)
   *  and the playtest JSONL carries the same table. */
  | {
      kind: 'end';
      winner: PlayerId | null;
      reason?: string;
      rewards?: Record<PlayerId, PlayerReward>;
    }
  /** The world clock could not fully reach `now` in one `advance` call. `reason`
   *  distinguishes an enormous-but-legitimate catch-up that was throttled to bound
   *  work (`throttled` — it will finish on the next advance) from a same-instant
   *  runaway where the clock stopped progressing (`stalled` — a content/module bug
   *  that needs attention). Ops should alert on `stalled`. */
  | {
      kind: 'advance_overflow';
      reachedTime: number;
      targetTime: number;
      reason: 'throttled' | 'stalled';
    }
  /** Scheduled events dead-lettered during a catch-up (their handler threw). The
   *  timeline kept moving (by design), but silence here hid real module bugs —
   *  the record must reach the host's logs (bug-hunt: failures had NO consumer). */
  | { kind: 'dead_letter'; failures: Array<{ at: number; type: string; code: string }> }
  /** Domain events that accompanied a committed change (M1) — the raw bus output
   *  BEFORE fog filtering (the observer is server-side and sees everything), so a
   *  metrics consumer can count battles/captures/arrivals. `time.advanced` spans are
   *  excluded (pure clock noise — one per broadcast would swamp the stream). */
  | { kind: 'events'; seq: number; events: DomainEvent[] }
  /** One broadcast round (M1): how long the fan-out took and the serialized size of
   *  each player's delta payload (fog efficiency — the doc target is idle < 1 KB). */
  | { kind: 'broadcast'; seq: number; ms: number; deltaBytes: Record<PlayerId, number> }
  /** Wall-clock cost of one room operation (M1): a player/server action submit
   *  (advance + apply + commit + broadcast, incl. the durable persist when configured)
   *  or an offline-heartbeat advance (`tick`). */
  | { kind: 'timing'; op: 'submit' | 'advance'; ms: number; seq: number; actionType?: string }
  /** A client reported that its reconstructed state hashed differently from the
   *  server's snapshot hash (M1). The room answers with a full resync snapshot;
   *  this record is the log half (the doc's desync-rate target is 0). */
  | { kind: 'desync'; playerId: PlayerId; atSeq: number; clientHash: string }
  /** A client perf sample (M2): smoothed fps + round-trip + JS-heap as the player's
   *  device experiences the match, plus its long frames and their worst main-thread block
   *  since the previous sample. Rate-limited at the room (floods are dropped silently —
   *  telemetry, not a conversation); values already range-checked at parse. */
  | ({ kind: 'client_perf'; playerId: PlayerId } & Omit<ClientPerfMessage, 'type'>)
  /** Hourly per-player economy snapshot (ECON-6): treasury, net hourly income and
   *  arrears at world instant `atTime`. Emitted by the HOST's wake driver (the room
   *  itself never produces it) — the type lives in the union so every observer
   *  (JSONL, aggregator) speaks one stream. Curves come from the JSONL; the
   *  aggregator keeps arrears-hours counters. */
  | {
      kind: 'economy';
      atTime: number;
      players: Record<
        PlayerId,
        { resources: Record<string, number>; netPerHour: Record<string, number>; arrears: string[] }
      >;
    };

export interface SubmitResult {
  ok: boolean;
  seq: number;
  events: DomainEvent[];
  code?: string;
}
