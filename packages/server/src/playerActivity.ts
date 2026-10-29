import type { Pool } from 'pg';

/** Confirmed foreground intervals only. Lost signals can undercount time;
 * a gap >70s is never charged. No client clock, nickname, IP or match state is stored. */
export const ACTIVITY_GAP_MS = 70_000;
export const ACTIVITY_DAYS = 30;
export const ACTIVITY_CHANNELS = 8;
const DAY = 86_400_000;
const MAX_SPANS = 1024;
const dayAt = (ms: number): string => new Date(ms).toISOString().slice(0, 10);
const dayStart = (ms: number): number => Math.floor(ms / DAY) * DAY;
export interface ActivityDay {
  day: string;
  players: number;
  visits: number;
  seconds: number;
  /** Menu entries reported by authenticated clients; not proof of playing a chapter. */
  sectorZeroEntries?: number;
}
export interface ActivitySnapshot {
  schema: 1;
  since: number;
  at: number;
  online: number;
  days: ActivityDay[];
}
export interface PlayerActivityStore {
  pulse(
    account: string,
    channel: string,
    active: boolean,
    at: number,
    sequence: number,
    sectorZero?: boolean,
  ): Promise<void>;
  snapshot(at: number): Promise<ActivitySnapshot>;
}
/** Split at UTC midnight, including a zero-length first observation in today's DAU. */
function pieces(from: number, to: number): [string, number, number][] {
  const out: [string, number, number][] = [];
  for (let start = from; start < to;) {
    const end = Math.min(to, dayStart(start) + DAY);
    out.push([dayAt(start), start, end]);
    start = end;
  }
  if (!out.some(([day]) => day === dayAt(to))) out.push([dayAt(to), to, to]);
  return out;
}
export function unionActivity(
  spans: readonly [number, number][],
  start: number,
  end: number,
): [number, number][] {
  const result: [number, number][] = [];
  for (const [lo, hi] of [...spans, [start, end] as [number, number]]
    .filter(([a, b]) => b > a)
    .sort((a, b) => a[0] - b[0])) {
    const last = result.at(-1);
    if (last && lo <= last[1]) last[1] = Math.max(last[1], hi);
    else result.push([lo, hi]);
  }
  if (result.length > MAX_SPANS) throw Error('E_ACTIVITY_CAP');
  return result;
}
function windowDays(at: number, since: number, rows: Map<string, ActivityDay>): ActivityDay[] {
  const result: ActivityDay[] = [];
  for (
    let t = Math.max(dayStart(since), dayStart(at) - (ACTIVITY_DAYS - 1) * DAY);
    t <= at;
    t += DAY
  ) {
    const day = dayAt(t);
    result.push(rows.get(day) ?? { day, players: 0, visits: 0, seconds: 0 });
  }
  return result;
}

export class MemoryPlayerActivityStore implements PlayerActivityStore {
  private readonly channels = new Map<
    string,
    Map<string, { at: number; sequence: number; active: boolean }>
  >();
  private readonly rows = new Map<
    string,
    { day: string; account: string; visits: number; sectorZeroEntries?: number; spans: [number, number][] }
  >();
  constructor(private readonly since = Date.now()) {}
  private prune(at: number): void {
    for (const [key, row] of this.rows)
      if (row.day < dayAt(at - (ACTIVITY_DAYS - 1) * DAY)) this.rows.delete(key);
    for (const [id, channels] of this.channels) {
      for (const [key, seen] of channels) if (seen.at < at - ACTIVITY_GAP_MS) channels.delete(key);
      if (!channels.size) this.channels.delete(id);
    }
  }
  async pulse(
    account: string,
    channel: string,
    active: boolean,
    at: number,
    sequence: number,
    sectorZero?: boolean,
  ): Promise<void> {
    this.prune(at);
    const channels =
      this.channels.get(account) ??
      new Map<string, { at: number; sequence: number; active: boolean }>();
    const previous = channels.get(channel);
    const seen = previous?.at;
    if (previous && (at < previous.at || sequence <= previous.sequence)) return;
    if (seen === undefined && channels.size >= ACTIVITY_CHANNELS) throw Error('E_ACTIVITY_CAP');
    const continuous = !!previous?.active && sequence === previous.sequence + 1
      && seen !== undefined && at - seen <= ACTIVITY_GAP_MS;
    const updates = (
      active || continuous
        ? pieces(
            continuous ? seen! : at,
            at,
          )
        : []
    ).map(([day, lo, hi]) => {
      const key = JSON.stringify([account, day]);
      const old = this.rows.get(key) ?? { day, account, visits: 0, spans: [] };
      return [
        key,
        {
          ...old,
          ...(sectorZero && active && day === dayAt(at)
            ? { sectorZeroEntries: (old.sectorZeroEntries ?? 0) + 1 } : {}),
          spans: unionActivity(old.spans, lo, hi),
          visits: old.visits + Number(active && !continuous && day === dayAt(at)),
        },
      ] as const;
    });
    if (this.rows.size + updates.filter(([key]) => !this.rows.has(key)).length > 50_000)
      throw Error('E_ACTIVITY_CAP');
    for (const [key, row] of updates) this.rows.set(key, row);
    channels.set(channel, { at, sequence, active });
    if (channels.size) this.channels.set(account, channels);
    else this.channels.delete(account);
  }
  async snapshot(at: number): Promise<ActivitySnapshot> {
    this.prune(at);
    const days = new Map<string, ActivityDay>();
    for (const row of this.rows.values()) {
      const day = days.get(row.day) ?? { day: row.day, players: 0, visits: 0, seconds: 0 };
      day.players++;
      day.visits += row.visits;
      if (row.sectorZeroEntries) day.sectorZeroEntries = (day.sectorZeroEntries ?? 0) + row.sectorZeroEntries;
      day.seconds += row.spans.reduce((sum, [a, b]) => sum + b - a, 0) / 1000;
      days.set(row.day, day);
    }
    return {
      schema: 1,
      since: this.since,
      at,
      online: [...this.channels.values()].filter((channels) =>
        [...channels.values()].some((c) => c.active),
      ).length,
      days: windowDays(at, this.since, days),
    };
  }
}

export class PostgresPlayerActivityStore implements PlayerActivityStore {
  private cleanedAt = -Infinity;
  constructor(private readonly pool: Pool) {}
  /** Both pulse and scrape prune: an idle service still expires data. Hourly, single flight. */
  private cleanup?: Promise<void>;
  private async prune(at: number): Promise<void> {
    if (at - this.cleanedAt < 3_600_000) return;
    if (!this.cleanup)
      this.cleanup = (async () => {
        await this.pool.query('DELETE FROM player_activity_days WHERE day < $1::date', [
          dayAt(at - (ACTIVITY_DAYS - 1) * DAY),
        ]);
        await this.pool.query('DELETE FROM player_activity_channels WHERE seen_ms < $1', [
          at - ACTIVITY_GAP_MS,
        ]);
        this.cleanedAt = at;
      })().finally(() => {
        this.cleanup = undefined;
      });
    await this.cleanup;
  }
  async pulse(
    account: string,
    channel: string,
    active: boolean,
    at: number,
    sequence: number,
    sectorZero?: boolean,
  ): Promise<void> {
    await this.prune(at);
    const db = await this.pool.connect();
    try {
      await db.query('BEGIN');
      await db.query("SET LOCAL statement_timeout='1500ms'");
      // One account lock serializes its tabs/devices and races with account erasure.
      const user = await db.query(
        'SELECT id FROM users WHERE id=$1 AND deletion_requested_at IS NULL FOR UPDATE',
        [account],
      );
      if (!user.rowCount) throw Error('E_UNAUTHORIZED');
      await db.query('DELETE FROM player_activity_channels WHERE account_id=$1 AND seen_ms<$2', [
        account,
        at - ACTIVITY_GAP_MS,
      ]);
      const channels = await db.query<{
        channel: string;
        seen_ms: string;
        sequence: number;
        active: boolean;
      }>(
        'SELECT channel,seen_ms,sequence,active FROM player_activity_channels WHERE account_id=$1',
        [account],
      );
      const previous = channels.rows.find((r) => r.channel === channel);
      const seen = previous ? Number(previous.seen_ms) : undefined;
      if (previous && (at < Number(previous.seen_ms) || sequence <= previous.sequence)) {
        await db.query('COMMIT');
        return;
      }
      if (seen === undefined && channels.rowCount! >= ACTIVITY_CHANNELS)
        throw Error('E_ACTIVITY_CAP');
      const continuous = !!previous?.active && sequence === previous.sequence + 1
        && seen !== undefined && at - seen <= ACTIVITY_GAP_MS;
      for (const [day, lo, hi] of active || continuous
        ? pieces(
            continuous ? seen! : at,
            at,
          )
        : []) {
        const visits = Number(active && !continuous && day === dayAt(at));
        const written = await db.query(
          `INSERT INTO player_activity_days(account_id,day,spans,visits,sector_zero_entries,sector_zero_first_ms,sector_zero_last_ms)
          VALUES($1,$2::date,int8multirange(int8range($3::bigint,$4::bigint,'[)')),$5,$6,$7,$7)
          ON CONFLICT(account_id,day) DO UPDATE SET spans=player_activity_days.spans+excluded.spans,
          visits=player_activity_days.visits+excluded.visits,
          sector_zero_entries=player_activity_days.sector_zero_entries+excluded.sector_zero_entries,
          sector_zero_first_ms=least(player_activity_days.sector_zero_first_ms,excluded.sector_zero_first_ms),
          sector_zero_last_ms=greatest(excluded.sector_zero_last_ms,player_activity_days.sector_zero_last_ms)
          WHERE (SELECT count(*) FROM unnest(player_activity_days.spans+excluded.spans))<=1024 RETURNING account_id`,
          [account, day, lo, hi, visits, Number(!!sectorZero && active && day === dayAt(at)),
            sectorZero && active && day === dayAt(at) ? at : null],
        );
        if (!written.rowCount) throw Error('E_ACTIVITY_CAP');
      }
      await db.query(
        `INSERT INTO player_activity_channels(account_id,channel,seen_ms,sequence,active) VALUES($1,$2,$3,$4,$5)
        ON CONFLICT(account_id,channel) DO UPDATE SET seen_ms=excluded.seen_ms,sequence=excluded.sequence,active=excluded.active`,
        [account, channel, at, sequence, active],
      );
      await db.query('COMMIT');
    } catch (err) {
      await db.query('ROLLBACK');
      throw err;
    } finally {
      db.release();
    }
  }
  async snapshot(at: number): Promise<ActivitySnapshot> {
    await this.prune(at);
    const start = await this.pool.query<{ since_ms: string }>(
      'SELECT since_ms FROM player_activity_state WHERE id=1',
    );
    const since = Number(start.rows[0]!.since_ms);
    const online = await this.pool.query<{ n: string }>(
      'SELECT count(DISTINCT account_id) n FROM player_activity_channels WHERE active AND seen_ms BETWEEN $1 AND $2',
      [at - ACTIVITY_GAP_MS, at],
    );
    const rows = await this.pool.query<{
      day: string;
      players: string;
      visits: string;
      seconds: string;
      sector_zero_entries: string;
    }>(
      `SELECT to_char(day,'YYYY-MM-DD') AS day,
      count(*) players, sum(visits) visits, sum(sector_zero_entries) sector_zero_entries,
      sum((SELECT coalesce(sum(upper(span)-lower(span)),0) FROM unnest(spans) span))/1000.0 seconds
      FROM player_activity_days WHERE day BETWEEN $1::date AND $2::date GROUP BY day ORDER BY day`,
      [dayAt(at - (ACTIVITY_DAYS - 1) * DAY), dayAt(at)],
    );
    const days = new Map(
      rows.rows.map((r) => [
        r.day,
        {
          day: r.day,
          players: Number(r.players),
          visits: Number(r.visits),
          seconds: Number(r.seconds),
          ...(Number(r.sector_zero_entries) > 0 ? { sectorZeroEntries: Number(r.sector_zero_entries) } : {}),
        },
      ]),
    );
    return {
      schema: 1,
      since,
      at,
      online: Number(online.rows[0]!.n),
      days: windowDays(at, since, days),
    };
  }
}
