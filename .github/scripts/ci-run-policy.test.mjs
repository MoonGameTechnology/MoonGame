import { describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import { runPolicy } from './ci-run-policy.mjs';

const pr = (overrides = {}) => ({
  state: 'open',
  head: { ref: 'work', repo: { full_name: 'MoonGameTechnology/MoonGame' } },
  ...overrides,
});

function fixture(eventName = 'push', ref = 'refs/heads/work', data = []) {
  const list = vi.fn().mockResolvedValue({ data });
  return {
    context: {
      eventName,
      ref,
      repo: { owner: 'MoonGameTechnology', repo: 'MoonGame' },
      payload: {},
    },
    github: { rest: { pulls: { list } } },
    core: { info: vi.fn(), warning: vi.fn() },
    list,
  };
}

describe('CI event deduplication', () => {
  it.each(['pull_request', 'merge_group', 'schedule', 'workflow_dispatch'])(
    '%s always gets the full checks without PR lookup',
    async (eventName) => {
      const f = fixture(eventName, 'refs/heads/gh-readonly-queue/main/pr-1', [pr()]);
      expect(await runPolicy(f)).toBe(true);
      expect(f.list).not.toHaveBeenCalled();
    },
  );

  it('a queue push keeps required checks even without merge_group delivery, without an API call', async () => {
    const f = fixture('push', 'refs/heads/gh-readonly-queue/main/pr-1', [pr()]);
    expect(await runPolicy(f)).toBe(true);
    expect(f.list).not.toHaveBeenCalled();
  });

  it('skips a push covered by an open PR of the exact repository and branch', async () => {
    const f = fixture('push', 'refs/heads/work', [pr()]);
    expect(await runPolicy(f)).toBe(false);
    expect(f.list).toHaveBeenCalledWith({
      owner: 'MoonGameTechnology',
      repo: 'MoonGame',
      head: 'MoonGameTechnology:work',
      state: 'open',
      per_page: 100,
      request: { timeout: 10_000 },
    });
  });

  it('keeps early branch checks, including branches with a closed PR', async () => {
    expect(await runPolicy(fixture())).toBe(true);
    expect(await runPolicy(fixture('push', 'refs/heads/work', [pr({ state: 'closed' })]))).toBe(
      true,
    );
  });

  it('a fork or a different branch cannot suppress checks on our push', async () => {
    for (const head of [
      { ref: 'work', repo: { full_name: 'other/MoonGame' } },
      { ref: 'elsewhere', repo: { full_name: 'MoonGameTechnology/MoonGame' } },
      { ref: 'work', repo: null },
    ])
      expect(await runPolicy(fixture('push', 'refs/heads/work', [pr({ head })]))).toBe(true);
  });

  it('API errors and malformed responses fall back to running, never certify an untested commit', async () => {
    for (const data of [null, {}, 'bad']) {
      const f = fixture('push', 'refs/heads/work', data);
      expect(await runPolicy(f)).toBe(true);
      expect(f.core.warning).toHaveBeenCalled();
    }
    const f = fixture();
    f.list.mockRejectedValue(new Error('403 private failure detail'));
    expect(await runPolicy(f)).toBe(true);
    expect(JSON.stringify(f.core.warning.mock.calls)).not.toContain('private failure detail');
  });

  it('passes unusual branch names as data to the API', async () => {
    const f = fixture('push', 'refs/heads/work/with-$characters');
    expect(await runPolicy(f)).toBe(true);
    expect(f.list.mock.calls[0][0].head).toBe('MoonGameTechnology:work/with-$characters');
  });

  it('does not build deleted branches or assume an unexpected ref has a PR', async () => {
    const f = fixture();
    f.context.payload.deleted = true;
    expect(await runPolicy(f)).toBe(false);
    const tag = fixture('push', 'refs/tags/v1');
    expect(await runPolicy(tag)).toBe(true);
    expect(tag.list).not.toHaveBeenCalled();
  });
});

// These six names are the live main ruleset's required contexts. A skipped push
// uses a different context. A queue push MUST run under the canonical names.
const required = [
  'lint · typecheck · test · audit',
  'SAST patterns (Semgrep)',
  'Secrets — tree (Gitleaks)',
  'SCA — osv.dev (OSV-Scanner)',
  'Vuln + IaC — files (Trivy fs)',
  'Vuln — built image base OS (Trivy image)',
];
const workflows = ['ci', 'security'].map((name) =>
  readFileSync(`.github/workflows/${name}.yml`, 'utf8'),
);
const guard =
  "!cancelled() && (github.event_name != 'push' || startsWith(github.ref, 'refs/heads/gh-readonly-queue/') || needs.run-policy.outputs.run != 'false')";

// The guards use the common JS/Actions subset (string comparisons and booleans).
// Evaluate the actual YAML expression, not a separately reimplemented decision.
const evaluate = (expression, event, output, cancelled = false, ref = 'refs/heads/work') =>
  runInNewContext(expression.replaceAll('needs.run-policy', "needs['run-policy']"), {
    github: { event_name: event, ref },
    needs: { 'run-policy': { outputs: { run: output } } },
    cancelled: () => cancelled,
    always: () => true,
    startsWith: (value, prefix) => value.startsWith(prefix),
  });

describe('workflow wiring and required-check isolation', () => {
  it('keeps all event triggers and separates cancellation groups', () => {
    for (const text of workflows) {
      expect(text).toContain("branches: ['**', '!main']");
      expect(text).toMatch(/^ {2}pull_request:/m);
      expect(text).toMatch(/^ {2}merge_group:/m);
      expect(text).toMatch(/^ {2}workflow_dispatch:/m);
      expect(text).toContain('${{ github.event_name }}');
      expect(text).toContain("cancel-in-progress: ${{ github.event_name != 'merge_group' }}");
    }
    expect(workflows[1]).toContain("- cron: '17 5 * * 1'");
  });

  it('every heavy job honors the policy, while a failed policy cannot skip required checks', () => {
    for (const text of workflows) {
      const jobs = text
        .slice(text.indexOf('\njobs:'))
        .split(/\n {2}[a-z][a-z-]*:\n/)
        .slice(1);
      for (const job of jobs) {
        if (job.includes('name: Select ')) continue;
        expect(job).toContain('run-policy');
        if (job.includes('name:') && job.includes('summarize + report')) {
          expect(job).toContain(
            "always() && (github.event_name != 'push' || startsWith(github.ref, 'refs/heads/gh-readonly-queue/') || needs.run-policy.outputs.run != 'false')",
          );
        } else expect(job).toContain(guard);
      }
    }
  });

  it('ordinary branch push copies cannot emit any of the six required context names', () => {
    for (const name of required) {
      const line = workflows
        .join('\n')
        .split('\n')
        .find((s) => s.includes(` }}${name}`));
      expect(line).toBeDefined();
      expect(line).toContain(
        "${{ github.event_name == 'push' && !startsWith(github.ref, 'refs/heads/gh-readonly-queue/') && 'Branch — ' || '' }}",
      );
      expect(
        line.replace(
          "${{ github.event_name == 'push' && !startsWith(github.ref, 'refs/heads/gh-readonly-queue/') && 'Branch — ' || '' }}",
          '',
        ),
      ).toContain(`name: ${name}`);
    }
  });

  it('actual required-job guards run after a missing/failed router and ignore its result on canonical events', () => {
    const jobs = workflows.flatMap((text) => text.split(/\n {2}[a-z][a-z-]*:\n/));
    for (const name of required) {
      const job = jobs.find((block) =>
        block
          .split('\n')
          .some((line) => line.trimStart().startsWith('name:') && line.endsWith(name)),
      );
      const condition = /^ {4}if: \$\{\{ (.+) \}\}$/m.exec(job)[1];
      const prefix = /name: \$\{\{ (.+?) \}\}/.exec(job)[1];
      for (const event of ['pull_request', 'merge_group', 'workflow_dispatch', 'schedule']) {
        expect(evaluate(condition, event, 'false')).toBe(true);
        expect(evaluate(prefix, event) + name).toBe(name);
      }
      for (const output of [undefined, '', 'true'])
        expect(evaluate(condition, 'push', output)).toBe(true);
      expect(evaluate(condition, 'push', 'false')).toBe(false);
      expect(evaluate(condition, 'merge_group', 'true', true)).toBe(false);
      expect(required).not.toContain(evaluate(prefix, 'push') + name);
      const queueRef = 'refs/heads/gh-readonly-queue/main/pr-2033';
      for (const output of [undefined, '', 'false', 'true']) {
        expect(evaluate(condition, 'push', output, false, queueRef)).toBe(true);
        expect(evaluate(prefix, 'push', output, false, queueRef) + name).toBe(name);
      }
    }
  });

  it('does not produce an unconfirmed scanner report for an intentionally skipped push', () => {
    const report = workflows[1].split('\n  report:')[1];
    const condition = /^ {4}if: \$\{\{ (.+) \}\}$/m.exec(report)[1];
    expect(evaluate(condition, 'push', 'false')).toBe(false);
    expect(evaluate(condition, 'push', undefined)).toBe(true);
    expect(evaluate(condition, 'pull_request', 'false')).toBe(true);
    expect(
      evaluate(condition, 'push', 'false', false, 'refs/heads/gh-readonly-queue/main/pr-1'),
    ).toBe(true);
  });

  it('routing only needs read permissions and uses pinned actions without persisting credentials', () => {
    for (const text of workflows) {
      const policy = text.split('\n  run-policy:')[1].split(/\n {2}[a-z][a-z-]*:\n/)[0];
      expect(policy).toContain('pull-requests: read');
      expect(policy).not.toContain(': write');
      expect(policy).toContain('persist-credentials: false');
      expect(policy).toContain('sparse-checkout: .github/scripts');
      expect(policy).toContain('runPolicy({ github, context, core })');
      expect([...policy.matchAll(/uses: (.+)/g)].every((m) => /@[a-f0-9]{40} /.test(m[1]))).toBe(
        true,
      );
    }
  });
});
