import type { SecurityAudit } from './securityAudit';
import type { ActionGate } from '@void/action-layer';
import {
  hashGameDataBundle,
  mapVictoryRules,
  type Action,
  type DomainEvent,
  type GameData,
  type GameState,
  type PlayerReward,
} from '@void/shared-core';
import { createDevMatch, MODULE_MANIFEST_VERSION } from './scenario';
import { startClockDriver, HEARTBEAT_MS, type ClockDriverHandle } from './clockDriver';
import { snapshotOf, type Stores } from './persistence';
import { nickSeatAccounts } from './commanderCredit';
import type { LoadedMatch } from './roomRegistry';
import type { MatchRoom, RoomObservation } from './matchRoom';
import { warDeclarationsFor, type AvaSessionSpec } from './avaOrchestrator';
import type { ArsenalStore, MatchSnapshot, StoredReceipt } from './store';
import { standingOrderTickActions } from './standingOrderDriver';
import { expiredSeatClaims } from './seatExpiry';
import { detach } from './detach';
import { commitMatch } from './matchCommit';

/**
 * The match-loading wiring `main.ts` hands to the LazyRoomRegistry, extracted
 * so tests can run the REAL persist/observe/driver composition instead of
 * mirroring it by hand (f8-persistence used to re-implement these closures).
 * Pure assembly over injected deps — no env reads, no listening socket.
 */
export interface MatchLoaderDeps {
  securityAudit?: SecurityAudit;
  /** Account cosmetics consume only committed terminal snapshots; also reconciles a restart. */
  onTerminalState?: (matchId: string, state: GameState) => Promise<void>;
  stores: Pick<Stores, 'store' | 'receiptStore'> &
    Partial<Pick<Stores, 'profileStore' | 'accountStore' | 'userStore'>>;
  careerAccounts?(matchId: string): Promise<Record<string, string>>;
  data: GameData;
  /** Present ⇒ every loaded room is gated (validated action.v1 envelopes). */
  gateFactory?: () => ActionGate;
  /** Wall clock (injectable for tests). */
  now?: () => number;
  /** Stall reporter — a same-instant scheduling loop wedged the world clock. */
  onStall?: (matchId: string) => void;
  /** MP-4 integrity-check reporter — the persisted match's `version.dataHash`
   *  doesn't match the currently-deployed game-data bundle (`data/*.json` was
   *  swapped out from under it). The load is refused either way; this is purely
   *  for operator visibility (defaults to a stderr line, see below). */
  onIntegrityFailure?: (matchId: string) => void;
  /** Optional per-match extras, resolved before the room is built. main.ts uses
   *  this for the AvA wiring (AVA-8): on an AvA session, PLAYER diplomacy is
   *  refused at the wire (the orchestrator owns the stances) and the match end
   *  is handed to the settlement. `null` ⇒ an ordinary match, no extras. */
  matchExtras?: (matchId: string) => Promise<MatchExtras | null>;
  /** LARS-1 live ownership read (see `MatchRoom.arsenalStore`) — shared by every
   *  loaded room (a live re-read is keyed per-account, not per-room) except one whose
   *  extras freeze the deck ({@link MatchExtras.frozenArsenal}). */
  arsenalStore?: ArsenalStore;
  /** Every room observation, tagged with its match — the UIX-4.3 push dispatcher reads
   *  joins, leaves and event batches from it. Observation-only: never feeds back. */
  onObservation?: (matchId: string, event: RoomObservation) => void;
}

/** Per-match wiring extras (see {@link MatchLoaderDeps.matchExtras}). */
export interface MatchExtras {
  /** Wire-level deny rule for player-submitted action types (server drivers pass). */
  denyPlayerActions?: (type: string) => string | null;
  /** The seats' build catalog stays as the match was created with it: the room gets no
   *  `arsenalStore`, so no LARS-1 re-read replaces it. An AvA battle locks each deck at
   *  roster lock (ARS-3), corporation handouts included (ARS-6); a live read of the
   *  personal arsenal would drop the handouts and pull in modules bought after the lock. */
  frozenArsenal?: boolean;
  /** Called once per observed room `end` (the room fires it on the terminal commit).
   *  `rewards` is the core's session-end table (SES-2: place/xp per seated player) —
   *  the ARS-4 drop roller keys its per-place roll off it. */
  onEnd?: (winner: string | null, rewards?: Record<string, PlayerReward>) => void;
  /** Called per observed domain-event batch (the raw pre-fog server-side stream, M1)
   *  — the ARS-4 salvage counter reads `battle.resolved`/`unit.died` from it. */
  onEvents?: (events: DomainEvent[]) => void;
}

/**
 * Rebuild a LIVE, fully-wired room from its durable snapshot (persist + clock
 * driver), or null if no such match exists in the store. The registry calls
 * this on demand; `dispose` persists the final state and stops the driver when
 * the match hibernates or the server stops.
 */
export function createMatchLoader(
  deps: MatchLoaderDeps,
): (matchId: string) => Promise<LoadedMatch | null> {
  const { stores, data } = deps;
  const now = deps.now ?? ((): number => Date.now());
  // MP-4: computed once (the bundle doesn't change while the process is up), not per load.
  const expectedDataHash = hashGameDataBundle(data);
  return async (matchId: string): Promise<LoadedMatch | null> => {
    const snap = await stores.store.load(matchId);
    if (!snap) return null;
    // MP-4: the match pinned the game-data bundle's hash at creation — a mismatch means
    // data/*.json was swapped out from under a LIVE match (accidental drift or tampering,
    // "подмена бандла меняет правила"). Fail-secure: refuse to resume rather than run it
    // under different rules than it started with. Snapshots with no pinned hash (persisted
    // before MP-4) skip the check — graceful degradation, not a crash.
    const pinnedHash = snap.state.version.dataHash;
    if (pinnedHash && pinnedHash !== expectedDataHash) {
      deps.onIntegrityFailure?.(matchId);
      process.stderr.write(
        `match ${matchId}: game-data integrity check failed — the deployed data/*.json ` +
          `bundle no longer matches the hash this match was created with (pinned ` +
          `${pinnedHash}, deployed ${expectedDataHash}). Refusing to load.\n`,
      );
      return null;
    }
    // Invariant #6 (module execution order = the determinism contract): a match pins
    // the module manifest version it was created under (`MODULE_MANIFEST_VERSION`,
    // `scenario.ts`) — a mismatch means `DEV_MODULES`' membership/order changed since,
    // so resuming under the new graph would silently diverge from the match's own
    // history. Fail-secure, same posture as the dataHash check above.
    const pinnedManifest = snap.state.version.manifest;
    if (pinnedManifest !== MODULE_MANIFEST_VERSION) {
      deps.onIntegrityFailure?.(matchId);
      process.stderr.write(
        `match ${matchId}: module manifest mismatch — the deployed module graph no ` +
          `longer matches the one this match was created with (pinned ${pinnedManifest}, ` +
          `deployed ${MODULE_MANIFEST_VERSION}). Refusing to load.\n`,
      );
      return null;
    }
    const initialReceipts = await stores.receiptStore.loadAll(matchId);
    const extras = (await deps.matchExtras?.(matchId)) ?? null;

    let driver: ClockDriverHandle | null = null;
    // Strict commit-before-broadcast: the room awaits this durable write of the new
    // snapshot + receipt before committing state / broadcasting the delta.
    const persist = async (snapshot: MatchSnapshot, receipt: StoredReceipt): Promise<void> => {
      await commitMatch(stores.store, stores.receiptStore, snapshot, receipt);
      if (snapshot.status === 'ended')
        detach(
          'career settlement',
          stores.profileStore?.creditCareer?.(snapshot) ?? Promise.resolve(),
        );
    };
    // The committed path already persists each action; `observe` re-arms the driver
    // (an action may have scheduled a new event the sleeping timer can't see) and
    // hands a terminal `end` to the extras hook (the AvA settlement path).
    const observe = (event: RoomObservation): void => {
      if (event.kind === 'action') driver?.reschedule();
      if (event.kind === 'end') {
        extras?.onEnd?.(event.winner, event.rewards);
        if (deps.onTerminalState)
          detach('profile progress', deps.onTerminalState(matchId, room.state));
      }
      if (event.kind === 'events') extras?.onEvents?.(event.events);
      deps.onObservation?.(matchId, event);
    };

    const victory = mapVictoryRules(snap.state.mapId);
    const room = createDevMatch(data, {
      id: matchId,
      now,
      observe,
      securityAudit: deps.securityAudit,
      persist,
      initialState: snap.state,
      initialReceipts,
      initialSeq: snap.seq,
      initialCareer: snap.career,
      careerAccounts: deps.careerAccounts
        ? await deps.careerAccounts(matchId)
        : stores.accountStore && stores.userStore
          ? await nickSeatAccounts(stores.accountStore, stores.userStore, matchId)()
          : {},
      // The mode is persisted in the state (BRW-0): without this a restart would bring an
      // AvA battle back under every-seat-for-itself rules (CORP-4). So is the map, and a
      // match on a catalogued map plays its victory rules, the table the players' host and
      // the HUD read: a corporations battle on a team map ends at that map's threshold,
      // not the core's (CORP-8). The dev scenario names no map and keeps the core's.
      config: {
        timeScale: 1,
        ...(snap.state.modeId !== undefined ? { modeId: snap.state.modeId } : {}),
        ...(victory !== undefined ? { victory } : {}),
      },
      // A room born on its own world clock resumes from the saved anchor; a room without
      // one keeps reading the wall clock as world time.
      ...(snap.clock ? { initiallyStarted: true, initialClock: snap.clock } : {}),
      gate: deps.gateFactory?.(),
      ...(extras?.denyPlayerActions ? { denyPlayerActions: extras.denyPlayerActions } : {}),
      ...(deps.arsenalStore && !extras?.frozenArsenal ? { arsenalStore: deps.arsenalStore } : {}),
    });

    if (snap.status === 'ended') await stores.profileStore?.creditCareer?.(snap);
    if (snap.state.match.status === 'ended' && deps.onTerminalState)
      await deps.onTerminalState(matchId, snap.state);

    // Re-entrancy guard for the async standing-order pass below: a slow durable submit
    // (awaiting the actor mailbox) must not overlap a later heartbeat's own pass —
    // mirrors the prototype host's `driversBusy` flag (netserver.ts).
    let standingOrdersBusy = false;
    // The 24/7 heartbeat while this match is live: fire due scheduled events with no
    // player action, persisting each advance. (While hibernated, the registry's wake
    // timer does it.) NETA2-6: `heartbeatMs` also keeps the published clock/economy
    // ticking for connected players when the schedule is momentarily empty (a fresh
    // match starts with none) — without it the real host froze on "Day 1" between
    // actions, the exact drift the prototype host already fixed with its inline driver.
    driver = startClockDriver(room, {
      onTick: ({ progressed }) => {
        const snapshot = snapshotOf(room);
        detach(
          'сохранение снапшота на тике',
          stores.store
            .save(snapshot)
            .then(() =>
              snapshot.status === 'ended'
                ? stores.profileStore?.creditCareer?.(snapshot)
                : undefined,
            ),
        );
        // Standing orders (CC-2 auto-storm / RETR-2 auto-retreat, standingOrderDriver.ts): the
        // missing "who decides, and when" half of `standingOrdersModule`. Skip on a
        // same-instant stall — submitting would emit `action` observations that
        // reschedule the driver and reset its stall guard into a 0ms spin (the driver's
        // own STALL_LIMIT already backs off; this just avoids feeding it).
        const stalled = !progressed && room.msUntilNextEvent() === 0;
        if (room.isStarted && !stalled && !standingOrdersBusy) {
          standingOrdersBusy = true;
          detach(
            'постоянные приказы',
            (async () => {
              try {
                for (const { playerId, action } of standingOrderTickActions(
                  room.state,
                  data,
                  (state: GameState, actions: readonly Action[]) =>
                    room.canApplyAll(state, actions, room.state.time),
                )) {
                  await room.submitServerAction(playerId, action);
                }
                // ENTRY-3 (правило 7): вернуть в оборот места, заявленные и не
                // подтверждённые дольше окна. Едет в той же пачке, что стоячие приказы —
                // отдельный таймер тут не нужен, а `standingOrdersBusy` уже страхует от
                // реэнтерабельности на durable-комнате.
                for (const { playerId, action } of expiredSeatClaims(room.state, room.clockScale)) {
                  await room.submitServerAction(playerId, action);
                }
              } finally {
                standingOrdersBusy = false;
              }
            })(),
          );
        }
      },
      onStall: () => deps.onStall?.(matchId),
      heartbeatMs: HEARTBEAT_MS,
    });

    const dispose = async (): Promise<void> => {
      driver?.stop();
      const final = snapshotOf(room);
      await stores.store.save(final);
      if (final.status === 'ended') await stores.profileStore?.creditCareer?.(final);
    };
    return { room, dispose };
  };
}

/** CORP-4 — the AvA orchestrator's `createRoom` sink: persist the session's first
 *  snapshot for `createMatchLoader` to raise. The room is born running on its own world
 *  clock from the map's start time: an AvA world starts at 0, and a room reading the wall
 *  clock as world time would cross the session cap on its first tick. The snapshot
 *  carries that clock's anchor across every load. */
export function createAvaRoom(deps: {
  stores: Pick<Stores, 'store'>;
  data: GameData;
  /** Wall clock (injectable for tests). */
  now?: () => number;
}): (spec: AvaSessionSpec) => Promise<void> {
  return async ({ matchId, state }) => {
    const room = createDevMatch(deps.data, {
      id: matchId,
      initialState: state,
      initiallyStarted: true,
      ...(deps.now ? { now: deps.now } : {}),
    });
    await deps.stores.store.save(snapshotOf(room));
  };
}

/** AVA-8 (S6) — open an AvA war on a live room: submit the system declarations
 *  (`warDeclarationsFor`) through the server-action path, past the wire deny that keeps
 *  players out of AvA diplomacy. True = every cross-side pair is at war (`E_SAME_STANCE`
 *  is a pair an earlier partial pass already flipped); false = retry on the next sweep. */
export async function declareAvaWar(room: MatchRoom, matchId: string): Promise<boolean> {
  let allLanded = true;
  for (const { playerId, action } of warDeclarationsFor(room.state, matchId)) {
    const r = await room.submitServerAction(playerId, action);
    if (!r.ok && r.code !== 'E_SAME_STANCE') allLanded = false;
  }
  return allLanded;
}
