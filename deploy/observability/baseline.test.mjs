/* global Response */
import { describe, expect, it } from 'vitest';
import { projectSource, readJson } from './baseline.mjs';

describe('OBS-0.1 baseline publication boundary', () => {
  it('keeps aggregate numbers while excluding identities, credentials and pre-fog data', () => {
    const secret = 'SECRET-should-never-be-published';
    const result = projectSource('summary', {
      joins: 2, leaves: 1, desyncs: 0, deadLetters: 0, advanceOverflows: 0,
      actions: { total: 7, ok: 6, rejected: 1, byType: { [secret]: 7 } },
      submitMs: { count: 7, total: 350, max: 80, avg: 50 },
      broadcastMs: { count: 2, total: 20, max: 12 },
      deltaBytes: { count: 2, total: 800, max: 500 },
      economy: { arrearsHours: { [secret]: 10 } }, end: { winner: secret },
      headers: { Authorization: secret }, state: secret,
    });
    expect(result.actionsTotal).toBe(7);
    expect(result.submitSeconds).toEqual({ count: 7, total: 0.35, max: 0.08 });
    expect(JSON.stringify(result)).not.toContain(secret);
    expect(result).not.toHaveProperty('economy');
    expect(result).not.toHaveProperty('end');
  });

  it('aggregates the public match feed without publishing match ids or seats', () => {
    const result = projectSource('matches', { available: [
      { matchId: 'SECRET-MATCH', mapId: 'duel-1', rules: { timeScale: 24 }, players: [{ login: 'SECRET-LOGIN' }] },
      { matchId: 'SECRET-OTHER', mapId: 'duel-1', rules: { timeScale: 24 } },
      { mapId: 'SECRET-MAP', rules: { timeScale: 'SECRET-SCALE' } },
    ], active: [], archived: [] });
    expect(result).toEqual([
      { map: 'duel-1', timeScale: 24, matches: 2 },
      { map: 'other', timeScale: null, matches: 1 },
    ]);
    expect(JSON.stringify(result)).not.toContain('SECRET');
  });

  it('does not turn missing or invalid measurements into healthy zeroes', () => {
    expect(projectSource('metrics', { matches: 0, connections: 0 })).toEqual({ matches: 0, connections: 0 });
    for (const data of [{ matches: 9 }, { matches: -1, connections: 0 }, null])
      expect(projectSource('metrics', data)).toBeNull();
    expect(projectSource('summary', {})).toBeNull();
    expect(projectSource('unknown', { token: 'SECRET' })).toBeNull();
    expect(projectSource('matches', { available: [{ mapId: 'duel-1' }], active: [], archived: [] })).toEqual([{ map: 'duel-1', timeScale: null, matches: 1 }]);
  });

  it('bounds response bodies and refuses redirects before any credentials can be forwarded', async () => {
    let options;
    const response = new Response('x'.repeat(65537));
    await expect(readJson('/metrics', 'SECRET', async (_url, opts) => { options = opts; return response; })).rejects.toThrow('E_OBS_SOURCE');
    expect(options.redirect).toBe('error');
    await expect(readJson('/metrics', 'SECRET', async () => new Response('SECRET', { status: 403 }))).rejects.toThrow('E_OBS_SOURCE');
  });
});
