import { describe, expect, it } from 'vitest';
import { existsSync, mkdtempSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { scan, selectFiles, toSarif } from './config-lint.mjs';

const finding = {
  file: './deploy/run.sh',
  line: 4,
  column: 7,
  level: 'warning',
  code: 2086,
  message: 'Double quote to prevent globbing and word splitting.',
};

describe('configuration scanners', () => {
  it('keeps the weekly default-branch rescan and includes every new scanner in aggregation', () => {
    const workflow = readFileSync('.github/workflows/security.yml', 'utf8');
    expect(workflow).toMatch(/schedule:\s*\n(?:\s*#[^\n]*\n)*\s*- cron: '17 5 \* \* 1'/);
    expect(workflow).toContain('  workflow_dispatch:');
    for (const key of ['actionlint', 'shellcheck', 'hadolint']) {
      const job = workflow.split(`\n  ${key}:`)[1].split(/\n {2}[a-z]/)[0];
      // Only the shared run-policy gate: still runs on weekly main, PR and queue;
      // a push duplicate of an already covered PR is the one case it skips.
      expect(job).toContain('    needs: run-policy\n');
      expect(job.match(/^ {4}if: (.*)$/m)?.[1]).toBe(
        "${{ !cancelled() && (github.event_name != 'push' || startsWith(github.ref, 'refs/heads/gh-readonly-queue/') || needs.run-policy.outputs.run != 'false') }}",
      );
      expect(job).toContain(`config-lint.mjs ${key} config-report`);
      expect(job).toContain('persist-credentials: false');
      expect(job).toContain('if-no-files-found: error');
      expect(workflow.split('\n  report:')[1]).toContain(`        ${key},`);
    }
  });

  it('selects tracked workflows, Dockerfile variants and shell scripts including extensionless shebangs', () => {
    const paths = [
      'Dockerfile',
      'deploy/Dockerfile.test',
      'ci/build.Dockerfile',
      'docs/Dockerfile.md',
      '.github/workflows/ci.yml',
      '.github/actions/build/action.yml',
      'deploy/a.sh',
      'tools/run',
      'app.ts',
    ];
    const read = (p) => (p === 'tools/run' ? '#!/usr/bin/env bash\necho ok' : '');
    expect(selectFiles('hadolint', paths, read)).toEqual(paths.slice(0, 3));
    expect(selectFiles('actionlint', paths, read)).toEqual(['.github/workflows/ci.yml']);
    expect(selectFiles('shellcheck', paths, read)).toEqual(['deploy/a.sh', 'tools/run']);
  });

  it('normalizes all three native formats to relative SARIF locations without snippets or fixes', () => {
    const native = {
      shellcheck: { comments: [{ ...finding, fix: { replacements: ['private code'] } }] },
      hadolint: [{ ...finding, code: 'DL3002' }],
      actionlint: [
        {
          filepath: './.github/workflows/ci.yml',
          line: 4,
          column: 7,
          kind: 'expression',
          message: 'invalid expression',
          snippet: 'private code',
        },
      ],
    };
    for (const [key, report] of Object.entries(native)) {
      const sarif = toSarif(key, JSON.stringify(report));
      expect(sarif.version).toBe('2.1.0');
      expect(sarif.runs[0].results).toHaveLength(1);
      expect(sarif.runs[0].results[0].locations[0].physicalLocation.region.startLine).toBe(4);
      expect(
        sarif.runs[0].results[0].locations[0].physicalLocation.artifactLocation.uri,
      ).not.toMatch(/^\.\//);
      expect(JSON.stringify(sarif)).not.toContain('private code');
    }
    expect(toSarif('shellcheck', JSON.stringify(native.shellcheck)).runs[0].results[0].ruleId).toBe(
      'SC2086',
    );
  });

  it('preserves embedded ShellCheck severity rather than escalating style notes to errors', () => {
    const sarif = toSarif(
      'actionlint',
      JSON.stringify([
        {
          filepath: '.github/workflows/ci.yml',
          line: 1,
          column: 1,
          kind: 'shellcheck',
          message:
            'shellcheck reported issue in this script: SC2012:info:2:6: Use find instead of ls',
        },
      ]),
    );
    expect(sarif.runs[0].results[0]).toMatchObject({ ruleId: 'shellcheck-SC2012', level: 'note' });
  });

  it('rejects malformed output, missing locations and unknown severity instead of certifying a clean scan', () => {
    for (const raw of [
      '',
      '{}',
      '{"comments":null}',
      JSON.stringify({ comments: [{}] }),
      JSON.stringify({ comments: [{ ...finding, file: '/etc/passwd' }] }),
      JSON.stringify({ comments: [{ ...finding, level: 'unknown' }] }),
    ]) {
      expect(() => toSarif('shellcheck', raw)).toThrow();
    }
  });

  const run = (result, paths = ['deploy/run.sh']) => {
    const dir = mkdtempSync(join(tmpdir(), 'config-lint-'));
    const calls = [];
    const ok = scan('shellcheck', {
      root: dir,
      out: dir,
      paths,
      read: () => '',
      run: (command, args) => {
        calls.push([command, args]);
        return result;
      },
    });
    return {
      ok,
      calls,
      status: JSON.parse(readFileSync(join(dir, 'status-shellcheck.json'))),
      dir,
    };
  };

  it('accepts findings as informational, with count and hardened offline read-only execution', () => {
    const result = run({ status: 1, stdout: JSON.stringify({ comments: [finding] }) });
    expect(result.ok).toBe(true);
    expect(result.status).toMatchObject({
      key: 'shellcheck',
      ok: true,
      exit: 1,
      findings: 1,
      files: 1,
    });
    expect(result.calls[0][1]).toEqual(
      expect.arrayContaining([
        '--network=none',
        '--read-only',
        '--cap-drop=ALL',
        '--security-opt=no-new-privileges',
        './deploy/run.sh',
      ]),
    );
    expect(result.calls[0][1].some((x) => /@sha256:[a-f0-9]{64}$/.test(x))).toBe(true);
  });

  it('separates a genuine zero from startup failure, timeout, malformed/partial output and no input', () => {
    expect(run({ status: 0, stdout: '{"comments":[]}' }).status).toMatchObject({
      ok: true,
      findings: 0,
    });
    for (const result of [
      { status: 125, stdout: '' },
      { status: null, error: new Error('timeout') },
      { status: 2, stdout: '{"comments":[]}' },
      { status: 0, stdout: '{}' },
      { status: 1, stdout: '{"comments":[]}' },
      { status: 0, stdout: JSON.stringify({ comments: [finding] }) },
    ]) {
      const failed = run(result);
      expect(failed.ok).toBe(false);
      expect(failed.status).toMatchObject({ ok: false, findings: null });
    }
    const empty = run({ status: 0, stdout: '{"comments":[]}' }, []);
    expect(empty.status.ok).toBe(false);
    expect(empty.calls).toHaveLength(0);
  });

  it('a failed rerun removes the old SARIF rather than uploading stale findings', () => {
    const first = run({ status: 1, stdout: JSON.stringify({ comments: [finding] }) });
    expect(existsSync(join(first.dir, 'shellcheck.sarif'))).toBe(true);
    expect(scan('shellcheck', { root: first.dir, out: first.dir, paths: [], read: () => '' })).toBe(
      false,
    );
    expect(existsSync(join(first.dir, 'shellcheck.sarif'))).toBe(false);
  });

  it('new scanner SARIF and sentinels participate in the real aggregate', () => {
    const root = mkdtempSync(join(tmpdir(), 'config-report-'));
    const dir = join(root, 'reports');
    mkdirSync(dir);
    writeFileSync(
      join(dir, 'shellcheck.sarif'),
      JSON.stringify(toSarif('shellcheck', JSON.stringify({ comments: [finding] }))),
    );
    writeFileSync(
      join(dir, 'status-shellcheck.json'),
      JSON.stringify({ key: 'shellcheck', ok: true, exit: 1 }),
    );
    execFileSync(process.execPath, [
      '.github/scripts/summarize-security.mjs',
      dir,
      join(root, 'report.md'),
    ]);
    const md = readFileSync(join(root, 'report.md'), 'utf8');
    expect(md).toContain('SC2086');
    expect(md).toContain('deploy/run.sh');
    expect(md).toMatch(/ShellCheck[^\n]+✅/);
  });
});
