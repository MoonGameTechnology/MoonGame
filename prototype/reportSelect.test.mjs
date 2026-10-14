import { describe, expect, it } from 'vitest';
import { lastSummaries, listMatches, parseReportArgs, selectLines } from './reportSelect.mjs';

const twoMatches = [
  { t: 1, match: 'm1', kind: 'join', playerId: 'p1' },
  { t: 2, match: 'm2', kind: 'join', playerId: 'p1' },
  { t: 3, match: 'm1', kind: 'action', ok: true },
  { t: 4, kind: 'summary', summary: {} },
];

describe('parseReportArgs', () => {
  it('reads --match, --day and a positional file, ignoring the pnpm `--`', () => {
    expect(parseReportArgs(['--', '--match', 'm1', '--day', '2026-10-14'])).toEqual({
      file: undefined,
      match: 'm1',
      day: '2026-10-14',
    });
    expect(parseReportArgs(['playtest-logs/proto-1.jsonl'])).toEqual({
      file: 'playtest-logs/proto-1.jsonl',
      match: undefined,
      day: undefined,
    });
  });

  it('refuses a malformed day', () => {
    expect(() => parseReportArgs(['--day', '14.10.2026'])).toThrow(/YYYY-MM-DD/);
  });
});

describe('lastSummaries', () => {
  it('keeps the last snapshot of each run, runs apart, in order', () => {
    const lines = [
      { kind: 'summary', run: 'a', summary: { n: 1 } },
      { kind: 'join' },
      { kind: 'summary', run: 'a', summary: { n: 2 } },
      { kind: 'summary', run: 'b', summary: { n: 1 } },
    ];
    expect(lastSummaries(lines)).toEqual([{ n: 2 }, { n: 1 }]);
  });

  it('an old file without run ids has one run', () => {
    expect(lastSummaries([{ kind: 'summary', summary: { n: 1 } }, { kind: 'summary', summary: { n: 3 } }])).toEqual([{ n: 3 }]);
  });
});

describe('listMatches', () => {
  it('lists matches by first appearance with line counts', () => {
    expect(listMatches(twoMatches)).toEqual([
      { id: 'm1', count: 2 },
      { id: 'm2', count: 1 },
    ]);
  });
});

describe('selectLines', () => {
  it('a file with several matches and no --match asks to choose', () => {
    expect(selectLines(twoMatches, undefined)).toEqual({ choose: listMatches(twoMatches) });
  });

  it('--match keeps that match and the process summary, flagged process-wide', () => {
    const r = selectLines(twoMatches, 'm1');
    expect(r.lines.map((l) => l.t)).toEqual([1, 3, 4]);
    expect(r.summaryScope).toBe('process');
  });

  it('a daily journal (summaries carry run) is process-wide even with one match', () => {
    const daily = [
      { t: 1, match: 'm1', kind: 'join', playerId: 'p1' },
      { t: 2, kind: 'summary', run: 'r1', summary: {} },
    ];
    expect(selectLines(daily, undefined).summaryScope).toBe('process');
    expect(selectLines(daily, 'm1').summaryScope).toBe('process');
  });

  it('a one-match file reads as before, summary scoped to the match', () => {
    const one = twoMatches.filter((l) => l.match !== 'm2');
    expect(selectLines(one, undefined)).toEqual({ lines: one, summaryScope: 'match' });
    expect(selectLines(one, 'm1').summaryScope).toBe('match');
  });

  it('an unknown match id is reported with the list', () => {
    expect(selectLines(twoMatches, 'nope')).toEqual({
      missing: 'nope',
      choose: listMatches(twoMatches),
    });
  });
});
