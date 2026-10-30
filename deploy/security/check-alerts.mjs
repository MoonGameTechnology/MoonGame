// CI uses the existing immutable Prometheus pin; no second image version to drift.
import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
import { isMainModule } from '../observability/main-module.mjs';
export function prometheusImage(text) {
  const section = /^ {2}obs-prometheus:\n([\s\S]*?)(?=^ {2}[a-z][a-z0-9-]*:|^networks:)/m.exec(
    text,
  )?.[1];
  const image = /^ {4}image: (prom\/prometheus:v[0-9.]+@sha256:[a-f0-9]{64})$/m.exec(
    section ?? '',
  )?.[1];
  if (!image) throw Error('E_SECURITY_PROMTOOL_IMAGE');
  return image;
}
export function checkAlerts() {
  const root = fileURLToPath(new URL('../../', import.meta.url));
  const image = prometheusImage(
    readFileSync(resolve(root, 'deploy/docker-compose.observability.yml'), 'utf8'),
  );
  const result = spawnSync(
    'docker',
    [
      'run',
      '--rm',
      '--network',
      'none',
      '--read-only',
      '--cap-drop',
      'ALL',
      '--security-opt',
      'no-new-privileges',
      '--memory',
      '256m',
      '--cpus',
      '1',
      '--tmpfs',
      '/tmp:rw,noexec,nosuid,nodev,size=32m,mode=1777',
      '--entrypoint',
      '/bin/promtool',
      '-v',
      `${root}:/work:ro`,
      '-w',
      '/work',
      image,
      'test',
      'rules',
      'deploy/observability/security.rules.test.yml',
    ],
    { stdio: 'inherit', timeout: 120000 },
  );
  if (result.status !== 0) throw Error('E_SECURITY_PROMTOOL');
}
if (isMainModule(import.meta.url)) {
  try {
    checkAlerts();
  } catch {
    process.stderr.write('E_SECURITY_PROMTOOL\n');
    process.exitCode = 1;
  }
}
