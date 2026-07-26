/**
 * Stack-list helpers for the prototype's fleet launch/merge/split — canonical
 * loadout signature, pro-rata apportioning of hull/shield pools on a split, and
 * loadout-aware coalescing on a merge. Extracted from `game.ts` (REFP-3): the
 * helpers are pure functions over `UnitStack[]` with no other `game.ts` deps.
 *
 * Bug-hunt provenance (BF-4/BF-5): a split must apportion `hp`/`shieldHp` pools
 * pro-rata (copying the whole pool onto both halves minted extra ships in combat),
 * and a merge coalesces only same-unit + same-loadout + both-full-health stacks
 * (merging on `hp` equality alone fused damaged stacks into one pool and smeared
 * paid modules over bare hulls).
 */
import type { UnitStack } from '../../packages/shared-core/src/index';

/** Canonical, order-independent loadout signature (mirrors shared-core `stacks.ts`):
 *  one instance per module id, sorted+joined. Two stacks share a merge identity only
 *  when this matches — a fitted stack never absorbs a bare one (SM-0.3). */
export function loadoutKey(modules?: readonly string[]): string {
  return !modules || modules.length === 0 ? '' : [...modules].sort().join(',');
}

/** Move up to `count` of `unit` out of `src` (mutates src) and return the removed
 *  stacks. `hp`/`shieldHp` are POOLS for the whole stack (gameState.ts), so a split
 *  must APPORTION them pro-rata — copying the whole pool onto both halves duplicated
 *  hull that combat then minted into extra ships (BF-4). The loadout rides onto the
 *  taken stack so a routine split never strips paid modules (BF-5). */
export function takeFromStacks(src: UnitStack[], unit: string, count: number): UnitStack[] {
  let remaining = count;
  const taken: UnitStack[] = [];
  for (const st of src) {
    if (st.unit !== unit || remaining <= 0) continue;
    const move = Math.min(st.count, remaining);
    remaining -= move;
    const frac = move / st.count; // share of the pools that leaves with the taken ships
    const t: UnitStack = { unit, count: move };
    if (st.hp !== undefined) {
      t.hp = st.hp * frac;
      st.hp -= t.hp; // source keeps the remainder — total pool conserved
    }
    if (st.shieldHp !== undefined) {
      t.shieldHp = st.shieldHp * frac;
      st.shieldHp -= t.shieldHp;
    }
    if (st.modules && st.modules.length > 0) t.modules = [...st.modules];
    st.count -= move;
    taken.push(t);
  }
  return taken;
}

/** Fold one stack list into another. Two stacks coalesce only when they share unit,
 *  loadout AND are both full-health (no `hp`/`shieldHp` pool) — the shared-core
 *  `findHealthyStack` rule. Merging on `hp` equality alone (the old code) fused two
 *  damaged stacks into ONE pool (halving hull) and smeared a fitted stack's modules
 *  over bare hulls, or destroyed them (BF-5); damaged/differently-fitted stacks now
 *  stay separate (combat handles multiple stacks of one unit fine). */
export function mergeStacks(base: UnitStack[], add: UnitStack[]): UnitStack[] {
  const clone = (st: UnitStack): UnitStack => ({
    ...st,
    ...(st.modules ? { modules: [...st.modules] } : {}),
  });
  const out = base.map(clone);
  for (const st of add) {
    const healthy = st.hp === undefined && st.shieldHp === undefined;
    const match = healthy
      ? out.find(
          (o) =>
            o.unit === st.unit &&
            o.hp === undefined &&
            o.shieldHp === undefined &&
            loadoutKey(o.modules) === loadoutKey(st.modules),
        )
      : undefined;
    if (match) match.count += st.count;
    else out.push(clone(st));
  }
  return out;
}