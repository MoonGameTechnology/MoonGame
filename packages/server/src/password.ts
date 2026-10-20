import { randomBytes, scrypt, timingSafeEqual } from 'node:crypto';

/**
 * Password hashing for the login+password accounts (SE-1.x) — scrypt from node:crypto,
 * so the server takes NO new dependency (no native build steps, works in the distroless
 * image). scrypt is an OWASP-accepted memory-hard KDF; the parameters are embedded in
 * every stored hash, so they can be raised later without invalidating old records —
 * verification always re-derives with the STORED parameters.
 *
 * Stored format (one line, `$`-separated):
 *   scrypt$<N>$<r>$<p>$<salt b64url>$<derived key b64url>
 */

/** Cost parameters. N=2^15 · r=8 · p=3 is OWASP's 32 MiB scrypt profile. */
export interface ScryptParams {
  N: number;
  r: number;
  p: number;
}

const DEFAULT_PARAMS: ScryptParams = { N: 2 ** 15, r: 8, p: 3 };
const SALT_BYTES = 16;
const KEY_BYTES = 32;
/** node's default scrypt maxmem (32 MiB) is EXACTLY the requirement of N=2^15·r=8 —
 *  give explicit headroom so the derivation never trips the limit. */
const MAX_MEM = 128 * 1024 * 1024;

export class PasswordWorkBusy extends Error {
  constructor() { super('E_AUTH_BUSY'); }
}

/** One process-wide budget across registration, verification, reset and rehash.
 * Two active KDFs cap memory; sixteen waiting requests bound retained work even
 * when an attacker distributes requests across many addresses. */
export class PasswordWorkQueue {
  private active = 0;
  private readonly waiting: Array<() => void> = [];
  constructor(readonly concurrency = 2, readonly maxWaiting = 16) {}

  async run<T>(work: () => Promise<T>): Promise<T> {
    if (this.active >= this.concurrency) {
      if (this.waiting.length >= this.maxWaiting) throw new PasswordWorkBusy();
      await new Promise<void>((resolve) => { this.waiting.push(resolve); });
    } else this.active += 1;
    try {
      return await work();
    } finally {
      const next = this.waiting.shift();
      if (next) next(); // transfer the reserved slot before admitting another caller
      else this.active -= 1;
    }
  }
}

/** Exported for deterministic overload tests; production always shares this instance. */
export const passwordWork = new PasswordWorkQueue();

function derive(password: string, salt: Buffer, params: ScryptParams): Promise<Buffer> {
  return passwordWork.run(() => new Promise((resolve, reject) => {
    scrypt(
      password,
      salt,
      KEY_BYTES,
      { N: params.N, r: params.r, p: params.p, maxmem: MAX_MEM },
      (err, key) => (err ? reject(err) : resolve(key)),
    );
  }));
}

/** Never replace a stored profile that already has at least this memory and work.
 * The target override is only the existing cheap-test parameter seam. */
export function passwordNeedsRehash(stored: string, target: ScryptParams = DEFAULT_PARAMS): boolean {
  const [scheme, n, r, p] = stored.split('$');
  if (scheme !== 'scrypt') return false;
  const memory = Number(n) * Number(r);
  const work = memory * Number(p);
  return memory < target.N * target.r || work < target.N * target.r * target.p;
}

/** Hash a password for storage. `params` is injectable for fast tests only —
 *  production callers use the default cost. */
export async function hashPassword(
  password: string,
  params: ScryptParams = DEFAULT_PARAMS,
): Promise<string> {
  const salt = randomBytes(SALT_BYTES);
  const key = await derive(password, salt, params);
  return [
    'scrypt',
    String(params.N),
    String(params.r),
    String(params.p),
    salt.toString('base64url'),
    key.toString('base64url'),
  ].join('$');
}

/** Verify a password against a stored hash. Fail-secure: ANY malformed/unsupported
 *  stored value verifies false; resource saturation throws the separate stable
 *  PasswordWorkBusy signal (never misreported as a wrong password). */
export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  try {
    const [scheme, nS, rS, pS, saltS, keyS] = stored.split('$');
    if (scheme !== 'scrypt' || !nS || !rS || !pS || !saltS || !keyS) return false;
    const params: ScryptParams = { N: Number(nS), r: Number(rS), p: Number(pS) };
    if (
      !Number.isInteger(params.N) ||
      !Number.isInteger(params.r) ||
      !Number.isInteger(params.p) ||
      params.N < 2 ||
      params.r < 1 ||
      params.p < 1 ||
      128 * params.N * params.r > MAX_MEM // reject a stored record we can't derive safely
    ) {
      return false;
    }
    const salt = Buffer.from(saltS, 'base64url');
    const expected = Buffer.from(keyS, 'base64url');
    if (salt.length === 0 || expected.length !== KEY_BYTES) return false;
    const actual = await derive(password, salt, params);
    return timingSafeEqual(actual, expected);
  } catch (error) {
    if (error instanceof PasswordWorkBusy) throw error;
    return false;
  }
}

/** A decoy hash for timing equalization: `login` misses still burn one scrypt derivation,
 *  so "unknown login" and "wrong password" are indistinguishable by response time. */
export function decoyHash(params: ScryptParams = DEFAULT_PARAMS): Promise<string> {
  return hashPassword(randomBytes(9).toString('base64url'), params);
}
