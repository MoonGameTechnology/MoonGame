/**
 * Instant hull repair ("платный мгновенный ремонт") — a Bytro-style paid button:
 * instant hull top-up for every stack, paid in credits, from anywhere.
 *
 * Was a port of the prototype's `instantRepairModule` (REFP-17); since CONV-1 it is
 * the ONLY implementation — the prototype deleted its copy and drives this module
 * through `protoKernel`.
 */
import type { GameModule } from '../kernel/module';
import { missingHull, INSTANT_REPAIR_CREDITS_PER_HP } from '../util/repair';
import { canAfford, payCost } from '../util/treasury';
import { ownFleet } from '../util/combat';

export const instantRepairModule: GameModule = {
  id: 'instant-repair',
  version: '1.0.0',
  setup(api) {
    api.onAction('fleet.instantRepair', (action, h) => {
      const p = action.payload as { fleetId?: unknown };
      if (typeof p?.fleetId !== 'string') return h.reject('E_BAD_PAYLOAD');
      const f = ownFleet(h.state, p.fleetId);
      // Absent OR not-yours → one opaque code (A06 — no fleet-existence probing).
      if (!f || f.owner !== action.playerId) return h.reject('E_NO_FLEET');
      if (f.battleId) return h.reject('E_IN_BATTLE');
      const player = h.state.players[action.playerId];
      if (!player) return h.reject('E_NO_PLAYER');
      const hull = missingHull(f, h.ctx.data);
      if (hull <= 0) return h.reject('E_NOTHING_TO_REPAIR');
      const credits = Math.ceil(hull * INSTANT_REPAIR_CREDITS_PER_HP);
      if (!canAfford(player.resources, { credits })) return h.reject('E_NO_FUNDS');
      payCost(player.resources, { credits });
      for (const stack of [...f.units, ...(f.landing ?? [])]) delete stack.hp;
      h.emit('fleet.instantRepaired', { fleetId: f.id, owner: f.owner, credits, hull });
    });
  },
};
