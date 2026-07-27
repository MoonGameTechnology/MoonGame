/**
 * ECON-3 экспресс-ремонт за металл — сток металла: экспресс-ремонт за METAL у
 * своего дока. Extracted from `game.ts` (REFP-18): depends on `missingHull`
 * (REFP-17), `canAfford`, `payCost`, `buildingLevel`.
 */
import type { Fleet, GameData, GameModule, GameState } from '../../packages/shared-core/src/index';
import { buildingLevel } from '../../packages/shared-core/src/index';
import { canAfford, payCost } from '../../packages/shared-core/src/util/treasury';
import { missingHull } from './instantRepair';

export const REPAIR_HP_PER_METAL = 2;

/** Цена экспресс-ремонта в metal (0 — чинить нечего) — одна формула на сервер и
 *  кнопку клиента. */
export function dockRepairCost(f: Fleet, data: GameData): number {
  return Math.ceil(missingHull(f, data) / REPAIR_HP_PER_METAL);
}

/** Есть ли у флота свой док: стоит (не летит) над СВОИМ миром с живым зданием,
 *  дающим `shipRepair > 0` (spaceport/shipyard). Та же проверка — в кнопке UI. */
export function fleetAtOwnDock(f: Fleet, state: GameState, data: GameData): boolean {
  if (f.movement || !f.location) return false;
  const planet = state.planets[f.location];
  if (!planet || planet.owner !== f.owner) return false;
  return planet.buildings.some((b) => {
    if (b.hp <= 0) return false;
    const def = data.buildings[b.type];
    return !!def && buildingLevel(def, b.level).shipRepair > 0;
  });
}

export const econScrewsModule: GameModule = {
  id: 'econ-screws',
  version: '0.1.0',
  setup(api) {
    // Экспресс-ремонт: мгновенный топ-ап корпуса за metal у своего дока.
    api.onAction('fleet.repair', (action, h) => {
      const p = action.payload as { fleetId?: unknown };
      if (typeof p?.fleetId !== 'string') return h.reject('E_BAD_PAYLOAD');
      const f = h.state.fleets[p.fleetId];
      // Absent OR not-yours → one opaque code (A06 — no fleet-existence probing).
      if (!f || f.owner !== action.playerId) return h.reject('E_NO_FLEET');
      if (f.battleId) return h.reject('E_IN_BATTLE');
      if (!fleetAtOwnDock(f, h.state, h.ctx.data)) return h.reject('E_NO_DOCK');
      const player = h.state.players[action.playerId];
      if (!player) return h.reject('E_NO_PLAYER');
      const hull = missingHull(f, h.ctx.data);
      if (hull <= 0) return h.reject('E_NOTHING_TO_REPAIR');
      const metal = Math.ceil(hull / REPAIR_HP_PER_METAL);
      if (!canAfford(player.resources, { metal })) return h.reject('E_NO_FUNDS');
      payCost(player.resources, { metal });
      for (const stack of [...f.units, ...(f.landing ?? [])]) delete stack.hp;
      h.emit('fleet.repaired', { fleetId: f.id, owner: f.owner, metal, hull });
    });
  },
};