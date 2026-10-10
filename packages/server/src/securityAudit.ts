import { createHmac, randomBytes } from 'node:crypto';

export type SecurityEvent =
  'auth.reject' | 'auth.success' | 'auth.change' | 'ws.reject' | 'action.reject' | 'rate.limit';
type Category = 'auth' | 'actions' | 'rate';
type Bucket = { since: number; count: number; alerted: boolean; sampledAt: number };

/** Fixed-cardinality counters + sampled JSONL. No request/exception/payload objects enter
 * the sink. IDs are keyed, process-local pseudonyms; IPs/logins/JWTs are never collected. */
export class SecurityAudit {
  private readonly salt = randomBytes(32);
  private readonly buckets = new Map<SecurityEvent | Category, Bucket>();
  private sinkFailedAt = -Infinity;
  constructor(
    private readonly sink: (line: string) => void = (line) => {
      process.stderr.write(line);
    },
    private readonly now: () => number = Date.now,
  ) {}

  record(event: SecurityEvent, code?: string, matchId?: string): void {
    const allowed: readonly SecurityEvent[] = [
      'auth.reject',
      'auth.success',
      'auth.change',
      'ws.reject',
      'action.reject',
      'rate.limit',
    ];
    if (!allowed.includes(event)) return;
    const at = this.now();
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
    // Count every denial, including samples dropped to keep attack traffic from filling disk.
    if (category && bucket.count >= 20 && !bucket.alerted) {
      bucket.alerted = true;
      this.write({
        kind: 'security.alert',
        at,
        category,
        event,
        count: bucket.count,
        windowMs: 60_000,
      });
    }
    if (at - bucket.sampledAt < 1000) return;
    bucket.sampledAt = at;
    this.write({
      kind: 'security.event',
      at,
      event,
      count: bucket.count,
      ...(code ? { code: /^E_[A-Z0-9_]{1,48}$/.test(code) ? code : 'E_UNKNOWN' } : {}),
      ...(matchId
        ? { match: createHmac('sha256', this.salt).update(matchId).digest('hex').slice(0, 24) }
        : {}),
    });
  }

  private write(value: object): void {
    try {
      this.sink(JSON.stringify(value) + '\n');
    } catch {
      const at = this.now();
      if (at - this.sinkFailedAt < 60_000) return;
      this.sinkFailedAt = at;
      process.stderr.write('{"kind":"security.sink_error","code":"E_AUDIT_SINK"}\n');
    }
  }
}

/** Default on for release posture; explicit SECURITY_AUDIT=1 also enables LAN staging. */
export function securityAuditFromEnv(env: NodeJS.ProcessEnv): SecurityAudit | undefined {
  return env.PROD === '1' || env.PROD === 'true' || env.SECURITY_AUDIT === '1'
    ? new SecurityAudit()
    : undefined;
}
