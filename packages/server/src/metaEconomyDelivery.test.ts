import { describe, expect, it, vi } from 'vitest';
import { createInitialState, type GameState, type Planet } from '@void/shared-core';
import { MemoryArsenalStore, MemoryDropStore, MemoryMatchStore, MemoryReceiptStore, type MatchSnapshot } from './store';
import { commitMatch } from './matchCommit';
import { MemoryMetaMarket } from './metaMarket';
import { MemoryMetaEconomyStore } from './metaEconomyStore';
import { createMetaRewardDelivery, type MetaRewardDeliveryDeps } from './metaEconomyDelivery';
import type { MatchRewardFacts } from './metaEconomy';

function snapshot(): MatchSnapshot {
  const state = createInitialState({
    seed: 'delivery',
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
  return { matchId: 'match', dataVersion: 'test', seq: 1, status: 'ongoing', state };
}
function explored(base: MatchSnapshot): MatchSnapshot {
  const next = structuredClone(base);
  next.seq++;
  next.state.fog = { p1: { home: {}, a: {}, b: {}, c: {} } } as unknown as GameState['fog'];
  return next;
}
function ended(base: MatchSnapshot): MatchSnapshot {
  const next = structuredClone(base);
  next.seq++;
  next.status = 'ended';
  next.state.match = {
    ...next.state.match,
    status: 'ended',
    winner: 'p1',
    rewards: { p1: { place: 1, xp: 100 } },
  };
  return next;
}
function fixture() {
  const arsenal = new MemoryArsenalStore();
  const market = new MemoryMetaMarket(arsenal);
  const store = new MemoryMetaEconomyStore(arsenal, new MemoryDropStore(), market);
  market.setEconomy(store);
  const matches = new MemoryMatchStore();
  const settle = vi.fn(async (_facts: MatchRewardFacts) => ({ ok: true }));
  const onError = vi.fn();
  const create = (clock = 1000, extra: Partial<MetaRewardDeliveryDeps> = {}) =>
    createMetaRewardDelivery({
      store,
      matches,
      seats: () => async () => ({ p1: 'account' }),
      settle,
      stageCount: 3,
      now: () => clock,
      onError,
      ...extra,
    });
  return { matches, store, settle, onError, create };
}

describe('reward delivery from persisted match facts', () => {
  it('preserves atomic command commits and observations through the production reward decorator', async () => {
    const { create, matches } = fixture();
    const delivery = create(); const receipts = new MemoryReceiptStore();
    const initial = snapshot();
    const receipt = { actionId: 'seat:p1:1', playerId: 'p1', seq: initial.seq, ok: true };
    await commitMatch(delivery.matches, receipts, initial, receipt);
    await delivery.stop();
    expect(await receipts.loadAll(initial.matchId)).toEqual([receipt]);
    expect((await matches.load(initial.matchId))?.economyObservations).toBeDefined();
    const committed = await matches.load(initial.matchId);
    receipts.prepareSave = () => { throw new Error('injected receipt preparation failure'); };
    await expect(commitMatch(delivery.matches, receipts, explored(initial), { ...receipt, actionId: 'seat:p1:2', seq: 2 }))
      .rejects.toThrow('injected receipt preparation failure');
    expect(await matches.load(initial.matchId)).toEqual(committed);
    expect(await receipts.loadAll(initial.matchId)).toHaveLength(1);
    await delivery.stop();
  });
  it('does not turn initial visibility, passive participation XP or a finished untouched seat into income', async () => {
    const { create, settle } = fixture();
    const delivery = create();
    const initial = snapshot();
    await delivery.deliver(initial);
    await delivery.deliver(ended(initial));
    expect(settle).not.toHaveBeenCalled();
  });

  it('does not count surviving starting buildings as newly built after another building is lost', async () => {
    const { create, settle } = fixture();
    const delivery = create();
    const initial = snapshot();
    initial.state.planets.home!.buildings = ['mine', 'factory', 'lab'].map((type) => ({
      type,
      level: 1,
      hp: 100,
    }));
    await delivery.deliver(initial);
    const damaged = ended(initial);
    damaged.state.planets.home!.buildings.shift();
    await delivery.deliver(damaged);
    expect(settle).not.toHaveBeenCalled();
  });

  it('ignores bots, unconfirmed seats and imported Sector Zero runs', async () => {
    const { create, settle } = fixture();
    const delivery = create();
    await delivery.deliver(snapshot());
    for (const kind of ['bot', 'npc', 'unseated', 'sector-zero']) {
      const state = ended(explored(snapshot()));
      if (kind === 'bot') state.state.players.p1!.ai = true;
      if (kind === 'npc') state.state.players.p1!.npc = 'pirate';
      if (kind === 'unseated') delete state.state.players.p1!.seated;
      if (kind === 'sector-zero') state.state.modeId = 'sector-zero';
      await delivery.deliver(state);
    }
    expect(settle).not.toHaveBeenCalled();
  });

  it('persists immutable reward facts before delivery and replays them after a process restart', async () => {
    const { create, settle, matches } = fixture();
    const delivery = create(1000);
    await delivery.deliver(snapshot());
    const final = ended(explored(snapshot()));
    await matches.save(final);
    settle.mockRejectedValueOnce(Error('meta temporarily down'));
    await expect(delivery.deliver(final)).rejects.toThrow('meta temporarily down');
    const first = structuredClone(settle.mock.calls[0]![0]);
    const restarted = create(9999);
    await restarted.sweep();
    expect(settle.mock.calls[1]![0]).toEqual(first);
    expect(settle.mock.calls.map(([facts]) => facts.kind)).toEqual(['stage', 'stage', 'final']);
    expect(settle.mock.calls[2]![0].occurredAt).toBe(1000);
  });

  it('keeps a verified stage when visibility is lost and the player returns after a natural pause', async () => {
    const { create, settle } = fixture();
    const delivery = create();
    await delivery.deliver(snapshot());
    await delivery.deliver(explored(snapshot()));
    settle.mockClear();
    await delivery.deliver(ended(snapshot()));
    expect(settle.mock.calls.map(([facts]) => facts.kind)).toEqual(['stage', 'final']);
    expect(settle.mock.calls[1]![0].seasonFacts?.recon).toBe(3);
  });

  it('loads committed state after save and does not settle a rejected stale snapshot', async () => {
    const { create, settle, matches } = fixture();
    const delivery = create();
    const initial = snapshot();
    await delivery.deliver(initial);
    const committed = { ...initial, seq: 10 };
    await matches.save(committed);
    await delivery.matches.save(ended(explored(initial)));
    await delivery.stop();
    expect(settle).not.toHaveBeenCalled();
    expect((await matches.load('match'))?.seq).toBe(10);
  });

  it('replays account-scoped facts after the same account reclaims a seat without issuing duplicate value', async () => {
    const { create, settle } = fixture();
    const receipts = new Map<string, string>();
    let credited = 0;
    settle.mockImplementation(async (facts) => {
      const key = `${facts.matchId}:${facts.accountId}:${facts.kind}:${facts.stage ?? ''}`;
      const payload = JSON.stringify(facts);
      const previous = receipts.get(key);
      if (previous && previous !== payload) throw new Error('E_IDEMPOTENCY_CONFLICT');
      if (!previous) {
        receipts.set(key, payload);
        credited++;
      }
      return { ok: true };
    });
    const first = create(1000);
    await first.deliver(snapshot());
    await first.deliver(explored(snapshot()));
    const awarded = structuredClone(settle.mock.calls[0]![0]);
    expect(credited).toBe(1);

    const reclaimed = snapshot();
    reclaimed.seq = 10;
    reclaimed.state.players.p1!.claimedAt = 2000;
    const restarted = create(9999);
    await restarted.deliver(reclaimed);
    await restarted.deliver(ended(explored(reclaimed)));
    expect(
      settle.mock.calls.filter(([facts]) => facts.kind === 'stage').map(([facts]) => facts),
    ).toEqual([awarded, awarded, awarded]);
    expect(credited).toBe(2); // one stage and one final, across both claims
    expect(settle.mock.calls.at(-1)![0].kind).toBe('final');
  });
});

describe('rewards only for time in the match', () => {
  const DAY = 86_400_000;
  const participation = {
    reconPerPoint: 3,
    logisticsPerPoint: 2,
    defensePerPoint: 1,
    objectivesPerPoint: 1,
    stagePoints: [1, 3],
    stageDays: [3, 7],
    finalPresence: 0.25,
  };
  const scope = (role: string) => JSON.stringify(['p1', 1, role]);
  /** Three objectives (3 points) with own orders on the given game days. */
  function played(days: number[], extra: Record<string, string[]> = {}): MatchSnapshot {
    const next = snapshot();
    next.seq = 2;
    next.economyActivity = {
      [scope('objectives')]: ['a', 'b', 'c'],
      [scope('orders')]: days.map(String),
      ...extra,
    };
    return next;
  }
  function endedAt(base: MatchSnapshot, day: number): MatchSnapshot {
    const next = ended(base);
    next.state.match.endedAt = day * DAY;
    return next;
  }
  const kinds = (settle: ReturnType<typeof fixture>['settle']) =>
    settle.mock.calls.map(([facts]) => `${facts.kind}${facts.stage ?? ''}`);

  it('pays a stage only after enough distinct days of own orders', async () => {
    const { create, settle } = fixture();
    const delivery = create(1000, { participation, stageCount: 2 });
    await delivery.deliver(snapshot());
    await delivery.deliver(played([0, 0, 1]));
    expect(settle).not.toHaveBeenCalled();
    await delivery.deliver(played([0, 1, 2]));
    expect(kinds(settle)).toEqual(['stage1']);
    settle.mockClear();
    await delivery.deliver(played([0, 1, 2, 3, 4, 5, 6]));
    expect(kinds(settle)).toEqual(['stage1', 'stage2']);
  });

  it('does not pay the final to a seat abandoned to the bots', async () => {
    const { create, settle } = fixture();
    const delivery = create(1000, { participation, stageCount: 2 });
    await delivery.deliver(snapshot());
    // Seat claimed at game time 1, match ends on day 40: the last quarter starts on day 30.
    await delivery.deliver(endedAt(played([0, 1, 2, 3, 4, 5, 6]), 40));
    expect(kinds(settle)).toEqual(['stage1', 'stage2']);
    settle.mockClear();
    await delivery.deliver(endedAt(played([0, 1, 2, 3, 4, 5, 6, 30]), 40));
    expect(kinds(settle)).toEqual(['stage1', 'stage2', 'final']);
  });

  it('pays the final to a short match and to a player who fought until eliminated', async () => {
    const short = fixture();
    const quick = short.create(1000, { participation, stageCount: 2 });
    await quick.deliver(snapshot());
    await quick.deliver(endedAt(played([0, 1]), 2));
    expect(kinds(short.settle)).toEqual(['final']);

    const lost = fixture();
    const delivery = lost.create(1000, { participation, stageCount: 2 });
    await delivery.deliver(snapshot());
    const eliminated = { [scope('eliminated')]: [String(12 * DAY)] };
    await delivery.deliver(endedAt(played([0, 1, 2, 10], eliminated), 40));
    expect(kinds(lost.settle)).toEqual(['stage1', 'final']);
  });

  it('credits each UTC day of own orders once per account', async () => {
    const { create } = fixture();
    const activeDay = vi.fn(async (_account: string, _day: number) => ({ ok: true }));
    const delivery = create(1000, { participation, activeDay });
    const base = played([0], { [scope('ordersUtc')]: ['20741', '20742'] });
    await delivery.deliver(base);
    await delivery.deliver(base);
    expect(activeDay.mock.calls).toEqual([
      ['account', 20741],
      ['account', 20742],
    ]);
    activeDay.mockResolvedValueOnce({ ok: false, code: 'E_META_UNAVAILABLE' } as never);
    const later = played([0], { [scope('ordersUtc')]: ['20741', '20742', '20743'] });
    await expect(delivery.deliver(later)).rejects.toThrow('E_META_UNAVAILABLE');
    await delivery.deliver(later);
    expect(activeDay.mock.calls.map(([, day]) => day)).toEqual([20741, 20742, 20743, 20743]);
  });
});
