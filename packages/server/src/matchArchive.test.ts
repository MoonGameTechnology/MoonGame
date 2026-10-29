import { describe, expect, it, vi } from 'vitest';
import Fastify from 'fastify';
import { createInitialState, createKernel, MS_PER_DAY, parseGameData } from '@void/shared-core';
import { restoreMatchArchives } from './matchArchive';
import { MATCH_ARCHIVE_MS, MatchRegistry, sessionMeta } from './matchRegistry';
import { MatchRoom } from './matchRoom';
import { registerBrowserApi } from './matchApi';
import { MemoryAccountStore, MemoryMatchStore, type MatchSnapshot } from './store';

const data = parseGameData({ version: 'archive', resources: ['metal'], units: {}, factions: {}, buildings: {}, events: {} });
const finish = 1_800_000_000_000;
const created = finish - 4 * MS_PER_DAY;
function snapshot(id: string, endedAt = finish): MatchSnapshot {
  const state = createInitialState({ seed: id, version: { data: 'archive', manifest: 'archive' } });
  state.mapId = 'nexus';
  state.time = 100 * MS_PER_DAY;
  state.startedAt = 0;
  state.match.status = 'ended';
  state.match.endedAt = state.time;
  state.players = {
    p1: { id: 'p1', name: 'One', faction: 'x', status: 'active', resources: {} },
    p2: { id: 'p2', name: 'Two', faction: 'x', status: 'active', resources: {} },
  };
  return {
    matchId: id, dataVersion: 'archive', seq: 12, status: 'ended', state, createdAt: created, endedAt,
    clock: { wallTime: endedAt + MS_PER_DAY, gameTime: state.time, timeScale: 24, running: false },
  };
}
function viewer(s: MatchSnapshot, now: () => number): MatchRoom {
  return new MatchRoom({
    id: s.matchId, initialState: s.state, initialSeq: s.seq, data, kernel: createKernel([]),
    initialCreatedAt: s.createdAt, initialEndedAt: s.endedAt, initialClock: s.clock,
    timeScale: s.clock?.timeScale, now,
  });
}

describe('seven-day finished-match archive', () => {
  it('archives automatically for every participant; strangers and anonymous viewers see nothing', async () => {
    const accounts = new MemoryAccountStore();
    const now = () => finish + MS_PER_DAY;
    const registry = new MatchRegistry(accounts, data, now);
    const room = viewer(snapshot('done'), now);
    registry.register(room, sessionMeta(room, { timeScale: 24, createdAt: created }));
    for (const nick of ['alice', 'bob']) await accounts.resolveSeat('done', nick, ['p1', 'p2']);
    for (const nick of ['alice', 'bob']) {
      const list = await registry.list(nick);
      expect(list.active).toEqual([]);
      expect(list.available).toEqual([]);
      expect(list.archived).toMatchObject([{
        matchId: 'done', days: 100, createdAt: created, endedAt: finish,
        archiveExpiresAt: finish + MATCH_ARCHIVE_MS, entryOpen: false, entryClosesInMs: 0,
      }]);
      expect(await registry.unarchive('done', nick)).toEqual({ ok: false, code: 'E_FORBIDDEN' });
    }
    expect(await registry.list('stranger')).toEqual({ active: [], archived: [], available: [] });
    expect(await registry.list(null)).toEqual({ active: [], archived: [], available: [] });
    expect(registry.entryOpen('done')).toBe(false);
  });

  it('restores only unexpired frozen maps after restart and preserves their real dates', async () => {
    const store = new MemoryMatchStore();
    const accounts = new MemoryAccountStore();
    const now = () => finish + MATCH_ARCHIVE_MS - 1;
    const original = snapshot('recent');
    await store.save(original);
    await store.save(snapshot('expired', finish - 1));
    const live = snapshot('live');
    live.status = live.state.match.status = 'ongoing';
    delete live.endedAt;
    await store.save(live);
    await accounts.resolveSeat('recent', 'alice', ['p1']);
    const registry = new MatchRegistry(accounts, data, now);
    const build = vi.fn((s: MatchSnapshot) => viewer(s, now));
    expect(await restoreMatchArchives(registry, store, build, now)).toBe(1);
    expect(build).toHaveBeenCalledTimes(1);
    expect(registry.ids()).toEqual(['recent']);
    expect(registry.get('recent')?.tick()).toBe(false);
    expect((await registry.list('alice')).archived[0]).toMatchObject({ days: 100, createdAt: created, endedAt: finish });
    expect(await store.load('recent')).toEqual(original);
    // A second boot/catalog pass cannot duplicate or restart the archive clock.
    expect(await restoreMatchArchives(registry, store, build, now)).toBe(0);
  });

  it('expires at exactly seven real days, closes viewers and retains durable results', async () => {
    let wall = finish + MATCH_ARCHIVE_MS - 1;
    const now = () => wall;
    const store = new MemoryMatchStore();
    const accounts = new MemoryAccountStore();
    await store.save(snapshot('done'));
    await accounts.resolveSeat('done', 'alice', ['p1']);
    const registry = new MatchRegistry(accounts, data, now);
    await restoreMatchArchives(registry, store, (s) => viewer(s, now), now);
    const close = vi.fn();
    registry.get('done')!.addPeer('p1', { send: () => {}, close });
    expect((await registry.list('alice')).archived).toHaveLength(1);
    wall++;
    expect(registry.get('done')).toBeUndefined();
    expect(registry.ids()).toEqual([]);
    expect((await registry.list('alice')).archived).toEqual([]);
    expect(await registry.unarchive('done', 'alice')).toEqual({ ok: false, code: 'E_NO_MATCH' });
    expect(registry.pruneExpired()).toEqual(['done']);
    expect(close).toHaveBeenCalledOnce();
    expect((await store.load('done'))?.state).toEqual(snapshot('done').state);
  });

  it('uses the authenticated viewer, ignoring a forged participant nickname in the URL', async () => {
    const accounts = new MemoryAccountStore();
    await accounts.resolveSeat('done', 'alice', ['p1']);
    const now = () => finish + 1;
    const registry = new MatchRegistry(accounts, data, now);
    const room = viewer(snapshot('done'), now);
    registry.register(room, sessionMeta(room, { createdAt: created, timeScale: 24 }));
    const app = Fastify();
    registerBrowserApi(app, registry, async (req) => req.headers.authorization === 'Bearer alice'
      ? { login: 'alice', accountId: 'alice' } : null);
    try {
      const own = await app.inject({ url: '/matches', headers: { authorization: 'Bearer alice' } });
      expect(own.json().archived).toHaveLength(1);
      const forged = await app.inject({ url: '/matches?nick=alice' });
      expect(forged.json().archived).toEqual([]);
    } finally { await app.close(); }
  });
});
