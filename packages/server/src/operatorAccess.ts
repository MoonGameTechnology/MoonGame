import { createHash, timingSafeEqual } from 'node:crypto';

/**
 * Who may read operator-only HTTP routes (the `/metrics/*` tail and summaries).
 *
 * Why these routes are not public: the observation log carries raw domain events from
 * BEFORE the fog filter (fleet routes, captures, revealed heroes), every player's economy
 * and every action. Served to anyone, that is a map hack for every match on the host.
 *
 * Two ways in, nothing else:
 * - a direct loopback peer with no `X-Forwarded-For` (a playtest host, `pnpm smoke:net`).
 *   A forwarded request came through a proxy on this machine, so the loopback peer is
 *   the proxy, not the operator. The raw socket address is used, never `req.ip`, which
 *   follows `X-Forwarded-For` when `TRUST_PROXY=1` and is therefore client-controlled;
 * - `Authorization: Bearer <METRICS_TOKEN>` (prod behind Docker, where the operator's
 *   curl arrives from the bridge gateway, not loopback).
 *
 * A token shorter than {@link MIN_OPERATOR_TOKEN_LENGTH} counts as unset.
 */
export const MIN_OPERATOR_TOKEN_LENGTH = 32;

export interface OperatorRequestView {
  readonly remoteAddress: string | undefined;
  readonly headers: Record<string, unknown>;
}

/** IPv4 127.0.0.0/8, IPv6 ::1 and their IPv4-mapped form. */
export function isLoopbackAddress(addr: string | undefined): boolean {
  if (!addr) return false;
  const v4 = addr.startsWith('::ffff:') ? addr.slice(7) : addr;
  return v4.startsWith('127.') || addr === '::1';
}

/** `METRICS_TOKEN` from the environment, or undefined when unset or too short. */
export function operatorTokenFromEnv(env: Record<string, string | undefined>): string | undefined {
  const token = env.METRICS_TOKEN ?? '';
  return token.length >= MIN_OPERATOR_TOKEN_LENGTH ? token : undefined;
}

/** Separate aggregate-only credential. Reusing the operator key defeats its scope. */
export function metricsReaderTokenFromEnv(env: Record<string, string | undefined>): string | undefined {
  const token = env.METRICS_READER_TOKEN;
  if (!token) return undefined;
  if (token.length < MIN_OPERATOR_TOKEN_LENGTH || token === env.METRICS_TOKEN)
    throw new Error('E_METRICS_READER_CONFIG');
  return token;
}

const digest = (s: string): Buffer => createHash('sha256').update(s).digest();

export function isOperatorRequest(req: OperatorRequestView, token: string | undefined): boolean {
  const auth = req.headers.authorization;
  if (typeof auth === 'string' && auth.startsWith('Bearer ')) {
    // A presented token is judged on its own: a wrong one never falls back to loopback.
    return token !== undefined && timingSafeEqual(digest(auth.slice(7)), digest(token));
  }
  if (req.headers['x-forwarded-for'] !== undefined) return false;
  return isLoopbackAddress(req.remoteAddress);
}

/** Use only on explicitly aggregate routes, never raw journals or operator actions. */
export function isMetricsReaderRequest(
  req: OperatorRequestView,
  operatorToken: string | undefined,
  readerToken: string | undefined,
): boolean {
  if (isOperatorRequest(req, operatorToken)) return true;
  const auth = req.headers.authorization;
  return readerToken !== undefined && typeof auth === 'string' && auth.startsWith('Bearer ') &&
    timingSafeEqual(digest(auth.slice(7)), digest(readerToken));
}
