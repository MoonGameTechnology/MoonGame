import { afterEach, describe, expect, it } from 'vitest';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const script = fileURLToPath(new URL('./caddy-rebuild-acceptance.sh', import.meta.url));
const dirs = [];
afterEach(() => dirs.splice(0).forEach((dir) => rmSync(dir, { recursive: true, force: true })));

function acceptance(report) {
  const dir = mkdtempSync(join(tmpdir(), 'caddy-acceptance-'));
  dirs.push(dir);
  const file = join(dir, 'report.json');
  writeFileSync(file, typeof report === 'string' ? report : JSON.stringify(report));
  try {
    execFileSync('bash', [script, file], { stdio: 'pipe' });
    return 0;
  } catch (error) {
    return error.status;
  }
}

const binary = (vulnerabilities = []) => ({
  Results: [{ Target: 'usr/bin/caddy', Vulnerabilities: vulnerabilities }],
});

describe('Caddy release security acceptance', () => {
  it('accepts a scanned binary with neither targeted vulnerability', () => {
    expect(acceptance(binary())).toBe(0);
  });
  it.each([
    ['CVE-2026-111943', 'stdlib'],
    ['CVE-2026-114437', 'github.com/go-chi/chi/v5'],
  ])('rejects the vulnerable Caddy dependency %s', (VulnerabilityID, PkgName) => {
    expect(acceptance(binary([{ VulnerabilityID, PkgName }]))).toBe(1);
  });
  it.each(['', '{broken', {}, { Results: [] }])(
    'rejects a failed or incomplete scan: %j',
    (report) => {
      expect(acceptance(report)).toBe(1);
    },
  );
});
