import { describe, expect, it } from 'vitest';
import { newGame, networkSeats, PLAYABLE_FACTIONS } from './matchSetup';
import { data } from './gameData';
import { aiOrders } from './ai';

describe('pirate inhabitants', () => {
  it('are NPCs with their own ships and troops, outside player faction selection', () => {
    const s = newGame({ mapId: 'frontier-50', seats: networkSeats('ffa', 'frontier-50').slice(0, 1) });
    expect(PLAYABLE_FACTIONS).not.toContain('pirates');
    const pirates = Object.values(s.players).filter((p) => p.npc === 'pirate');
    expect(pirates).toHaveLength(6);
    for (const p of pirates) {
      expect(p.faction).toBe('pirates');
      const stacks = [
        ...Object.values(s.fleets).filter((f) => f.owner === p.id).flatMap((f) => [...f.units, ...(f.landing ?? [])]),
        ...Object.values(s.planets).filter((w) => w.owner === p.id).flatMap((w) => w.garrison),
      ];
      expect(stacks.length).toBeGreaterThan(0);
      for (const stack of stacks) expect(data.units[stack.unit]?.faction, stack.unit).toBe('pirates');
    }
  });

  it('both AI profiles replenish pirate units instead of switching back to human units', () => {
    const s = newGame({ mapId: 'frontier-50', seats: networkSeats('ffa', 'frontier-50').slice(0, 1) });
    const pirate = Object.values(s.players).find((p) => p.npc === 'pirate')!;
    pirate.resources = Object.fromEntries(data.resources.map((r) => [r, 10000]));
    const base = Object.values(s.planets).find((p) => p.owner === pirate.id)!;
    base.buildings.push(...['shipyard', 'barracks', 'factory'].map((type) => ({ type, level: 3, hp: 100 })));
    base.garrison = [];
    for (const profile of ['weak', 'strong'] as const) {
      const builds = aiOrders(s, pirate.id, 'expand', profile).filter((a) => a.type === 'unit.build');
      expect(builds.length, profile).toBeGreaterThan(0);
      for (const a of builds) {
        const payload = a.payload as { unit: string };
        expect(data.units[payload.unit]?.faction, `${profile}: ${payload.unit}`).toBe('pirates');
      }
    }
  });
});
