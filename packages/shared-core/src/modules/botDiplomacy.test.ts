import { describe, expect, it } from 'vitest';
import { createKernel } from '../kernel/kernel';
import type { GameModule } from '../kernel/module';
import { botDiplomacyModule } from './botDiplomacy';
import { createInitialState, type GameState, type Player } from '../state/gameState';
import { getStance, setStance } from '../state/diplomacy';
import { botEmbargoes, botFavour, FAVOUR_EMBARGO } from '../state/botFavour';
import { parseGameData, type GameData } from '../data/schemas';
import type { Action, Context } from '../action/types';

const data: GameData = parseGameData({
  version: '0.1.0',
  resources: ['credits'],
  units: {},
  factions: {},
  buildings: {},
  events: {},
});
const HOUR = 3_600_000;
const DAY = 24 * HOUR;
const ctx = (now: number): Context => ({ now, data });

/** The bot `b` catches `p1`'s spy red-handed when `p1` orders `test.caught`. */
const counterIntel: GameModule = {
  id: 'test-counter-intel',
  version: '1.0.0',
  setup(api) {
    api.onAction('test.caught', (_action, h) => h.emit('espionage.detected', { owner: 'b', spy: 'p1' }));
  },
};
const caught: Action = { id: 't:p1:1', type: 'test.caught', playerId: 'p1', payload: {}, issuedAt: 0 };

function player(id: string): Player {
  return { id, name: id, faction: 'x', status: 'active', resources: {} };
}
/** A bot `b` at peace with `p1`, holding `favour` toward it. */
function world(favour: number): GameState {
  const s = createInitialState({ seed: 'bot', version: { data: '0.1.0', manifest: '1' } });
  const state = { ...s, players: { b: player('b'), p1: player('p1') } } as unknown as GameState & {
    approval: Record<string, Record<string, number>>;
  };
  state.approval = { b: { p1: favour } };
  setStance(state, 'b', 'p1', 'peace');
  return state;
}
const kernel = createKernel([botDiplomacyModule, counterIntel]);
function advanceIn(state: GameState, to: number, step: number): GameState {
  let s = state;
  for (let t = Math.min(to, s.time + step); ; t = Math.min(to, t + step)) {
    const r = kernel.advanceTo(s, ctx(t));
    if (!r.ok) throw new Error(r.code);
    s = r.state;
    if (t >= to) return s;
  }
}

// PE-2.2: a bot's favour moves by formula inside a span, and the span's length is not
// ours — an unwatched match catches days up in one, a watched one ticks every second.
describe('bot favour does not depend on how time is cut', () => {
  it('a caught spy that drops favour under the war line makes the bot declare war at once', () => {
    // 16 − 20 → 0, far under the line: the bot commits to war on the spot and vents to 35.
    const r = kernel.applyAction(world(16), caught, ctx(0));
    if (!r.ok) throw new Error(r.code);
    expect(getStance(r.state, 'b', 'p1')).toBe('war');
    expect(r.events).toContainEqual({ type: 'diplomacy.changed', payload: { a: 'b', b: 'p1', stance: 'war' } });
    // Three days of healing would lift the meter back over the line in one long span —
    // but the bot is already at war, and both cuts erode the same vented meter.
    const once = advanceIn(r.state, 3 * DAY, 3 * DAY);
    const hourly = advanceIn(r.state, 3 * DAY, HOUR);
    expect(getStance(once, 'b', 'p1')).toBe('war');
    expect(getStance(hourly, 'b', 'p1')).toBe('war');
    expect(botFavour(once, 'b', 'p1')).toBeCloseTo(botFavour(hourly, 'b', 'p1'), 9);
  });

  it('favour healing exactly onto the embargo line is read the same however time is cut', () => {
    // 20 + 6/day × 60 h = 35: on the line, which is not under it. One span lands on it
    // exactly; 720 five-minute spans sum to 34.99999999999966 — a float's dust, not a grudge.
    const once = advanceIn(world(FAVOUR_EMBARGO - 15), 60 * HOUR, 60 * HOUR);
    const fine = advanceIn(world(FAVOUR_EMBARGO - 15), 60 * HOUR, 5 * 60_000);
    expect(botEmbargoes(once, 'b', 'p1')).toBe(false);
    expect(botEmbargoes(fine, 'b', 'p1')).toBe(false);
  });
});

describe('a caught spy never starts a war the core would forbid', () => {
  it('a fixed teammate keeps the alliance however low the favour falls', () => {
    const s = world(16);
    s.players.b!.team = 'red';
    s.players.p1!.team = 'red';
    const r = kernel.applyAction(s, caught, { ...ctx(0), config: { modeId: 'team_2v2' } } as Context);
    if (!r.ok) throw new Error(r.code);
    expect(getStance(r.state, 'b', 'p1')).toBe('peace');
  });
});
