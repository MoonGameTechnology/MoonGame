import { describe, expect, it } from 'vitest';
import { AvaService } from './avaService';
import { CorpService, type CorpActor } from './corpService';
import { generatedCorpName } from './corpNames';
import { parseMedalCatalog, type MedalCatalog } from './medalCatalog';
import {
  MemoryAvaChallengeStore,
  MemoryAvaFeedStore,
  MemoryAvaResultStore,
  MemoryAvaRosterStore,
  MemoryCorpStore,
  type AvaBattleReport,
} from './store';

// AVA-2/3/4 — readiness + the S0→S2 challenge state machine — and AVA-6, the roster
// window, enforced fail-secure. Every gate is exercised both ways; influence is
// checked to balance exactly across spend / refund; expiry and the roster sweep run
// with no client, on the injected clock. The battle formats (CORP-7) run on the shipped
// catalog: a 2-on-2 costs 100, pays the winner 150 and needs two players a side.

const A_HEAD: CorpActor = { accountId: 'a-head', login: 'ahead' };
const A_MEMBER: CorpActor = { accountId: 'a-mem', login: 'amember' };
const A_THIRD: CorpActor = { accountId: 'a-3rd', login: 'athird' };
const B_HEAD: CorpActor = { accountId: 'b-head', login: 'bhead' };
const B_MEMBER: CorpActor = { accountId: 'b-mem', login: 'bmember' };
const B_THIRD: CorpActor = { accountId: 'b-3rd', login: 'bthird' };
const OUTSIDER: CorpActor = { accountId: 'out', login: 'outsider' };

interface Fixture {
  ava: AvaService;
  corp: CorpService;
  store: MemoryCorpStore;
  /** The public feed the AvA service and the corp store both write to (CORP-1). */
  feed: MemoryAvaFeedStore;
  corpA: string;
  corpB: string;
  clock: () => number;
  /** Move the services' clock forward (CORP-7: let a construction finish). */
  advance: (ms: number) => void;
}

/** Two corps A and B (head + two members each), each with `influence` credited. */
async function fixture(
  opts: {
    influenceA?: number;
    influenceB?: number;
    medals?: MedalCatalog;
  } = {},
): Promise<Fixture> {
  const feed = new MemoryAvaFeedStore();
  const store = new MemoryCorpStore(feed);
  const challenges = new MemoryAvaChallengeStore();
  let t = 0;
  const now = (): number => ++t;
  let catalogueIndex = 0;
  const corp = new CorpService({ store, now, nameIndex: () => catalogueIndex++ });
  const ava = new AvaService({
    corpStore: store,
    challengeStore: challenges,
    rosterStore: new MemoryAvaRosterStore(),
    resultStore: new MemoryAvaResultStore(),
    feedStore: feed,
    ...(opts.medals ? { medals: opts.medals } : {}),
    now,
    expiryMs: 1_000,
    pauseMs: 1_000,
  });

  const a = await corp.create(A_HEAD, 'Alliance A');
  const b = await corp.create(B_HEAD, 'Alliance B');
  if (!a.ok || !b.ok) throw new Error('fixture: create failed');
  for (const [head, corpId, members] of [
    [A_HEAD, a.corpId, [A_MEMBER, A_THIRD]],
    [B_HEAD, b.corpId, [B_MEMBER, B_THIRD]],
  ] as const) {
    for (const member of members) {
      await corp.apply(member, corpId);
      await corp.accept(head, corpId, member.accountId);
    }
  }
  await store.addInfluence(a.corpId, opts.influenceA ?? 500);
  await store.addInfluence(b.corpId, opts.influenceB ?? 500);
  return {
    ava,
    corp,
    store,
    feed,
    corpA: a.corpId,
    corpB: b.corpId,
    clock: (): number => t,
    advance: (ms): void => {
      t += ms;
    },
  };
}

/** Ready → challenge → accept → two a side join → sweep-lock: the LOCKED matchup id. */
async function lockedMatchup(f: Fixture): Promise<string> {
  await f.ava.setCorpReady(A_HEAD);
  await f.ava.setCorpReady(B_HEAD);
  const ch = await f.ava.challenge(A_HEAD, f.corpB);
  if (!ch.ok) throw new Error('challenge failed');
  if (!(await f.ava.accept(B_HEAD, ch.id)).ok) throw new Error('accept failed');
  for (const who of [A_HEAD, A_MEMBER, B_HEAD, B_MEMBER]) await f.ava.join(who, ch.id);
  if ((await f.ava.sweepRosters(f.clock() + 1_000_000)).locked !== 1)
    throw new Error('lock failed');
  return ch.id;
}

describe('AvaService — readiness (AVA-3)', () => {
  it('only the head flags the corp; a member flags only their own consent', async () => {
    const { ava, corpA } = await fixture();
    expect(await ava.setCorpReady(A_MEMBER)).toEqual({ ok: false, code: 'E_FORBIDDEN' });
    expect(await ava.setCorpReady(A_HEAD)).toEqual({ ok: true });
    expect((await ava.pool()).map((c) => c.corpId)).toContain(corpA);

    expect(await ava.setPlayerReady(OUTSIDER)).toEqual({ ok: false, code: 'E_FORBIDDEN' });
    expect(await ava.setPlayerReady(A_MEMBER)).toEqual({ ok: true });
    expect(await ava.setPlayerReady(A_HEAD)).toEqual({ ok: true });
  });

  it('leaving the corp revokes the player consent', async () => {
    const { ava, corp, store, corpA } = await fixture();
    await ava.setPlayerReady(A_MEMBER);
    expect(await store.readyPlayersOf(corpA)).toContain(A_MEMBER.accountId);
    await corp.leave(A_MEMBER, corpA);
    expect(await store.readyPlayersOf(corpA)).not.toContain(A_MEMBER.accountId);
  });
});

describe('AvaService — challenge S0→S2 (AVA-4)', () => {
  async function ready(f: Fixture): Promise<void> {
    await f.ava.setCorpReady(A_HEAD);
    await f.ava.setCorpReady(B_HEAD);
  }

  it('challenge → accept: influence spent stays spent, status accepted (S2)', async () => {
    const f = await fixture();
    await ready(f);
    const ch = await f.ava.challenge(A_HEAD, f.corpB);
    if (!ch.ok) throw new Error('challenge failed');
    expect((await f.store.getCorp(f.corpA))?.influence).toBe(400); // 500 − 100
    expect(await f.ava.accept(B_HEAD, ch.id)).toEqual({ ok: true });
    expect((await f.store.getCorp(f.corpA))?.influence).toBe(400); // war funded — not refunded
    const list = await f.ava.challengesFor(B_HEAD);
    expect(list[0]).toMatchObject({
      status: 'accepted',
      challengerCorp: f.corpA,
      targetCorp: f.corpB,
    });
  });

  it('challenge → decline refunds the challenger in full', async () => {
    const f = await fixture();
    await ready(f);
    const ch = await f.ava.challenge(A_HEAD, f.corpB);
    if (!ch.ok) throw new Error('challenge failed');
    expect(await f.ava.decline(B_HEAD, ch.id)).toEqual({ ok: true });
    expect((await f.store.getCorp(f.corpA))?.influence).toBe(500); // fully refunded
  });

  it('expiry refunds without any client, on the injected clock', async () => {
    const f = await fixture();
    await ready(f);
    const ch = await f.ava.challenge(A_HEAD, f.corpB);
    if (!ch.ok) throw new Error('challenge failed');
    expect(await f.ava.sweepExpired(1)).toBe(0); // not yet due (expiryMs 1000)
    const closed = await f.ava.sweepExpired(1_000_000);
    expect(closed).toBe(1);
    expect((await f.store.getCorp(f.corpA))?.influence).toBe(500); // refunded on expiry
    expect((await f.ava.challengesFor(A_HEAD))[0]).toMatchObject({ status: 'expired' });
  });

  it('rejects self-challenge, an unready pair, and insufficient influence', async () => {
    const f = await fixture({ influenceA: 50 });
    // corps aren't in the ready pool yet → E_NOT_READY (the head gate already passed)
    expect(await f.ava.challenge(A_HEAD, f.corpB)).toEqual({ ok: false, code: 'E_NOT_READY' });
    await ready(f);
    expect(await f.ava.challenge(A_HEAD, f.corpA)).toEqual({ ok: false, code: 'E_SELF_CHALLENGE' });
    expect(await f.ava.challenge(A_HEAD, f.corpB)).toEqual({ ok: false, code: 'E_INSUFFICIENT' }); // 50 < 100
    expect((await f.store.getCorp(f.corpA))?.influence).toBe(50); // nothing spent on the failed attempt
  });

  it('a non-head cannot challenge, accept or decline', async () => {
    const f = await fixture();
    await ready(f);
    expect(await f.ava.challenge(A_MEMBER, f.corpB)).toEqual({ ok: false, code: 'E_FORBIDDEN' });
    const ch = await f.ava.challenge(A_HEAD, f.corpB);
    if (!ch.ok) throw new Error('challenge failed');
    // only the TARGET head answers — the challenger head cannot accept their own
    expect(await f.ava.accept(A_HEAD, ch.id)).toEqual({ ok: false, code: 'E_FORBIDDEN' });
    expect(await f.ava.accept(OUTSIDER, ch.id)).toEqual({ ok: false, code: 'E_FORBIDDEN' });
  });

  it('one pending challenge per pair; refunds the blocked second attempt', async () => {
    const f = await fixture();
    await ready(f);
    const first = await f.ava.challenge(A_HEAD, f.corpB);
    if (!first.ok) throw new Error('first failed');
    const second = await f.ava.challenge(A_HEAD, f.corpB);
    expect(second).toEqual({ ok: false, code: 'E_ALREADY_CHALLENGED' });
    expect((await f.store.getCorp(f.corpA))?.influence).toBe(400); // blocked attempt was refunded (only 100 gone)
  });

  it('double-accept race: the second accept sees a closed challenge', async () => {
    const f = await fixture();
    await ready(f);
    const ch = await f.ava.challenge(A_HEAD, f.corpB);
    if (!ch.ok) throw new Error('challenge failed');
    expect(await f.ava.accept(B_HEAD, ch.id)).toEqual({ ok: true });
    expect(await f.ava.accept(B_HEAD, ch.id)).toEqual({ ok: false, code: 'E_CHALLENGE_CLOSED' });
    expect(await f.ava.decline(B_HEAD, ch.id)).toEqual({ ok: false, code: 'E_CHALLENGE_CLOSED' });
  });

  it('a missing challenge id is E_NO_CHALLENGE', async () => {
    const f = await fixture();
    expect(await f.ava.accept(B_HEAD, 'nope')).toEqual({ ok: false, code: 'E_NO_CHALLENGE' });
  });
});

describe('AvaService — roster window S3 (AVA-6)', () => {
  /** Ready both corps, run challenge → accept, return the matchup id. */
  async function matchup(f: Fixture): Promise<string> {
    await f.ava.setCorpReady(A_HEAD);
    await f.ava.setCorpReady(B_HEAD);
    const ch = await f.ava.challenge(A_HEAD, f.corpB);
    if (!ch.ok) throw new Error('challenge failed');
    const accepted = await f.ava.accept(B_HEAD, ch.id);
    if (!accepted.ok) throw new Error('accept failed');
    return ch.id;
  }

  it('accept opens the roster window (pauseEndsAt stamped on the matchup)', async () => {
    const f = await fixture();
    await matchup(f);
    const row = (await f.ava.challengesFor(A_HEAD))[0];
    expect(row?.status).toBe('accepted');
    expect(row?.pauseEndsAt).toBeGreaterThan(f.clock());
  });

  it('setRoster: head/officer only, flagged pool only, capped by the side slots', async () => {
    const f = await fixture();
    const id = await matchup(f);
    // A plain member cannot curate; an unflagged pick is rejected wholesale.
    expect(await f.ava.setRoster(A_MEMBER, id, [])).toEqual({ ok: false, code: 'E_FORBIDDEN' });
    expect(await f.ava.setRoster(A_HEAD, id, [A_MEMBER.accountId])).toEqual({
      ok: false,
      code: 'E_NOT_FLAGGED',
    });
    // Flag both, curate both — the side is replaced wholesale.
    await f.ava.setPlayerReady(A_HEAD);
    await f.ava.setPlayerReady(A_MEMBER);
    expect(
      await f.ava.setRoster(A_HEAD, id, [A_HEAD.accountId, A_MEMBER.accountId]),
    ).toEqual({ ok: true });
    const view = await f.ava.rosterView(A_HEAD, id);
    if ('ok' in view) throw new Error('view failed');
    expect(view.mine.map((r) => r.accountId).sort()).toEqual([
      A_HEAD.accountId,
      A_MEMBER.accountId,
    ]);
    // Over the cap (2) — rejected before anything changes.
    expect(
      await f.ava.setRoster(A_HEAD, id, [A_HEAD.accountId, A_MEMBER.accountId, 'ghost']),
    ).toEqual({ ok: false, code: 'E_ROSTER_FULL' });
  });

  it('join: a member self-enrolls (unflagged too), idempotently; outsiders never', async () => {
    const f = await fixture();
    const id = await matchup(f);
    expect(await f.ava.join(A_MEMBER, id)).toEqual({ ok: true }); // unflagged — showing up IS consent
    expect(await f.ava.join(A_MEMBER, id)).toEqual({ ok: true }); // already in = desired state
    expect(await f.ava.join(OUTSIDER, id)).toEqual({ ok: false, code: 'E_FORBIDDEN' });
    const view = await f.ava.rosterView(A_MEMBER, id);
    if ('ok' in view) throw new Error('view failed');
    expect(view.mine).toHaveLength(1);
    expect(view.mine[0]).toMatchObject({ accountId: A_MEMBER.accountId, source: 'self' });
  });

  it('join respects the per-side cap: a 2-on-2 seats two', async () => {
    const f = await fixture();
    const id = await matchup(f);
    expect(await f.ava.join(A_HEAD, id)).toEqual({ ok: true });
    expect(await f.ava.join(A_MEMBER, id)).toEqual({ ok: true });
    expect(await f.ava.join(A_THIRD, id)).toEqual({ ok: false, code: 'E_ROSTER_FULL' });
    expect(await f.ava.join(B_HEAD, id)).toEqual({ ok: true }); // the OTHER side has its own cap
  });

  it('the opponent roster stays private — headcount only', async () => {
    const f = await fixture();
    const id = await matchup(f);
    await f.ava.join(A_HEAD, id);
    await f.ava.join(A_MEMBER, id);
    const view = await f.ava.rosterView(B_HEAD, id);
    if ('ok' in view) throw new Error('view failed');
    expect(view.side).toBe('target');
    expect(view.mine).toHaveLength(0); // B has nobody yet…
    expect(view.counts).toEqual({ challenger: 2, target: 0 }); // …and sees only A's COUNT
    expect(await f.ava.rosterView(OUTSIDER, id)).toEqual({ ok: false, code: 'E_FORBIDDEN' });
  });

  it('sweep locks a full roster exactly once; writes freeze after the lock', async () => {
    const f = await fixture();
    const id = await matchup(f);
    for (const who of [A_HEAD, A_MEMBER, B_HEAD, B_MEMBER]) await f.ava.join(who, id);
    expect(await f.ava.sweepRosters(1)).toEqual({ locked: 0, cancelled: 0 }); // window still open
    expect(await f.ava.sweepRosters(1_000_000)).toEqual({ locked: 1, cancelled: 0 });
    expect(await f.ava.sweepRosters(1_000_000)).toEqual({ locked: 0, cancelled: 0 }); // exactly once
    expect((await f.ava.challengesFor(A_HEAD))[0]?.status).toBe('locked');
    expect(await f.ava.join(A_THIRD, id)).toEqual({ ok: false, code: 'E_ROSTER_LOCKED' });
    await f.ava.setPlayerReady(A_HEAD);
    expect(await f.ava.setRoster(A_HEAD, id, [A_HEAD.accountId])).toEqual({
      ok: false,
      code: 'E_ROSTER_LOCKED',
    });
  });

  it('sweep cancels a short-side matchup and refunds the challenge cost once', async () => {
    const f = await fixture();
    const id = await matchup(f);
    await f.ava.join(A_HEAD, id); // side B never gathers anyone
    expect((await f.store.getCorp(f.corpA))?.influence).toBe(400); // cost still spent
    expect(await f.ava.sweepRosters(1_000_000)).toEqual({ locked: 0, cancelled: 1 });
    expect((await f.store.getCorp(f.corpA))?.influence).toBe(500); // refunded on cancel
    expect((await f.ava.challengesFor(A_HEAD))[0]?.status).toBe('cancelled');
    expect(await f.ava.sweepRosters(1_000_000)).toEqual({ locked: 0, cancelled: 0 }); // no double refund
    expect((await f.store.getCorp(f.corpA))?.influence).toBe(500);
    expect(await f.ava.join(A_MEMBER, id)).toEqual({ ok: false, code: 'E_WINDOW_CLOSED' });
  });

  it('a side one short of the 2-on-2 minimum cancels the battle (CORP-7)', async () => {
    const f = await fixture();
    const id = await matchup(f);
    for (const who of [A_HEAD, A_MEMBER, B_HEAD]) await f.ava.join(who, id);
    expect(await f.ava.sweepRosters(1_000_000)).toEqual({ locked: 0, cancelled: 1 });
    expect((await f.store.getCorp(f.corpA))?.influence).toBe(500); // refunded
  });

  it('a pending (not yet accepted) challenge has no roster window', async () => {
    const f = await fixture();
    await f.ava.setCorpReady(A_HEAD);
    await f.ava.setCorpReady(B_HEAD);
    const ch = await f.ava.challenge(A_HEAD, f.corpB);
    if (!ch.ok) throw new Error('challenge failed');
    expect(await f.ava.join(A_HEAD, ch.id)).toEqual({ ok: false, code: 'E_WINDOW_CLOSED' });
  });
});

describe('AvaService — settlement (AVA-8, S7)', () => {
  it('archives the matchup, records the outcome, awards influence to the winner', async () => {
    const f = await fixture();
    const id = await lockedMatchup(f);
    expect((await f.store.getCorp(f.corpA))?.influence).toBe(400); // cost spent, not refunded
    expect(await f.ava.settleMatch(id, 'challenger')).toEqual({ ok: true, winnerCorp: f.corpA });
    expect((await f.ava.challengesFor(A_HEAD))[0]?.status).toBe('ended'); // S7 archive
    expect((await f.store.getCorp(f.corpA))?.influence).toBe(550); // +150 win reward
    const history = await f.ava.matchHistory();
    expect(history).toHaveLength(1);
    expect(history[0]).toMatchObject({
      matchupId: id,
      challengerCorp: f.corpA,
      targetCorp: f.corpB,
      winnerCorp: f.corpA,
    });
  });

  it('is exactly-once: a replayed settle neither re-archives nor double-awards', async () => {
    const f = await fixture();
    const id = await lockedMatchup(f);
    expect(await f.ava.settleMatch(id, 'target')).toEqual({ ok: true, winnerCorp: f.corpB });
    expect((await f.store.getCorp(f.corpB))?.influence).toBe(650); // 500 + 150
    expect(await f.ava.settleMatch(id, 'target')).toEqual({ ok: false, code: 'E_MATCHUP_CLOSED' });
    expect((await f.store.getCorp(f.corpB))?.influence).toBe(650); // not awarded twice
    expect(await f.ava.matchHistory()).toHaveLength(1);
  });

  it('a draw records the result but awards no influence', async () => {
    const f = await fixture();
    const id = await lockedMatchup(f);
    expect(await f.ava.settleMatch(id, null)).toEqual({ ok: true, winnerCorp: null });
    expect((await f.store.getCorp(f.corpA))?.influence).toBe(400);
    expect((await f.store.getCorp(f.corpB))?.influence).toBe(500);
    expect((await f.ava.matchHistory())[0]).toMatchObject({ matchupId: id, winnerCorp: null });
  });

  it('only a LOCKED matchup settles — an unlocked or missing one is rejected', async () => {
    const f = await fixture();
    await f.ava.setCorpReady(A_HEAD);
    await f.ava.setCorpReady(B_HEAD);
    const ch = await f.ava.challenge(A_HEAD, f.corpB);
    if (!ch.ok) throw new Error('challenge failed');
    await f.ava.accept(B_HEAD, ch.id); // accepted, never locked
    expect(await f.ava.settleMatch(ch.id, 'challenger')).toEqual({
      ok: false,
      code: 'E_MATCHUP_CLOSED',
    });
    expect(await f.ava.settleMatch('nope', 'challenger')).toEqual({
      ok: false,
      code: 'E_NO_CHALLENGE',
    });
    expect(await f.ava.matchHistory()).toHaveLength(0);
  });
});

describe('AvaService — a locked battle no map fits (CORP-4)', () => {
  it('cancels the matchup and refunds the challenge exactly once', async () => {
    const f = await fixture();
    const id = await lockedMatchup(f);
    expect((await f.store.getCorp(f.corpA))?.influence).toBe(400); // cost spent at challenge
    expect(await f.ava.cancelLocked(id)).toBe(true);
    expect((await f.ava.challengesFor(A_HEAD))[0]?.status).toBe('cancelled');
    expect((await f.store.getCorp(f.corpA))?.influence).toBe(500); // refunded
    expect(await f.ava.cancelLocked(id)).toBe(false); // replay: no second refund
    expect((await f.store.getCorp(f.corpA))?.influence).toBe(500);
    // A cancelled battle is never settled, and records no result.
    expect(await f.ava.settleMatch(id, 'challenger')).toEqual({ ok: false, code: 'E_MATCHUP_CLOSED' });
    expect(await f.ava.matchHistory()).toHaveLength(0);
  });

  it('leaves an unlocked or missing matchup alone', async () => {
    const f = await fixture();
    await f.ava.setCorpReady(A_HEAD);
    await f.ava.setCorpReady(B_HEAD);
    const ch = await f.ava.challenge(A_HEAD, f.corpB);
    if (!ch.ok) throw new Error('challenge failed');
    await f.ava.accept(B_HEAD, ch.id); // accepted, roster window still open
    expect(await f.ava.cancelLocked(ch.id)).toBe(false);
    expect(await f.ava.cancelLocked('nope')).toBe(false);
    expect((await f.store.getCorp(f.corpA))?.influence).toBe(400); // nothing refunded
  });
});

describe('AvaService — public feed (AVA-9)', () => {
  it('publishes a matchup on accept and a result on settle; no roster leaks', async () => {
    const f = await fixture();
    await f.ava.setCorpReady(A_HEAD);
    await f.ava.setCorpReady(B_HEAD);
    const ch = await f.ava.challenge(A_HEAD, f.corpB);
    if (!ch.ok) throw new Error('challenge failed');
    expect(await f.ava.accept(B_HEAD, ch.id)).toEqual({ ok: true });
    // S2: the confirmed matchup is public (corp names snapshotted, no winner yet).
    let feed = await f.ava.publicFeed();
    expect(feed).toHaveLength(1);
    expect(feed[0]).toMatchObject({
      kind: 'matchup',
      challengerCorp: f.corpA,
      challengerName: generatedCorpName(0),
      targetCorp: f.corpB,
      targetName: generatedCorpName(1),
    });
    expect(feed[0]?.winnerCorp).toBeUndefined();
    // Drive to a lock, then settle → the S7 result is appended (newest first).
    for (const who of [A_HEAD, A_MEMBER, B_HEAD, B_MEMBER]) await f.ava.join(who, ch.id);
    await f.ava.sweepRosters(1_000_000);
    expect((await f.ava.settleMatch(ch.id, 'challenger')).ok).toBe(true);
    feed = await f.ava.publicFeed();
    expect(feed).toHaveLength(2);
    expect(feed[0]).toMatchObject({ kind: 'result', winnerCorp: f.corpA });
    // The public feed never carries private roster data.
    expect(JSON.stringify(feed)).not.toContain(A_MEMBER.accountId);
    // The same store also holds both corporations' founding (CORP-1); this feed keeps to
    // battles.
    expect((await f.feed.recent(50)).map((e) => e.kind).sort()).toEqual([
      'founded',
      'founded',
      'matchup',
      'result',
    ]);
  });
});

describe('AvaService — medal news (CORP-1)', () => {
  const catalog = parseMedalCatalog({
    medals: {
      first: {
        name: 'n',
        description: 'd',
        scope: 'corp',
        grant: 'manual',
        condition: { type: 'corp_wins', count: 1 },
      },
      two: {
        name: 'n',
        description: 'd',
        scope: 'corp',
        grant: 'manual',
        condition: { type: 'corp_matches', count: 2 },
      },
    },
  });
  const medalNews = async (f: Fixture): Promise<string[]> =>
    (await f.feed.recent(50, undefined, ['medal'])).map((e) => e.id).sort();

  it('a settlement that brings a record to a corp medal condition is news, once', async () => {
    const f = await fixture({ medals: catalog });
    expect((await f.ava.settleMatch(await lockedMatchup(f), 'challenger')).ok).toBe(true);
    expect(await medalNews(f)).toEqual([`medal:${f.corpA}:first`]);
    // The second battle: A wins again (no second «first»), both sides reach two battles.
    expect((await f.ava.settleMatch(await lockedMatchup(f), 'challenger')).ok).toBe(true);
    expect(await medalNews(f)).toEqual(
      [`medal:${f.corpA}:first`, `medal:${f.corpA}:two`, `medal:${f.corpB}:two`].sort(),
    );
    const [entry] = (await f.feed.recent(50, undefined, ['medal'])).filter(
      (e) => e.id === `medal:${f.corpB}:two`,
    );
    expect(entry).toMatchObject({ kind: 'medal', corpId: f.corpB, corpName: generatedCorpName(1), medalId: 'two' });
  });

  it('without the catalog a settlement is no medal news', async () => {
    const f = await fixture();
    expect((await f.ava.settleMatch(await lockedMatchup(f), 'challenger')).ok).toBe(true);
    expect(await medalNews(f)).toEqual([]);
  });
});

describe('AvaService — battle formats (CORP-7)', () => {
  /** Build a corp's operations center (HQ 1 → HQ 2 → operations center 1) on the store and
   *  move the services' clock to the moment each stage finishes: the last one is left for
   *  the service's own read to settle. */
  async function openOperationsCenter(f: Fixture, corpId: string, head: CorpActor): Promise<void> {
    for (const [buildingId, expectedLevel] of [
      ['headquarters', 0],
      ['headquarters', 1],
      ['operations_center', 0],
    ] as const) {
      const at = f.clock();
      const r = await f.store.infrastructure(corpId, head.accountId, at, {
        buildingId,
        expectedLevel,
      });
      if (!r.ok || !r.infrastructure.construction) throw new Error(`build ${buildingId} failed`);
      f.advance(r.infrastructure.construction.completesAt - at);
    }
    // Settle the last construction (and the income it earned) so balances read after this are final.
    await f.store.infrastructure(corpId, head.accountId, f.clock());
  }
  const poolOf = async (f: Fixture, corpId: string) =>
    (await f.ava.pool()).find((c) => c.corpId === corpId);

  it('readiness: no formats means 2 на 2; up to 3 на 3 without buildings', async () => {
    const f = await fixture();
    expect(await f.ava.setCorpReady(A_HEAD)).toEqual({ ok: true });
    const since = (await poolOf(f, f.corpA))?.readySince;
    expect(await poolOf(f, f.corpA)).toMatchObject({ formats: [2] });
    // Repeats and order don't matter; the corp keeps its place in the pool.
    expect(await f.ava.setCorpReady(A_HEAD, [3, 2, 3])).toEqual({ ok: true });
    expect(await poolOf(f, f.corpA)).toMatchObject({ formats: [2, 3], readySince: since });
    expect(await f.ava.setCorpReady(A_HEAD, [4])).toEqual({ ok: false, code: 'E_FORMAT_LOCKED' });
    for (const formats of [[], [1], [11], [2, 12]]) {
      expect(await f.ava.setCorpReady(A_HEAD, formats)).toEqual({ ok: false, code: 'E_FORMAT' });
    }
    expect(await f.ava.setCorpReady(A_MEMBER, [2])).toEqual({ ok: false, code: 'E_FORBIDDEN' });
    expect(await poolOf(f, f.corpA)).toMatchObject({ formats: [2, 3] }); // nothing changed
  });

  it('the operations center opens 4 на 4 and 5 на 5 as soon as it is built', async () => {
    const f = await fixture();
    await openOperationsCenter(f, f.corpA, A_HEAD);
    expect(await f.ava.setCorpReady(A_HEAD, [6])).toEqual({ ok: false, code: 'E_FORMAT_LOCKED' });
    expect(await f.ava.setCorpReady(A_HEAD, [2, 4, 5])).toEqual({ ok: true });
    expect(await poolOf(f, f.corpA)).toMatchObject({ formats: [2, 4, 5] });
  });

  it('a challenge goes in a format the target plays, the smallest by default, at 50 ⟡ a seat', async () => {
    const f = await fixture();
    await f.ava.setCorpReady(A_HEAD);
    await f.ava.setCorpReady(B_HEAD, [3]);
    expect(await f.ava.challenge(A_HEAD, f.corpB, 1)).toEqual({ ok: false, code: 'E_FORMAT' });
    expect(await f.ava.challenge(A_HEAD, f.corpB, 4)).toEqual({
      ok: false,
      code: 'E_FORMAT_LOCKED',
    });
    expect(await f.ava.challenge(A_HEAD, f.corpB, 2)).toEqual({
      ok: false,
      code: 'E_NO_COMMON_FORMAT',
    });
    expect((await f.store.getCorp(f.corpA))?.influence).toBe(500); // nothing spent
    const ch = await f.ava.challenge(A_HEAD, f.corpB);
    if (!ch.ok) throw new Error(ch.code);
    expect((await f.ava.challengesFor(A_HEAD))[0]).toMatchObject({ format: 3, cost: 150 });
    expect((await f.store.getCorp(f.corpA))?.influence).toBe(350);
    expect(await f.ava.decline(B_HEAD, ch.id)).toEqual({ ok: true });
    expect((await f.store.getCorp(f.corpA))?.influence).toBe(500); // the format's price back
    // An explicit format both play.
    await f.ava.setCorpReady(B_HEAD, [2, 3]);
    const two = await f.ava.challenge(A_HEAD, f.corpB, 2);
    if (!two.ok) throw new Error(two.code);
    expect((await f.ava.challengesFor(A_HEAD))[0]).toMatchObject({
      id: two.id,
      format: 2,
      cost: 100,
    });
  });

  it('no common format: the target plays only formats the challenger has not opened', async () => {
    const f = await fixture();
    await openOperationsCenter(f, f.corpB, B_HEAD);
    await f.ava.setCorpReady(A_HEAD);
    expect(await f.ava.setCorpReady(B_HEAD, [4, 5])).toEqual({ ok: true });
    expect(await f.ava.challenge(A_HEAD, f.corpB)).toEqual({
      ok: false,
      code: 'E_NO_COMMON_FORMAT',
    });
    // With its own operations center the challenger plays the target's smallest format.
    await openOperationsCenter(f, f.corpA, A_HEAD);
    const before = (await f.store.getCorp(f.corpA))!.influence;
    const ch = await f.ava.challenge(A_HEAD, f.corpB);
    if (!ch.ok) throw new Error(ch.code);
    expect((await f.ava.challengesFor(A_HEAD))[0]).toMatchObject({ format: 4, cost: 200 });
    expect((await f.store.getCorp(f.corpA))?.influence).toBe(before - 200);
  });

  it('a 3-on-3 needs three a side and pays the winner 75 ⟡ a seat', async () => {
    const f = await fixture();
    await f.ava.setCorpReady(A_HEAD);
    await f.ava.setCorpReady(B_HEAD, [3]);
    const play = async (b: readonly CorpActor[]): Promise<string> => {
      const ch = await f.ava.challenge(A_HEAD, f.corpB);
      if (!ch.ok) throw new Error(ch.code);
      expect(await f.ava.accept(B_HEAD, ch.id)).toEqual({ ok: true });
      for (const who of [A_HEAD, A_MEMBER, A_THIRD, ...b]) {
        expect(await f.ava.join(who, ch.id)).toEqual({ ok: true });
      }
      return ch.id;
    };
    // Two of three on side B: short of the 3-on-3 minimum, the battle is cancelled.
    await play([B_HEAD, B_MEMBER]);
    expect(await f.ava.sweepRosters(f.clock() + 1_000_000)).toEqual({ locked: 0, cancelled: 1 });
    expect((await f.store.getCorp(f.corpA))?.influence).toBe(500);
    // Three a side lock; the winner gets 225.
    const id = await play([B_HEAD, B_MEMBER, B_THIRD]);
    expect(await f.ava.sweepRosters(f.clock() + 1_000_000)).toEqual({ locked: 1, cancelled: 0 });
    expect(await f.ava.settleMatch(id, 'target')).toEqual({ ok: true, winnerCorp: f.corpB });
    expect((await f.store.getCorp(f.corpB))?.influence).toBe(725);
    expect((await f.store.getCorp(f.corpA))?.influence).toBe(350);
  });
});

describe('AvaService — the «Битвы» tab (CORP-9)', () => {
  /** The breakdown the host sends with a settlement: two challengers, the target's head
   *  and a bot. */
  const report = (): AvaBattleReport => ({
    reason: 'score',
    warAt: 5,
    provinces: 9,
    sides: { challenger: { score: 900, provinces: 5 }, target: { score: 300, provinces: 2 } },
    seats: [
      { side: 'challenger', accountId: A_HEAD.accountId, login: 'ahead', score: 600, provinces: 3, out: false },
      { side: 'challenger', accountId: A_MEMBER.accountId, login: 'amember', score: 300, provinces: 2, out: false },
      { side: 'target', accountId: B_HEAD.accountId, login: 'bhead', score: 300, provinces: 2, out: false },
      { side: 'target', accountId: null, login: null, score: 0, provinces: 0, out: true },
    ],
  });

  it('records the battle’s format and breakdown with its result', async () => {
    const f = await fixture();
    const id = await lockedMatchup(f);
    expect(await f.ava.settleMatch(id, 'challenger', report())).toEqual({ ok: true, winnerCorp: f.corpA });
    expect((await f.ava.matchHistory())[0]).toMatchObject({ matchupId: id, format: 2, report: report() });
  });

  it('drops a malformed breakdown and settles all the same', async () => {
    const f = await fixture();
    const id = await lockedMatchup(f);
    const bad = { ...report(), seats: 'everyone' } as unknown as AvaBattleReport;
    expect(await f.ava.settleMatch(id, 'challenger', bad)).toEqual({ ok: true, winnerCorp: f.corpA });
    const [result] = await f.ava.matchHistory();
    expect(result).toMatchObject({ matchupId: id, format: 2 });
    expect(result).not.toHaveProperty('report');
    expect((await f.store.getCorp(f.corpA))?.influence).toBe(550); // the win still paid
  });

  it('shows a member the readiness, every challenge, the battles and the record', async () => {
    const f = await fixture();
    const won = await lockedMatchup(f);
    await f.ava.settleMatch(won, 'challenger', report());
    const again = await f.ava.challenge(A_HEAD, f.corpB);
    if (!again.ok) throw new Error('challenge failed');
    await f.ava.decline(B_HEAD, again.id); // closed, and still listed
    await f.ava.setPlayerReady(A_MEMBER);

    const view = await f.ava.battles(A_MEMBER);
    if ('ok' in view) throw new Error(view.code);
    expect(view.corpId).toBe(f.corpA);
    expect(view.ready).toEqual({ corp: true, formats: [2], player: true, players: [A_MEMBER.accountId] });
    expect(view.challenges.map((c) => [c.id, c.status])).toEqual([
      [again.id, 'declined'],
      [won, 'ended'],
    ]);
    expect(view.tally).toEqual([{ opponent: f.corpB, format: 2, wins: 1, losses: 0, draws: 0 }]);
    expect(view.names).toEqual({ [f.corpB]: generatedCorpName(1) });
    expect(view.results).toHaveLength(1);
    expect(view.results[0]).toMatchObject({ matchupId: won, side: 'challenger', format: 2, winnerCorp: f.corpA });
    // The corp's own seats name their accounts; a rival is known by login, a bot by nothing.
    expect(view.results[0]?.report?.seats).toEqual([
      { side: 'challenger', accountId: A_HEAD.accountId, bot: false, login: 'ahead', score: 600, provinces: 3, out: false },
      { side: 'challenger', accountId: A_MEMBER.accountId, bot: false, login: 'amember', score: 300, provinces: 2, out: false },
      { side: 'target', bot: false, login: 'bhead', score: 300, provinces: 2, out: false },
      { side: 'target', bot: true, login: null, score: 0, provinces: 0, out: true },
    ]);
  });

  it('the rival sees the same battle from its own side', async () => {
    const f = await fixture();
    await f.ava.settleMatch(await lockedMatchup(f), 'challenger', report());
    const view = await f.ava.battles(B_MEMBER);
    if ('ok' in view) throw new Error(view.code);
    expect(view.ready).toMatchObject({ corp: true, player: false, players: [] });
    expect(view.tally).toEqual([{ opponent: f.corpA, format: 2, wins: 0, losses: 1, draws: 0 }]);
    expect(view.names).toEqual({ [f.corpA]: generatedCorpName(0) });
    expect(view.results[0]?.side).toBe('target');
    expect(view.results[0]?.report?.seats.map((seat) => seat.accountId)).toEqual([
      undefined,
      undefined,
      B_HEAD.accountId,
      undefined,
    ]);
  });

  it('is for members: an outsider and a recruit are refused', async () => {
    const f = await fixture();
    expect(await f.ava.battles(OUTSIDER)).toEqual({ ok: false, code: 'E_FORBIDDEN' });
    await f.corp.apply(OUTSIDER, f.corpA); // an application makes a recruit
    expect(await f.ava.battles(OUTSIDER)).toEqual({ ok: false, code: 'E_FORBIDDEN' });
  });
});
