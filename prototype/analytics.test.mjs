import { describe, expect, it } from 'vitest';
import {
  activity,
  connection,
  errors,
  funnel,
  loading,
  percentile,
  personSources,
  powerCurve,
  retention,
  sessions,
  survival,
  taskSuccess,
  uniqueEvents,
} from './analytics.mjs';

const DAY = 86_400_000;
const D0 = Date.UTC(2026, 9, 1);
const H = 3_600_000;
const c = (t, install, session, e, p, actor) => ({ t, kind: 'client', e, install, session, ...(actor ? { actor } : {}), ...(p ? { p } : {}) });

// Alice: opens, logs in, joins, acts, comes back on day 1 and day 7.
// Bob: opens, sees login, fails, leaves for good on day 0.
// Carol: anonymous, only opens.
const client = [
  c(D0, 'ia', 'sa1', 'app_loaded', { loadMs: 800, mobile: false, src: 'tg' }),
  c(D0 + 1000, 'ia', 'sa1', 'login_shown'),
  c(D0 + 60_000, 'ia', 'sa1', 'login_ok', { created: true }, 'alice'),
  c(D0 + 90_000, 'ia', 'sa1', 'match_list_shown', { available: 1, mine: 0 }, 'alice'),
  c(D0 + 120_000, 'ia', 'sa1', 'ws_ready', { connectMs: 300, reconnect: false }, 'alice'),
  c(D0 + 120_000, 'ia', 'sa1', 'match_joined', { firstTime: true }, 'alice'),
  c(D0 + 30 * 60_000, 'ia', 'sa1', 'ws_closed', { code: 1006, afterMs: 1 }, 'alice'),
  c(D0 + 30 * 60_000 + 1, 'ia', 'sa1', 'ws_ready', { connectMs: 100, reconnect: true }, 'alice'),
  c(D0 + 40 * 60_000, 'ia', 'sa1', 'session_ended', { ms: 40 * 60_000 }),
  c(D0 + DAY + 2 * H, 'ia', 'sa2', 'app_loaded', { loadMs: 600, mobile: false }, 'alice'),
  c(D0 + 7 * DAY, 'ia', 'sa3', 'app_loaded', { loadMs: 700, mobile: false }, 'alice'),
  c(D0 + 2 * H, 'ib', 'sb1', 'app_loaded', { loadMs: 3000, mobile: true, src: 'reddit' }),
  c(D0 + 2 * H + 1000, 'ib', 'sb1', 'login_shown'),
  c(D0 + 2 * H + 2000, 'ib', 'sb1', 'login_failed', { code: 'wrong-password' }),
  c(D0 + 2 * H + 3000, 'ib', 'sb1', 'client_error', { kind: 'error', name: 'TypeError', where: 'app:1:5', n: 4 }),
  c(D0 + 3 * H, 'ic', 'sc1', 'app_loaded', { loadMs: 1000, mobile: true }),
  c(D0 + 14 * DAY, 'iz', 'sz1', 'session_started', { entry: 'main' }), // the end of data
];
const match = [
  { t: D0 + 120_000, match: 'm1', kind: 'join', playerId: 'p1', actor: 'alice' },
  { t: D0 + 130_000, match: 'm1', kind: 'action', playerId: 'p1', ok: true },
  { t: D0 + 140_000, match: 'm1', kind: 'action', playerId: 'p1', ok: false, code: 'E_NO_CAPACITY' },
  { t: D0 + 150_000, match: 'm1', kind: 'action', playerId: 'p2', ok: true }, // a bot seat: nobody
];
const people = activity(client, match);
const lastT = D0 + 14 * DAY;

describe('analytics', () => {
  it('folds the anonymous install into its actor', () => {
    expect([...people.keys()].sort()).toEqual(['alice', 'install:ib', 'install:ic', 'install:iz']);
  });

  it('funnel counts people per step in order, and who came back', () => {
    const f = funnel(people);
    expect(f.steps.map((s) => [s.step, s.people])).toEqual([
      ['opened', 4],
      ['saw_login', 2],
      ['logged_in', 1],
      ['saw_matches', 1],
      ['joined', 1],
      ['first_action', 1],
    ]);
    expect(f.steps[2].medianMin).toBe(1);
    expect(f.returned).toBe(1);
  });

  it('connection: first connects vs reconnects, drops, failed logins', () => {
    const k = connection(client);
    expect(k.connects).toBe(1);
    expect(k.reconnects).toBe(1);
    expect(k.connectMs).toEqual({ p50: 300, p95: 300 });
    expect(k.dropsPerSession).toBe(1);
    expect(k.loginFailed).toEqual([['wrong-password', 1]]);
  });

  it('loading splits phones and computers', () => {
    expect(loading(client)).toEqual({
      mobile: { n: 2, p50: 1000, p95: 3000 },
      desktop: { n: 3, p50: 700, p95: 800 },
    });
  });

  it('errors sum the client repeat counter', () => {
    expect(errors(client)).toEqual([{ key: 'error TypeError @ app:1:5', n: 4, sessions: 1 }]);
  });

  it('sessions: length from session_ended, gaps between a person’s sessions', () => {
    const s = sessions(client);
    expect(s.count).toBe(6);
    expect(s.gaps).toEqual({ '<1h': 0, '1-6h': 0, '6-24h': 0, '1-3d': 1, '>3d': 1 });
  });

  it('retention counts only closed windows; unbounded ≥ exact', () => {
    const r = retention(people, lastT, [1, 7]);
    // Alice, Bob and Carol started on day 0; the end-of-data person on day 14 is not eligible.
    expect(r[0]).toEqual({ n: 1, eligible: 3, day: 1 / 3, unbounded: 1 / 3 });
    expect(r[1]).toEqual({ n: 7, eligible: 3, day: 1 / 3, unbounded: 1 / 3 });
  });

  it('power curve: people by number of active days', () => {
    expect(powerCurve(people)).toEqual([
      [1, 3],
      [3, 1],
    ]);
  });

  it('survival: Bob and Carol gone after day 0, Alice gone after day 7', () => {
    const s = survival(people, lastT, 7, [1, 8]);
    // at risk at t=0: 4 (incl. the censored newcomer) → 2 churn → 1/2; at t=7: 1 at risk (Alice) → 0.
    expect(s).toEqual([
      { day: 1, survival: 0.5 },
      { day: 8, survival: 0 },
    ]);
  });

  it('task success: share of rejected actions with codes', () => {
    expect(taskSuccess(people)).toEqual([
      { person: 'alice', actions: 2, rejectRate: 0.5, codes: [['E_NO_CAPACITY', 1]] },
    ]);
  });

  it('invite tag per person', () => {
    expect(Object.fromEntries(personSources(client))).toEqual({
      alice: 'tg',
      'install:ib': 'reddit',
      'install:ic': '—',
    });
  });

  it('percentile is nearest-rank', () => {
    expect(percentile([5, 1, 3, 2, 4], 50)).toBe(3);
    expect(percentile([], 50)).toBeNull();
  });

  it('a batch delivered twice (request and beacon) counts once', () => {
    const a = { install: 'i1', id: 'ev-1', e: 'pve_started' };
    const b = { install: 'i2', id: 'ev-1', e: 'pve_started' };
    expect(uniqueEvents([a, { ...a }, b])).toEqual([a, b]);
  });
});
