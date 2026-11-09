import { containsBlockedLanguage } from '@void/protocol';
import type { Action } from '@void/shared-core';

/**
 * Coalition descriptions are player-authored public text. The room applies the
 * server-owned language policy in BOTH sync and durable action paths, before
 * persistence or fan-out; the pure game core has no dependency on protocol.
 */
export function blockedPublicText(action: Action): boolean {
  if (action.type !== 'coalition.edit' || !action.payload || typeof action.payload !== 'object') return false;
  const { description } = action.payload as { description?: unknown };
  return typeof description === 'string' && containsBlockedLanguage(description);
}
