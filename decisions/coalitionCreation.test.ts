import { describe, expect, it } from 'vitest';
import { createInitialState, type GameState } from '../packages/shared-core/src/index';
import { canCreateCoalition, coalitionInviteBlock, canKickCoalitionMember, coalitionTreatyLocked } from './coalitionCreation';

function world(): GameState {
  const state = createInitialState({
    seed: 'coalition-button',
    version: { data: '1', manifest: '1' },
  });
  state.players.p1 = { id: 'p1', name: 'Orion', faction: 'x', status: 'active', resources: {} };
  return state;
}

describe('coalition creation availability', () => {
  it('allows an active human without a coalition in a free session', () => {
    expect(canCreateCoalition(world(), 'p1')).toBe(true);
  });

  it.each(['team_2v2', 'team_3v3'])('excludes fixed-side mode %s', (modeId) => {
    expect(canCreateCoalition({ ...world(), modeId }, 'p1')).toBe(false);
  });

  it.each(['missing', 'defeated', 'bot', 'npc', 'member'] as const)('excludes %s', (reason) => {
    const state = world();
    if (reason === 'missing') delete state.players.p1;
    if (reason === 'defeated') state.players.p1!.status = 'defeated';
    if (reason === 'bot') state.players.p1!.ai = true;
    if (reason === 'npc') state.players.p1!.npc = 'pirate';
    if (reason === 'member')
      state.coalitions = {
        c1: { id: 'c1', founder: 'p1', members: ['p1'], emblem: 'star', description: '' },
      };
    expect(canCreateCoalition(state, 'p1')).toBe(false);
  });
});


describe('coalition invitations and departure controls', () => {
  function pair(): GameState {
    const state = world();
    state.players.p2 = { ...state.players.p1!, id: 'p2' };
    state.coalitions = { c1: { id: 'c1', founder: 'p1', members: ['p1'], emblem: 'star', description: '' } };
    return state;
  }
  it.each(['war', 'peace', 'pact'] as const)('allows an invitation during %s', (stance) => {
    const state = pair();
    state.diplomacy = { 'p1|p2': stance };
    expect(coalitionInviteBlock(state, 'p1', 'p2')).toBeNull();
  });
  it('blocks creation and invitations until the exact cooldown deadline', () => {
    const state = pair();
    state.coalitionJoinAfter = { p2: 200 };
    state.time = 199;
    expect(canCreateCoalition(state, 'p2')).toBe(false);
    expect(coalitionInviteBlock(state, 'p1', 'p2')).toBe('err.coalition-cooldown');
    state.time = 200;
    expect(canCreateCoalition(state, 'p2')).toBe(true);
    expect(coalitionInviteBlock(state, 'p1', 'p2')).toBeNull();
  });
  it('keeps the 48 real-hour joining lock at ×24 and after a ×2 restart', () => {
    const state = pair();
    const hour = 3_600_000;
    const wall = 1_800_000_000_000;
    state.coalitionClock = { wallTime: wall, gameTime: 0, timeScale: 24 };
    state.coalitionJoinAfter = { p2: wall + 48 * hour };
    state.time = 48 * hour; // Only two real hours have elapsed.
    expect(canCreateCoalition(state, 'p2')).toBe(false);
    expect(coalitionInviteBlock(state, 'p1', 'p2')).toBe('err.coalition-cooldown');
    state.coalitionClock = { wallTime: wall + 2 * hour, gameTime: state.time, timeScale: 2 };
    state.time += 46 * hour * 2 - 1;
    expect(canCreateCoalition(state, 'p2')).toBe(false);
    state.time += 1;
    expect(canCreateCoalition(state, 'p2')).toBe(true);
    expect(coalitionInviteBlock(state, 'p1', 'p2')).toBeNull();
  });
  it('cannot invite through a departing member or kick twice', () => {
    const state = pair();
    state.coalitions!.c1!.departures = { p1: { at: 200, by: 'p1', kind: 'leave' } };
    expect(coalitionInviteBlock(state, 'p1', 'p2')).toBe('err.coalition-leaving');
    state.coalitions!.c1!.members.push('p2');
    expect(canKickCoalitionMember(state, 'p1', 'p2')).toBe(false);
    state.coalitions!.c1!.departures = { p2: { at: 200, by: 'p1', kind: 'kick' } };
    expect(canKickCoalitionMember(state, 'p1', 'p2')).toBe(false);
  });
  it('only the founder can kick a different member; treaties stay locked during notice', () => {
    const state = pair();
    state.coalitions!.c1!.members.push('p2');
    expect(canKickCoalitionMember(state, 'p1', 'p2')).toBe(true);
    expect(canKickCoalitionMember(state, 'p2', 'p1')).toBe(false);
    expect(canKickCoalitionMember(state, 'p1', 'p1')).toBe(false);
    expect(coalitionTreatyLocked(state, 'p1', 'p2')).toBe(true);
  });
});
