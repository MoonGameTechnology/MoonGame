import { describe, it, expect } from 'vitest';
import { newGame, order, spyOn, recallSpy, advance, botFavour, FAVOUR_SPY_CAUGHT_HIT, HOUR } from './game';
import { getStance, type GameState } from '../../packages/shared-core/src/index';
import type { StepOut } from './protoKernel';

// The core espionageModule wired into the prototype kernel: `espionage.spy` sends an
// agent to a WORLD (SPY-8), burns the fee at once and rolls the seeded RNG when the
// 12h mission resolves; a recon success grants a live intel window on that world in
// `state.intel[actor]`. These tests drive it через the prototype's own order() path —
// the same path the UI buttons use.

/** A rich actor so repeated attempts never trip E_INSUFFICIENT. */
function funded(): GameState {
  const s = newGame();
  s.players['p1']!.resources.credits = 100_000;
  return s;
}

/** A world of `owner` in the fresh prototype map. */
function worldOf(s: GameState, owner: string): string {
  return Object.values(s.planets).find((p) => p.owner === owner)!.id;
}

/** Send one recon mission and let it resolve (12h + slack). */
function mission(s: GameState, planetId: string): StepOut {
  const sent = order(s, spyOn('p1', planetId, 'recon'), s.time);
  expect(sent.error).toBeUndefined();
  const done = advance(sent.state, sent.state.time + 13 * HOUR);
  return { state: done.state, events: [...sent.events, ...done.events] };
}

describe('espionage in the prototype kernel (SPY-8 playable)', () => {
  it('a recon mission on an enemy world grants a live window on it and burns the fee', () => {
    const before = funded();
    const target = worldOf(before, 'p2');
    let st = before;
    for (let i = 0; i < 12; i++) {
      // SPY-6: retries need a free agent each
      const out = mission(st, target);
      st = { ...out.state, spyAgents: undefined };
      // Every attempt is a real dispatch (fee burned, agent away), not a refusal.
      expect(out.events.some((e) => e.type === 'espionage.sent')).toBe(true);
      if (st.intel?.['p1']?.some((g) => g.target === target)) return;
    }
    throw new Error('no success in 12 seeded missions — chance pipeline broken?');
  });

  it('spying on your own world is rejected', () => {
    const st = funded();
    expect(order(st, spyOn('p1', worldOf(st, 'p1'), 'recon'), st.time).error).toBe('E_BAD_TARGET');
  });

  it('SPY-13: the recon agent stays on post, and its recall closes the intel', () => {
    let st = funded();
    const target = worldOf(st, 'p2');
    for (let i = 0; i < 12; i++) {
      const out = mission(st, target).state;
      if (out.intel?.['p1']?.length) {
        st = out;
        break;
      }
      st = { ...out, spyAgents: undefined };
    }
    expect(st.intel?.['p1']?.[0]).toMatchObject({ target, layer: 1 });
    const recalled = order(st, recallSpy('p1', target, 'recon'), st.time);
    expect(recalled.error).toBeUndefined();
    expect(recalled.state.intel?.['p1'] ?? []).toHaveLength(0);
  });

  it('SPY-2: a bot that catches your spy red-handed sours its favour toward you', () => {
    // Keep spying until a mission is DETECTED with the spy identified (failed
    // attempt, base 0.4 × detect 0.5 → a couple dozen seeded tries always land one).
    let st = funded();
    const target = worldOf(st, 'p2');
    for (let i = 0; i < 40; i++) {
      const before = botFavour(st, 'p2', 'p1');
      const out = mission(st, target);
      // SPY-6: the network holds 3 agents — send them home so the retries never trip
      // E_NO_AGENT (this test is about favour, not about the network).
      st = { ...out.state, spyAgents: undefined };
      const caught = out.events.find(
        (e) => e.type === 'espionage.detected' && (e.payload as { spy?: string }).spy === 'p1',
      );
      if (caught) {
        expect((caught.payload as { owner: string }).owner).toBe('p2'); // addressed to the victim
        // Favour heals a little over the 12h mission, so the hit shows as a drop below
        // where it started. SPY-11: the exposure also declares war, so the war hit may
        // stack on top — the drop is at least most of the spy hit.
        expect(botFavour(st, 'p2', 'p1')).toBeLessThan(before - FAVOUR_SPY_CAUGHT_HIT / 2);
        expect(getStance(st, 'p1', 'p2')).toBe('war');
        return;
      }
    }
    throw new Error('no red-handed detection in 40 seeded missions');
  });

  it('SPY-6: three agents away → the fourth mission is refused with E_NO_AGENT', () => {
    let st = funded();
    const target = worldOf(st, 'p2');
    // SPY-13: one recon agent per world — the network goes on three different operations.
    for (const op of ['recon', 'sabotage', 'theft'] as const) {
      const out = order(st, spyOn('p1', target, op), st.time);
      expect(out.error).toBeUndefined();
      st = out.state;
    }
    expect(st.spyAgents?.['p1']).toHaveLength(3);
    // SPY-17: a fourth agent on the SAME world is refused by the per-world cap first, so
    // the network check is read with a guard for our own world.
    expect(order(st, spyOn('p1', target, 'research'), st.time).error).toBe('E_BAD_TARGET');
    expect(order(st, spyOn('p1', worldOf(st, 'p1'), 'counter'), st.time).error).toBe('E_NO_AGENT');
  });
});
