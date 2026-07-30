import { describe, it, expect } from 'vitest';
import { newGame, advance, data, kernel, START_CANDIDATES } from './game';
import type { SetupConfig } from './game';
import { DEFAULT_SETUP, networkSeats } from './matchSetup';

// H3 — factions are PURE passive bonuses to the economy or units (for now), applied by
// the core factionModule through the same hooks as technologies. The hooks themselves
// are pinned in shared-core's faction.test.ts; here we pin the PROTOTYPE wiring: the
// catalog shape, the kernel carrying the module, the seat faction reaching the player,
// and the economy passive actually moving a real match's treasury.

const HOUR = 3_600_000;
const solo = (faction: string): SetupConfig => ({
  seats: [{ id: 'p1', name: 'X', faction, start: START_CANDIDATES[0]!, ai: false }],
});

describe('factions (H3) — passive house bonuses over the prototype data', () => {
  it('the catalog carries the four houses, purely economy-or-units passives', () => {
    expect(Object.keys(data.factions).sort()).toEqual(['amber', 'azure', 'crimson', 'violet']);
    for (const f of Object.values(data.factions)) {
      // pure passives: no unique units / faction abilities, no radar reach —
      // strictly «экономика или юниты» (production / damage / fleet speed).
      expect(f.uniqueUnits).toEqual([]);
      expect(f.abilities).toEqual([]);
      expect(f.passives.radarRangeBonus).toBe(0);
      const sum = f.passives.productionBonus + f.passives.combatDamageBonus + f.passives.fleetSpeedBonus;
      expect(sum).toBeGreaterThan(0);
    }
  });

  it('the kernel carries factionModule; the chosen seat faction lands on the player', () => {
    expect(kernel.manifest.modules.map((m) => m.id)).toContain('faction');
    expect(newGame(solo('crimson')).players.p1?.faction).toBe('crimson');
  });

  it('every seat-assignable faction id resolves in the catalog (no silent zero passives)', () => {
    // factionModule reads `data.factions[id]?.passives[key] ?? 0` — an id that is
    // missing from the catalog plays with NO passives and nothing errors. This is
    // exactly the 2026-07 azure/crimson-vs-blue/red bug; pin the seat sources.
    const seatIds = [
      ...DEFAULT_SETUP.seats.map((seat) => seat.faction),
      ...networkSeats('ffa').map((seat) => seat.faction),
      ...networkSeats('2v2').map((seat) => seat.faction),
      ...networkSeats('5v5').map((seat) => seat.faction),
    ];
    for (const id of seatIds) {
      expect(data.factions[id], `faction id "${id}" missing from data.factions`).toBeDefined();
    }
  });

  it('the production passive moves a real treasury: azure (+12% economy) out-earns crimson', () => {
    const azure = newGame(solo('azure'));
    const crimson = newGame(solo('crimson'));
    const metal = (s: typeof azure): number => s.players.p1!.resources.metal ?? 0;
    const a0 = metal(azure);
    const c0 = metal(crimson);
    const da = metal(advance(azure, azure.time + 10 * HOUR).state) - a0;
    const dc = metal(advance(crimson, crimson.time + 10 * HOUR).state) - c0;
    // Identical world, mine and clock — only the house differs. Crimson's combat
    // passive must not touch production; azure's +12% must show in the mined metal.
    expect(dc).toBeGreaterThan(0);
    expect(da).toBeGreaterThan(dc);
  });
});
