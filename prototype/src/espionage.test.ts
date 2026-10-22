import { describe, it, expect } from 'vitest';
import { newGame, order, spyOn, advance, botFavour, FAVOUR_SPY_CAUGHT_HIT, HOUR, DAY } from './game';
import type { GameState } from '../../packages/shared-core/src/index';
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

  it('windows expire: time.advanced prunes a stale grant', () => {
    let st = funded();
    const target = worldOf(st, 'p2');
    for (let i = 0; i < 12 && !st.intel?.['p1']?.length; i++)
      st = { ...mission(st, target).state, spyAgents: undefined };
    expect(st.intel?.['p1']?.length).toBeGreaterThan(0);
    // 24h base window (timeScale-compressed) — two full days later it must be gone.
    const later = advance(st, st.time + 2 * DAY + HOUR).state;
    expect(later.intel?.['p1'] ?? []).toHaveLength(0);
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
        // where it started, never more than the hit itself.
        expect(botFavour(st, 'p2', 'p1')).toBeLessThan(before);
        expect(botFavour(st, 'p2', 'p1')).toBeGreaterThanOrEqual(before - FAVOUR_SPY_CAUGHT_HIT);
        return;
      }
    }
    throw new Error('no red-handed detection in 40 seeded missions');
  });

  it('SPY-6: three agents away → the fourth mission is refused with E_NO_AGENT', () => {
    let st = funded();
    const target = worldOf(st, 'p2');
    for (let i = 0; i < 3; i++) {
      const out = order(st, spyOn('p1', target, 'recon'), st.time);
      expect(out.error).toBeUndefined();
      st = out.state;
    }
    expect(st.spyAgents?.['p1']).toHaveLength(3);
    expect(order(st, spyOn('p1', target, 'recon'), st.time).error).toBe('E_NO_AGENT');
  });
});
