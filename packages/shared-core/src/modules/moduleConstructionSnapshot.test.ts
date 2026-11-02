import { describe, expect, it } from 'vitest';
import { createKernel } from '../kernel/kernel';
import { constructionModule } from './construction';
import { arsenalSyncModule } from './arsenalSync';
import { createInitialState, type GameState } from '../state/gameState';
import { parseGameData } from '../data/schemas';
import type { ApplyResult } from '../action/types';
import type { CompletePayload } from '../state/construction';
import { effectiveStats } from '../util/loadout';
const data = parseGameData({
  version: 'test',
  factions: {},
  events: {},
  resources: ['metal'],
  units: {
    ship: {
      faction: 'x',
      slots: { utility: 1 },
      stats: { attack: 1, defense: 1, speed: 1, hp: 10 },
      cost: { metal: 1 },
      buildTimeHours: 1,
    },
  },
  modules: {
    gun: {
      name: 'Gun',
      slot: 'utility',
      tag: 'horizontal',
      rarity: 'simple',
      effects: { stats: { attack: 10 } },
      cost: {},
      allow: {},
    },
  },
  buildings: {
    yard: { name: 'Yard', cost: {}, stats: {}, buildTimeHours: 0, enablesShipConstruction: true },
  },
  sectorZeroStars: {
    cap: 6,
    guaranteed: 3,
    steps: [{ chance: 1, warrants: 1, bonus: 0.1, pity: 0 }],
  },
});
const kernel = createKernel([constructionModule, arsenalSyncModule]);
function initial(): GameState {
  const state = createInitialState({ seed: 'pin', version: { data: 'test', manifest: '1' } });
  state.players.p = {
    id: 'p',
    name: 'P',
    faction: 'x',
    status: 'active',
    resources: { metal: 100 },
    arsenal: { hulls: ['ship'], modules: ['gun'] },
  };
  state.planets.a = {
    id: 'a',
    owner: 'p',
    position: { x: 0, y: 0 },
    resources: {},
    buildings: [{ type: 'yard', level: 1, hp: 100 }],
    garrison: [],
    traits: [],
  };
  return state;
}
const ok = (r: ApplyResult): GameState => {
  if (!r.ok) throw Error(r.code);
  return r.state;
};
const act = (s: GameState, type: string, payload: unknown, now = s.time) =>
  ok(
    kernel.applyAction(
      s,
      { id: `${type}:${now}`, playerId: 'p', type, payload, issuedAt: now },
      { now, data },
    ),
  );
const build = (s: GameState) =>
  act(s, 'unit.build', { planetId: 'a', unit: 'ship', modules: ['gun'] });
const upgrade = (s: GameState) =>
  act(s, 'arsenal.sync', { hulls: ['ship'], modules: ['gun'], stars: { gun: 1 } });
describe('module values are pinned when an order is accepted', () => {
  it.each(['active', 'queued', 'paused'])(
    'keeps pre-migration %s orders at their old module values',
    (kind) => {
      let s = build(initial());
      const seq = s.scheduled.find((e) => e.type === 'construction.complete')!.seq;
      if (kind === 'queued') s = build(s);
      if (kind === 'paused') s = act(s, 'construction.cancel', { planetId: 'a', seq }, 100);
      for (const e of s.scheduled)
        if (e.type === 'construction.complete')
          delete (e.payload as CompletePayload).moduleSnapshot;
      for (const order of [
        ...(s.planets.a!.buildQueue ?? []),
        ...(s.planets.a!.pausedConstruction ?? []),
      ])
        delete order.moduleSnapshot;
      const old = structuredClone(s);
      let refreshed = upgrade(s);
      expect(s).toEqual(old);
      if (kind === 'paused')
        refreshed = act(refreshed, 'construction.resume', { planetId: 'a', id: seq }, 200);
      const completed = kernel.advanceTo(refreshed, { now: 8 * 3600_000, data });
      expect(completed.ok).toBe(true);
      if (!completed.ok) return;
      expect(completed.state.planets.a!.garrison.reduce((n, stack) => n + stack.count, 0)).toBe(
        kind === 'queued' ? 2 : 1,
      );
      for (const stack of completed.state.planets.a!.garrison)
        expect(effectiveStats(data.units.ship!, stack, data).attack).toBe(11);
    },
  );
  it('pins ★0 as well as ★1 and preserves both orders in the shipyard queue', () => {
    let s = build(initial());
    s = build(s); // queued while the first hull is in progress
    s = upgrade(s);
    const complete = kernel.advanceTo(s, { now: 8 * 3600_000, data });
    expect(complete.ok).toBe(true);
    if (!complete.ok) return;
    expect(complete.state.planets.a!.garrison.reduce((n, stack) => n + stack.count, 0)).toBe(2);
    for (const stack of complete.state.planets.a!.garrison)
      expect(effectiveStats(data.units.ship!, stack, data).attack).toBe(11);
    const newer = build(complete.state);
    const finished = kernel.advanceTo(newer, { now: 16 * 3600_000, data });
    expect(finished.ok).toBe(true);
    if (!finished.ok) return;
    expect(
      finished.state.planets.a!.garrison.some(
        (stack) => effectiveStats(data.units.ship!, stack, data).attack === 12,
      ),
    ).toBe(true);
  });
  it('keeps the original snapshot through cancellation, a sale and resume', () => {
    let s = build(upgrade(initial()));
    const seq = s.scheduled.find((e) => e.type === 'construction.complete')!.seq;
    s = act(s, 'construction.cancel', { planetId: 'a', seq }, 100);
    s = act(s, 'arsenal.sync', { hulls: ['ship'], modules: [] }, 100);
    s = act(s, 'construction.resume', { planetId: 'a', id: seq }, 200);
    const completed = kernel.advanceTo(s, { now: 8 * 3600_000, data });
    expect(completed.ok).toBe(true);
    if (!completed.ok) return;
    expect(completed.state.planets.a!.garrison[0]?.moduleStars).toEqual({ gun: 1 });
    expect(
      kernel.applyAction(
        completed.state,
        {
          id: 'new',
          type: 'unit.build',
          playerId: 'p',
          payload: { planetId: 'a', unit: 'ship', modules: ['gun'] },
          issuedAt: 8 * 3600_000,
        },
        { now: 8 * 3600_000, data },
      ).ok,
    ).toBe(false);
  });
});
