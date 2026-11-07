import { hashGameDataBundle, Rejection, resolveMatchConfig, type GameData, type GameState, type MatchConfig } from '@void/shared-core';
import { freezeTree, jsonClone } from './canonical';
import { assertSnapshotPin } from './snapshot';
import { RulesetError, type MatchRulesetBinding } from './types';

/** Only the original engine resolves gameplay defaults, once, before its pin is signed. */
export function roomConfiguration(options: { data: GameData; initialState: GameState; config?: MatchConfig; ruleset?: MatchRulesetBinding }): {
  config: MatchConfig; ruleset?: MatchRulesetBinding;
} {
  if (options.ruleset) {
    assertSnapshotPin({ state: options.initialState, dataVersion: options.initialState.version.data }, options.ruleset);
    if (hashGameDataBundle(options.data) !== options.ruleset.version.dataHash) throw new RulesetError('E_RULESET_PIN_CONFLICT');
  }
  const resolved = options.ruleset ? { ok: true as const, config: options.ruleset.config }
    : resolveMatchConfig(options.data, options.config ?? { timeScale: 1 });
  if (!resolved.ok) throw new Rejection(resolved.code);
  return { config: freezeTree(jsonClone(resolved.config)),
    ...(options.ruleset ? { ruleset: freezeTree(jsonClone(options.ruleset)) } : {}) };
}
