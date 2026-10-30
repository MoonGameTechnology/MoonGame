import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { prometheusImage } from './check-alerts.mjs';
import { withEdgeImport } from './edge-logging.mjs';
import { projectSource } from '../observability/game-exporter.mjs';
import { EVENTS } from './records.mjs';
const read = (path) => readFileSync(new URL(path, import.meta.url), 'utf8');

describe('operator boundaries and panel-only provisioning', () => {
  it('exports finite security labels, ignores identity fields and rejects malformed source data', () => {
    const security = {
      schema: 2,
      startedAt: 100,
      at: 200,
      sampled: 0,
      failed: 0,
      stableCorrelation: 1,
      counts: Object.fromEntries([...EVENTS].map((event) => [event, 0])),
      journal: { written: 1, dropped: 0, failed: 0 },
      actor: 'PRIVATE_SECRET',
      source: 'PRIVATE_SECRET',
      token: 'PRIVATE_SECRET',
    };
    security.counts.PRIVATE_SECRET = 8;
    const result = projectSource('metrics', { matches: 1, connections: 0, security });
    expect(JSON.stringify(result)).not.toContain('PRIVATE_SECRET');
    expect(result.samples.filter((s) => s.name === 'moongame_security_events_total')).toHaveLength(
      EVENTS.size,
    );
    expect(result.samples.every((s) => Object.keys(s.labels).every((key) => key === 'event'))).toBe(
      true,
    );
    expect(
      projectSource('metrics', {
        matches: 1,
        connections: 0,
        security: { ...security, stableCorrelation: 9 },
      }),
    ).toBeNull();
    expect(
      projectSource('metrics', {
        matches: 1,
        connections: 0,
        security: { ...security, journal: { written: 1, dropped: -1, failed: 0 } },
      }),
    ).toBeNull();
  });
  it('has a read-only Prometheus dashboard with missing-data gates and no identity labels', () => {
    const dashboard = JSON.parse(
      read('../observability/grafana/provisioning/dashboards/security.json'),
    );
    expect(dashboard.editable).toBe(false);
    for (const panel of dashboard.panels.filter((p) => p.type !== 'text')) {
      expect(panel.datasource.uid).toBe('moongame-prometheus');
      for (const target of panel.targets) {
        expect(target.expr).not.toMatch(/actor|sourceHash|requestId|account_id|token/);
        if (!target.expr.startsWith('ALERTS'))
          expect(target.expr).toMatch(/timestamp_seconds < 45/);
      }
    }
    const rules = read('../observability/security.rules.yml');
    expect(rules).toContain('absent(up{job="observer"})');
    expect(rules).not.toMatch(/webhook|smtp|telegram|receiver|token/i);
    expect(read('../observability/prometheus.yml')).toContain('/etc/prometheus/security.rules.yml');
    expect(read('../docker-compose.observability.yml')).toContain(
      'target: /etc/prometheus/security.rules.yml',
    );
  });
  it('keeps the host worker resource bounded, networkless and outside the public HTTP surface', () => {
    const unit = read('./moongame-security-monitor.service');
    for (const setting of [
      'MemoryMax=96M',
      'CPUQuota=15%',
      'TasksMax=32',
      'NoNewPrivileges=yes',
      'IPAddressDeny=any',
      'InaccessiblePaths=/run',
    ])
      expect(unit).toContain(setting);
    expect(unit).toContain('/usr/bin/flock -n -E 0 /var/lib/moongame/autoupdate.lock');
    expect(unit).not.toMatch(/docker\.sock|listen|DATABASE_URL/);
    const image = prometheusImage(read('../docker-compose.observability.yml'));
    expect(image).toMatch(/^prom\/prometheus:v[0-9.]+@sha256:[a-f0-9]{64}$/);
    expect(() => prometheusImage('image: prom/prometheus:latest')).toThrow(
      'E_SECURITY_PROMTOOL_IMAGE',
    );
  });
  it('imports edge policy from the signed image so updates do not freeze the host snippet', () => {
    const source = read('../Caddyfile');
    const applied = withEdgeImport(source);
    expect(withEdgeImport(applied)).toBe(applied);
    expect(applied).toContain('import /etc/caddy/security/edge.caddy');
    expect(applied).not.toContain('BEGIN MOONGAME SECURITY ACCESS');
    expect(read('../caddy/Dockerfile')).toContain('COPY edge.caddy /etc/caddy/security/edge.caddy');
  });
  it.skipIf(!process.env.PROMTOOL_BIN)(
    'validates actual Prometheus alert expressions and no-data scenarios',
    () => {
      const path = new URL('../observability/security.rules.test.yml', import.meta.url).pathname;
      const result = spawnSync(process.env.PROMTOOL_BIN, ['test', 'rules', path], {
        encoding: 'utf8',
        timeout: 10000,
      });
      expect(result.status, result.stdout + result.stderr).toBe(0);
    },
  );
});
