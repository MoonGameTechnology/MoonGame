/**
 * Платный мгновенный ремонт («золотой ремонт») — донатная кнопка Bytro-стиля:
 * мгновенный топ-ап КОРПУСА всех стеков за кредиты. Extracted from `game.ts`
 * (REFP-17): depends on `effectiveStats`, `canAfford`, `payCost`.
 */
import type { Fleet, GameData, GameModule } from '../../packages/shared-core/src/index';
import { effectiveStats } from '../../packages/shared-core/src/index';
import { canAfford, payCost } from '../../packages/shared-core/src/util/treasury';

export const INSTANT_REPAIR_CREDITS_PER_HP = 1;

/** Недостающий корпус флота (корабли + десант), по эффективному hp с фитингами. */
export function missingHull(f: Fleet, data: GameData): number {
  let missing = 0;
  for (const stack of [...f.units, ...(f.landing ?? [])]) {
    if (stack.count <= 0 || stack.hp === undefined) continue;
    const def = data.units[stack.unit];
    if (!def) continue;
    const per = effectiveStats(def, stack, data).hp ?? 0;
    const full = stack.count * per;
    missing += Math.max(0, full - Math.min(stack.hp, full));
  }
  return missing;
}

/** Цена мгновенного ремонта в кредитах (0 — чинить нечего) — одна формула на
 *  сервер и кнопку клиента, чтобы ценник в UI не расходился с гейтом. */
export function instantRepairCost(f: Fleet, data: GameData): number {
  return Math.ceil(missingHull(f, data) * INSTANT_REPAIR_CREDITS_PER_HP);
}

export const instantRepairModule: GameModule = {
  id: 'instant-repair',
  version: '0.1.0',
  setup(api) {
    api.onAction('fleet.instantRepair', (action, h) => {
      const p = action.payload as { fleetId?: unknown };
      if (typeof p?.fleetId !== 'string') return h.reject('E_BAD_PAYLOAD');
      const f = h.state.fleets[p.fleetId];
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