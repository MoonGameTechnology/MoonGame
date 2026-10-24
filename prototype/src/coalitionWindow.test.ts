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
  const panel = {
    innerHTML: '',
    querySelectorAll: (): Array<{ dataset: Record<string, string | undefined>; textContent: string }> => [...panel.innerHTML.matchAll(/<[^>]*data-coal-timer="([^"]+)" data-coal-deadline="([^"]+)"[^>]*>([^<]*)</g)].map((match) => ({
      dataset: { coalTimer: match[1], coalDeadline: match[2] },
      set textContent(value: string) { panel.innerHTML = panel.innerHTML.replace(match[0], match[0].replace(match[3]!, value)); },
    })),
    classList: { add: (c: string) => classes.add(c), remove: (c: string) => classes.delete(c) },
    addEventListener: (_type: string, listener: (event: { target: unknown }) => void) =>
      listeners.push(listener),
    click: (selector: string, dataset: Record<string, string> = {}) => {
      const target = { closest: (s: string) => (s === selector ? { dataset } : null) };
      listeners.forEach((listener) => listener({ target }));
    },
  };
  return panel;
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


describe('coalition invitation, kick and exit UI', () => {
  function openOwnCard(member = false): void {
    env.state = ownCoalition(env.state);
    env.state.players.p2 = { ...env.state.players.p1!, id: 'p2', name: 'Vega' };
    if (member) env.state.coalitions!.c1!.members.push('p2');
    openCoalitions();
    panel.click('[data-coal]', { coal: 'c1' });
  }
  it.each(['war', 'peace', 'pact'] as const)('offers an explicit invite during %s', (stance) => {
    env.state.diplomacy = { 'p1|p2': stance };
    openOwnCard();
    expect(panel.innerHTML).toContain('data-invite="p2"');
    panel.click('[data-invite]', { invite: 'p2' });
    expect(env.orders).toEqual([expect.objectContaining({ type: 'diplomacy.declare', payload: { target: 'p2', stance: 'alliance' } })]);
  });
  it('updates the invitation after the server records it and suppresses another send', () => {
    openOwnCard();
    env.state.diplomacyOffers = { 'p1>p2': 'alliance' };
    syncCoalitions();
    expect(panel.innerHTML).toContain(t('coal.invite.waiting'));
    panel.click('[data-invite]', { invite: 'p2' });
    expect(env.orders).toEqual([]);
  });
  it('asks before kicking and shows the server countdown without another kick button', () => {
    openOwnCard(true);
    panel.click('[data-kick]', { kick: 'p2' });
    expect(env.orders).toEqual([]);
    expect(panel.innerHTML).toContain(t('coal.kick.confirm'));
    panel.click('[data-kick]', { kick: 'p2' });
    expect(env.orders).toEqual([expect.objectContaining({ type: 'coalition.kick', payload: { target: 'p2' } })]);
    env.state.coalitions!.c1!.departures = { p2: { at: env.state.time + 86_400_000, kind: 'kick', by: 'p1' } };
    syncCoalitions();
    expect(panel.innerHTML).toContain(t('coal.departure.kick', { time: t('fmt.hours', { n: '24.0' }) }));
    expect(panel.innerHTML).not.toContain('data-kick="p2"');
    panel.click('[data-kick]', { kick: 'p2' });
    expect(env.orders).toHaveLength(1);
    env.state.time += 3_600_000;
    syncCoalitions();
    expect(panel.innerHTML).toContain(t('coal.departure.kick', { time: t('fmt.hours', { n: '23.0' }) }));
  });
  it('keeps the member card while leaving and then shows the remaining cooldown', () => {
    openOwnCard();
    panel.click('.cw-leave');
    expect(env.orders).toHaveLength(0);
    panel.click('.cw-leave');
    expect(env.orders[0]).toMatchObject({ type: 'coalition.leave', payload: {} });
    env.state.coalitions!.c1!.departures = { p1: { at: env.state.time + 86_400_000, kind: 'leave', by: 'p1' } };
    syncCoalitions();
    expect(panel.innerHTML).not.toContain('class="cw-leave');
    expect(panel.innerHTML).toContain(t('coal.departure.leave', { time: t('fmt.hours', { n: '24.0' }) }));
    env.state.coalitions = {};
    env.state.coalitionJoinAfter = { p1: env.state.time + 172_800_000 };
    syncCoalitions();
    expect(panel.innerHTML).not.toContain('class="cw-create"');
    expect(panel.innerHTML).toContain(t('coal.cooldown', { time: t('fmt.hours', { n: '48.0' }) }));
  });
  it('hides kick controls from ordinary members and guards synthetic clicks', () => {
    openOwnCard(true);
    env.state.coalitions!.c1!.founder = 'p2';
    syncCoalitions();
    expect(panel.innerHTML).not.toContain('data-kick=');
    panel.click('[data-kick]', { kick: 'p2' });
    panel.click('[data-kick]', { kick: 'p2' });
    expect(env.orders).toHaveLength(0);
  });
});
