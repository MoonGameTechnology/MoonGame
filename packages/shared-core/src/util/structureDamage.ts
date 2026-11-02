import type { HandlerContext } from '../kernel/module';
import type { DamageHookArgs } from './combat';

/** Synchronous module capability: later hits and return fire see surviving buildings. */
export type StructureDamage = (
  h: HandlerContext,
  planetId: string,
  amount: number,
  owner: string | null,
  covered?: { hit: DamageHookArgs; factor: number },
) => void;

export function wearStructures(
  h: HandlerContext,
  planetId: string,
  amount: number,
  owner: string | null,
  covered?: { hit: DamageHookArgs; factor: number },
): boolean {
  const apply = h.capability<StructureDamage>('construction.impact');
  if (!apply) return false;
  apply(h, planetId, amount, owner, covered);
  return true;
}
