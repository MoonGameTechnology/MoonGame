/**
 * Generic "slots + items" install gate (SHIP-4) — the ONE mechanism behind every
 * fitting system: ship modules on hulls (`util/loadout.ts`) and ship fittings on
 * heroes (`hero.fit`), and any future consumer (e.g. building modules).
 *
 * The shared rule set: the item must exist in its catalog, must not already be
 * installed (one instance per id), must pass the consumer's `allowed` predicate,
 * and must find a free slot in its category's bounded budget — or, with that budget
 * full, a free universal slot (`wildcard`). An untyped budget (heroes) is just a
 * single-category spec. Checks run in that fixed order, so every consumer reports
 * the same failure for the same situation.
 *
 * The gate returns a GENERIC reason; each consumer maps reasons onto its own
 * stable `E_*` codes (fail-secure, A10) — unifying the mechanism must not change
 * any public error surface. Pure & deterministic: fixed iteration order, no
 * Date/random; unknown ids inside `current` are skipped when counting usage
 * (the same base-default convention as `slotUsage`/`effectiveStats`).
 */

/** Why an install is refused, in check order. */
export type InstallFailure = 'unknown' | 'duplicate' | 'not_allowed' | 'no_slot';

/** How a consumer's fitting system maps onto the generic gate. */
export interface FittingSpec<Item> {
  /** Resolve an item id in the catalog; `undefined` ⇒ unknown. */
  item: (id: string) => Item | undefined;
  /** The slot category an item occupies — items of one category compete for its
   *  capacity. A single-budget system returns a constant. */
  category: (item: Item) => string;
  /** Capacity of a category. Counted against the BASE budget — an installed item
   *  can never expand the budget it occupies. */
  capacity: (category: string) => number;
  /** Universal slots: they take an item of ANY category, but only once that
   *  category's own capacity is full — a typed slot is always spent first, so a
   *  universal one never goes to an item that had a typed home. Absent ⇒ none, and
   *  the gate answers exactly as it did before universal slots existed. */
  wildcard?: number;
  /** Optional per-item predicate (e.g. ship `allowed` domain/traits/units).
   *  Absent ⇒ every catalog item is eligible. */
  allowed?: (item: Item) => boolean;
}

/** Can `id` be installed on top of `current`? Fixed check order:
 *  unknown → duplicate → not_allowed → no_slot. */
export function canInstall<Item>(
  spec: FittingSpec<Item>,
  current: readonly string[],
  id: string,
): { ok: true } | { ok: false; reason: InstallFailure } {
  const item = spec.item(id);
  if (item === undefined) return { ok: false, reason: 'unknown' };
  if (current.includes(id)) return { ok: false, reason: 'duplicate' };
  if (spec.allowed !== undefined && !spec.allowed(item)) {
    return { ok: false, reason: 'not_allowed' };
  }
  const category = spec.category(item);
  const used = new Map<string, number>();
  for (const cur of current) {
    const it = spec.item(cur);
    if (it === undefined) continue;
    const c = spec.category(it);
    used.set(c, (used.get(c) ?? 0) + 1);
  }
  if ((used.get(category) ?? 0) < spec.capacity(category)) return { ok: true };
  // Its own category is full — a universal slot takes it if one is left. Universal
  // slots hold the overflow of EVERY category, so what they already hold is the sum of
  // all overflows. That sum depends on the installed SET, not on the order the items
  // went in, so a loadout's legality does not depend on the order it was assembled in.
  let overflow = 0;
  for (const [c, n] of used) overflow += Math.max(0, n - spec.capacity(c));
  if (overflow < (spec.wildcard ?? 0)) return { ok: true };
  return { ok: false, reason: 'no_slot' };
}

/** Validate a whole installed list: every item installs legally on top of the
 *  ones before it. Returns the first failure — the same left-to-right replay the
 *  ship build gate uses, so a client and the server agree on legality. */
export function validateInstalled<Item>(
  spec: FittingSpec<Item>,
  items: readonly string[],
): { ok: true } | { ok: false; reason: InstallFailure } {
  const acc: string[] = [];
  for (const id of items) {
    const check = canInstall(spec, acc, id);
    if (!check.ok) return check;
    acc.push(id);
  }
  return { ok: true };
}
