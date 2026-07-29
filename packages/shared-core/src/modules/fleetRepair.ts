/**
 * Dock repair ("экспресс-ремонт за металл") — instant hull top-up paid in metal,
 * only at an owned dock (a live building with `shipRepair > 0`). Port of the
 * prototype's `econScrewsModule` (`prototype/src/econScrews.ts`, REFP-18).
 */
import type { GameModule } from '../kernel/module';
import { missingHull, dockRepairCost, fleetAtOwnDock } from '../util/repair';
import { canAfford, payCost } from '../util/treasury';
import { ownFleet } from '../util/combat';

export const fleetRepairModule: GameModule = {
  id: 'fleet-repair',
  version: '1.0.0',
  setup(api) {
    api.onAction('fleet.repair', (action, h) => {
      const p = action.payload as { fleetId?: unknown };
      if (typeof p?.fleetId !== 'string') return h.reject('E_BAD_PAYLOAD');
      const f = ownFleet(h.state, p.fleetId);
      // Absent OR not-yours → one opaque code (A06 — no fleet-existence probing).
      if (!f || f.owner !== action.playerId) return h.reject('E_NO_FLEET');
      if (f.battleId) return h.reject('E_IN_BATTLE');
      if (!fleetAtOwnDock(f, h.state, h.ctx.data)) return h.reject('E_NO_DOCK');
      const player = h.state.players[action.playerId];
      if (!player) return h.reject('E_NO_PLAYER');
      const hull = missingHull(f, h.ctx.data);
      if (hull <= 0) return h.reject('E_NOTHING_TO_REPAIR');
      const metal = dockRepairCost(f, h.ctx.data);
      if (!canAfford(player.resources, { metal })) return h.reject('E_NO_FUNDS');
      payCost(player.resources, { metal });
      for (const stack of [...f.units, ...(f.landing ?? [])]) delete stack.hp;
      h.emit('fleet.repaired', { fleetId: f.id, owner: f.owner, metal, hull });
    });
  },
};
