import { createStores } from '../persistence';
import { createMatchRulesets } from './service';

/** Canonical network bootstrap always pins new matches before exposing a store. */
export async function createPinnedStores(env = process.env): Promise<{
  stores: Awaited<ReturnType<typeof createStores>>;
  matchRulesets: Awaited<ReturnType<typeof createMatchRulesets>>;
}> {
  const stores = await createStores(env);
  const matchRulesets = await createMatchRulesets(stores.store, env);
  stores.store = matchRulesets.pinNewMatches(stores.store);
  return { stores, matchRulesets };
}
