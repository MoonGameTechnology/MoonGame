/**
 * The client's HTTP half: sign in, list matches, claim a seat (MIG-2).
 *
 * Until this module the package had **no HTTP at all** — the only way into a match was
 * the `?join=<ws url>` deep link, i.e. an address somebody else had already produced.
 * Everything needed to produce it yourself (credential rules, the login→register order,
 * the seat exchange, how a client names itself when dialling) was already written and
 * tested — it just lived inside `prototype/src`, where this package cannot see it. MIG-1
 * moved that chain to `/decisions`; this file is the first consumer.
 *
 * The split is deliberate and is the whole point of `/decisions`:
 *
 *   decisions/*  — the RULES: pure, browser-free, tested without a network.
 *   session.ts   — the EFFECTS: fetch, storage, and the order the rules run in.
 *
 * So nothing here re-derives a rule. Which password reaches the request, whether a 401
 * means "register instead" or "your session is gone", which refusal must forget the
 * stored session, what a dial URL looks like — every one of those questions is answered
 * by a decision module, and answered the same way for the prototype.
 *
 * Both effects are INJECTED (`SessionIo`) rather than reached for globally: that is what
 * lets the tests drive a full sign-in → browse → join chain with no browser and no server,
 * and it keeps the one storage rule this file must respect — browser storage can throw
 * outright (private mode, blocked site data), so every read and write is guarded and a
 * failure degrades to "no stored session", never to a crash.
 */
import type { MatchLists } from '@void/protocol';
import {
  authOutcome,
  shouldRegister,
  validLogin,
  validPassword,
  type AuthOutcome,
  type AuthReply,
} from '../../../decisions/authRules';
import { registerExtra } from '../../../decisions/authRequest';
import {
  httpBase,
  matchesUrl,
  queryOutcome,
  type QueryOutcome,
} from '../../../decisions/matchQuery';
import {
  dropsSession,
  joinOutcome,
  joinQuery,
  parseJoinPass,
  type JoinOutcome,
} from '../../../decisions/joinRules';
import { dialIdentity, dialUrl } from '../../../decisions/netDial';
import {
  clearSession,
  readSession,
  saveSession,
  type KeyValueStore,
} from '../../../decisions/sessionStore';

/** One HTTP answer, reduced to what the decisions actually read. */
export interface HttpReply {
  ok: boolean;
  status: number;
  /** Parsed JSON body, or null when the answer had none / did not parse. */
  body: unknown;
}

export interface HttpRequest {
  method?: 'GET' | 'POST';
  headers?: Record<string, string>;
  body?: string;
}

/**
 * The network effect, injected.
 *
 * `null` means the request NEVER LANDED (offline, DNS, a dead host) — deliberately a
 * different value from a reply that refused, because that is the distinction
 * `queryOutcome` draws and the only one the player can act on: an unreachable server is
 * worth retrying, a refusal is not. Collapsing both into `ok: false` erases it.
 */
export type HttpFetch = (url: string, init?: HttpRequest) => Promise<HttpReply | null>;

export interface SessionIo {
  http: HttpFetch;
  store: KeyValueStore;
}

/** Local refusal (the field is wrong before anything is sent), no answer at all, or the
 *  server's verdict. `offline` is kept apart from every refusal for the same reason as
 *  above — it is the only one where trying again is the right advice. */
export type SignInResult =
  | { kind: 'invalid'; field: 'login' | 'password' }
  | { kind: 'offline' }
  | { kind: 'done'; outcome: AuthOutcome };

export type JoinAttempt =
  | { ok: true; wsUrl: string; playerId: string }
  | { ok: false; reason: JoinOutcome | 'offline' };

export interface MatchesResult {
  outcome: QueryOutcome;
  lists: MatchLists | null;
}

/** Seat preferences carried into the claim (REL-7 / ENTRY-1) — all optional. */
export interface SeatPreference {
  slot?: string;
  faction?: string;
  scientists?: readonly string[];
}

export interface NetSession {
  /** The ws base this session talks to (`ws://…` / `wss://…`). */
  readonly base: string;
  /** The signed-in callsign, or null when there is no live session for this server. */
  login(): string | null;
  signIn(login: string, password: string, email?: string): Promise<SignInResult>;
  signOut(): void;
  matches(): Promise<MatchesResult>;
  join(matchId: string, prefer?: SeatPreference): Promise<JoinAttempt>;
}

/**
 * Real browser effects. Nothing here throws: a dead request becomes `null` and an
 * unparsable body becomes a reply with `body: null`, which are different facts — the
 * first means "try again", the second means the server answered something we can't use.
 */
export function browserIo(): SessionIo {
  const store: KeyValueStore = {
    getItem: (k) => {
      try {
        return localStorage.getItem(k);
      } catch {
        return null;
      }
    },
    setItem: (k, v) => {
      try {
        localStorage.setItem(k, v);
      } catch {
        /* storage blocked — the session simply won't survive a reload */
      }
    },
    removeItem: (k) => {
      try {
        localStorage.removeItem(k);
      } catch {
        /* same: nothing to do if the browser refuses to forget it */
      }
    },
  };
  const http: HttpFetch = async (url, init) => {
    try {
      const res = await fetch(url, init);
      const body: unknown = await res.json().catch(() => null);
      return { ok: res.ok, status: res.status, body };
    } catch {
      // Unreachable, not refused — `null` is what the decisions read as "retry later".
      return null;
    }
  };
  return { http, store };
}

/** `{ error }` bodies carry a stable `E_*` code; anything else reads as no code. */
function errorCode(body: unknown): string | undefined {
  const e = (body as { error?: unknown } | null)?.error;
  return typeof e === 'string' ? e : undefined;
}

function tokenOf(body: unknown): string | undefined {
  const t = (body as { token?: unknown } | null)?.token;
  return typeof t === 'string' && t ? t : undefined;
}

const asReply = (r: HttpReply): AuthReply => ({
  status: r.status,
  ...(tokenOf(r.body) !== undefined ? { token: tokenOf(r.body) } : {}),
  ...(errorCode(r.body) !== undefined ? { error: errorCode(r.body) } : {}),
});

export function createSession(base: string, io: SessionIo): NetSession {
  const api = httpBase(base);
  const post = (path: string, payload: Record<string, string>): Promise<HttpReply | null> =>
    io.http(`${api}${path}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(payload),
    });

  const bearer = (): Record<string, string> => {
    const rec = readSession(io.store, base);
    return rec ? { authorization: `Bearer ${rec.token}` } : {};
  };

  return {
    base,

    login() {
      return readSession(io.store, base)?.login ?? null;
    },

    async signIn(loginName, password, email) {
      // Checked here, before the wire: the server would refuse these too, but a 400 tells
      // the player nothing about WHICH field is wrong. The rules are the server's own
      // (`authRules` mirrors `LOGIN_RE`/`PASSWORD_MIN`), not a second opinion.
      if (!validLogin(loginName)) return { kind: 'invalid', field: 'login' };
      if (!validPassword(password)) return { kind: 'invalid', field: 'password' };

      const loginRaw = await post('/auth/login', { login: loginName, password });
      if (!loginRaw) return { kind: 'offline' };
      const loginReply = asReply(loginRaw);
      // Order is the meaning of "first sign-in creates the account" (authRequest, rule 4):
      // try the existing account first, and let ONLY an unknown login fall through to
      // registration. Swapped, it would open a second account for someone who has one.
      let registerReply: AuthReply | undefined;
      if (shouldRegister(loginReply)) {
        const raw = await post('/auth/register', {
          login: loginName,
          password,
          ...registerExtra(email),
        });
        if (!raw) return { kind: 'offline' };
        registerReply = asReply(raw);
      }

      const outcome = authOutcome(loginReply, registerReply);
      const token = loginReply.token ?? registerReply?.token;
      if (token) saveSession(io.store, base, { login: loginName, token });
      return { kind: 'done', outcome };
    },

    signOut() {
      clearSession(io.store, base);
    },

    async matches() {
      const nick = readSession(io.store, base)?.login ?? '';
      const res = await io.http(matchesUrl(base, nick), { headers: bearer() });
      const outcome = queryOutcome(res);
      if (outcome !== 'ok' || !res) return { outcome, lists: null };
      const lists = res.body as MatchLists | null;
      // A 2xx whose body did not parse is NOT "the list is unchanged" (matchQuery, rule 4):
      // leaving the old rows up invites a click on a match that is already gone.
      if (!lists || !Array.isArray(lists.available)) return { outcome: 'unreachable', lists: null };
      return { outcome: 'ok', lists };
    },

    async join(matchId, prefer) {
      const query = joinQuery(prefer?.slot, prefer?.faction, prefer?.scientists);
      const res = await io.http(`${api}/matches/${encodeURIComponent(matchId)}/join${query}`, {
        headers: bearer(),
      });
      // No answer at all: say so instead of borrowing `failed`, which the player reads as
      // "this match said no" and answers by picking a different one — the wrong move when
      // the whole server is unreachable.
      if (!res) return { ok: false, reason: 'offline' };
      const outcome = joinOutcome(res.status);
      if (outcome !== 'ok') {
        // An expired session must be FORGOTTEN, or the client keeps knocking with a dead
        // pass and the player reads the same opaque error forever (joinRules, rule 1).
        if (dropsSession(outcome)) clearSession(io.store, base);
        return { ok: false, reason: outcome };
      }
      const pass = parseJoinPass(res.body);
      // Half a pass is not a pass: a 2xx missing either field cannot produce a dial URL,
      // and inventing one would send the player into a handshake the server must refuse.
      if (!pass) return { ok: false, reason: 'failed' };
      const nick = readSession(io.store, base)?.login ?? '';
      return {
        ok: true,
        playerId: pass.playerId,
        // Token and callsign never mix in the address (netDial, rule 1): with accounts on,
        // the short per-match token IS the identity and a nick beside it is refused.
        wsUrl: dialUrl(base, matchId, dialIdentity(true, pass.token, nick, null)),
      };
    },
  };
}
