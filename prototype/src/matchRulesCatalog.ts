import type { MatchRulesCatalog } from '../../packages/protocol/src/index';
import { FORTRESS_DEPLOY_COST, type Action, type MatchConfig, type ResourceBag } from '../../packages/shared-core/src/index';
let selected: MatchRulesCatalog | undefined;
let actions: Set<string> | undefined;
export function useNetworkRules(rules?: MatchRulesCatalog): void {
  selected = rules;
  actions = rules ? new Set(rules.actions) : undefined;
}
export function networkConfig(): MatchConfig | undefined { return selected?.config; }
/** Modern local reducers cannot veto valid commands belonging to another engine. */
export function networkProbe(action: Action): string | null | undefined {
  if (!actions) return undefined;
  return actions.has(action.type) ? null : 'E_UNKNOWN_ACTION';
}
export function fortressDeployPrice(): ResourceBag {
  return selected?.view?.fortressDeployCost ?? FORTRESS_DEPLOY_COST;
}
