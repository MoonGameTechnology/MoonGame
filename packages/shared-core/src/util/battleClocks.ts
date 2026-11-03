import { hoursToMs, type Context } from '../action/types';
import type { ActionHandler, HandlerContext } from '../kernel/module';
import { attacks, combatantKey } from '../state/battle';
import { sideAlive } from './combat';

export const roundIntervalMs = (ctx: Context): number => hoursToMs(ctx, 1);

/** An owned living defender may switch to attack; repetition preserves its clock. */
export const orderBattleAttack: ActionHandler = (action, h) => {
  const p = action.payload as { battleId?: unknown; side?: unknown } | null;
  if (!p || typeof p.battleId !== 'string' || (p.side !== undefined && typeof p.side !== 'string'))
    return h.reject('E_BAD_PAYLOAD');
  const battle = Object.hasOwn(h.state.battles, p.battleId) ? h.state.battles[p.battleId] : undefined;
  const own = battle?.sides.filter((s) => s.owner === action.playerId && sideAlive(h.state, s.ref)
    && (p.side === undefined || combatantKey(s.ref) === p.side)) ?? [];
  if (!battle || !own.length) return h.reject('E_NO_BATTLE');
  for (const side of own) {
    if (attacks(side)) continue;
    side.stance = 'attack';
    side.attackCount = 0;
    side.attackStartedAt = h.ctx.now;
    side.nextAttackAt = h.ctx.now + roundIntervalMs(h.ctx);
  }
  scheduleTick(h, battle.id);
};

/** Schedule the earliest personal clock. Old/duplicate events are harmless: the
 * handler fires only due sources, in clock order and then battle-entry order. */
export function scheduleTick(h: HandlerContext, battleId: string, immediate = false): void {
  const battle = h.state.battles[battleId];
  if (!battle) return;
  for (const side of battle.sides) {
    if (!attacks(side)) continue;
    if (side.nextAttackAt === undefined) {
      const at = battle.nextRoundAt ?? (immediate ? h.ctx.now : h.ctx.now + roundIntervalMs(h.ctx));
      side.attackStartedAt = Math.min(h.ctx.now, at);
      side.nextAttackAt = at;
    }
  }
  const times = battle.sides.flatMap((s) => attacks(s) && s.nextAttackAt !== undefined ? [s.nextAttackAt] : []);
  if (!times.length) { delete battle.nextRoundAt; return; }
  const at = Math.min(...times);
  if (battle.nextRoundAt === at) return;
  battle.nextRoundAt = at;
  h.schedule(at, 'combat.tick', { battleId });
}
