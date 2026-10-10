import { describe, expect, it } from 'vitest';
import { assessContainer } from './posture.mjs';

const server = (extra = {}) => ({
  Config: {
    Labels: { 'com.docker.compose.service': 'server' },
    Image: `ghcr.io/game@sha256:${'a'.repeat(64)}`,
    User: '65532',
    Env: [
      'PROD=1',
      'GATE=1',
      'SEAT_LOCK=1',
      `AUTH_JWT_SECRET=${'s'.repeat(64)}`,
      'ALLOWED_ORIGINS=https://game.example',
      'TRUST_PROXY=1',
      'DATABASE_URL=postgres://vd_app_v1:private-password@postgres/void',
      'DB_AUTO_MIGRATE=0',
      'DB_REQUIRE_LEAST_PRIVILEGE=1',
      'AUTH_JWT_PREVIOUS_SECRET=old-private-secret',
      'AUTH_JWT_PREVIOUS_UNTIL=1234567890',
      'API_TOKEN=private-api-token',
    ],
  },
  State: { Running: true, Health: { Status: 'healthy' } },
  HostConfig: {
    ReadonlyRootfs: true,
    SecurityOpt: ['no-new-privileges:true'],
    CapDrop: ['ALL'],
    Memory: 1000,
    PidsLimit: 100,
    LogConfig: { Type: 'local', Config: { 'max-size': '10m', 'max-file': '3' } },
  },
  NetworkSettings: { Ports: { '8788/tcp': [{ HostIp: '127.0.0.1', HostPort: '8788' }] } },
  ...extra,
});
describe('effective container posture projection', () => {
  it('reports configured guards without claiming to have verified database grants or TLS certificates', () => {
    expect(assessContainer(server())).toMatchObject({
      service: 'server',
      leastPrivilegeGuard: true,
      tlsConfigured: true,
      findings: [],
    });
  });
  it('never serializes raw secrets, connection strings or unrelated services', () => {
    const result = JSON.stringify(assessContainer(server()));
    expect(result).not.toMatch(
      /private-password|private-secret|private-api-token|postgres:\/\/|AUTH_JWT_SECRET/,
    );
    expect(
      assessContainer({
        Config: { Labels: { 'com.docker.compose.service': 'unrelated' }, Env: ['SECRET=secret'] },
      }),
    ).toBeUndefined();
  });
  it('detects a publicly published plaintext server despite TRUST_PROXY=1', () => {
    const result = assessContainer(
      server({ NetworkSettings: { Ports: { '8788/tcp': [{ HostIp: '0.0.0.0' }] } } }),
    );
    expect(result.findings).toContainEqual({
      id: 'server.public-plaintext-port',
      severity: 'critical',
    });
  });
  it('detects public PostgreSQL and privileged containers', () => {
    const result = assessContainer({
      Config: { Labels: { 'com.docker.compose.service': 'postgres' }, Env: [] },
      HostConfig: { Privileged: true },
      NetworkSettings: { Ports: { '5432/tcp': [{ HostIp: '::' }] } },
    });
    expect(result.findings).toContainEqual({ id: 'database.public-port', severity: 'critical' });
    expect(result.findings).toContainEqual({ id: 'container.privileged', severity: 'critical' });
  });
});
