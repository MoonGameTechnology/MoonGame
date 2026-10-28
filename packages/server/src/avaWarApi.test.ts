import { describe, expect, it } from 'vitest';
import Fastify, { type FastifyInstance, type FastifyRequest } from 'fastify';
import { buildStateFromMap } from '@void/shared-core';
import type { AvaWarView } from './avaBattleView';
import { seatAvaRoster } from './avaOrchestrator';
import { registerAvaWarApi } from './avaWarApi';
import type { Identity } from './matchApi';
import { loadAvaMaps, loadShippedData } from './scenario';
import {
  MemoryAvaChallengeStore,
  MemoryAvaSessionStore,
  MemoryCorpStore,
  MemoryUserStore,
  type AvaChallenge,
} from './store';

// CORP-9 — GET /ava-war/:matchupId, the war of one side on the host that runs the battle.
// The view itself is `avaWarView` (avaBattleView.test.ts); here: the session gate, who may
// look, when there is a battle to look at, and what of the rival the wire carries.

const data = loadShippedData();
const map = loadAvaMaps(data).retired.find((m) => m.id === 'ava-2v2-1')!;
const rules = { scoreLimit: 600, coalitionFactor: 0.7, dominationPercent: 0.6, endsAt: 1e10 };

interface Harness {
  app: FastifyInstance;
  ids: Record<string, string>;
  challenges: MemoryAvaChallengeStore;
  sessions: MemoryAvaSessionStore;
  /** Lock the matchup and raise its battle: alice and ann against bob and a bot. */
  raise(): Promise<void>;
}

/** Corp A (alice head, ann member) challenged corp B (bob head, rex recruit) to a 2 на 2;
 *  carol heads a third corp, dave is in none. */
async function harness(): Promise<Harness> {
  const users = new MemoryUserStore();
  const ids: Record<string, string> = {};
  for (const login of ['alice', 'ann', 'bob', 'rex', 'carol', 'dave']) {
    const made = await users.createUser(login, 'hash');
    if (!made.ok) throw new Error('harness: user');
    ids[login] = made.userId;
  }
  const corps = new MemoryCorpStore();
  const a = await corps.createCorp('Alliance A', ids.alice!, 'alice');
  const b = await corps.createCorp('Alliance B', ids.bob!, 'bob');
  const c = await corps.createCorp('Alliance C', ids.carol!, 'carol');
  if (!a.ok || !b.ok || !c.ok) throw new Error('harness: corp');
  await corps.addMember(a.corpId, ids.ann!, 'ann', 'member');
  await corps.addMember(b.corpId, ids.rex!, 'rex', 'recruit');
  const challenges = new MemoryAvaChallengeStore();
  const challenge: AvaChallenge = {
    id: 'mu-1',
    challengerCorp: a.corpId,
    targetCorp: b.corpId,
    format: 2,
    cost: 100,
    status: 'pending',
    createdAt: 1,
    expiresAt: 1_000,
  };
  await challenges.createChallenge(challenge);
  await challenges.closeChallenge('mu-1', 'accepted');
  const sessions = new MemoryAvaSessionStore();
  const { slots, seats } = seatAvaRoster(map, {
    challenger: [ids.alice!, ids.ann!],
    target: [ids.bob!],
  });
  const state = buildStateFromMap(map, data, { slots, crossTeamStart: 'peace' });
  const app = Fastify();
  registerAvaWarApi(app, {
    identify: (request: FastifyRequest): Promise<Identity | null> => {
      const login = request.headers['x-test-user'];
      const accountId = typeof login === 'string' ? ids[login] : undefined;
      return Promise.resolve(accountId ? { accountId, login: login as string } : null);
    },
    corps,
    challenges,
    sessions,
    users,
    battle: (matchId) =>
      Promise.resolve(matchId === 'ava-1' ? { state, victoryRules: rules } : undefined),
    data,
  });
  const raise = async (): Promise<void> => {
    await challenges.closeMatchup('mu-1', 'locked');
    await sessions.create({
      matchId: 'ava-1',
      matchupId: 'mu-1',
      mapId: map.id,
      seats,
      at: 0,
      warAt: 9_000,
    });
  };
  return { app, ids, challenges, sessions, raise };
}

const get = (app: FastifyInstance, login: string | null, matchupId = 'mu-1') =>
  app.inject({
    method: 'GET',
    url: `/ava-war/${matchupId}`,
    headers: login ? { 'x-test-user': login } : {},
  });

describe('GET /ava-war/:matchupId (CORP-9) — the war of one side', () => {
  it('needs a session and a member of a party to the matchup', async () => {
    const { app, raise } = await harness();
    await raise();
    expect((await get(app, null)).statusCode).toBe(401);
    const unknown = await get(app, 'alice', 'mu-404');
    expect([unknown.statusCode, unknown.json()]).toEqual([404, { error: 'E_NO_CHALLENGE' }]);
    for (const login of ['carol', 'dave', 'rex']) {
      const res = await get(app, login);
      expect([res.statusCode, res.json()], login).toEqual([403, { error: 'E_FORBIDDEN' }]);
    }
    await app.close();
  });

  it('in peace: the side’s own seats, and of the rival only how many signed up', async () => {
    const { app, ids, raise } = await harness();
    await raise();
    const res = await get(app, 'ann');
    expect(res.statusCode).toBe(200);
    const view = res.json<AvaWarView>();
    expect(view).toMatchObject({
      matchupId: 'mu-1',
      side: 'challenger',
      phase: 'peace',
      warAt: 9_000,
      scoreGoal: 840,
      capturable: 9,
      rivals: { count: 1 },
    });
    expect(view.rivals).not.toHaveProperty('seats');
    // Seats come in slot order, and which slot an account takes follows its id.
    expect(view.mine.map((seat) => [seat.login, seat.accountId]).sort()).toEqual([
      ['alice', ids.alice],
      ['ann', ids.ann],
    ]);
    expect(res.body).not.toContain('bob');
    expect(res.body).not.toContain(ids.bob);
    await app.close();
  });

  it('at war: who the rivals are and who is out, never their accounts, score or land', async () => {
    const { app, ids, sessions, raise } = await harness();
    await raise();
    await sessions.markWarDeclared('ava-1', 9_100);
    const res = await get(app, 'bob');
    expect(res.statusCode).toBe(200);
    const view = res.json<AvaWarView>();
    expect(view).toMatchObject({ side: 'target', phase: 'war', warAt: 9_100, scoreGoal: 840 });
    expect(view.mine).toEqual([
      { accountId: null, login: null, score: 0, provinces: 1, out: false },
      { accountId: ids.bob, login: 'bob', score: 0, provinces: 1, out: false },
    ]);
    expect(view.rivals.count).toBe(2);
    expect(view.rivals.seats?.map((seat) => seat.login).sort()).toEqual(['alice', 'ann']);
    expect(view.rivals.seats?.every((seat) => !seat.bot && !seat.out)).toBe(true);
    expect(
      view.rivals.seats?.every((seat) => Object.keys(seat).sort().join() === 'bot,login,out'),
    ).toBe(true);
    expect(res.body).not.toContain(ids.alice);
    expect(res.body).not.toContain(ids.ann);
    await app.close();
  });

  it('there is no battle to show before the lock, before it is raised, or after it is settled', async () => {
    const { app, challenges, sessions } = await harness();
    const noBattle = async (): Promise<void> => {
      const res = await get(app, 'alice');
      expect([res.statusCode, res.json()]).toEqual([404, { error: 'E_NO_BATTLE' }]);
    };
    await noBattle(); // the roster window is still open
    await challenges.closeMatchup('mu-1', 'locked');
    await noBattle(); // locked, the battle not raised yet
    await sessions.create({
      matchId: 'ava-gone',
      matchupId: 'mu-1',
      mapId: map.id,
      seats: {},
      at: 0,
    });
    await noBattle(); // raised, but not on this host
    await app.close();
    const settled = await harness();
    await settled.raise();
    expect((await get(settled.app, 'alice')).statusCode).toBe(200);
    await settled.challenges.endMatchup('mu-1', 'ended');
    const res = await get(settled.app, 'alice');
    expect([res.statusCode, res.json()]).toEqual([404, { error: 'E_NO_BATTLE' }]);
    await settled.app.close();
  });
});
