// PTM-2.1 (docs/playtest-telemetry-roadmap.md): the behaviour report after a network test.
// Pure: takes parsed journal lines, returns numbers. The CLI around it is
// `analyticsReport.mjs` (`pnpm run analytics`).
//
// Who is a "person": the analytics pseudonym `actor` when any of their lines carries one
// (they logged in), otherwise the browser install. An install that logged in is folded
// into its actor, so the anonymous steps before login count for the same person.
// Definitions follow docs/research/2026-10-13-player-engagement-research.md («План
// измерения»): cohorts by the UTC day of first activity, only complete windows count.

const DAY = 86_400_000;

export const utcDay = (t) => new Date(t).toISOString().slice(0, 10);
const dayIndex = (t) => Math.floor(t / DAY);

/** Nearest-rank percentile of numbers; null for none. */
export function percentile(values, p) {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const rank = Math.min(sorted.length - 1, Math.max(0, Math.ceil((p / 100) * sorted.length) - 1));
  return sorted[rank];
}

/** install → actor, from any client line of that install that carries one. */
export function installActors(clientLines) {
  const map = new Map();
  for (const l of clientLines) if (l.actor && !map.has(l.install)) map.set(l.install, l.actor);
  return map;
}

/** Person key for a client line. */
export function personOf(line, actors) {
  return line.actor ?? actors.get(line.install) ?? `install:${line.install}`;
}

/** (match, seat) → actor from the match journal's joins. */
function seatActors(matchLines) {
  const map = new Map();
  for (const l of matchLines) if (l.kind === 'join' && l.actor) map.set(`${l.match}|${l.playerId}`, l.actor);
  return map;
}

/** Every person's time-ordered activity: client events plus their own match actions. */
export function activity(clientLines, matchLines) {
  const actors = installActors(clientLines);
  const seats = seatActors(matchLines);
  const byPerson = new Map();
  const add = (person, entry) => {
    if (!byPerson.has(person)) byPerson.set(person, []);
    byPerson.get(person).push(entry);
  };
  for (const l of clientLines) add(personOf(l, actors), { t: l.t, e: l.e, p: l.p ?? {}, session: l.session });
  for (const l of matchLines) {
    if (l.kind !== 'action') continue;
    const actor = seats.get(`${l.match}|${l.playerId}`);
    if (actor) add(actor, { t: l.t, e: l.ok ? 'action_ok' : 'action_rejected', p: l.code ? { code: l.code } : {} });
  }
  for (const list of byPerson.values()) list.sort((a, b) => a.t - b.t);
  return byPerson;
}

export const FUNNEL = [
  ['opened', (e) => e.e === 'app_loaded' || e.e === 'session_started'],
  ['saw_login', (e) => e.e === 'login_shown'],
  ['logged_in', (e) => e.e === 'login_ok'],
  ['saw_matches', (e) => e.e === 'match_list_shown'],
  ['joined', (e) => e.e === 'match_joined' || e.e === 'ws_ready'],
  ['first_action', (e) => e.e === 'action_ok' || e.e === 'action_rejected'],
];

/** People reaching each step (in order of the funnel, not of time) and the median
 *  minutes from opening to the step; `returned` = active on a second UTC day. */
export function funnel(byPerson) {
  const rows = FUNNEL.map(([step]) => ({ step, people: 0, minutes: [] }));
  let returned = 0;
  for (const list of byPerson.values()) {
    const start = list[0].t;
    let alive = true;
    FUNNEL.forEach(([, hit], i) => {
      const at = alive ? list.find(hit) : undefined;
      if (!at) {
        alive = false;
        return;
      }
      rows[i].people += 1;
      rows[i].minutes.push((at.t - start) / 60_000);
    });
    if (new Set(list.map((e) => dayIndex(e.t))).size > 1) returned += 1;
  }
  return {
    steps: rows.map((r) => ({ step: r.step, people: r.people, medianMin: percentile(r.minutes, 50) })),
    returned,
  };
}

/** Link health from the client side. */
export function connection(clientLines) {
  const ready = clientLines.filter((l) => l.e === 'ws_ready');
  const first = ready.filter((l) => !l.p?.reconnect).map((l) => l.p?.connectMs ?? 0);
  const sessions = new Set(ready.map((l) => l.session)).size;
  const closed = clientLines.filter((l) => l.e === 'ws_closed');
  const failed = new Map();
  for (const l of clientLines)
    if (l.e === 'login_failed') failed.set(l.p?.code ?? '?', (failed.get(l.p?.code ?? '?') ?? 0) + 1);
  return {
    connects: first.length,
    reconnects: ready.length - first.length,
    connectMs: { p50: percentile(first, 50), p95: percentile(first, 95) },
    dropsPerSession: sessions ? closed.length / sessions : 0,
    closeCodes: countBy(closed, (l) => String(l.p?.code ?? '?')),
    loginFailed: [...failed.entries()].sort((a, b) => b[1] - a[1]),
  };
}

function countBy(lines, key) {
  const m = new Map();
  for (const l of lines) m.set(key(l), (m.get(key(l)) ?? 0) + 1);
  return [...m.entries()].sort((a, b) => b[1] - a[1]);
}

/** Load time p50/p95, phones and computers apart. */
export function loading(clientLines) {
  const out = {};
  for (const mobile of [true, false]) {
    const ms = clientLines.filter((l) => l.e === 'app_loaded' && l.p?.mobile === mobile).map((l) => l.p.loadMs);
    out[mobile ? 'mobile' : 'desktop'] = { n: ms.length, p50: percentile(ms, 50), p95: percentile(ms, 95) };
  }
  return out;
}

/** Top errors by type and place, summing the client's own repeat counter. */
export function errors(clientLines) {
  const m = new Map();
  for (const l of clientLines) {
    if (l.e !== 'client_error') continue;
    const key = `${l.p?.kind ?? '?'} ${l.p?.name ?? '?'} @ ${l.p?.where ?? '?'}`;
    const row = m.get(key) ?? { key, n: 0, sessions: new Set() };
    row.n += l.p?.n ?? 1;
    row.sessions.add(l.session);
    m.set(key, row);
  }
  return [...m.values()].map((r) => ({ key: r.key, n: r.n, sessions: r.sessions.size })).sort((a, b) => b.n - a.n);
}

/** Sessions (page loads): length percentiles, per person per active day, and the gaps
 *  between a person's sessions — the gap histogram is what picks the "gone" threshold. */
export function sessions(clientLines) {
  const actors = installActors(clientLines);
  const bySession = new Map();
  for (const l of clientLines) {
    const s = bySession.get(l.session) ?? { person: personOf(l, actors), start: l.t, end: l.t, ms: 0 };
    s.start = Math.min(s.start, l.t);
    s.end = Math.max(s.end, l.t);
    if (l.e === 'session_ended' && typeof l.p?.ms === 'number') s.ms = Math.max(s.ms, l.p.ms);
    bySession.set(l.session, s);
  }
  const list = [...bySession.values()];
  const lengths = list.map((s) => Math.max(s.ms, s.end - s.start) / 60_000);
  const perPersonDay = new Map();
  for (const s of list) {
    const k = `${s.person}|${dayIndex(s.start)}`;
    perPersonDay.set(k, (perPersonDay.get(k) ?? 0) + 1);
  }
  const gaps = { '<1h': 0, '1-6h': 0, '6-24h': 0, '1-3d': 0, '>3d': 0 };
  const byPerson = new Map();
  for (const s of list) byPerson.set(s.person, [...(byPerson.get(s.person) ?? []), s]);
  for (const own of byPerson.values()) {
    own.sort((a, b) => a.start - b.start);
    for (let i = 1; i < own.length; i++) {
      const h = (own[i].start - own[i - 1].end) / 3_600_000;
      gaps[h < 1 ? '<1h' : h < 6 ? '1-6h' : h < 24 ? '6-24h' : h < 72 ? '1-3d' : '>3d'] += 1;
    }
  }
  return {
    count: list.length,
    minutes: { p50: percentile(lengths, 50), p75: percentile(lengths, 75), p90: percentile(lengths, 90) },
    perPersonDay: percentile([...perPersonDay.values()], 50),
    gaps,
  };
}

/**
 * Retention by first-day cohort. `day n` = active exactly on day n after the first;
 * `unbounded n` = active on day n or any later day. Only people whose window has
 * closed (first day + n ≤ last day of data) are counted.
 */
export function retention(byPerson, lastT, days = [1, 3, 7, 14, 30]) {
  const last = dayIndex(lastT);
  const people = [...byPerson.values()].map((list) => {
    const active = new Set(list.map((e) => dayIndex(e.t)));
    return { first: Math.min(...active), active };
  });
  return days.map((n) => {
    const eligible = people.filter((p) => p.first + n <= last);
    const exact = eligible.filter((p) => p.active.has(p.first + n)).length;
    const unbounded = eligible.filter((p) => [...p.active].some((d) => d >= p.first + n)).length;
    return {
      n,
      eligible: eligible.length,
      day: eligible.length ? exact / eligible.length : null,
      unbounded: eligible.length ? unbounded / eligible.length : null,
    };
  });
}

/** Power-user curve: how many people were active on exactly k distinct days. */
export function powerCurve(byPerson) {
  const curve = new Map();
  for (const list of byPerson.values()) {
    const k = new Set(list.map((e) => dayIndex(e.t))).size;
    curve.set(k, (curve.get(k) ?? 0) + 1);
  }
  return [...curve.entries()].sort((a, b) => a[0] - b[0]);
}

/**
 * Kaplan–Meier survival of "still playing", in days since first activity. A person
 * churned at their last active day if they have been silent for `goneDays` before the
 * end of data; otherwise they are censored (still possibly playing) at the end.
 */
export function survival(byPerson, lastT, goneDays = 7, at = [1, 3, 7, 14, 30]) {
  const last = dayIndex(lastT);
  const obs = [...byPerson.values()].map((list) => {
    const days = list.map((e) => dayIndex(e.t));
    const first = Math.min(...days);
    const lastActive = Math.max(...days);
    const churned = last - lastActive >= goneDays;
    return { time: (churned ? lastActive : last) - first, churned };
  });
  const times = [...new Set(obs.filter((o) => o.churned).map((o) => o.time))].sort((a, b) => a - b);
  let s = 1;
  const steps = [];
  for (const time of times) {
    const atRisk = obs.filter((o) => o.time >= time).length;
    const died = obs.filter((o) => o.churned && o.time === time).length;
    if (atRisk > 0) s *= 1 - died / atRisk;
    steps.push([time, s]);
  }
  // A churn "at day t" means the last active day was t; the person is gone from t+1.
  return at.map((d) => ({ day: d, survival: steps.filter(([t]) => t < d).at(-1)?.[1] ?? 1 }));
}

/** Task success: per person the share of rejected actions and the top codes. */
export function taskSuccess(byPerson) {
  const rows = [];
  for (const [person, list] of byPerson) {
    const acts = list.filter((e) => e.e === 'action_ok' || e.e === 'action_rejected');
    if (acts.length === 0) continue;
    const rejected = acts.filter((e) => e.e === 'action_rejected');
    rows.push({
      person,
      actions: acts.length,
      rejectRate: rejected.length / acts.length,
      codes: countBy(rejected, (e) => e.p.code ?? '?').slice(0, 3),
    });
  }
  return rows.sort((a, b) => b.rejectRate - a.rejectRate);
}

/** Invite tag of each person: the first `src` their `app_loaded` carried (`—` if none). */
export function personSources(clientLines) {
  const actors = installActors(clientLines);
  const out = new Map();
  for (const l of clientLines) {
    if (l.e !== 'app_loaded') continue;
    const person = personOf(l, actors);
    if (!out.has(person)) out.set(person, l.p?.src ?? '—');
  }
  return out;
}
