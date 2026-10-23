import { describe, it, expect } from 'vitest';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { monitoringSite } from './https-ingress.mjs';

describe('separate mTLS ingress', () => {
  it('requires a valid CA and rejects hostname/config injection', () => {
    for (const name of ['localhost:443', 'a.example.com\nrespond 200', '*.example.com', '127.0.0.1'])
      expect(() => monitoringSite(name, '')).toThrow('E_OBS_INGRESS');
    expect(() => monitoringSite('monitor.example.com', 'broken')).toThrow('E_OBS_INGRESS');
  });
  it('requires a verified certificate and sends requests only to Grafana', () => {
    const directory = mkdtempSync(join(tmpdir(), 'obs-ca-'));
    try {
      execFileSync('openssl', ['req', '-x509', '-newkey', 'ec', '-pkeyopt', 'ec_paramgen_curve:P-256', '-nodes', '-days', '1', '-subj', '/CN=test', '-addext', 'basicConstraints=critical,CA:TRUE', '-keyout', join(directory, 'key'), '-out', join(directory, 'ca')], { stdio: 'ignore' });
      const site = monitoringSite('monitor.example.com', readFileSync(join(directory, 'ca')));
      expect(site).toContain('mode require_and_verify');
      expect(site).toContain('trust_der ');
      expect(site).toContain('reverse_proxy obs-grafana:3000');
      expect(site).not.toContain('server:8788');
      expect(site).not.toContain('request_header');
    } finally { rmSync(directory, { recursive: true, force: true }); }
  });
});
