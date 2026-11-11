import { describe, it, expect } from 'vitest';
import { createKernel } from '../../kernel/kernel';
import type { GameModule } from '../../kernel/module';
import { economyModule } from '../economy';
import { espionageModule, BASE_SPY_AGENTS } from '../espionage';
import { SPY_SALARY } from './economy';
import { createInitialState, type GameState, type Player } from '../../state/gameState';
import { parseGameData, type GameData } from '../../data/schemas';
import type { Context } from '../../action/types';

const data: GameData = parseGameData({
  version: '0.1.0',
  resources: ['metal', 'credits'],
  units: {},
  factions: {},
  buildings: {},
  events: {},
});
const DAY = 86_400_000;
const ctx = (now: number): Context => ({ now, data });

function player(id: string, credits: number, extra: Partial<Player> = {}): Player {
  return { id, name: id, faction: 'x', status: 'active', resources: { credits }, ...extra };
}
function world(players: Player[]): GameState {
  const s = createInitialState({ seed: 'pay', version: { data: '0.1.0', manifest: '1' } });
  const planets: GameState['planets'] = {};
  for (const p of players)
    planets[`home-${p.id}`] = {
      id: `home-${p.id}`,
      owner: p.id,
      position: { x: 0, y: 0 },
      resources: {},
      buildings: [],
      garrison: [],
      traits: [],
    };
  return {
    ...s,
    players: Object.fromEntries(players.map((p) => [p.id, p])),
    planets,
    capital: Object.fromEntries(players.map((p) => [p.id, `home-${p.id}`])),
  };
}
const kernel = (extra: GameModule[] = []) =>
  createKernel([economyModule, espionageModule, ...extra]);
function credits(s: GameState, k = kernel(), at = DAY): Record<string, number> {
  const r = k.advanceTo(s, ctx(at));
  if (!r.ok) throw new Error(r.code);
  return Object.fromEntries(
    Object.entries(r.state.players).map(([id, p]) => [id, p.resources.credits ?? 0]),
  );
}

describe('spy salary (owner, 2026-11-11)', () => {
  it('a day of the base network costs its credits, before any order is given', () => {
    expect(credits(world([player('p1', 1000)])).p1).toBeCloseTo(
      1000 - BASE_SPY_AGENTS * SPY_SALARY,
      9,
    );
  });

  it('accrues by formula: two half-days cost what one day does', () => {
    const k = kernel();
    const half = k.advanceTo(world([player('p1', 1000)]), ctx(DAY / 2));
    if (!half.ok) throw new Error(half.code);
    expect(credits(half.state, k).p1).toBeCloseTo(credits(world([player('p1', 1000)])).p1!, 9);
  });

  it('pays the spies a registry holds, and nothing for a slot awaiting a recruit', () => {
    const s = world([player('p1', 1000)]);
    s.spies = {
      p1: [
        { id: 1, gen: 1, state: 'rest', location: 'home-p1' },
        { id: 2, gen: 1, state: 'hidden', location: 'home-p1' },
        { id: 3, gen: 2, state: 'recruit', location: 'home-p1', arrivesAt: 10 * DAY },
      ],
    };
    expect(credits(s).p1).toBeCloseTo(1000 - 2 * SPY_SALARY, 9);
  });

  it('map inhabitants and defeated players pay nobody', () => {
    const s = world([
      player('npc', 1000, { npc: 'pirate' }),
      player('gone', 1000, { status: 'defeated' }),
    ]);
    expect(credits(s)).toEqual({ npc: 1000, gone: 1000 });
  });

  it('an unpaid salary drains the treasury to zero and puts credits in arrears', () => {
    const r = kernel().advanceTo(world([player('p1', 10)]), ctx(DAY));
    if (!r.ok) throw new Error(r.code);
    expect(r.state.players.p1!.resources.credits).toBe(0);
    expect(r.state.players.p1!.arrears).toEqual(['credits']);
  });

  it('`espionage.salary` bends the pay per spy; a broken result pays the base', () => {
    const raise: GameModule = {
      id: 'raise',
      version: '1.0.0',
      setup: (api) =>
        api.hook<number>('espionage.salary', (v, args) =>
          (args as { spyId: number }).spyId === 1 ? v * 2 : v,
        ),
    };
    expect(credits(world([player('p1', 1000)]), kernel([raise])).p1).toBeCloseTo(
      1000 - (BASE_SPY_AGENTS + 1) * SPY_SALARY,
      9,
    );
    const broken: GameModule = {
      id: 'broken',
      version: '1.0.0',
      setup: (api) => api.hook<number>('espionage.salary', () => Number.NaN),
    };
    expect(credits(world([player('p1', 1000)]), kernel([broken])).p1).toBeCloseTo(
      1000 - BASE_SPY_AGENTS * SPY_SALARY,
      9,
    );
  });

  it('a broken `economy.upkeep` bill falls back to the base bill', () => {
    const broken: GameModule = {
      id: 'broken',
      version: '1.0.0',
      setup: (api) => api.hook('economy.upkeep', () => ({ credits: -1e9 })),
    };
    // The economy's own bill here is empty: the spies' pay is added by a hook too, so the
    // broken one after it voids the lot — the fallback is the economy's base, not a payout.
    expect(credits(world([player('p1', 1000)]), kernel([broken])).p1).toBe(1000);
  });
});
