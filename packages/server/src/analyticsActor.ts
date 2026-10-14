import { createHmac } from 'node:crypto';
import type { RoomObservation } from './matchRoom';

/**
 * PTM-0.2 (docs/playtest-telemetry-roadmap.md): the analytics pseudonym of an account.
 *
 * Telemetry must link one person across matches and days (did they come back? how many
 * sessions a day?) without carrying the account id itself. `actor = HMAC(salt, accountId)`,
 * truncated: stable for as long as the salt is, meaningless without it. Unlike the
 * security stream's per-process salt (`securityAudit.ts`) this one is PERSISTENT —
 * `ANALYTICS_SALT` in `server.env` — otherwise every restart would split each person in two.
 * Rotating the salt deliberately cuts every link to the past.
 *
 * A pseudonym is still personal data (GDPR art. 4(5)): it narrows what leaks, it does not
 * license collecting more. A salt shorter than {@link MIN_ANALYTICS_SALT_LENGTH} counts as
 * unset — then no `actor` is written at all, rather than a guessable one.
 */
export const MIN_ANALYTICS_SALT_LENGTH = 32;

/** Hex chars kept: 64 bits — no collisions at playtest scale, short in every log line. */
const ACTOR_HEX = 16;

export type ActorOf = (accountId: string) => string;

export function analyticsActor(salt: string): ActorOf {
  return (accountId) =>
    createHmac('sha256', salt).update(accountId).digest('hex').slice(0, ACTOR_HEX);
}

/** The pseudonymizer from `ANALYTICS_SALT`, or undefined when unset or too short. */
export function analyticsActorFromEnv(
  env: Record<string, string | undefined>,
): ActorOf | undefined {
  const salt = env.ANALYTICS_SALT ?? '';
  return salt.length >= MIN_ANALYTICS_SALT_LENGTH ? analyticsActor(salt) : undefined;
}

/**
 * One match-journal record for an observation. A `join` carries the seat's raw
 * `accountId` (server-internal); here it becomes `actor` — or nothing, without a salt —
 * so the raw id never reaches the journal, nor `/metrics/recent`, which serves its lines.
 */
export function journalRecord(
  match: string,
  ev: RoomObservation,
  actorOf: ActorOf | undefined,
): Record<string, unknown> {
  if (ev.kind !== 'join') return { match, ...ev };
  const { accountId, ...rest } = ev;
  return { match, ...rest, ...(accountId && actorOf ? { actor: actorOf(accountId) } : {}) };
}
