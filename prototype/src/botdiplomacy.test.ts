import { describe, it, expect } from 'vitest';
import {
  newGame,
  order,
  advance,
  declareWar,
  botFavour,
  botEmbargoes,
  approvalView,
  networkSeats,
  DEFAULT_SETUP,
  FAVOUR_BASE,
  FAVOUR_WAR,
  FAVOUR_WAR_DECLARED_HIT,
  DAY,
  HOUR,
} from './game';
import {
  diffState,
  getStance,
  getOffer,
  type GameState,
} from '../../packages/shared-core/src/index';

// In the default setup p1 is the human, p2 the AI (a tracked bot).
describe('bot diplomacy — favour meter', () => {
  it('starts friendly toward the player and stays passive — never wars unprovoked', () => {
    const s = newGame();
    expect(botFavour(s, 'p2', 'p1')).toBe(FAVOUR_BASE);
    // A month with no aggression: the bot never declares war; favour stays capped.
    const st = advance(s, 30 * DAY).state;
    expect(getStance(st, 'p1', 'p2')).toBe('peace');
    expect(botFavour(st, 'p2', 'p1')).toBe(FAVOUR_BASE);
  });

  it('declaring war on a bot sours its favour toward the declarer', () => {
    const st = order(newGame(), declareWar('p1', 'p2'), 0).state;
    expect(botFavour(st, 'p2', 'p1')).toBe(FAVOUR_BASE - FAVOUR_WAR_DECLARED_HIT);
  });

  it('sustained aggression bottoms the meter out and the bot commits to war', () => {
    let st = order(newGame(), declareWar('p1', 'p2'), 0).state; // 60 → 30
    st = advance(st, 20 * DAY).state; // 20 days at war erode favour under the war line
    expect(botFavour(st, 'p2', 'p1')).toBeLessThan(FAVOUR_WAR);
    // The player sues for peace, but the furious bot declines the offer — war holds.
    st = order(st, declareWar('p1', 'p2', 'peace'), st.time).state;
    st = advance(st, st.time + HOUR).state;
    expect(getStance(st, 'p1', 'p2')).toBe('war');
  });

  it('a bot that is left alone accepts peace and mends its favour', () => {
    // Declare war then immediately make peace: favour dropped once, then heals over time.
    let st = order(newGame(), declareWar('p1', 'p2'), 0).state;
    st = order(st, declareWar('p1', 'p2', 'peace'), 0).state; // back to peace right away
    const dropped = botFavour(st, 'p2', 'p1');
    st = advance(st, 20 * DAY).state; // long stretch of peace mends it
    expect(getStance(st, 'p1', 'p2')).toBe('peace'); // never re-warred
    expect(botFavour(st, 'p2', 'p1')).toBeGreaterThan(dropped);
  });

  it('botEmbargoes reports the embargo tier; a non-bot never embargoes', () => {
    const st = order(newGame(), declareWar('p1', 'p2'), 0).state; // 60 → 30, below the embargo line
    expect(botEmbargoes(st, 'p2', 'p1')).toBe(true);
    expect(botEmbargoes(st, 'p1', 'p2')).toBe(false); // p1 is human, tracks no favour
  });
});

// Softening a stance needs the other side's consent (game.ts diplomacyModule): the
// declaration files an OFFER; the matching counter-declaration commits the pair. A
// bot answers inside the same order (by favour); a human's offer waits for a reply.
describe('diplomacy consent — offers, counters, bot answers', () => {
  // The two-humans board the netserver seeds: same seats, nobody tracked as a bot.
  const HUMANS = { seats: DEFAULT_SETUP.seats.map((seat) => ({ ...seat, ai: false })) };

  it('softening files an offer that hangs until the human answers in kind', () => {
    let st = order(newGame(HUMANS), declareWar('p1', 'p2'), 0).state; // escalation: instant
    expect(getStance(st, 'p1', 'p2')).toBe('war');
    st = order(st, declareWar('p2', 'p1', 'peace'), 0).state; // p2 sues for peace
    expect(getStance(st, 'p1', 'p2')).toBe('war'); // …still at war
    expect(getOffer(st, 'p2', 'p1')).toBe('peace'); // …offer on the table
    st = order(st, declareWar('p1', 'p2', 'peace'), 0).state; // p1 answers in kind
    expect(getStance(st, 'p1', 'p2')).toBe('peace'); // pair committed
    expect(getOffer(st, 'p2', 'p1')).toBeNull(); // table wiped both ways
    expect(getOffer(st, 'p1', 'p2')).toBeNull();
  });

  it('duplicate offer → E_ALREADY_OFFERED, same-stance declaration → E_SAME_STANCE', () => {
    let st = order(newGame(HUMANS), declareWar('p1', 'p2'), 0).state;
    st = order(st, declareWar('p1', 'p2', 'peace'), 0).state;
    expect(order(st, declareWar('p1', 'p2', 'peace'), 0).error).toBe('E_ALREADY_OFFERED');
    expect(order(st, declareWar('p1', 'p2', 'war'), 0).error).toBe('E_SAME_STANCE');
    // a DIFFERENT softening replaces the offer instead of stacking
    st = order(st, declareWar('p1', 'p2', 'pact'), 0).state;
    expect(getOffer(st, 'p1', 'p2')).toBe('pact');
  });

  it('escalation voids offers in flight — no stale auto-accept after a war', () => {
    let st = order(newGame(HUMANS), declareWar('p2', 'p1', 'pact'), 0).state; // peace→pact offer
    expect(getOffer(st, 'p2', 'p1')).toBe('pact');
    st = order(st, declareWar('p1', 'p2'), 0).state; // p1 escalates — table wiped
    expect(getOffer(st, 'p2', 'p1')).toBeNull();
    st = order(st, declareWar('p1', 'p2', 'pact'), 0).state; // p1 proposes the same later
    expect(getStance(st, 'p1', 'p2')).toBe('war'); // p2's stale offer must NOT commit it
    expect(getOffer(st, 'p1', 'p2')).toBe('pact');
  });

  it('a bot accepts peace on the spot while favour holds the line', () => {
    const st = order(newGame(), declareWar('p1', 'p2'), 0).state; // favour 60 → 30 ≥ 15
    const r = order(st, declareWar('p1', 'p2', 'peace'), 0).state;
    expect(getStance(r, 'p1', 'p2')).toBe('peace');
    expect(getOffer(r, 'p1', 'p2')).toBeNull();
  });

  it('a furious bot declines and wipes the offer, so the seat can retry', () => {
    let st = order(newGame(), declareWar('p1', 'p2'), 0).state;
    st = advance(st, 20 * DAY).state; // favour bottoms out under FAVOUR_WAR
    st = order(st, declareWar('p1', 'p2', 'peace'), st.time).state;
    expect(getStance(st, 'p1', 'p2')).toBe('war'); // refused
    expect(getOffer(st, 'p1', 'p2')).toBeNull(); // wiped — not stuck as "already offered"
    expect(order(st, declareWar('p1', 'p2', 'peace'), st.time).error).toBeUndefined();
  });

  it('a fresh bot accepts a pact; an alliance with a bot stays barred', () => {
    const st0 = newGame(); // favour 60 ≥ FAVOUR_PACT_ACCEPT
    expect(getStance(order(st0, declareWar('p1', 'p2', 'pact'), 0).state, 'p1', 'p2')).toBe('pact');
    expect(order(st0, declareWar('p1', 'p2', 'alliance'), 0).error).toBe('E_BOT_ALLIANCE');
  });
});

// BF-33: elimination marks a seat 'defeated' but keeps the record — the old
// `if (!players[bot])` guard never fired, so a dead bot kept venting favour and
// declared war from the grave. The fix gates on status AND sweeps the ledger.
describe('bot diplomacy — the dead leave the table (BF-33)', () => {
  it('a defeated bot never declares war from the grave', () => {
    let st = order(newGame(), declareWar('p1', 'p2'), 0).state; // sour the bot: 60 → 30
    st = structuredClone(st);
    st.players.p2!.status = 'defeated'; // eliminated, record stays
    st = advance(st, st.time + 20 * DAY).state; // would bottom out and war-back if alive
    expect(botFavour(st, 'p2', 'p1')).toBe(FAVOUR_BASE - FAVOUR_WAR_DECLARED_HIT); // meter frozen
  });

  it('losing the last world sweeps the favour ledger both ways (player.eliminated)', () => {
    let st = order(newGame(), declareWar('p1', 'p2'), 0).state; // p2 tracks p1 at 60 → 30
    st = structuredClone(st);
    // Strip the bot's territory; the victory sweep on the next span eliminates it.
    for (const planet of Object.values(st.planets)) {
      if (planet.owner === 'p2') planet.owner = 'p1';
    }
    st = advance(st, st.time + HOUR).state;
    expect(st.players.p2!.status).toBe('defeated');
    // The ledger entry is GONE (not merely frozen): favour reads the untracked default.
    expect(botFavour(st, 'p2', 'p1')).toBe(FAVOUR_BASE);
  });
});

describe('approvalView — the favour a viewer is sent', () => {
  type Ledger = GameState & { approval?: Record<string, Record<string, number>> };
  /** The human plus TWO bots, so the ledger can hold a grudge that is not about the viewer. */
  const threeSeats = (): GameState =>
    newGame({
      seats: [...DEFAULT_SETUP.seats, { ...networkSeats('ffa')[2]!, id: 'p3', ai: true }],
    });

  it("keeps each bot's opinion of the viewer and nothing else", () => {
    let st = order(threeSeats(), declareWar('p2', 'p3'), 0).state; // a grudge between two bots
    st = order(st, declareWar('p1', 'p2'), 0).state; // and one about the viewer: 60 → 30
    const view = approvalView(st, 'p1') as Ledger;
    expect(view.approval).toEqual({
      p2: { p1: FAVOUR_BASE - FAVOUR_WAR_DECLARED_HIT },
      p3: { p1: FAVOUR_BASE },
    });
    // What the client reads off it answers exactly as the full ledger does.
    for (const bot of ['p2', 'p3']) {
      expect(botFavour(view, bot, 'p1')).toBe(botFavour(st, bot, 'p1'));
      expect(botEmbargoes(view, bot, 'p1')).toBe(botEmbargoes(st, bot, 'p1'));
    }
  });

  it('leaves its input alone and drops a ledger with nothing about the viewer', () => {
    const st = threeSeats();
    const before = JSON.stringify(st);
    approvalView(st, 'p1');
    expect(JSON.stringify(st)).toBe(before);
    expect('approval' in approvalView(st, 'someone-untracked')).toBe(false);
    const { approval: _ledger, ...bare } = st as Ledger;
    expect(approvalView(bare as GameState, 'p1')).toBe(bare); // no ledger: nothing to narrow
  });

  it('a second of war between two bots moves the ledger, not what the viewer is sent', () => {
    const st = order(threeSeats(), declareWar('p2', 'p3'), 0).state;
    const next = advance(st, st.time + 1000).state;
    // War decay runs every span, so the full table changes each second…
    expect((next as Ledger).approval).not.toEqual((st as Ledger).approval);
    // …and none of that rides the viewer's delta: their slice did not move.
    expect(
      diffState(approvalView(st, 'p1'), approvalView(next, 'p1')).meta?.approval,
    ).toBeUndefined();
  });
});
