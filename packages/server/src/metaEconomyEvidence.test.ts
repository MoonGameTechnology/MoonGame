import { randomUUID } from 'node:crypto';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  createInitialState,
  createKernel,
  parseGameData,
  type GameModule,
  type GameState,
  type Planet,
} from '@void/shared-core';
import pg from 'pg';
import {
  MemoryArsenalStore,
  MemoryDropStore,
  MemoryMatchStore,
  PostgresMatchStore,
  migrate,
  type MatchSnapshot,
  type MatchStore,
} from './store';
import { MemoryMetaMarket } from './metaMarket';
import { MemoryMetaEconomyStore } from './metaEconomyStore';
import { createMetaRewardDelivery } from './metaEconomyDelivery';
import { economyObservation, economyObservationKey } from './metaEconomyObservation';
import { MAX_META_ACTIVITY_FACTS_PER_ROLE } from './metaEconomyActivity';
import type { MatchRewardFacts } from './metaEconomy';
import { MatchRoom } from './matchRoom';
import { snapshotOf } from './persistence';

// Uses the real authoritative event payloads; construction/combat arithmetic is
// tested in shared-core, while this exercises room -> durable Game -> Meta replay.
const activityModule: GameModule = {
  id: 'activity-evidence-test',
  version: '1',
  setup(api) {
    api.onAction('test.build', (_action, h) => {
      for (const building of ['mine', 'factory']) {
        h.state.planets.home!.buildings.push({
          uid: `built:${building}`,
          type: building,
          level: 1,
          hp: 100,
        });
        h.emit('building.constructed', { planetId: 'home', building, owner: 'p1' });
      }
    });
    api.onAction('test.capture', (_action, h) => {
      h.state.planets.a!.owner = 'p1';
      h.emit('planet.captured', {
        planetId: 'a',
        owner: 'p1',
        from: null,
        by: 'fleet',
        via: 'arrival',
      });
    });
    api.onAction('test.loss', (_action, h) => {
      h.state.planets.home!.buildings = [];
      h.state.planets.a!.owner = null;
    });
  },
};
const activityData = parseGameData({
  version: 'test',
  resources: ['credits'],
  units: {},
  factions: {},
  buildings: {},
  events: {},
  sectors: {},
  planetTypes: {},
});
const activityKey = (role: string): string => JSON.stringify(['p1', 1, role]);

const pools: pg.Pool[] = [];
afterEach(async () => {
  await Promise.all(pools.splice(0).map((pool) => pool.end()));
});

function initial(): MatchSnapshot {
  const state = createInitialState({
    seed: 'evidence',
    version: { data: 'test', manifest: 'test' },
  });
  state.players.p1 = {
    id: 'p1',
    name: 'Player',
    faction: 'f',
    status: 'active',
    resources: {},
    claimedAt: 1,
    seated: true,
  };
  const world = (id: string): Planet => ({
    id,
    owner: id === 'home' ? 'p1' : null,
    position: { x: 0, y: 0 },
    resources: {},
    buildings: [],
    garrison: [],
    traits: [],
  });
  state.planets = Object.fromEntries(['home', 'a', 'b', 'c'].map((id) => [id, world(id)]));
  state.fog = { p1: { home: {} } } as unknown as GameState['fog'];
  return { matchId: randomUUID(), dataVersion: 'test', seq: 1, status: 'ongoing', state };
}

async function backend(
  kind: 'memory' | 'postgres',
): Promise<{ matches: MatchStore; restart(): MatchStore }> {
  if (kind === 'memory') {
    const matches = new MemoryMatchStore();
    return { matches, restart: () => matches };
  }
  const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
  pools.push(pool);
  await migrate(pool);
  return { matches: new PostgresMatchStore(pool), restart: () => new PostgresMatchStore(pool) };
}

function economy() {
  const arsenal = new MemoryArsenalStore();
  const market = new MemoryMetaMarket(arsenal);
  const store = new MemoryMetaEconomyStore(arsenal, new MemoryDropStore(), market);
  market.setEconomy(store);
  return store;
}

for (const kind of ['memory', 'postgres'] as const) {
  describe.skipIf(kind === 'postgres' && !process.env.DATABASE_URL)(
    `durable reward evidence — ${kind}`,
    () => {
      it('retains the first confirmed observation while Meta is unavailable, then settles early recon after restart', async () => {
        const { matches, restart } = await backend(kind);
        const store = economy();
        vi.spyOn(store, 'transaction').mockRejectedValue(Error('meta unavailable'));
        const settle = vi.fn(async (_facts: MatchRewardFacts) => ({ ok: true }));
        const deps = {
          store,
          matches,
          seats: () => async () => ({ p1: 'account' }),
          settle,
          stageCount: 2,
          now: () => 1000,
          onError: vi.fn(),
        };
        const delivery = createMetaRewardDelivery(deps);
        const first = initial();
        await delivery.matches.save(first);
        const final = structuredClone(first);
        final.seq = 3;
        final.status = 'ended';
        final.state.fog = { p1: { home: {}, a: {}, b: {}, c: {} } } as unknown as GameState['fog'];
        final.state.match = {
          ...final.state.match,
          status: 'ended',
          winner: 'p1',
          rewards: { p1: { place: 1, xp: 100 } },
        };
        await delivery.matches.save(final);
        await delivery.stop();
        expect(settle).not.toHaveBeenCalled();
        const loaded = (await restart().load(first.matchId))!;
        expect(loaded.economyObservations?.[economyObservationKey('p1', 1)]?.known).toEqual([
          'home',
        ]);
        expect(loaded.state).toEqual(final.state);
        const restored = createMetaRewardDelivery({
          ...deps,
          matches: restart(),
          store: economy(),
        });
        await restored.deliver(loaded);
        expect(settle.mock.calls.map(([facts]) => facts.kind)).toEqual(['stage', 'final']);
        expect(settle.mock.calls[0]![0].seasonFacts?.recon).toBe(3);
      });

      it('keeps accepted evidence through plain saves and rejects metadata from stale snapshots', async () => {
        const { matches } = await backend(kind);
        const first = initial();
        const key = economyObservationKey('p1', 1);
        first.seq = 10;
        first.economyObservations = { [key]: economyObservation(first.state, 'p1') };
        first.economyActivity = { [activityKey('defense')]: ['battle-a'] };
        await matches.save(first);
        const stale = {
          ...first,
          seq: 9,
          economyObservations: { forged: economyObservation(first.state, 'p1') },
          economyActivity: { [activityKey('defense')]: ['forged-battle'] },
        };
        await matches.save(stale);
        const plain = { ...first, seq: 11 };
        delete plain.economyObservations;
        delete plain.economyActivity;
        await matches.save(plain);
        const loaded = (await matches.load(first.matchId))!;
        expect(loaded.economyObservations).toEqual(first.economyObservations);
        expect(loaded.economyActivity).toEqual({ [activityKey('defense')]: ['battle-a'] });
        const next = {
          ...plain,
          seq: 12,
          economyActivity: { [activityKey('defense')]: ['battle-a', 'battle-b'] },
        };
        await matches.save(next);
        expect((await matches.load(first.matchId))!.economyActivity).toEqual({
          [activityKey('defense')]: ['battle-a', 'battle-b'],
        });
      });

      it('retains a verified defense after every defending unit disappears', async () => {
        const { matches } = await backend(kind);
        const settle = vi.fn(async (_facts: MatchRewardFacts) => ({ ok: true }));
        const delivery = createMetaRewardDelivery({
          store: economy(),
          matches,
          seats: () => async () => ({ p1: 'account' }),
          settle,
          stageCount: 2,
          now: () => 1000,
          onError: vi.fn(),
        });
        const first = initial();
        await delivery.matches.save(first);
        await delivery.stop();
        const defended = structuredClone(first);
        defended.seq = 2;
        defended.economyActivity = { [activityKey('defense')]: ['verified-defense'] };
        await matches.save(defended);
        const final = {
          ...first,
          seq: 3,
          status: 'ended' as const,
          state: {
            ...first.state,
            match: {
              ...first.state.match,
              status: 'ended' as const,
              winner: null,
              rewards: { p1: { place: 2, xp: 50 } },
            },
          },
        };
        await matches.save(final);
        expect(Object.values(final.state.fleets)).toEqual([]);
        await delivery.deliver((await matches.load(first.matchId))!);
        expect(settle.mock.calls.map(([facts]) => facts.kind)).toEqual(['stage', 'final']);
        expect(settle.mock.calls[0]![0].seasonFacts?.defense).toBe(1);
      });

      it('bounds each activity role while preserving already committed evidence', async () => {
        const { matches } = await backend(kind);
        const first = initial();
        const key = activityKey('defense');
        first.economyActivity = { [key]: ['first'] };
        await matches.save(first);
        const ids = Array.from(
          { length: MAX_META_ACTIVITY_FACTS_PER_ROLE + 10 },
          (_, i) => `new-${i}`,
        );
        await matches.save({ ...first, seq: 2, economyActivity: { [key]: ids } });
        const loaded = (await matches.load(first.matchId))!;
        expect(loaded.economyActivity?.[key]).toHaveLength(MAX_META_ACTIVITY_FACTS_PER_ROLE);
        expect(loaded.economyActivity?.[key]?.[0]).toBe('first');
        expect(new Set(loaded.economyActivity?.[key]).size).toBe(MAX_META_ACTIVITY_FACTS_PER_ROLE);
      });

      it.each([
        ['build', 'logistics', 2],
        ['capture', 'objectives', 1],
      ] as const)(
        'retains %s achievements committed then destroyed during Meta downtime and settles them after restart',
        async (action, role, count) => {
          const { matches, restart } = await backend(kind);
          const unavailable = economy();
          vi.spyOn(unavailable, 'transaction').mockRejectedValue(Error('meta unavailable'));
          const settle = vi.fn(async (_facts: MatchRewardFacts) => ({ ok: true }));
          const deps = {
            store: unavailable,
            matches,
            seats: () => async () => ({ p1: 'account' }),
            settle,
            stageCount: 2,
            now: () => 1000,
            onError: vi.fn(),
          };
          const delivery = createMetaRewardDelivery(deps);
          const first = initial();
          await delivery.matches.save(first);
          const room = new MatchRoom({
            id: first.matchId,
            initialState: first.state,
            initialSeq: first.seq,
            data: activityData,
            kernel: createKernel([activityModule]),
            now: () => 10,
            persist: (snapshot) => delivery.matches.save(snapshot),
          });
          const submit = (type: string) =>
            room.submitServerAction('p1', {
              id: type,
              type,
              playerId: 'p1',
              issuedAt: 10,
              payload: {},
            });
          expect(await submit(`test.${action}`)).toEqual({ ok: true });
          expect(await submit('test.loss')).toEqual({ ok: true });
          const final = snapshotOf(room);
          final.seq++;
          final.status = 'ended';
          final.state.match = {
            ...final.state.match,
            status: 'ended',
            winner: null,
            rewards: { p1: { place: 2, xp: 50 } },
          };
          await delivery.matches.save(final);
          await delivery.stop();
          expect(settle).not.toHaveBeenCalled();
          const loaded = (await restart().load(first.matchId))!;
          expect(loaded.state.planets.home!.buildings).toEqual([]);
          expect(loaded.state.planets.a!.owner).toBe(null);
          expect(loaded.economyActivity?.[activityKey(role)]).toHaveLength(count);
          const restored = createMetaRewardDelivery({
            ...deps,
            matches: restart(),
            store: economy(),
          });
          await restored.deliver(loaded);
          expect(settle.mock.calls.map(([facts]) => facts.kind)).toEqual(['stage', 'final']);
          expect(settle.mock.calls[0]![0].seasonFacts?.[role]).toBe(count);
        },
      );
    },
  );
}
