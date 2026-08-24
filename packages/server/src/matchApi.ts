import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import type { MatchRegistry } from './matchRegistry';
import { slidingWindowIpLimiter } from './rateLimit';

/**
 * SV-2.4 — the minimal match create/join HTTP API, so players can actually enter a match
 * on the authenticated path: create a match, then exchange your identity for a join token
 * that gates the WebSocket handshake (SE-0.1).
 *
 * Identity comes through the optional `identify` hook. When wired (login+password accounts,
 * SE-1.x — see authApi.ts), BOTH routes require a valid `Authorization: Bearer <session>`:
 * create is a logged-in action, and join claims the seat for the SESSION'S account (its
 * login is the nick) — a `?nick=` query can no longer impersonate anyone. Without `identify`
 * (dev harness), the legacy first-come `?nick=` behaviour applies, which is NOT an
 * authorization boundary. Upgrading to external identity (OIDC) stays a later brick.
 */

export interface CreatedMatch {
  matchId: string;
  /** The seat player ids a client can `join` (e.g. `['green', 'red']`). */
  seats: string[];
}

export interface JoinResult {
  playerId: string;
  /** A short-lived join token to pass as `?token=` on the WS handshake. */
  token: string;
}

/** A stable failure from `join`, mapped to an HTTP status by the route. `E_NOT_ROSTERED`
 *  is the AvA path (AVA-7): the match is an AvA session and the caller is not on its roster.
 *  `E_ENTRY_CLOSED` is the SES-2.3 entry window: a login that does not already hold a seat is
 *  refused once the window has closed (the join impl checks `seatOf` before assigning a chair). */
export type JoinFailure = {
  error: 'E_NO_MATCH' | 'E_MATCH_FULL' | 'E_AUTH_DISABLED' | 'E_NOT_ROSTERED' | 'E_ENTRY_CLOSED';
};

/** An authenticated caller, as resolved by the `identify` hook. */
export interface Identity {
  accountId: string;
  login: string;
}

export interface MatchApiDeps {
  /** Seed + persist a new match; returns its id and seat player ids. Optional: when absent
   *  the `POST /matches` route is not registered — a host that only seeds matches out of band
   *  (e.g. the playtest netserver) exposes join without a public create. */
  createMatch?(): Promise<CreatedMatch>;
  /** Resolve `nick` to a seat in `matchId` and mint its join token, or a stable failure:
   *  the match does not exist, every seat is taken, or token auth is not configured.
   *  `accountId` is stamped into the join token when the caller is authenticated.
   *  `preferredSlot` (REL-7): the player's chosen slot id (e.g. "p3"); the server
   *  reserves it if free, falls back to any free slot if not. */
  join(matchId: string, nick: string, accountId?: string, preferredSlot?: string, preferredFaction?: string): Promise<JoinResult | JoinFailure>;
  /** Resolve the caller's identity from the request (session token), or null when the
   *  request carries no valid session. Wired ⇒ create/join REQUIRE identity (401 E_AUTH)
   *  and the session's login IS the nick. Absent ⇒ legacy `?nick=` dev behaviour. */
  identify?(request: FastifyRequest): Promise<Identity | null>;
  /** Injectable clock + limits for the per-IP rate limit (deterministic tests). */
  now?: () => number;
  rateMax?: number;
  rateWindowMs?: number;
}

const STATUS: Record<JoinFailure['error'], number> = {
  E_NO_MATCH: 404,
  E_MATCH_FULL: 409,
  E_NOT_ROSTERED: 403,
  E_ENTRY_CLOSED: 403,
  E_AUTH_DISABLED: 501,
};

/** Both write routes mutate durable state (seed a match, claim a seat), so both sit
 *  behind a per-IP sliding-window rate limit — a create/join-spray brake mirroring the
 *  auth API's limiter. A bounded map (oldest window evicted first) keeps an
 *  address-spraying client from growing memory. */
const RATE_MAX = 30; // create+join attempts per IP per window (shared budget)
const RATE_WINDOW_MS = 60_000;
const RATE_MAX_IPS = 10_000;

export function registerMatchApi(app: FastifyInstance, deps: MatchApiDeps): void {
  const identify = deps.identify;
  const now = deps.now ?? ((): number => Date.now());
  const rateMax = deps.rateMax ?? RATE_MAX;
  const rateWindowMs = deps.rateWindowMs ?? RATE_WINDOW_MS;
  const rateLimited = slidingWindowIpLimiter({
    now,
    max: rateMax,
    windowMs: rateWindowMs,
    maxIps: RATE_MAX_IPS,
  });

  // Only mounted when the host seeds matches through the API. A host that seeds out of
  // band (netserver) omits `createMatch` and gets the join route alone.
  const createMatch = deps.createMatch;
  if (createMatch) {
    app.post('/matches', async (request: FastifyRequest, reply: FastifyReply) => {
      if (rateLimited(request.ip)) {
        void reply.code(429);
        return { error: 'E_RATE_LIMIT' as const };
      }
      if (identify && !(await identify(request))) {
        void reply.code(401);
        return { error: 'E_AUTH' as const };
      }
      return createMatch();
    });
  }

  app.get('/matches/:id/join', async (request: FastifyRequest, reply: FastifyReply) => {
    if (rateLimited(request.ip)) {
      void reply.code(429);
      return { error: 'E_RATE_LIMIT' as const };
    }
    const { id } = request.params as { id: string };
    if (identify) {
      // Authenticated path: the seat belongs to the SESSION's account — a query nick
      // is ignored, so nobody joins as somebody else.
      const who = await identify(request);
      if (!who) {
        void reply.code(401);
        return { error: 'E_AUTH' as const };
      }
      const slot = (request.query as { slot?: string }).slot;
      const faction = (request.query as { faction?: string }).faction;
      const result = await deps.join(id, who.login, who.accountId, slot, faction);
      if ('error' in result) void reply.code(STATUS[result.error]);
      return result;
    }
    const nick = (request.query as { nick?: string }).nick;
    if (typeof nick !== 'string' || nick.trim() === '') {
      void reply.code(400);
      return { error: 'E_NICK_REQUIRED' as const };
    }
    const result = await deps.join(id, nick.trim());
    if ('error' in result) void reply.code(STATUS[result.error]);
    return result;
  });
}

/** One open match as the feed reports it. */
export interface OpenMatch {
  matchId: string;
  seated: number;
  capacity: number;
}

export interface OpenMatchesFeedDeps {
  /** Every ongoing match id (durable — from the store, so hibernated matches count too). */
  listOngoing(): Promise<string[]>;
  /** Occupied seat count for a match. */
  occupiedSeats(matchId: string): Promise<number>;
  /** Seats per match — a match at this occupancy is full and omitted from the feed. */
  capacity: number;
}

/**
 * SV-2.5 — the open-matches feed: `GET /matches/open` lists every ongoing match that
 * still has a free seat, straight from the durable store (so it survives restarts and
 * shows hibernated matches, not only the rooms live in memory). Public and read-only —
 * browsing precedes login; joining still needs a session (SE-1.x). Distinct from the
 * prototype browser's 3-tab `GET /matches`, so both can coexist.
 */
export function registerOpenMatchesFeed(app: FastifyInstance, deps: OpenMatchesFeedDeps): void {
  app.get('/matches/open', async () => {
    const ids = await deps.listOngoing();
    const open: OpenMatch[] = [];
    for (const matchId of ids) {
      const seated = await deps.occupiedSeats(matchId);
      if (seated < deps.capacity) open.push({ matchId, seated, capacity: deps.capacity });
    }
    return { open };
  });
}

/** One seat of a match, as the pre-join picker reads it (REL-7). */
export interface SeatView {
  playerId: string;
  name: string;
  faction: string;
  /** The seat's homeworld id — the fog-sensitive field, see {@link registerSeatsApi}. */
  start: string | null;
  taken: boolean;
}

/** A match's seating, as the host knows it — independent of who is asking. */
export interface SeatLayout {
  seats: SeatView[];
  /** The simulation is over: no chair here is claimable any more. */
  ended: boolean;
}

export interface SeatsApiDeps {
  /** The match's seat layout, or null when there is no such match. */
  seats(matchId: string): Promise<SeatLayout | null>;
  /** SES-2.3 entry window: may a NEWCOMER still claim a seat in this match? Unknown
   *  match ⇒ false (fail-secure), mirroring `MatchRegistry.entryOpen`. */
  entryOpen(matchId: string): boolean | Promise<boolean>;
  /** The seat this login already holds in the match, or null when it holds none. */
  seatOf(matchId: string, login: string): Promise<string | null>;
  /** The same identity hook `registerMatchApi` takes: a verified session, or null.
   *  Absent ⇒ the legacy `?nick=` host (see the authorization note below). */
  identify?(request: FastifyRequest): Promise<Identity | null>;
}

/**
 * ADDR-6 — `GET /matches/:id/seats`: the seat layout, and who may read it.
 *
 * The layout exists for pre-join seat picking (REL-7): before entering, a player needs
 * to see which chairs are free, which house each belongs to and which world it starts
 * on. For a match still open to newcomers that is public information — anyone reading it
 * could simply join and see the same thing.
 *
 * Once a session is closed to newcomers the very same payload becomes intel about
 * strangers: every player's callsign and faction, and `start` — the homeworld ids that
 * `visibleState()` keeps behind fog in the game itself. A match id is not a secret (it
 * rides in the `?join=` deep link, stays in the address bar during play and is listed by
 * `GET /matches/open`), so gating on «did you know the id» gated nothing. CORS does not
 * help either: it constrains a browser on a foreign page and is ignored by `curl`.
 *
 * So the route asks whether the caller may enter, and failing that, whether they are
 * already in: a match open for entry serves anyone; a closed one serves only a caller
 * who holds a seat in it. Open means a chair is really claimable — the entry window is
 * still up (SES-2.3), the session has not ended and some seat is free.
 *
 * Identity is the `identify` hook, exactly as in {@link registerMatchApi}. Without it
 * (the nick-only host, which has no authentication to offer) participation falls back to
 * `?nick=` — the posture `registerBrowserApi`'s archive intents already take. That is a
 * participation check, not proof of identity, and it is what keeps a seated player able
 * to read their own running session where sessions do not exist.
 */
export function registerSeatsApi(app: FastifyInstance, deps: SeatsApiDeps): void {
  const participates = async (request: FastifyRequest, matchId: string): Promise<boolean> => {
    const login = deps.identify ? (await deps.identify(request))?.login : nickOf(request);
    if (!login) return false;
    return (await deps.seatOf(matchId, login)) !== null;
  };

  app.get('/matches/:id/seats', async (request: FastifyRequest, reply: FastifyReply) => {
    const { id } = request.params as { id: string };
    const layout = await deps.seats(id);
    if (!layout) {
      void reply.code(404);
      return { error: 'E_NO_MATCH' as const };
    }
    const claimable =
      !layout.ended && layout.seats.some((seat) => !seat.taken) && (await deps.entryOpen(id));
    if (!claimable && !(await participates(request, id))) {
      void reply.code(403);
      return { error: 'E_FORBIDDEN' as const };
    }
    return { seats: layout.seats };
  });
}

/** A repeated `?nick=a&nick=b` parses to an array and `?nick=` to an empty string —
 *  treat anything but a non-blank string as absent (fail-secure: anonymous view /
 *  E_FORBIDDEN), like the join route's check. */
function nickOf(request: FastifyRequest): string | null {
  const nick = (request.query as { nick?: unknown }).nick;
  return typeof nick === 'string' && nick.trim() !== '' ? nick : null;
}

/**
 * The match-browser read-model + archive intents (docs/main-menu.md §2), served beside
 * the create/join API. A server projection — the client only reads it (A10/fog rule);
 * archive is fail-secure per-player (participants only, stable codes).
 */
export function registerBrowserApi(app: FastifyInstance, registry: MatchRegistry): void {
  // The three tabs (available/active/archived) for one viewer (`?nick=`).
  app.get('/matches', (request: FastifyRequest) => registry.list(nickOf(request)));

  const archive = async (request: FastifyRequest, reply: FastifyReply): Promise<unknown> => {
    const { id, intent } = request.params as { id: string; intent: string };
    const nick = nickOf(request) ?? '';
    const result =
      intent === 'archive'
        ? await registry.archive(id, nick)
        : await registry.unarchive(id, nick);
    if (!result.ok) void reply.code(result.code === 'E_NO_MATCH' ? 404 : 403);
    return result;
  };
  app.post('/matches/:id/:intent(archive|unarchive)', archive);
}
