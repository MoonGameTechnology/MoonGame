import { describe, expect, it } from 'vitest';
import { createInitialState, type GameState } from '../packages/shared-core/src/index';
import { canCreateCoalition } from './coalitionCreation';

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
