import type { HandlerContext } from '../kernel/module';
import type { Battle, BattleSide } from '../state/gameState';
import { attacks, combatantKey, shipsEngaged } from '../state/battle';
import { isHostile, sideAlive } from './combat';
import { scheduleTick } from './battleClocks';

function enemies(h: HandlerContext, a: BattleSide, b: BattleSide): boolean {
  return a.owner !== b.owner &&
    (a.owner === null || b.owner === null || isHostile(h, a.owner, b.owner));
}

/** Retreat removes only the leaving fleets. Surviving enemies keep their battle,
 * fire orders and clocks; role anchors still exist for reports and resolution. */
export function retainBattleAfterRetreat(
  h: HandlerContext,
  battle: Battle,
  leaving: ReadonlySet<string>,
): boolean {
  const left = battle.sides.filter(side =>
    !(side.ref.kind === 'fleet' && leaving.has(side.ref.fleetId)) && sideAlive(h.state, side.ref));
  if (!left.some((a, i) => left.some((b, j) => j > i && enemies(h, a, b)))) return false;
  const attacker = left.find(side => side.role === 'attacker') ?? left[0]!;
  const defender = left.find(side => side !== attacker && side.role === 'defender') ??
    left.find(side => side !== attacker)!;
  for (const [side, role] of [[attacker, 'attacker'], [defender, 'defender']] as const) {
    if (side.role === role) continue;
    const stance = attacks(side) ? 'attack' : 'defense';
    side.role = role;
    side.roleStance = stance;
  }
  battle.sides = left;
  for (const side of left) {
    if (side.ref.kind !== 'fleet') continue;
    const fleet = h.state.fleets[side.ref.fleetId];
    if (fleet) fleet.battleId = battle.id;
  }
  scheduleTick(h, battle.id);
  return true;
}

/** A casualty on a road must not free surviving enemies to resume their marches.
 * Rebuild the same connected hostile groups as a node battle, in fleet-id order. */
export function roadBattleSides(h: HandlerContext, previous: Battle): BattleSide[][] {
  const waiting = previous.sides.filter(side => {
    if (side.ref.kind !== 'fleet' || !sideAlive(h.state, side.ref)) return false;
    const fleet = h.state.fleets[side.ref.fleetId];
    return fleet && fleet.location === null && fleet.edge && !fleet.movement && !shipsEngaged(h.state, fleet);
  }).sort((a, b) => {
    const aId = a.ref.kind === 'fleet' ? a.ref.fleetId : '';
    const bId = b.ref.kind === 'fleet' ? b.ref.fleetId : '';
    return aId < bId ? -1 : aId > bId ? 1 : 0;
  });
  const groups: BattleSide[][] = [];
  while (waiting.length > 1) {
    const first = waiting.shift()!;
    const enemyIndex = waiting.findIndex(side => enemies(h, first, side));
    if (enemyIndex < 0) continue;
    const second = waiting.splice(enemyIndex, 1)[0]!;
    const group: BattleSide[] = [{ ...first, role: 'attacker' }, { ...second, role: 'defender' }];
    for (let joined = true; joined;) {
      joined = false;
      for (let i = 0; i < waiting.length; i++) {
        if (!group.some(side => enemies(h, side, waiting[i]!))) continue;
        group.push({ ...waiting.splice(i--, 1)[0]!, role: 'attacker' });
        joined = true;
      }
    }
    groups.push(group);
  }
  return groups;
}

const clockKey = (side: BattleSide): string => JSON.stringify([side.owner, combatantKey(side.ref)]);

/** Run before any continuation's tick, but after the FIFO beachhead events have
 * created their new battles. Emitted landing events are not handled inline. */
export function queueBattleClockRestore(h: HandlerContext, previous: Battle): void {
  const live = previous.sides.filter(side => sideAlive(h.state, side.ref));
  if (!live.some((a, i) => live.some((b, j) => j > i && enemies(h, a, b)))) return;
  h.schedule(h.ctx.now, 'combat.clocks.restore', {
    previous: { ...previous, sides: previous.sides.map(side => ({ ...side, ref: { ...side.ref } })) },
  });
}

/** Keep continuing attackers' reload times and explicit attack overrides. The
 * default roles follow relinking; a captured garrison has a different owner/key.
 * A newly scheduled immediate tick can stay: it finds no prematurely due source. */
export function restoreBattleClocks(h: HandlerContext, previous: Battle): void {
  const prior = new Map(previous.sides.map(side => [clockKey(side), side]));
  for (const id of Object.keys(h.state.battles).sort()) {
    const battle = h.state.battles[id]!;
    if (battle.id === previous.id || battle.location !== previous.location || battle.phase !== previous.phase) continue;
    let restored = false;
    for (const side of battle.sides) {
      const old = prior.get(clockKey(side));
      if (!old) continue;
      restored = true;
      // Explicit attack overrides outlive the link's default roles.
      delete side.roleStance;
      if (old.stance === 'attack') side.stance = 'attack';
      else delete side.stance;
      if (attacks(side)) {
        side.nextAttackAt = attacks(old) ? old.nextAttackAt ?? previous.nextRoundAt ?? h.ctx.now : h.ctx.now;
        side.attackStartedAt = attacks(old) ? old.attackStartedAt ?? Math.min(h.ctx.now, side.nextAttackAt) : h.ctx.now;
        // A casualty is progress: the new battle link gets a fresh stalemate window.
        side.attackCount = 0;
      } else {
        delete side.nextAttackAt;
        delete side.attackStartedAt;
        delete side.attackCount;
      }
    }
    if (restored) scheduleTick(h, battle.id);
  }
}
