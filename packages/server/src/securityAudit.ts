import { createHmac, randomBytes, randomUUID } from 'node:crypto';
import { isIP } from 'node:net';
import { analyticsActor } from './analyticsActor';
import { buildVersion } from './buildVersion';
import { DailyJsonl, type DailyJsonlStats } from './dailyJsonl';

export type SecurityEvent =
  | 'auth.reject'
  | 'auth.success'
  | 'auth.change'
  | 'auth.logout'
  | 'auth.delete'
  | 'ws.reject'
  | 'ws.accept'
  | 'action.reject'
  | 'rate.limit'
  | 'http.reject'
  | 'http.error'
  | 'http.mutation'
  | 'process.start'
  | 'process.stop';
type Category = 'auth' | 'actions' | 'rate';
type Bucket = { since: number; count: number; alerted: boolean; sampledAt: number };

/** Server-generated pseudonyms only. Never attach a request, payload or raw identity. */
export interface SecurityContext {
  requestId?: string;
  source?: string;
  actor?: string;
  target?: string;
  route?: string;
  method?: string;
  status?: number;
  inputClass?: 'mixed-script';
}
interface AuditOptions {
  salt?: string;
  version?: string;
  journalStats?: () => DailyJsonlStats;
  flush?: () => Promise<void>;
  status?: (value: Record<string, unknown>) => void;
}
const EVENTS: ReadonlySet<SecurityEvent> = new Set([
  'auth.reject',
  'auth.success',
  'auth.change',
  'auth.logout',
  'auth.delete',
  'ws.reject',
  'ws.accept',
  'action.reject',
  'rate.limit',
  'http.reject',
  'http.error',
  'http.mutation',
  'process.start',
  'process.stop',
]);
const METHODS = new Set(['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD', 'OPTIONS', 'WS']);
const zeroJournal = (): DailyJsonlStats => ({ written: 0, dropped: 0, failed: 0 });

/** Erasure derives the same pseudonym from its existing protected identity ledger. */
export function securityTarget(salt: string, login: string): string {
  return createHmac('sha256', salt)
    .update(`security:target:${login.normalize('NFC').toLowerCase()}`)
    .digest('hex')
    .slice(0, 24);
}

/** Bounded operational audit, independent of request logging. The persistent sink
 * does not provide transactionally committed receipts or off-host immutability. */
export class SecurityAudit {
  private readonly salt: string | Buffer;
  private readonly actorOf: (id: string) => string;
  private readonly contexts = new WeakMap<object, SecurityContext>();
  private readonly sourceKeys = new WeakMap<object, string>();
  private readonly outcomes = new WeakMap<object, string>();
  private readonly buckets = new Map<SecurityEvent | Category, Bucket>();
  private readonly counts = Object.fromEntries([...EVENTS].map((event) => [event, 0]));
  private readonly run = randomUUID();
  private readonly startedAt: number;
  private timer?: ReturnType<typeof setInterval>;
  private sequence = 0;
  private sinkFailedAt = -Infinity;
  private failed = 0;
  private sampled = 0;
  private burstAt = -Infinity;
  private burstCount = 0;
  private lastEventAt = 0;

  constructor(
    private readonly sink: (line: string) => void = (line) => {
      process.stderr.write(line);
    },
    private readonly now: () => number = Date.now,
    private readonly options: AuditOptions = {},
  ) {
    this.salt = options.salt && options.salt.length >= 32 ? options.salt : randomBytes(32);
    this.actorOf = analyticsActor(
      typeof this.salt === 'string' ? this.salt : this.salt.toString('hex'),
    );
    this.startedAt = now();
  }

  /** ip comes from the host's trusted-proxy parser. route is a declared template.
   * Client request IDs, tokens, request URLs and query strings are never used. */
  request(request: object, ip: string, method: string, route: string): SecurityContext {
    const old = this.contexts.get(request);
    const day = new Date(this.now()).toISOString().slice(0, 10);
    const address = typeof ip === 'string' ? (ip.startsWith('::ffff:') ? ip.slice(7) : ip) : '';
    const sourceKey =
      isIP(address) && typeof this.salt === 'string'
        ? this.hash(`source-ip:${address}`)
        : undefined;
    if (sourceKey) this.sourceKeys.set(request, sourceKey);
    const context: SecurityContext = {
      ...old,
      requestId: old?.requestId ?? randomUUID(),
      ...(sourceKey ? { source: `${day}:${this.hash(`source:${day}:${sourceKey}`)}` } : {}),
      method: METHODS.has(method) ? method : 'OTHER',
      route:
        route === 'unmatched' || /^\/[A-Za-z0-9_/:.*-]{0,119}$/.test(route) ? route : 'unmatched',
    };
    this.contexts.set(request, context);
    return context;
  }
  identify(request: object, accountId: string): void {
    if (
      typeof this.salt !== 'string' ||
      typeof accountId !== 'string' ||
      !accountId.length ||
      accountId.length > 256
    )
      return;
    this.contexts.set(request, { ...this.contexts.get(request), actor: this.actorOf(accountId) });
  }
  target(request: object, login: unknown): void {
    if (
      typeof this.salt !== 'string' ||
      typeof login !== 'string' ||
      !login.length ||
      login.length > 128
    )
      return;
    this.contexts.set(request, {
      ...this.contexts.get(request),
      target: securityTarget(this.salt, login),
      ...(/\p{Script=Latin}/u.test(login) && /\p{Script=Cyrillic}/u.test(login)
        ? { inputClass: 'mixed-script' as const }
        : {}),
    });
  }
  context(request: object): SecurityContext | undefined {
    const context = this.contexts.get(request);
    const key = this.sourceKeys.get(request);
    const day = new Date(this.now()).toISOString().slice(0, 10);
    return context && key
      ? { ...context, source: `${day}:${this.hash(`source:${day}:${key}`)}` }
      : context;
  }
  result(request: object, code: unknown): void {
    if (typeof code === 'string' && /^E_[A-Z0-9_]{1,48}$/.test(code))
      this.outcomes.set(request, code);
  }
  bind(peer: object, context: SecurityContext | undefined, from?: object): void {
    if (context) this.contexts.set(peer, this.cleanContext(context));
    const key = from ? this.sourceKeys.get(from) : undefined;
    if (key) this.sourceKeys.set(peer, key);
  }

  http(
    request: { ip: string; method: string; routeOptions: { url?: string } },
    status: number,
  ): void {
    const route = request.routeOptions.url ?? 'unmatched';
    if (route === '/health' || route === '/ready') return;
    const context = { ...this.request(request, request.ip, request.method, route), status };
    let event: SecurityEvent | undefined;
    let code: string | undefined;
    if (status === 429) {
      event = 'rate.limit';
      code = 'E_RATE_LIMIT';
    } else if (status === 401 || status === 403) {
      event = 'auth.reject';
      code = 'E_AUTH';
    } else if (status >= 500) {
      event = 'http.error';
      code = 'E_INTERNAL';
    } else if (status >= 400) {
      event = 'http.reject';
      code = 'E_BAD_REQUEST';
    } else if (['/auth/login', '/auth/register'].includes(route) && [200, 201].includes(status))
      event = 'auth.success';
    else if (route === '/auth/reset' && status === 200) event = 'auth.change';
    else if (route === '/auth/logout' && status === 204) event = 'auth.logout';
    else if (route === '/auth/delete-account' && status === 202) event = 'auth.delete';
    else if (
      ['POST', 'PUT', 'PATCH', 'DELETE'].includes(request.method) &&
      !['/telemetry', '/activity/pulse'].includes(route)
    )
      event = 'http.mutation';
    if (event) this.record(event, this.outcomes.get(request) ?? code, undefined, context);
  }

  record(event: SecurityEvent, code?: string, matchId?: string, context?: SecurityContext): void {
    if (!EVENTS.has(event)) return;
    const at = this.now();
    this.lastEventAt = at;
    this.counts[event] = Math.min((this.counts[event] ?? 0) + 1, Number.MAX_SAFE_INTEGER);
    const category: Category | undefined =
      event === 'rate.limit'
        ? 'rate'
        : event === 'action.reject'
          ? 'actions'
          : event === 'auth.reject' || event === 'ws.reject'
            ? 'auth'
            : undefined;
    const key = category ?? event;
    let bucket = this.buckets.get(key);
    if (!bucket || at - bucket.since >= 60_000 || at < bucket.since) {
      bucket = { since: at, count: 0, alerted: false, sampledAt: -Infinity };
      this.buckets.set(key, bucket);
    }
    bucket.count = Math.min(bucket.count + 1, Number.MAX_SAFE_INTEGER);
    const safeContext = this.cleanContext(context ?? {});
    if (category && bucket.count >= 20 && !bucket.alerted) {
      bucket.alerted = true;
      this.write({
        kind: 'security.alert',
        at,
        category,
        event,
        count: bucket.count,
        windowMs: 60_000,
        severity: 'warning',
        ...safeContext,
      });
    }
    // Context-free legacy callers keep their flood sampling. Contextual HTTP/WS
    // probes are individually retained, subject to a separate global burst budget.
    if (!context && at - bucket.sampledAt < 1000) {
      this.sampled++;
      return;
    }
    if (at - this.burstAt >= 1000 || at < this.burstAt) {
      this.burstAt = at;
      this.burstCount = 0;
    }
    if (context && ++this.burstCount > 64) {
      this.sampled++;
      return;
    }
    bucket.sampledAt = at;
    this.write({
      kind: 'security.event',
      at,
      event,
      count: bucket.count,
      severity: event === 'http.error' ? 'error' : category ? 'warning' : 'info',
      ...(code ? { code: /^E_[A-Z0-9_]{1,48}$/.test(code) ? code : 'E_UNKNOWN' } : {}),
      ...(matchId ? { match: this.hash(`match:${matchId}`) } : {}),
      ...safeContext,
    });
  }

  start(): void {
    if (this.timer) return;
    this.record('process.start');
    this.status();
    this.timer = setInterval(() => this.status(), 60_000);
    this.timer.unref?.();
  }
  async close(): Promise<void> {
    if (this.timer) clearInterval(this.timer);
    this.timer = undefined;
    this.record('process.stop');
    this.status();
    await this.options.flush?.();
  }
  async flush(): Promise<void> {
    await this.options.flush?.();
  }
  summary(): Record<string, unknown> {
    return {
      schema: 2,
      startedAt: this.startedAt,
      at: this.now(),
      lastEventAt: this.lastEventAt,
      stableCorrelation: Number(typeof this.salt === 'string'),
      sampled: this.sampled,
      failed: this.failed,
      counts: { ...this.counts },
      journal: this.options.journalStats?.() ?? zeroJournal(),
    };
  }
  private hash(value: string): string {
    return createHmac('sha256', this.salt).update(`security:${value}`).digest('hex').slice(0, 24);
  }
  private cleanContext(context: SecurityContext): SecurityContext {
    const out: SecurityContext = {};
    if (typeof context.requestId === 'string' && /^[0-9a-f-]{36}$/.test(context.requestId))
      out.requestId = context.requestId;
    if (typeof context.actor === 'string' && /^[0-9a-f]{16}$/.test(context.actor))
      out.actor = context.actor;
    if (typeof context.target === 'string' && /^[0-9a-f]{24}$/.test(context.target))
      out.target = context.target;
    if (
      typeof context.source === 'string' &&
      /^\d{4}-\d{2}-\d{2}:[0-9a-f]{24}$/.test(context.source)
    )
      out.source = context.source;
    if (
      typeof context.route === 'string' &&
      (context.route === 'unmatched' || /^\/[A-Za-z0-9_/:.*-]{0,119}$/.test(context.route))
    )
      out.route = context.route;
    if (context.method && (METHODS.has(context.method) || context.method === 'OTHER'))
      out.method = context.method;
    if (Number.isInteger(context.status) && context.status! >= 100 && context.status! <= 599)
      out.status = context.status;
    if (context.inputClass === 'mixed-script') out.inputClass = context.inputClass;
    return out;
  }
  private status(): void {
    try {
      this.options.status?.({ ...this.summary(), kind: 'security.status', run: this.run });
    } catch {
      this.failed++;
    }
  }
  private write(value: Record<string, unknown>): void {
    try {
      this.sink(
        JSON.stringify({
          schema: 2,
          service: 'game',
          version: this.options.version ?? 'dev',
          run: this.run,
          sequence: ++this.sequence,
          ...value,
        }) + '\n',
      );
    } catch {
      this.failed++;
      const at = this.now();
      if (at - this.sinkFailedAt < 60_000) return;
      this.sinkFailedAt = at;
      try {
        process.stderr.write('{"kind":"security.sink_error","code":"E_AUDIT_SINK"}\n');
      } catch {
        /* The independent health projection still exposes the failure count. */
      }
    }
  }
}

/** Everyday game-rule errors and reconnect ordering are not security violations. */
const SECURITY_REJECT_CODES: ReadonlySet<string> = new Set([
  'E_FORBIDDEN',
  'E_BAD_PAYLOAD',
  'E_BAD_ACTION_ID',
  'E_BAD_MESSAGE',
  'E_REPLAY',
  'E_PAYLOAD_TOO_LARGE',
]);
export function roomRejectionEvent(code: string): SecurityEvent | null {
  if (code === 'E_RATE_LIMIT') return 'rate.limit';
  return SECURITY_REJECT_CODES.has(code) ? 'action.reject' : null;
}

/** Persisted with game/client journals, including their erasure inventory. Priority
 * auth/alerts and heartbeats have separate daily budgets. Nothing reads Docker logs. */
export function securityAuditFromEnv(env: NodeJS.ProcessEnv): SecurityAudit | undefined {
  if (env.PROD !== '1' && env.PROD !== 'true' && env.SECURITY_AUDIT !== '1') return undefined;
  const journals = new Map<string, DailyJsonl>();
  const journal = (prefix: string, bytes: number): DailyJsonl => {
    let value = journals.get(prefix);
    if (!value) {
      value = new DailyJsonl({
        dir: env.SECURITY_LOG_DIR ?? 'playtest-logs',
        prefix,
        retentionDays: 13,
        maxQueued: 1024,
        maxQueuedBytes: 512 * 1024,
        maxFileBytes: bytes,
        durable: true,
      });
      journals.set(prefix, value);
    }
    return value;
  };
  return new SecurityAudit(
    (line) => {
      const record = JSON.parse(line) as Record<string, unknown>;
      const priority =
        record.kind === 'security.alert' ||
        [
          'auth.success',
          'auth.change',
          'auth.logout',
          'auth.delete',
          'process.start',
          'process.stop',
        ].includes(String(record.event));
      journal(
        priority ? 'security-auth' : 'security',
        priority ? 1024 * 1024 : 4 * 1024 * 1024,
      ).write(record);
    },
    Date.now,
    {
      ...(env.ANALYTICS_SALT ? { salt: env.ANALYTICS_SALT } : {}),
      version: buildVersion(env.GIT_SHA) ?? 'dev',
      journalStats: () =>
        [...journals.values()].reduce((sum, j) => {
          const stat = j.stats();
          return {
            written: sum.written + stat.written,
            dropped: sum.dropped + stat.dropped,
            failed: sum.failed + stat.failed,
          };
        }, zeroJournal()),
      flush: async () => {
        await Promise.all([...journals.values()].map((j) => j.flush()));
      },
      status: (value) => journal('security-status', 2 * 1024 * 1024).write(value),
    },
  );
}
