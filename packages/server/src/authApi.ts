import { createHash } from 'node:crypto';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import type { SessionClaim } from './auth';
import { hashPassword, verifyPassword, decoyHash, type ScryptParams } from './password';
import type { UserStore } from './store';
import { slidingWindowIpLimiter } from './rateLimit';
import { validLogin, validLoginPassword, passwordIssue, blockedPublicName, parseRecoveryEmail, closedInput } from '@void/protocol';

/**
 * SE-1.x — login+password authentication over HTTP: `POST /auth/register` and
 * `POST /auth/login`. Success hands the client a SESSION token (see auth.ts) — the
 * "who you are" credential the match API then exchanges for per-match join tokens.
 *
 * Fail-secure by construction (invariant #4):
 *  - login failures are UNIFORM: unknown login and wrong password both return the same
 *    401 `E_AUTH`, and an unknown login still burns one scrypt derivation (decoy hash),
 *    so neither the body nor the response time enumerates accounts;
 *  - malformed input → 400 `E_BAD_CREDENTIALS` with no field-level detail;
 *  - both routes sit behind a per-IP sliding-window rate limit (online-guessing brake) —
 *    a bounded map, evicted FIFO, so an address-spraying client can't grow memory.
 */

/** Delivery seam: production hosts wire the verified SMTP transport. */
export type Mailer = (msg: { to: string; subject: string; text: string }) => Promise<void>;

/** Auth supplies structural data; the host owns recipient-localized presentation. */
export interface RecoveryMail {
  to: string;
  template: 'password-reset';
  locale?: string;
  params: { link: string };
}
export type RecoveryMailer = (msg: RecoveryMail) => Promise<void>;

/** Password fingerprint: a short digest of the password hash. When the password changes
 *  the hash — and thus this fingerprint — changes. Two consumers: single-use reset tokens
 *  (a spent/stale token stops matching → dead, no token store needed) and session freshness
 *  (`liveSession` below re-checks a session's stamped fingerprint against the current hash,
 *  so a reset revokes older sessions). No server-side state either way. */
export const pwFingerprint = (passHash: string): string =>
  createHash('sha256').update(passHash).digest('base64url').slice(0, 22);

/** Re-check a signature-verified session against the CURRENT password: the account must
 *  still exist and its password hash must still fingerprint to the session's stamped `pwfp`.
 *  A password change (today, a `/auth/reset`) breaks the match, so an older session — a
 *  stolen one that outlived the reset included — no longer authenticates. Returns the
 *  claim on success, `null` on any failure (fail-secure). Meant for the identity gate
 *  (join/create), not every request: it costs one indexed `findById`. */
export async function liveSession(
  claim: SessionClaim,
  users: Pick<UserStore, 'findById'>,
): Promise<SessionClaim | null> {
  const user = await users.findById(claim.accountId);
  if (!user || pwFingerprint(user.passHash) !== claim.pwfp) return null;
  return claim;
}

/** The account's CURRENT password fingerprint, or null when there is no such account.
 *  The WS handshake compares a join token's stamped `pwfp` against it, so a token minted
 *  before a password reset no longer opens a socket. A store error propagates — the
 *  caller refuses the handshake (fail-secure). */
export async function currentPwfp(
  users: Pick<UserStore, 'findById'>,
  accountId: string,
): Promise<string | null> {
  const user = await users.findById(accountId);
  return user ? pwFingerprint(user.passHash) : null;
}

export interface AuthApiDeps {
  users: UserStore;
  /** Mint a session token for an authenticated account (from serverConfig). `pwfp` binds
   *  the session to the current password (see `liveSession`) so a reset revokes it. */
  signSession(accountId: string, login: string, pwfp: string): Promise<string>;
  /** Recovery (SE-1.x): mint a short-lived reset token bound to `pwfp`. Present together
   *  with `resetBaseUrl` mounts `/auth/recover` + `/auth/reset`; absent leaves them off. */
  signReset?(accountId: string, pwfp: string): Promise<string>;
  /** Validate a reset token (returns the account + fingerprint, or null on any failure). */
  verifyReset?(token: string): Promise<{ accountId: string; pwfp: string } | null>;
  /** Client origin the emailed reset link points at: `${resetBaseUrl}/?reset=<token>`. */
  resetBaseUrl?: string;
  /** Required when recovery is enabled. Never logs reset bearers. */
  sendRecoveryMail?: RecoveryMailer;
  /** Runs after a password change has been committed (today, `/auth/reset`): the host
   *  closes the account's open game connections (`revokeAccountConnections`) — a session
   *  revoked by the new password must not keep issuing orders over a socket it opened
   *  earlier. Awaited before the response; a throw is logged and swallowed (the password
   *  is already changed — failing the reset would only hide that from its owner). */
  onPasswordChanged?(accountId: string): void | Promise<void>;
  /** Post-registration hook (e.g. the starter-arsenal grant, ARS-2), awaited before
   *  the 201 so the account's first read sees its grant. MUST be resilient: a throw
   *  is swallowed here (registration already succeeded — never fail it for a
   *  side-effect), so the hook owns its retries/logging; idempotent hooks are safe
   *  to re-run out of band. */
  onRegistered?(accountId: string, login: string): Promise<void>;
  /** Injectable clock + limits for deterministic tests. */
  now?: () => number;
  rateMax?: number;
  rateWindowMs?: number;
  /** Shortest gap between two recovery mails to one account (default
   *  `RECOVERY_COOLDOWN_MS`). Tests that exercise the queue pass 0. */
  recoveryCooldownMs?: number;
  /** Test-only: cheaper scrypt cost. Production callers omit it (default cost). */
  scryptParams?: ScryptParams;
}

/** Bound all auth bodies before parsing or password hashing. */
const AUTH_BODY_LIMIT = 4096;

/**
 * Per-IP attempt budget for the auth routes (register/login/recover/reset SHARE it).
 *
 * The number is derived, not picked: it has to fit ONE lobby arriving at once from ONE
 * address. A whole match is 10 seats; a first-time player costs TWO requests (login
 * first — the uniform 401 is what tells the client to register, there is deliberately
 * no "does this login exist" oracle), so a full lobby behind a single NAT is 20; double
 * it for mistyped passwords and reloads. Below that the brake stops the honest lobby
 * instead of the attacker: at the previous value of 10 the fifth player to register
 * from a shared address got a 429 (measured — ten browsers, 0.7 s apart, 4 got in).
 *
 * Login failures still burn a scrypt derivation and return a uniform answer.
 * Legacy sign-ins retain the 8-character floor; new/reset passwords use the shared
 * creation policy. Deployments that terminate at a proxy for many players (or want it tighter)
 * override both numbers — see `AUTH_RATE_MAX` / `AUTH_RATE_WINDOW_MS` in the hosts.
 */
const RATE_MAX = 40;
const RATE_WINDOW_MS = 60_000;
const RATE_MAX_IPS = 10_000; // bounded tracker: oldest window evicted first

/** One recovery mail per account per this window. The per-IP budget alone does not
 *  protect a mailbox: requests from many addresses would each get their own budget and
 *  all land in one inbox. A real user who lost the first mail waits a few minutes. */
const RECOVERY_COOLDOWN_MS = 10 * 60_000;
const RECOVERY_COOLDOWN_MAX = 10_000; // bounded tracker: oldest entry evicted first

/**
 * Auth rate limit from the environment, for hosts that want to retune it (both do).
 *
 * Two knobs, both optional: `AUTH_RATE_MAX` (attempts per window) and
 * `AUTH_RATE_WINDOW_MS`. An absent, unparseable or non-positive value leaves the
 * default in place rather than disabling the brake — a typo in an env var must never
 * be the thing that removes an online-guessing limit (invariant #4, fail-secure).
 * Returns a partial `AuthApiDeps` slice so a host can spread it into the call.
 */
export function authRateFromEnv(env: Record<string, string | undefined>): {
  rateMax?: number;
  rateWindowMs?: number;
} {
  const positive = (raw: string | undefined): number | undefined => {
    const n = Number(raw);
    return Number.isFinite(n) && n > 0 ? Math.floor(n) : undefined;
  };
  const rateMax = positive(env.AUTH_RATE_MAX);
  const rateWindowMs = positive(env.AUTH_RATE_WINDOW_MS);
  return { ...(rateMax !== undefined ? { rateMax } : {}), ...(rateWindowMs !== undefined ? { rateWindowMs } : {}) };
}

interface Creds {
  login: string;
  password: string;
}

function parseCreds(body: unknown, fields: readonly string[]): Creds | null {
  if (!closedInput(body, fields)) return null;
  const { login, password } = body as { login?: unknown; password?: unknown };
  if (typeof login !== 'string' || !validLogin(login)) return null;
  if (
    typeof password !== 'string' ||
    !validLoginPassword(password)
  ) {
    return null;
  }
  return { login, password };
}

export function registerAuthApi(app: FastifyInstance, deps: AuthApiDeps): void {
  const now = deps.now ?? ((): number => Date.now());
  const rateMax = deps.rateMax ?? RATE_MAX;
  const rateWindowMs = deps.rateWindowMs ?? RATE_WINDOW_MS;
  const rateLimited = slidingWindowIpLimiter({
    now,
    max: rateMax,
    windowMs: rateWindowMs,
    maxIps: RATE_MAX_IPS,
  });

  // A decoy hash computed once at startup: login misses verify against it so the
  // "unknown login" path costs one scrypt derivation, same as "wrong password".
  const decoy = decoyHash(deps.scryptParams);

  app.post('/auth/register', { bodyLimit: AUTH_BODY_LIMIT }, async (request: FastifyRequest, reply: FastifyReply) => {
    if (rateLimited(request.ip)) {
      void reply.code(429);
      return { error: 'E_RATE_LIMIT' as const };
    }
    const creds = parseCreds(request.body, ['login', 'password', 'email']);
    const email = parseRecoveryEmail((request.body as { email?: unknown } | null)?.email);
    if (!creds || email === null) {
      void reply.code(400);
      return { error: 'E_BAD_CREDENTIALS' as const };
    }
    // Login→register is also the wrong-password path for an existing account.
    // Preserve that verdict before applying rules intended only for a new identity.
    if (await deps.users.findUser(creds.login)) {
      return reply.code(409).send({ error: 'E_LOGIN_TAKEN' as const });
    }
    if (blockedPublicName(creds.login)) return reply.code(400).send({ error: 'E_NICKNAME_BLOCKED' });
    if (passwordIssue(creds.password)) return reply.code(400).send({ error: 'E_PASSWORD_POLICY' });
    const passHash = await hashPassword(creds.password, deps.scryptParams);
    const created = await deps.users.createUser(creds.login, passHash, email);
    if (!created.ok) {
      void reply.code(409);
      return { error: created.code }; // E_LOGIN_TAKEN | E_EMAIL_TAKEN
    }
    // Post-registration side-effects (starter arsenal, ARS-2): awaited so the new
    // account's first read sees them, but NEVER allowed to fail the registration
    // itself — the account exists; an idempotent hook re-runs safely out of band.
    if (deps.onRegistered) {
      try {
        await deps.onRegistered(created.userId, creds.login);
      } catch {
        /* the hook owns its logging/retries */
      }
    }
    // Auto-login: registration IS the first login — hand the session token right away.
    const token = await deps.signSession(created.userId, creds.login, pwFingerprint(passHash));
    void reply.code(201);
    return { accountId: created.userId, login: creds.login, token };
  });

  app.post('/auth/login', { bodyLimit: AUTH_BODY_LIMIT }, async (request: FastifyRequest, reply: FastifyReply) => {
    if (rateLimited(request.ip)) {
      void reply.code(429);
      return { error: 'E_RATE_LIMIT' as const };
    }
    const creds = parseCreds(request.body, ['login', 'password']);
    if (!creds) {
      void reply.code(400);
      return { error: 'E_BAD_CREDENTIALS' as const };
    }
    const user = await deps.users.findUser(creds.login);
    // Uniform failure: both paths verify against SOME hash and return the same 401,
    // so account existence leaks neither through the body nor through timing. The
    // decoy verification's result is deliberately discarded — it exists ONLY to
    // cost one scrypt derivation, same as a real check.
    let ok = false;
    if (user) {
      ok = await verifyPassword(creds.password, user.passHash);
    } else {
      await verifyPassword(creds.password, await decoy);
    }
    if (!ok || !user) {
      void reply.code(401);
      return { error: 'E_AUTH' as const };
    }
    const token = await deps.signSession(user.userId, user.login, pwFingerprint(user.passHash));
    return { accountId: user.userId, login: user.login, token };
  });

  // --- Password recovery (SE-1.x): request a reset link, then spend it -----------------
  // Mounted only when the deployment wired reset-token signing + a client origin. Both
  // routes share the register/login per-IP budget (guessing/spray brake) and are
  // fail-secure: `recover` ALWAYS 200s (no account-existence oracle); `reset` yields a
  // uniform `E_AUTH` for any bad / expired / already-spent token.
  if (deps.signReset && deps.verifyReset && deps.resetBaseUrl) {
    const signReset = deps.signReset;
    const verifyReset = deps.verifyReset;
    // Strip trailing slashes WITHOUT a backtracking regex: `/\/+$/` is a
    // quadratic ReDoS on a run of '/' (CodeQL js/polynomial-redos). resetBaseUrl
    // is deployment config, not request data, so the practical risk is nil — but
    // a linear trim keeps the auth surface clear of the pattern altogether.
    const base = deps.resetBaseUrl;
    let baseEnd = base.length;
    while (baseEnd > 0 && base[baseEnd - 1] === '/') baseEnd -= 1;
    const resetBaseUrl = base.slice(0, baseEnd);
    if (!deps.sendRecoveryMail) throw new Error('E_MAIL_CONFIG');
    const sendRecoveryMail = deps.sendRecoveryMail;
    // Queue BOTH known and unknown addresses before any lookup/signing/SMTP work.
    // The response therefore cannot expose SMTP latency (or transport failures).
    // One worker and at most 64 waiting requests bound work during an SMTP outage.
    // This is best-effort process-local delivery; shutdown/full queue requires retry.
    const recoveryQueue: Array<{ email: string; locale?: string }> = [];
    const cooldownMs = deps.recoveryCooldownMs ?? RECOVERY_COOLDOWN_MS;
    /** Account → when its last recovery mail went out (insertion order = age). */
    const lastMailed = new Map<string, number>();
    let recovering = false;
    let recoveryClosed = false;
    app.addHook('onClose', async () => {
      recoveryClosed = true;
      recoveryQueue.length = 0;
    });
    const deliverRecovery = async () => {
      try {
        while (!recoveryClosed && recoveryQueue.length > 0) {
          const { email, locale } = recoveryQueue.shift()!;
          try {
            const user = await deps.users.findUserByEmail(email);
            if (!user?.email || recoveryClosed) continue;
            const sentAt = lastMailed.get(user.userId);
            if (sentAt !== undefined && now() - sentAt < cooldownMs) continue;
            const token = await signReset(user.userId, pwFingerprint(user.passHash));
            const link = `${resetBaseUrl}/?reset=${encodeURIComponent(token)}`;
            await sendRecoveryMail({
              to: user.email,
              template: 'password-reset',
              locale,
              params: { link },
            });
            // Only a delivered mail starts the cooldown: after a failed send the user may retry.
            lastMailed.delete(user.userId);
            lastMailed.set(user.userId, now());
            if (lastMailed.size > RECOVERY_COOLDOWN_MAX) {
              const oldest = lastMailed.keys().next().value;
              if (oldest !== undefined) lastMailed.delete(oldest);
            }
          } catch {
            /* keep the worker alive; never expose lookup/delivery failures or bearers */
          }
        }
      } finally {
        recovering = false;
      }
    };

    app.post('/auth/recover', { bodyLimit: AUTH_BODY_LIMIT }, async (request: FastifyRequest, reply: FastifyReply) => {
      if (rateLimited(request.ip)) {
        void reply.code(429);
        return { error: 'E_RATE_LIMIT' as const };
      }
      const email = closedInput(request.body, ['email', 'locale']) ? parseRecoveryEmail(request.body.email) : null;
      if (!email) {
        void reply.code(400);
        return { error: 'E_BAD_CREDENTIALS' as const };
      }
      if (!recoveryClosed && recoveryQueue.length < 64) {
        const requested = (request.body as { locale?: unknown }).locale;
        // Bound presentation metadata; supported locales and fallback belong to the host.
        const locale = typeof requested === 'string' && requested.length <= 64 ? requested : undefined;
        recoveryQueue.push({ email, locale });
        if (!recovering) {
          recovering = true;
          setImmediate(() => { deliverRecovery().catch(() => {}); });
        }
      }
      return { ok: true as const };
    });

    app.post('/auth/reset', { bodyLimit: AUTH_BODY_LIMIT }, async (request: FastifyRequest, reply: FastifyReply) => {
      if (rateLimited(request.ip)) {
        void reply.code(429);
        return { error: 'E_RATE_LIMIT' as const };
      }
      const body = closedInput(request.body, ['token', 'password']) ? request.body : {};
      const token = typeof body.token === 'string' ? body.token : '';
      const password = body.password;
      if (
        !token || token.length > 2048 ||
        typeof password !== 'string' ||
        !validLoginPassword(password)
      ) {
        void reply.code(400);
        return { error: 'E_BAD_CREDENTIALS' as const };
      }
      if (passwordIssue(password)) return reply.code(400).send({ error: 'E_PASSWORD_POLICY' });
      const claim = await verifyReset(token);
      // Single-use: re-fetch the account and re-check the fingerprint against the CURRENT
      // hash — a token already spent (or minted before another change) no longer matches.
      const user = claim ? await deps.users.findById(claim.accountId) : null;
      if (!claim || !user || pwFingerprint(user.passHash) !== claim.pwfp) {
        void reply.code(401);
        return { error: 'E_AUTH' as const };
      }
      // Capture before scrypt yields: the memory adapter can return a live record.
      const expectedHash = user.passHash;
      const passHash = await hashPassword(password, deps.scryptParams);
      if (!(await deps.users.setPasswordIfCurrent(user.userId, expectedHash, passHash))) {
        void reply.code(401);
        return { error: 'E_AUTH' as const };
      }
      // Sessions are revoked by the fingerprint check; open sockets are not — close them.
      if (deps.onPasswordChanged) {
        try {
          await deps.onPasswordChanged(user.userId);
        } catch (err) {
          request.log.error({ err }, 'password change: revoking connections failed');
        }
      }
      // Reset IS a login: hand back a fresh session (stamped with the NEW password's
      // fingerprint, so it survives while every pre-reset session is now revoked).
      const sessionToken = await deps.signSession(user.userId, user.login, pwFingerprint(passHash));
      return { accountId: user.userId, login: user.login, token: sessionToken };
    });
  }
}
