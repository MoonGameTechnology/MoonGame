import { describe, expect, it } from 'vitest';
import { emptyCareer, foldCareerEvents, careerOwners, settleCareer } from './playerCareer';
import { createInitialState, type GameState } from '@void/shared-core';
const state = (): GameState => {
  const s = createInitialState({ seed: 'career', version: { data: '1', manifest: '1' } });
  s.players = Object.fromEntries(
    ['a', 'b', 'bot'].map((id) => [
      id,
      {
        id,
        name: id,
        faction: 'f',
        status: 'active' as const,
        resources: {},
        claimedAt: 1,
        seated: true as const,
      },
    ]),
  );
  s.mapId = 'duel-1';
  return s;
};
const death = (owner = 'b', killedBy = 'a') => ({
  type: 'unit.died',
  payload: {
    owner,
    killedBy,
    unit: 'ship',
    count: 2,
    lossCost: { metal: 80 },
  },
});
describe('authoritative player career', () => {
  it('credits only two known human seats, including an offline autopilot', () => {
    const s = state();
    s.players.a!.ai = true;
    const owners = careerOwners(s, { a: 'account-a', b: 'account-b' });
    const result = foldCareerEvents(
      emptyCareer(100),
      [death(), death('bot'), death('a', 'bot')],
      s,
      owners,
    );
    expect(result.players['account-a']!.destroyed).toBe(2);
    expect(result.players['account-b']!.lostCost).toEqual({ metal: 80 });
    expect(result.players['account-a']!.lost).toBe(0);
  });
  it('rejects released, replaced, self and malformed casualties', () => {
    const s = state(),
      owners = careerOwners(s, { a: 'account-a', b: 'account-b' });
    s.players.b!.claimedAt = 2;
    expect(
      foldCareerEvents(emptyCareer(100), [death(), death('a', 'a')], s, owners).players,
    ).toEqual({});
  });
  it('counts only completed competitive matches and records no invented historic zero', () => {
    const s = state(),
      owners = careerOwners(s, { a: 'account-a', b: 'account-b' });
    expect(settleCareer(emptyCareer(100), s, owners)).toEqual([]);
    s.match.status = 'ended'; s.match.rewards = { a: {place:1,xp:100},b:{place:2,xp:50} };
    s.match.winner = 'a';
    const rows = settleCareer(emptyCareer(100), s, owners);
    expect(rows.find((r) => r.accountId === 'account-a')!.career).toMatchObject({
      matches: 1,
      wins: 1,
      since: 100,
    });
    s.pve = {} as GameState['pve'];
    expect(settleCareer(emptyCareer(100), s, owners)).toEqual([]);
  });
});

it('divides joint combat by damage contribution and excludes the bot share symmetrically', () => {
  const s = state();
  const owners = careerOwners(s, { a: 'account-a', b: 'account-b' });
  const event = death();
  const result = foldCareerEvents(
    emptyCareer(100),
    [{ ...event, payload: { ...event.payload, count: 4, damageShares: { a: 1, bot: 1 } } }],
    s,
    owners,
  );
  expect(result.players['account-a']).toMatchObject({ destroyed: 2, destroyedCost: { metal: 40 } });
  expect(result.players['account-b']).toMatchObject({ lost: 2, lostCost: { metal: 40 } });
  expect(result.players.bot).toBeUndefined();
});
it('does not mutate a prior ledger or count a defeated human as a bot', () => {
  const s = state(),
    owners = careerOwners(s, { a: 'account-a', b: 'account-b' });
  s.players.b!.status = 'defeated';
  const before = emptyCareer(100);
  const after = foldCareerEvents(before, [death()], s, owners);
  expect(before.players).toEqual({});
  expect(after.players['account-a']!.destroyed).toBe(2);
});
it('keeps a kicked participant’s earned combat on settlement', () => {
  const s = state(),
    owners = careerOwners(s, { a: 'account-a', b: 'account-b' });
  const ledger = foldCareerEvents(emptyCareer(100), [death()], s, owners);
  delete s.players.b!.seated;
  s.match.status = 'ended'; s.match.rewards = { a: {place:1,xp:100},b:{place:2,xp:50} };
  expect(
    settleCareer(ledger, s, owners).find((r) => r.accountId === 'account-b')!.career.pvp.lost,
  ).toBe(2);
});

it('publishes career data only with a successful world commit and restores it privately', async () => {
  const { MatchRoom } = await import('./matchRoom');
  const { createKernel, parseGameData, visibleView } = await import('@void/shared-core');
  const { snapshotOf } = await import('./persistence');
  const data = parseGameData({
    version: '1',
    resources: ['metal'],
    units: {},
    buildings: {},
    factions: {},
    events: {},
  });
  const kernel = createKernel([
    {
      id: 'casualty-fixture',
      version: '1',
      setup(api) {
        api.onAction('test.death', (_a, h) => {
          h.emit('unit.died', death().payload);
          h.emit('career.casualty', { ...death().payload, killedBy:'bot' });
        });
      },
    },
  ]);
  let fail = true;
  const snapshots: import('./store').MatchSnapshot[] = [];
  const options = {
    id: 'career-match',
    data,
    kernel,
    config: { timeScale: 1 },
    initialState: state(),
    now: () => 100,
    careerAccounts: { a: 'account-a', b: 'account-b' },
  };
  const room = new MatchRoom({
    ...options,
    persist: async (snapshot) => {
      if (fail) throw Error('test write failure');
      snapshots.push(snapshot);
    },
  });
  const messages: string[] = [];
  room.addPeer('b', { send: (message) => { messages.push(message); } });
  const action = { id: 'death-1', type: 'test.death', playerId: 'a', payload: {}, issuedAt: 100 };
  expect((await room.submitServerAction('a', action)).ok).toBe(false);
  expect(room.careerSnapshot!.players).toEqual({});
  fail = false;
  expect((await room.submitServerAction('a', action)).ok).toBe(true);
  expect(room.careerSnapshot!.players['account-a']!.destroyed).toBe(2);
  expect((await room.submitServerAction('a', action)).ok).toBe(true);
  expect(room.careerSnapshot!.players['account-a']!.destroyed).toBe(2);
  const saved = snapshotOf(room);
  expect(saved.career).toEqual(snapshots[0]!.career);
  expect(messages.join('')).not.toMatch(/lossCost|damageShares|career.casualty|account-a|account-b/);
  const restored = new MatchRoom({
    ...options,
    initialState: saved.state,
    initialCareer: saved.career,
    initialSeq: saved.seq,
  });
  expect(restored.careerSnapshot).toEqual(saved.career);
  expect(JSON.stringify(visibleView(room.state, 'a', data))).not.toContain('account-a');
});
