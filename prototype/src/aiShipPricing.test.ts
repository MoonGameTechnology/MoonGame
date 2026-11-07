import { describe, expect, it } from 'vitest';
import { aiOrders, canOrder, kernel, newGame, START_CANDIDATES } from './game';
import { data } from './gameData';
import { buildUnit } from '../../decisions/actions';

function ready(microelectronics: number) {
  const s = newGame({
    seats: [
      { id: 'p1', name: 'A', faction: 'azure', start: START_CANDIDATES[0]!, ai: true },
      { id: 'p2', name: 'B', faction: 'crimson', start: START_CANDIDATES[1]!, ai: true },
    ],
  });
  s.pricing = {
    cost: { metal: 1.5, credits: 3, microelectronics: 2 },
    shipCost: { metal: 2.5, credits: 2, microelectronics: 1.5 },
  };
  s.players.p2!.technologies = { completed: Object.keys(data.technologies) };
  s.players.p2!.scientists = [];
  s.players.p2!.resources = {
    metal: 100_000,
    credits: 100_000,
    food: 100_000,
    energy: 100_000,
    microelectronics,
  };
  const base = Object.values(s.planets).find(
    (p) => p.owner === 'p2' && p.buildings.some((b) => b.type === 'shipyard'),
  )!;
  return { s, base };
}

describe('AI line ship budget uses the current match price', () => {
  it.each([6, 7, 8])('does not request a cruiser with only %i microelectronics', (micro) => {
    const { s, base } = ready(micro);
    expect(canOrder(s, buildUnit('p2', base.id, 'cruiser', 1))).toBe('E_INSUFFICIENT');
    const orders = aiOrders(s, 'p2', 'expand', 'strong');
    expect(
      orders.some(
        (a) => a.type === 'unit.build' && (a.payload as { unit?: string }).unit === 'cruiser',
      ),
    ).toBe(false);
  });

  it('orders the cruiser once all components cover its price', () => {
    const { s, base } = ready(9);
    expect(canOrder(s, buildUnit('p2', base.id, 'cruiser', 1))).toBeNull();
    expect(
      aiOrders(s, 'p2', 'expand', 'strong').some(
        (a) => a.type === 'unit.build' && (a.payload as { unit?: string }).unit === 'cruiser',
      ),
    ).toBe(true);
  });
});

describe('wartime scouts preserve the next line ship budget', () => {
  function atWar(metal: number, credits = 361, microelectronics = 9) {
    const { s, base } = ready(microelectronics);
    s.players.p2!.resources.metal = metal;
    s.players.p2!.resources.credits = credits;
    s.diplomacy = { ...s.diplomacy, 'p1|p2': 'war' };
    return { s, base };
  }

  const scoutOrder = (s: ReturnType<typeof newGame>) =>
    aiOrders(s, 'p2', 'expand', 'strong').find(
      (a) => a.type === 'unit.build' && (a.payload as { unit?: string }).unit === 'scout',
    );

  it.each([211, 300, 330, 331, 405])(
    'saves instead of buying a scout with %i metal below the spare-money threshold',
    (metal) => {
      const { s } = atWar(metal);
      expect(scoutOrder(s)).toBeUndefined();
    },
  );

  it('reaches the line-production threshold without spending it on another scout', () => {
    const { s, base } = atWar(331);
    const line = aiOrders(s, 'p2', 'expand', 'strong').find(
      (a) => a.type === 'unit.build' && (a.payload as { unit?: string }).unit === 'cruiser',
    );
    expect(line).toBeDefined();
    expect(canOrder(s, buildUnit('p2', base.id, 'cruiser', 1))).toBeNull();
    expect(scoutOrder(s)).toBeUndefined();
  });

  it('pays for a surplus scout while leaving the line hull affordable and above its floors', () => {
    const { s, base } = atWar(406);
    const scout = scoutOrder(s);
    expect(scout).toBeDefined();
    const paid = kernel.applyAction(s, scout!, { now: s.time, data });
    if (!paid.ok) throw new Error(paid.code);
    expect(paid.state.players.p2!.resources.metal).toBe(331);
    expect(paid.state.players.p2!.resources.credits).toBe(361);
    expect(canOrder(paid.state, buildUnit('p2', base.id, 'cruiser', 1))).toBeNull();
  });

  it.each([
    { credits: 360, microelectronics: 9 },
    { credits: 361, microelectronics: 8 },
  ])('reserves the line credits and microelectronics too: %j', (resources) => {
    const { s } = atWar(10000, resources.credits, resources.microelectronics);
    expect(scoutOrder(s)).toBeUndefined();
  });

  it('uses the actual hull price plus the order reserve when these exceed the old floors', () => {
    const { s } = atWar(809);
    s.pricing!.shipCost!.metal = 6;
    // Scout 180 + cruiser 540 + ordinary metal reserve 90 = 810.
    expect(scoutOrder(s)).toBeUndefined();
    const funded = structuredClone(s);
    funded.players.p2!.resources.metal = 810;
    expect(scoutOrder(funded)).toBeDefined();
  });

  it('continues scouting while the line hull needs a larger yard', () => {
    const { s, base } = atWar(300);
    base.buildings.find((b) => b.type === 'shipyard')!.level = 1;
    expect(canOrder(s, buildUnit('p2', base.id, 'cruiser', 1))).toBe('E_YARD_TOO_SMALL');
    expect(scoutOrder(s)).toBeDefined();
  });

  it('continues scouting while the first line hull technology is locked', () => {
    const { s, base } = atWar(300, 10000, 10000);
    s.techRules = { ruleset: 'main', dayGates: true, exclude: [] };
    s.players.p2!.technologies = { completed: ['scout_design'] };
    expect(canOrder(s, buildUnit('p2', base.id, 'frigate', 1))).toBe('E_TECH_LOCKED');
    expect(scoutOrder(s)).toBeDefined();
  });

  it('keeps the existing scout policy for neutral NPCs', () => {
    const { s, base } = atWar(300);
    s.players.p2!.npc = 'neutral';
    expect(canOrder(s, buildUnit('p2', base.id, 'cruiser', 1))).toBeNull();
    expect(scoutOrder(s)).toBeDefined();
  });
});
