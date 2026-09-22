import type { GameData, ResourceBag } from '../data/schemas';
import type { GameModule } from '../kernel/module';
import type { Player } from '../state/gameState';

/**
 * Faction passives (CR-1.2 / B2). A player's faction (`Player.faction` → game data
 * `factions[...].passives`) grants always-on bonuses, applied through the SAME value
 * hooks as technologies: `economy.production`, `fleet.speed`, `combat.damage`. Pure and
 * data-driven; the faction roster/loadout itself is data (B1) — this module only reads
 * `passives` and contributes to the pipelines. Without the module the passives simply
 * don't apply (graceful degradation), like every other extension point.
 */

type PassiveKey = 'productionBonus' | 'fleetSpeedBonus' | 'combatDamageBonus' | 'fortGarrisonBonus';

/** The faction passive `key` for `player`, or 0 (no faction / unknown faction / no module). */
function passive(player: Player | undefined, data: GameData, key: PassiveKey): number {
  const factionId = player?.faction;
  const def = factionId ? data.factions[factionId] : undefined;
  return def?.passives[key] ?? 0;
}

export const factionModule: GameModule = {
  id: 'faction',
  version: '1.1.0',
  setup(api) {
    // Signature organisms belong to their declared faction, even for direct intents.
    api.hook<{ allowed: boolean; code?: string }>(
      'construction.requirement',
      (requirement, args, h) => {
        if (!requirement.allowed) return requirement;
        const { playerId, kind, id } = args as { playerId: string; kind: string; id: string };
        if (kind !== 'unit') return requirement;
        const owner = Object.entries(h.ctx.data.factions).find(([, def]) =>
          def.uniqueUnits.includes(id),
        );
        return owner && owner[0] !== h.state.players[playerId]?.faction
          ? { allowed: false, code: 'E_FORBIDDEN' }
          : requirement;
      },
    );
    // Owned-world production ×(1 + productionBonus).
    api.hook<ResourceBag>('economy.production', (bag, args, h) => {
      const planetId = (args as { planetId?: string }).planetId;
      const owner = planetId ? h.state.planets[planetId]?.owner : null;
      if (owner === null || owner === undefined) return bag;
      const bonus = passive(h.state.players[owner], h.ctx.data, 'productionBonus');
      if (bonus === 0) return bag;
      const out: Record<string, number> = {};
      for (const res of Object.keys(bag)) out[res] = (bag[res] ?? 0) * (1 + bonus);
      return out;
    });

    // Owned-fleet travel speed ×(1 + fleetSpeedBonus).
    api.hook<number>('fleet.speed', (speed, args, h) => {
      const fleetId = (args as { fleetId?: string }).fleetId;
      const owner = fleetId ? h.state.fleets[fleetId]?.owner : undefined;
      const bonus = owner ? passive(h.state.players[owner], h.ctx.data, 'fleetSpeedBonus') : 0;
      return bonus !== 0 ? speed * (1 + bonus) : speed;
    });

    // Потолок выданного гарнизона + fortGarrisonBonus (FORT-2.3). Слагаемое, а не
    // множитель: потолок считается головами, и доля дала бы дробных защитников.
    api.hook<number>('fort.garrisonCap', (cap, args, h) => {
      const planetId = (args as { planetId?: string }).planetId;
      const owner = planetId ? h.state.planets[planetId]?.owner : null;
      if (owner === null || owner === undefined) return cap;
      return cap + passive(h.state.players[owner], h.ctx.data, 'fortGarrisonBonus');
    });

    // Outgoing combat damage ×(1 + combatDamageBonus).
    api.hook<number>('combat.damage', (damage, args, h) => {
      const attacker = (args as { attacker?: string | null }).attacker;
      const bonus =
        typeof attacker === 'string'
          ? passive(h.state.players[attacker], h.ctx.data, 'combatDamageBonus')
          : 0;
      return bonus !== 0 ? damage * (1 + bonus) : damage;
    });
  },
};
