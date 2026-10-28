import { describe, expect, it, vi } from 'vitest';
import Fastify from 'fastify';
import { registerOperatorMatchApi } from './operatorMatchApi';

const token = 'operator-'.padEnd(40, 'a');
const payload = { mapId: 'ffa-20', timeScale: 2 };
function setup(configured: string | undefined = token) {
  const app = Fastify();
  const createMatch = vi.fn(async () => ({ matchId: '12345678', seats: Array.from({ length: 20 }, (_, i) => `p${i + 1}`) }));
  registerOperatorMatchApi(app, { token: configured, mapIds: ['ffa-20'], createMatch });
  return { app, createMatch };
}

describe('operator match creation', () => {
  it.each([undefined, 'short'])('is absent without a full operator credential (%s)', async (configured) => {
    const { app, createMatch } = setup(configured === undefined ? '' : configured);
    try {
      expect((await app.inject({ method: 'POST', url: '/metrics/matches', payload })).statusCode).toBe(404);
      expect(createMatch).not.toHaveBeenCalled();
    } finally { await app.close(); }
  });
  it.each([undefined, 'Bearer reader-token', `Bearer ${'b'.repeat(40)}`])('refuses missing, reader and incorrect credentials (%s)', async (authorization) => {
    const { app, createMatch } = setup();
    try {
      const response = await app.inject({ method: 'POST', url: '/metrics/matches', payload,
        ...(authorization ? { headers: { authorization } } : {}) });
      expect(response.statusCode).toBe(404);
      expect(createMatch).not.toHaveBeenCalled();
    } finally { await app.close(); }
  });
  it.each([null, [], {}, { ...payload, mapId: 'ffa-50' }, { ...payload, timeScale: 0 },
    { ...payload, timeScale: -2 }, { ...payload, timeScale: 25 }, { ...payload, timeScale: 1.5 },
    { ...payload, timeScale: '2' }, { ...payload, accountId: 'somebody' }])('refuses invalid settings before creating anything (%j)', async (body) => {
    const { app, createMatch } = setup();
    try {
      const response = await app.inject({ method: 'POST', url: '/metrics/matches',
        payload: JSON.stringify(body), headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' } });
      expect(response.statusCode).toBe(400);
      expect(createMatch).not.toHaveBeenCalled();
    } finally { await app.close(); }
  });
  it('creates exactly one twenty-seat x2 match after the host finishes persistence', async () => {
    const { app, createMatch } = setup();
    try {
      const response = await app.inject({ method: 'POST', url: '/metrics/matches', payload, headers: { authorization: `Bearer ${token}` } });
      expect(response.statusCode).toBe(201);
      expect(response.json()).toEqual({ matchId: '12345678', seats: Array.from({ length: 20 }, (_, i) => `p${i + 1}`) });
      expect(createMatch).toHaveBeenCalledExactlyOnceWith(payload);
    } finally { await app.close(); }
  });
  it('returns a stable failure without exposing host errors', async () => {
    const { app, createMatch } = setup();
    createMatch.mockRejectedValueOnce(new Error('private database credentials'));
    try {
      const response = await app.inject({ method: 'POST', url: '/metrics/matches', payload, headers: { authorization: `Bearer ${token}` } });
      expect(response.statusCode).toBe(503);
      expect(response.json()).toEqual({ error: 'E_CREATE_MATCH' });
    } finally { await app.close(); }
  });
});
