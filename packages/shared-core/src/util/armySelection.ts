import type { GameData } from '../data/schemas';
import type { GameState, UnitStack } from '../state/gameState';
import { consolidateGroundStacks, takeFromStacks } from './stacks';

export interface ArmySource {
  group: string;
  count: number;
}
export interface ArmySelection {
  unit: string;
  count: number;
  sources?: ArmySource[];
  first?: 'wounded' | 'healthy';
}

/** Preserve the existing type-only priority when pinning a legacy claim. */
function sourceOrder(stacks: readonly UnitStack[], first?: ArmySelection['first']): readonly UnitStack[] {
  if (!first) return stacks;
  const preferred = (s: UnitStack) =>
    (s.hp !== undefined || s.shieldHp !== undefined) === (first === 'wounded');
  return [...stacks.filter(preferred), ...stacks.filter((s) => !preferred(s))];
}

/** Remaining units per persistent group, after all claims on the same source. */
export function armyFreeGroups(
  stacks: readonly UnitStack[],
  claims: readonly ArmySelection[],
): Map<string, number> {
  const free = new Map(stacks.filter((s) => s.armyGroup).map((s) => [s.armyGroup!, s.count]));
  for (const claim of claims)
    for (const source of claim.sources ?? [])
      free.set(source.group, Math.max(0, (free.get(source.group) ?? 0) - source.count));
  // Old saved orders still reserve their original first-available selection.
  for (const claim of claims)
    if (claim.sources === undefined) {
      for (const source of selectArmySources(stacks, free, claim.unit, claim.count, undefined, claim.first))
        free.set(source.group, (free.get(source.group) ?? 0) - source.count);
    }
  return free;
}

export function selectArmySources(
  stacks: readonly UnitStack[],
  free: ReadonlyMap<string, number>,
  unit: string,
  count: number,
  group?: string,
  first?: ArmySelection['first'],
): ArmySource[] {
  const sources: ArmySource[] = [];
  for (const stack of sourceOrder(stacks, first)) {
    if (count <= 0) break;
    if (
      stack.unit !== unit ||
      !stack.armyGroup ||
      (group !== undefined && stack.armyGroup !== group)
    )
      continue;
    const take = Math.min(count, free.get(stack.armyGroup) ?? 0);
    if (take > 0) {
      sources.push({ group: stack.armyGroup, count: take });
      count -= take;
    }
  }
  return sources;
}

/** Lazy, server-owned identities. Reading the menu never invents authoritative IDs. */
export function prepareArmyGroups(
  state: GameState,
  stacks: UnitStack[],
  claims: ArmySelection[],
  data: GameData,
): void {
  for (const stack of stacks)
    if (stack.count > 0 && data.units[stack.unit]?.domain === 'ground')
      stack.armyGroup ??= `army:${state.scheduleSeq++}`;
  // Pin older claims before admitting any explicit selection, so they cannot steal it later.
  const pinned = claims.filter((c) => c.sources !== undefined);
  for (const claim of claims)
    if (claim.sources === undefined) {
      claim.sources = selectArmySources(
        stacks,
        armyFreeGroups(stacks, pinned),
        claim.unit,
        claim.count,
        undefined,
        claim.first,
      );
      pinned.push(claim);
    }
  mergeArmyGroups(stacks, claims, data);
}

/** Keep accepted source identities intact until their lift finishes or cancels. */
export function mergeArmyGroups(stacks: UnitStack[], claims: readonly ArmySelection[], data: GameData): void {
  const reserved = new Set(claims.flatMap((c) => c.sources?.map((s) => s.group) ?? []));
  const legacy = new Set(claims.filter((c) => c.sources === undefined).map((c) => c.unit));
  const merged = consolidateGroundStacks(stacks, data,
    (s) => !legacy.has(s.unit) && (!s.armyGroup || !reserved.has(s.armyGroup)));
  stacks.splice(0, stacks.length, ...merged);
}

export function armyClaimCount(stacks: readonly UnitStack[], claim: ArmySelection): number {
  if (claim.sources === undefined)
    return stacks.reduce((n, s) => n + (s.unit === claim.unit ? s.count : 0), 0);
  return claim.sources.reduce((n, source) => {
    const stack = stacks.find((s) => s.armyGroup === source.group && s.unit === claim.unit);
    return n + Math.min(source.count, stack?.count ?? 0);
  }, 0);
}

/** Follow the chosen formation through healing and array reordering; never substitute another. */
export function takeArmySelection(
  stacks: UnitStack[],
  claim: ArmySelection,
  count: number,
): UnitStack[] {
  if (claim.sources === undefined) return takeFromStacks([...sourceOrder(stacks, claim.first)], claim.unit, count);
  const moved: UnitStack[] = [];
  for (const source of claim.sources) {
    const stack = stacks.find((s) => s.armyGroup === source.group && s.unit === claim.unit);
    if (!stack || stack.count <= 0 || count <= 0) continue;
    const take = Math.min(count, source.count, stack.count);
    moved.push(...takeFromStacks([stack], claim.unit, take));
    count -= take;
  }
  return moved;
}

export function groundClaims(state: GameState, planetId: string): ArmySelection[] {
  return Object.values(state.fleets).flatMap((f) =>
    (f.loading ?? []).filter((c) => c.from === planetId),
  );
}
