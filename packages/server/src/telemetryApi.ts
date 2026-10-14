import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { parseTelemetryBatch, TELEMETRY_BODY_MAX } from '@void/protocol';
import type { ActorOf } from './analyticsActor';
import type { Identity } from './matchApi';
import { slidingWindowIpLimiter } from './rateLimit';

/**
 * PTM-1.1 (docs/playtest-telemetry-roadmap.md): `POST /telemetry` — product events from the
 * browser, one JSONL line per event in `playtest-logs/client-YYYY-MM-DD.jsonl`.
 *
 * Observation only: nothing here touches a match, and a failure here never reaches the
 * game. The client cannot name a person: `actor` is derived HERE from a valid session token
 * (`Authorization: Bearer`), so it cannot be forged; without one the events stay anonymous
 * and are tied together by the random `install` id. The final batch of a closing tab rides
 * `navigator.sendBeacon`, which carries no header — that is the anonymous path, and the
 * report links it through `install`.
 *
 * Budgets are deliberately three: per IP and per install (the client sends a batch every
 * few seconds, so either budget is far above an honest tab), and a global one — the
 * receiver must not fill the disk because one script found it.
 */
export interface TelemetryLog {
  write(record: Record<string, unknown>): void;
}

export interface TelemetryApiOptions {
  log: TelemetryLog;
  /** Live-session check (the same one the account APIs use); absent → all anonymous. */
  identify?: (request: FastifyRequest) => Promise<Identity | null>;
  actorOf?: ActorOf;
  /** `ALLOWED_ORIGINS`: a browser POST from any other site is refused. */
  allowedOrigins?: readonly string[];
  now?: () => number;
}

export interface TelemetryStats {
  batches: number;
  events: number;
  /** Events refused inside an accepted batch (bad name, bad props). */
  droppedEvents: number;
  /** Whole requests refused: bad envelope, foreign origin. */
  rejected: number;
  limited: number;
}

const MINUTE = 60_000;
const PER_IP = 30;
const PER_INSTALL = 15;
const GLOBAL = 3_000;

export function registerTelemetryApi(
  app: FastifyInstance,
  options: TelemetryApiOptions,
): () => TelemetryStats {
  const now = options.now ?? Date.now;
  const ipLimited = slidingWindowIpLimiter({ now, max: PER_IP, windowMs: MINUTE });
  const installLimited = slidingWindowIpLimiter({ now, max: PER_INSTALL, windowMs: MINUTE });
  const globalLimited = slidingWindowIpLimiter({ now, max: GLOBAL, windowMs: MINUTE, maxIps: 1 });
  const stats: TelemetryStats = { batches: 0, events: 0, droppedEvents: 0, rejected: 0, limited: 0 };

  const refuse = (reply: FastifyReply, code: number, error: string) => {
    if (code === 429) stats.limited += 1;
    else stats.rejected += 1;
    return reply.code(code).send({ error });
  };

  app.post(
    '/telemetry',
    { bodyLimit: TELEMETRY_BODY_MAX },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const origin = request.headers.origin;
      if (options.allowedOrigins && origin !== undefined && !options.allowedOrigins.includes(origin))
        return refuse(reply, 403, 'E_FORBIDDEN');
      if (globalLimited('*') || ipLimited(request.ip)) return refuse(reply, 429, 'E_RATE_LIMIT');
      // sendBeacon posts text/plain (no preflight); fetch posts JSON. Both are one shape.
      let body: unknown = request.body;
      if (typeof body === 'string') {
        try {
          body = JSON.parse(body);
        } catch {
          return refuse(reply, 400, 'E_BAD_REQUEST');
        }
      }
      const parsed = parseTelemetryBatch(body);
      if (!parsed.ok) return refuse(reply, 400, 'E_BAD_REQUEST');
      const { batch, dropped } = parsed;
      if (installLimited(batch.install)) return refuse(reply, 429, 'E_RATE_LIMIT');

      let actor: string | undefined;
      if (options.actorOf && options.identify && request.headers.authorization) {
        // A stale or forged token is not an error here: the events still count, anonymously.
        const who = await options.identify(request).catch(() => null);
        if (who) actor = options.actorOf(who.accountId);
      }
      const t = now();
      for (const ev of batch.events) {
        options.log.write({
          t,
          kind: 'client',
          e: ev.e,
          id: ev.id,
          ct: ev.t,
          install: batch.install,
          session: batch.session,
          build: batch.build,
          ...(actor ? { actor } : {}),
          ...(ev.p ? { p: ev.p } : {}),
        });
      }
      stats.batches += 1;
      stats.events += batch.events.length;
      stats.droppedEvents += dropped;
      return reply.code(204).send();
    },
  );

  return () => ({ ...stats });
}
