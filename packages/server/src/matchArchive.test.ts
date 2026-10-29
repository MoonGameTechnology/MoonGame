import { describe, expect, it, vi } from 'vitest';
import Fastify from 'fastify';
import { createInitialState, createKernel, MS_PER_DAY, parseGameData } from '@void/shared-core';
import { ArchiveCapacityError, ArchiveRoomCache } from './matchArchive';
import { ARCHIVE_CATALOG_LIMIT, StoreArchiveCatalog } from './matchArchiveCatalog';
import { MATCH_ARCHIVE_MS, MatchRegistry, sessionMeta } from './matchRegistry';
import { MatchRoom } from './matchRoom';
import { registerBrowserApi, registerSeatsApi } from './matchApi';
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
function catalogRegistry(store: MemoryMatchStore, accounts: MemoryAccountStore, now: () => number,
  build = (s: MatchSnapshot) => viewer(s, now)) {
  const cache = new ArchiveRoomCache({ store, viewer: build, otherResidents: () => 0, totalRoomLimit: 64, now });
  return { cache, registry: new MatchRegistry(accounts, data, now,
    { rooms: cache, catalog: new StoreArchiveCatalog(store, accounts) }) };
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
    const build = vi.fn((s: MatchSnapshot) => viewer(s, now));
    const { registry, cache } = catalogRegistry(store, accounts, now, build);
    const load = vi.spyOn(store, 'loadArchive');
    const wholeLoad = vi.spyOn(store, 'load');
    expect(registry.ids()).toEqual([]);
    expect((await registry.list('alice')).archived).toHaveLength(1);
    expect(build).not.toHaveBeenCalled();
    expect(load).not.toHaveBeenCalled();
    expect(wholeLoad).not.toHaveBeenCalled();
    expect(await registry.resolve('recent')).toBeDefined();
    expect(build).toHaveBeenCalledTimes(1);
    expect(cache.size).toBe(1);
    expect(registry.get('recent')?.tick()).toBe(false);
    expect((await registry.list('alice')).archived[0]).toMatchObject({ days: 100, createdAt: created, endedAt: finish });
    expect(await store.load('recent')).toEqual(original);
    // A second boot/catalog pass cannot duplicate or restart the archive clock.
    expect(await registry.resolve('recent')).toBe(registry.get('recent'));
    expect(build).toHaveBeenCalledTimes(1);
    const rebooted = catalogRegistry(store, accounts, now);
    expect((await rebooted.registry.list('alice')).archived).toHaveLength(1);
    expect(rebooted.cache.size).toBe(0);
  });

  it('expires at exactly seven real days, closes viewers and retains durable results', async () => {
    let wall = finish + MATCH_ARCHIVE_MS - 1;
    const now = () => wall;
    const store = new MemoryMatchStore();
    const accounts = new MemoryAccountStore();
    await store.save(snapshot('done'));
    await accounts.resolveSeat('done', 'alice', ['p1']);
    const { registry } = catalogRegistry(store, accounts, now);
    await registry.resolve('done');
    const close = vi.fn();
    registry.get('done')!.addPeer('p1', { send: () => {}, close });
    expect((await registry.list('alice')).archived).toHaveLength(1);
    wall++;
    expect(registry.get('done')).toBeUndefined();
    expect(registry.ids()).toEqual([]);
    expect((await registry.list('alice')).archived).toEqual([]);
    expect(await registry.unarchive('done', 'alice')).toEqual({ ok: false, code: 'E_NO_MATCH' });
    expect(registry.pruneExpired()).toEqual([]);
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

describe('bounded archive residency', () => {
  it('refuses anonymous/foreign seat browsing before loading or renewing archives, retaining public live entry', async () => {
    const store = new MemoryMatchStore();
    const accounts = new MemoryAccountStore();
    let wall = finish + 1;
    const now = () => wall;
    const ids = Array.from({ length: 9 }, (_, i) => `private-${i}`);
    for (const id of ids) {
      await store.save(snapshot(id));
      await accounts.resolveSeat(id, 'alice', ['p1']);
    }
    const load = vi.spyOn(store, 'loadArchive');
    const { registry, cache } = catalogRegistry(store, accounts, now);
    const live = snapshot('public-live');
    live.status = live.state.match.status = 'ongoing';
    delete live.endedAt;
    const room = viewer(live, now);
    registry.register(room, sessionMeta(room, { createdAt: created, timeScale: 24 }));
    const app = Fastify();
    registerSeatsApi(app, {
      identify: async (req) => {
        const login = req.headers.authorization === 'Bearer alice' ? 'alice'
          : req.headers.authorization === 'Bearer mallory' ? 'mallory' : null;
        return login ? { login, accountId: login } : null;
      },
      entryOpen: (id) => registry.entryOpen(id),
      seatOf: (id, login) => accounts.seatOf(id, login),
      seats: async (id, login) => {
        const found = await registry.resolveForBrowser(id, login);
        return found ? { ended: found.state.match.status === 'ended', seats: [
          { playerId: 'p1', name: 'One', faction: 'x', start: null, taken: false },
        ] } : null;
      },
    });
    try {
      expect((await app.inject('/matches/public-live/seats')).statusCode).toBe(200);
      for (const id of ids) {
        expect((await app.inject(`/matches/${id}/seats?nick=alice`)).statusCode).toBe(404);
        expect((await app.inject({ url: `/matches/${id}/seats`,
          headers: { authorization: 'Bearer mallory' } })).statusCode).toBe(404);
      }
      expect(load).not.toHaveBeenCalled();
      expect(cache.size).toBe(0);
      expect((await app.inject({ url: '/matches/private-0/seats',
        headers: { authorization: 'Bearer alice' } })).statusCode).toBe(200);
      expect(load).toHaveBeenCalledOnce();
      wall += 59_999;
      expect((await app.inject('/matches/private-0/seats?nick=alice')).statusCode).toBe(404);
      expect(await registry.resolveForBrowser('private-0', 'mallory')).toBeUndefined();
      wall++;
      expect(cache.pruneExpired()).toContain('private-0');
      expect(cache.size).toBe(0); // Refused probes never renewed the minute-long idle window.
      expect(load).toHaveBeenCalledOnce();
    } finally { await app.close(); await cache.shutdown(); }
  });

  it('lists thousands of stored archives and restarts without loading any worlds', async () => {
    const store = new MemoryMatchStore();
    const accounts = new MemoryAccountStore();
    const now = () => finish + 1;
    for (let i = 0; i < 2000; i++) {
      const id = `archive-${i}`;
      await store.save(snapshot(id));
      await accounts.resolveSeat(id, 'alice', ['p1']);
    }
    const whole = vi.spyOn(store, 'load');
    const bounded = vi.spyOn(store, 'loadArchive');
    const build = vi.fn((s: MatchSnapshot) => viewer(s, now));
    const { registry, cache } = catalogRegistry(store, accounts, now, build);
    expect((await registry.list('alice')).archived).toHaveLength(ARCHIVE_CATALOG_LIMIT);
    expect((await registry.list('stranger')).archived).toEqual([]);
    expect(whole).not.toHaveBeenCalled();
    expect(bounded).not.toHaveBeenCalled();
    expect(build).not.toHaveBeenCalled();
    expect(cache.size).toBe(0);
    await registry.resolve('archive-0');
    expect(bounded).toHaveBeenCalledOnce();
    expect(build).toHaveBeenCalledOnce();
    expect(cache.size).toBe(1);
    const restarted = catalogRegistry(store, accounts, now);
    expect((await restarted.registry.list('alice')).archived).toHaveLength(ARCHIVE_CATALOG_LIMIT);
    expect(restarted.cache.size).toBe(0);
    expect(bounded).toHaveBeenCalledOnce();
  });

  it('reserves concurrent archive loads before awaiting the store and shares the live-room cap', async () => {
    const store = new MemoryMatchStore();
    const now = () => finish + 1;
    const complete: Array<(value: MatchSnapshot | null) => void> = [];
    const load = vi.spyOn(store, 'loadArchive').mockImplementation(() => new Promise((resolve) => complete.push(resolve)));
    let live = 1;
    const cache = new ArchiveRoomCache({ store, viewer: (s) => viewer(s, now), now,
      otherResidents: () => live, totalRoomLimit: 3, maxRooms: 8, idleMs: 0 });
    const first = cache.resolve('first');
    const duplicate = cache.resolve('first');
    const second = cache.resolve('second');
    expect(load).toHaveBeenCalledTimes(2);
    expect(cache.residentCount).toBe(3);
    await expect(cache.resolve('third')).rejects.toBeInstanceOf(ArchiveCapacityError);
    expect(() => cache.reserveHostRoom()).toThrow(ArchiveCapacityError);
    expect(load).toHaveBeenCalledTimes(2);
    complete[0]!(snapshot('first'));
    complete[1]!(snapshot('second'));
    const one = await first;
    expect(await duplicate).toBe(one);
    await second;
    one!.addPeer('p1', { send() {} });
    cache.get('second')!.addPeer('p1', { send() {} });
    expect(() => cache.reserveHostRoom()).toThrow(ArchiveCapacityError);
    expect(cache.residentCount).toBe(3);
    await cache.shutdown();
    expect(cache.residentCount).toBe(1);
    const releaseA = cache.reserveHostRoom();
    const releaseB = cache.reserveHostRoom();
    expect(() => cache.reserveHostRoom()).toThrow(ArchiveCapacityError);
    expect(cache.residentCount).toBe(3);
    live++;
    releaseA(); // A newly registered host replaces its reservation, not an extra slot.
    expect(cache.residentCount).toBe(3);
    releaseA();
    expect(cache.residentCount).toBe(3);
    releaseB();
    expect(cache.residentCount).toBe(2);
  });

  it('bounds archive rooms independently, preserves connected viewers and evicts only idle maps', async () => {
    const store = new MemoryMatchStore();
    let wall = finish + 1;
    const now = () => wall;
    for (const id of ['first','second','third']) await store.save(snapshot(id));
    const cache = new ArchiveRoomCache({ store, viewer: (s) => viewer(s, now), now,
      otherResidents: () => 0, totalRoomLimit: 64, maxRooms: 2, idleMs: 1000 });
    const first = await cache.resolve('first');
    const second = await cache.resolve('second');
    first!.addPeer('p1', { send() {} });
    second!.addPeer('p1', { send() {} });
    await expect(cache.resolve('third')).rejects.toBeInstanceOf(ArchiveCapacityError);
    expect(cache.size).toBe(2);
    second!.evict('p1');
    cache.release('second');
    await expect(cache.resolve('third')).rejects.toBeInstanceOf(ArchiveCapacityError);
    wall += 1000;
    expect(await cache.resolve('third')).toBeDefined();
    expect(cache.get('first')).toBe(first);
    expect(cache.get('second')).toBeUndefined();
    expect(cache.size).toBe(2);
    await cache.shutdown();
  });

  it('rejects oversized states through the bounded store API without an unbounded load fallback', async () => {
    const store = new MemoryMatchStore();
    const now = () => finish + 1;
    await store.save(snapshot('big'));
    const whole = vi.spyOn(store, 'load');
    const bounded = vi.spyOn(store, 'loadArchive');
    const build = vi.fn((s: MatchSnapshot) => viewer(s, now));
    const cache = new ArchiveRoomCache({ store, viewer: build, now,
      otherResidents: () => 0, totalRoomLimit: 64, maxStateBytes: 1 });
    expect(await cache.resolve('big')).toBeUndefined();
    expect(bounded).toHaveBeenCalledWith('big', now() - MATCH_ARCHIVE_MS, 1);
    expect(whole).not.toHaveBeenCalled();
    expect(build).not.toHaveBeenCalled();
    expect(cache.size).toBe(0);
  });
});
