// PTM-0.1 (docs/playtest-telemetry-roadmap.md): which lines of a playtest JSONL a
// report reads. The prod journal is one file per UTC day holding every match that ran
// that day (`playtest-logs/match-YYYY-MM-DD.jsonl`), so the report must pick one match
// out of it; old per-run files (`proto-<ms>.jsonl`) usually hold one. Pure: no fs.

/** `--match <id>`, `--day YYYY-MM-DD` and an optional positional file. */
export function parseReportArgs(argv) {
  const out = { file: undefined, match: undefined, day: undefined };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--') continue;
    if (a === '--match') out.match = argv[++i];
    else if (a === '--day') out.day = argv[++i];
    else if (!a.startsWith('--')) out.file = a;
  }
  if (out.day !== undefined && !/^\d{4}-\d{2}-\d{2}$/.test(out.day)) {
    throw new Error(`--day ждёт YYYY-MM-DD, получено «${out.day}»`);
  }
  return out;
}

/** Matches in the file, in order of first appearance, with their line counts. */
export function listMatches(lines) {
  const counts = new Map();
  for (const l of lines)
    if (typeof l.match === 'string') counts.set(l.match, (counts.get(l.match) ?? 0) + 1);
  return [...counts.entries()].map(([id, count]) => ({ id, count }));
}

/**
 * The last summary of each server run in the file, in run order. A summary is a
 * cumulative snapshot of ONE process: a restart within the UTC day starts the next
 * run's counters at zero, so only the last snapshot per run is its truth, and runs are
 * reported side by side, not merged (percentiles of two runs don't add up). Old files
 * carry no `run` — they were one run each.
 */
export function lastSummaries(lines) {
  const byRun = new Map();
  for (const l of lines) if (l.kind === 'summary') byRun.set(l.run ?? '', l.summary);
  return [...byRun.values()];
}

/**
 * Lines for one match report.
 * - `match` given: that match's lines (+ process summaries, flagged as process-wide).
 * - none given and the file holds at most one match: every line, as before.
 * - none given and several matches: `{ choose: [...] }` — the caller lists them.
 * `summaryScope` says what the latency summary covers. Summaries are written by the
 * server's one process-wide aggregator, which outlives matches and UTC days, so they
 * are process-wide — except in an old per-run file (no `run` on its summaries) that holds
 * a single match.
 */
export function selectLines(lines, match) {
  const matches = listMatches(lines);
  const daily = lines.some((l) => l.kind === 'summary' && l.run !== undefined);
  const summaryScope = daily || matches.length > 1 ? 'process' : 'match';
  if (match === undefined) {
    if (matches.length > 1) return { choose: matches };
    return { lines, summaryScope };
  }
  if (!matches.some((m) => m.id === match)) return { missing: match, choose: matches };
  const picked = lines.filter((l) => l.match === match || l.kind === 'summary');
  return { lines: picked, summaryScope };
}
