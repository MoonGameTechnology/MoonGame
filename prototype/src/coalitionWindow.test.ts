import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { t } from '../../localization/runtime';
import {
  createInitialState,
  type Action,
  type GameState,
} from '../../packages/shared-core/src/index';
import { initCoalitionWindow, openCoalitions, syncCoalitions } from './coalitionWindow';

function element() {
  const listeners: Array<(event: { target: unknown }) => void> = [];
  const classes = new Set<string>();
  return {
    innerHTML: '',
    classList: { add: (c: string) => classes.add(c), remove: (c: string) => classes.delete(c) },
    addEventListener: (_type: string, listener: (event: { target: unknown }) => void) =>
      listeners.push(listener),
    click: (selector: string) => {
      const target = { closest: (s: string) => (s === selector ? { dataset: {} } : null) };
      listeners.forEach((listener) => listener({ target }));
    },
  };
}

function world(): GameState {
  const state = createInitialState({ seed: 'coalition-ui', version: { data: '1', manifest: '1' } });
  state.players.p1 = { id: 'p1', name: 'Orion', faction: 'x', status: 'active', resources: {} };
  return state;
}

function ownCoalition(state: GameState): GameState {
  return {
    ...state,
    coalitions: {
      c1: { id: 'c1', founder: 'p1', members: ['p1'], emblem: 'star', description: '' },
    },
  };
}

let panel: ReturnType<typeof element>;
let env: { state: GameState; orders: Action[]; accepted: boolean; local: boolean };
beforeEach(() => {
  panel = element();
  const rail = element();
  const elements = new Map([['coalwin', panel], ['rail-coal', rail]]);
  vi.stubGlobal('document', {
    getElementById: (id: string) => elements.get(id) ?? null,
  });
  env = { state: world(), orders: [], accepted: true, local: false };
  initCoalitionWindow({
    state: () => env.state,
    me: () => 'p1',
    names: () => ({ p1: 'Orion' }),
    ownerColor: () => '#fff',
    playerOrder: (action) => {
      env.orders.push(action);
      if (env.accepted && env.local) env.state = ownCoalition(env.state);
      return env.accepted;
    },
  });
});
afterEach(() => vi.unstubAllGlobals());

describe('session coalition creation', () => {
  it('shows an explicit create button before any alliance exists', () => {
    openCoalitions();
    expect(panel.innerHTML).toContain('class="cw-create"');
    expect(panel.innerHTML).toContain(t('coal.create'));
  });

  it('sends intent, waits for the server snapshot, then opens the new card', () => {
    openCoalitions();
    panel.click('.cw-create');
    expect(env.orders).toEqual([
      expect.objectContaining({ type: 'coalition.create', playerId: 'p1', payload: {} }),
    ]);
    expect(env.state.coalitions).toBeUndefined();
    expect(panel.innerHTML).not.toContain('id="cw-text"');
    env.state = ownCoalition(env.state);
    syncCoalitions();
    expect(panel.innerHTML).toContain('id="cw-text"');
    expect(panel.innerHTML).toContain('data-emblem="star"');
    expect(panel.innerHTML).not.toContain('class="cw-create"');
  });

  it('opens the card immediately when a local order has already applied', () => {
    env.local = true;
    openCoalitions();
    panel.click('.cw-create');
    expect(panel.innerHTML).toContain('id="cw-text"');
  });

  it('keeps the list after a refused order', () => {
    env.accepted = false;
    openCoalitions();
    panel.click('.cw-create');
    expect(panel.innerHTML).toContain('class="cw-create"');
    env.state = ownCoalition(env.state);
    syncCoalitions();
    expect(panel.innerHTML).not.toContain('id="cw-text"');
  });

  it.each(['team', 'member'] as const)(
    'does not offer or dispatch creation for %s',
    (reason) => {
      if (reason === 'team') env.state.modeId = 'team_2v2';
      if (reason === 'member') env.state = ownCoalition(env.state);
      openCoalitions();
      expect(panel.innerHTML).not.toContain('class="cw-create"');
      panel.click('.cw-create');
      expect(env.orders).toHaveLength(0);
    },
  );

  it('updates availability when a new snapshot changes the actor status', () => {
    openCoalitions();
    env.state.players.p1!.status = 'defeated';
    syncCoalitions();
    expect(panel.innerHTML).not.toContain('class="cw-create"');
  });
});
