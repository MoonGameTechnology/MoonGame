import { describe, expect, it } from 'vitest';
import { tutorialAttempts } from './analytics.mjs';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';

const event = (sequence, action, extra = {}) => ({
  kind: 'client', e: 'onboarding_step', id: `event${sequence}`, t: 1000 + sequence,
  install: 'install01', session: 'session01', actor: 'alice',
  p: { guide: 'main', attempt: 'a'.repeat(32), sequence, action, index: sequence,
    step: `economy.${sequence}`, stage: 'economy', total: 100, elapsedMs: sequence, ...extra },
});
describe('tutorial report', () => {
  it('exposes the new breakdown in the existing operator CLI', () => {
    const dir = mkdtempSync(join(tmpdir(), 'tutorial-report-'));
    try {
      writeFileSync(join(dir, 'client-1970-01-01.jsonl'),
        [event(0, 'started'), event(1, 'step')].map((row) => JSON.stringify(row)).join('\n') + '\n');
      const run = spawnSync(process.execPath, ['prototype/analyticsReport.mjs', '--dir', dir], { encoding: 'utf8' });
      expect(run.status, run.stderr).toBe(0);
      expect(run.stdout).toContain('main: уникальных 1, попыток 1, начало записано 1');
      expect(run.stdout).toContain('incomplete: economy / economy.1');
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });
  it('deduplicates beacon copies, uses attempt sequence despite receipt reorder, and preserves skip outcome', () => {
    const first = event(0, 'started');
    const last = event(2, 'completed', { skippedStages: 1, stage: 'assault' });
    const rows = tutorialAttempts([last, first, event(1, 'step'), { ...first, actor: undefined }], 999999);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ startedObserved: true, status: 'completed_with_skips', index: 2, step: 'economy.2' });
    expect(rows[0].stages.sort()).toEqual(['assault', 'economy']);
  });
  it('distinguishes a hidden live tab, a silent incomplete attempt, a resumed page, and an explicit exit', () => {
    const lines = [event(0, 'started'), event(1, 'hidden')];
    expect(tutorialAttempts(lines, 1002)[0].status).toBe('pending');
    expect(tutorialAttempts(lines, 301001)[0].status).toBe('incomplete');
    expect(tutorialAttempts([...lines, { ...event(2, 'visible'), t: 400000 }], 400001)[0].status).toBe('pending');
    expect(tutorialAttempts([...lines, event(2, 'exited')], 999999)[0].status).toBe('exited');
  });
  it('keeps retries, accounts and guides separate and includes partial windows without fabricating starts', () => {
    const rows = tutorialAttempts([event(1, 'step'),
      { ...event(2, 'started'), actor: 'bob' },
      event(3, 'started', { attempt: 'b'.repeat(32) }),
      event(4, 'started', { guide: 'sector-zero' }),
      event(5, 'step', { guide: 'pirates' }),
      event(6, 'step', { attempt: '<script>' })], 999999);
    expect(rows).toHaveLength(4);
    expect(rows[0].startedObserved).toBe(false);
  });
});
