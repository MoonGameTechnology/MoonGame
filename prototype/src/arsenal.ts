/**
 * ARS-5 — arsenal witryna (pure logic). The account's persistent meta-inventory
 * (ARS-1..4, server-side) had no client-facing shape until now; this module is
 * the parse/ownership layer the hub tab and the constructor's ownership filter
 * both read. Pure: no DOM, no fetch — main.ts feeds it the fetched/cached items
 * and persists. What the hub tab shows is decided in `decisions/arsenalView.ts`.
 *
 * `PlayerArsenal` (the coarse hulls/modules/fittings id snapshot ARS-3 seeds a
 * MATCH with) is a narrower projection of the same items — kept in shared-core
 * since the core build gate reads it. This module works on the raw `ArsenalItem[]`
 * the witryna needs (grade/origin/durability per card).
 */

import type { ArsenalItem } from '../../packages/shared-core/src/index';
import { safeParseArsenalItem } from '../../packages/shared-core/src/index';

/** The defIds this collection actually owns for one kind — what a build-catalog
 *  filter (constructor palette, hero fitting picker) narrows to. Dedup only; a
 *  blueprint and a graded instance of the same defId both just mean "owned". */
export function ownedDefIds(items: readonly ArsenalItem[], kind: ArsenalItem['kind']): Set<string> {
  return new Set(items.filter((i) => i.kind === kind).map((i) => i.defId));
}

/** LARS-4 — best-effort origin lookup for a build-catalog defId (the constructor's
 *  Верфь shows this on a palette/bay card, so "just bought" reads differently from
 *  "starter kit"). `items` is whatever the hub witryna has cached — may be empty if
 *  the player never opened the Arsenal tab this session; then `undefined` (the
 *  caller shows nothing, never a guess). Multiple owned instances of one defId pick
 *  the most RECENTLY acquired (a fresh craft/drop is the interesting one to flag,
 *  not an old starter blueprint sitting alongside it). */
export function originOf(items: readonly ArsenalItem[], defId: string): ArsenalItem['origin'] | undefined {
  const matches = items.filter((i) => i.defId === defId);
  if (matches.length === 0) return undefined;
  return matches.reduce((a, b) => (b.acquiredAt > a.acquiredAt ? b : a)).origin;
}

/** Parse a persisted/fetched blob into items (fail-secure: anything that doesn't
 *  parse as an `ArsenalItem` is dropped, never thrown — a corrupt cache degrades
 *  to an empty witryna, not a crash). */
export function parseArsenalItems(raw: unknown): ArsenalItem[] {
  if (!Array.isArray(raw)) return [];
  const out: ArsenalItem[] = [];
  for (const entry of raw) {
    const r = safeParseArsenalItem(entry);
    if (r.success) out.push(r.data);
  }
  return out;
}
