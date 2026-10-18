import { afterEach, expect, it } from 'vitest';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { chmodSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const checker = fileURLToPath(new URL('./privacy-readiness.py', import.meta.url));
const dirs = [];
afterEach(() => { for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true }); });
function fixture() {
  const dir = mkdtempSync(join(tmpdir(), 'privacy-evidence-'));
  dirs.push(dir);
  const path = join(dir, 'synthetic-evidence');
  writeFileSync(path, 'synthetic review, never real personal data', { mode: 0o600 });
  const evidence = { path, sha256: createHash('sha256').update(readFileSync(path)).digest('hex') };
  const manifest = JSON.parse(readFileSync(new URL('./privacy-release.example.json', import.meta.url), 'utf8'));
  manifest.operator = { name: 'Synthetic operator', address: 'Synthetic test address', contactEmail: 'privacy@test.invalid' };
  manifest.approvedBy = 'Synthetic reviewer';
  manifest.reviewedAt = new Date().toISOString().slice(0, 10);
  for (const key of Object.keys(manifest.evidence)) manifest.evidence[key] = evidence;
  for (const store of manifest.stores) Object.assign(store, { country: 'RU', provider: 'Synthetic provider', evidence });
  const file = join(dir, 'manifest.json');
  const run = () => {
    writeFileSync(file, JSON.stringify(manifest), { mode: 0o600 });
    try { return { ok: true, output: execFileSync('python3', [checker, file], { encoding: 'utf8', stdio: 'pipe' }) }; }
    catch (e) { return { ok: false, output: String(e.stderr) }; }
  };
  return { run, manifest, path };
}
it('requires a complete reviewed manifest and rejects changed evidence without printing its content', () => {
  const f = fixture();
  expect(f.run().ok).toBe(true);
  writeFileSync(f.path, 'private details must never appear in logs');
  const bad = f.run();
  expect(bad.ok).toBe(false);
  expect(bad.output).not.toContain('private details');
});
it('rejects missing operator, non-Russian storage, stale approval, and writable evidence', () => {
  for (const change of [
    (f) => { f.manifest.operator.name = ''; },
    (f) => { f.manifest.stores[0].country = 'US'; },
    (f) => { f.manifest.reviewedAt = '2000-01-01'; },
    (f) => { delete f.manifest.evidence.subjectRequests; },
    (f) => { chmodSync(f.path, 0o666); },
  ]) {
    const f = fixture(); change(f); expect(f.run().ok).toBe(false);
  }
});
