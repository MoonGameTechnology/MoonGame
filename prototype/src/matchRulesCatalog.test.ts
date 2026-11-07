import { afterEach, expect, it } from 'vitest';
import { createInitialState, hashGameDataBundle } from '../../packages/shared-core/src/index';
import { data, useMatchCatalog } from './gameData';
import { useNetworkRules, fortressDeployPrice } from './matchRulesCatalog';
import { canOrder, ctx } from './protoKernel';
const originalHash = hashGameDataBundle(data);
afterEach(() => { useMatchCatalog(); useNetworkRules(); });
it('uses the old match catalog/config while keeping its modern UI and restores campaign defaults on exit', () => {
  const old = structuredClone(data); old.version = 'old-match';
  const id = 'a'.repeat(64);
  const rules = { id, data: old, version: { data: old.version, dataHash: hashGameDataBundle(old), manifest: `ruleset:${id}` },
    config: { timeScale: 1, victory: { scoreLimit: 3800 } }, actions: ['fleet.move'], view: { fortressDeployCost: { metal: 120 } } };
  useMatchCatalog(rules); useNetworkRules(rules);
  expect(data.version).toBe('old-match');
  expect(ctx(1).config).toEqual(rules.config);
  expect(fortressDeployPrice()).toEqual({ metal: 120 });
  const state = createInitialState({ seed: 'view', version: rules.version });
  // The latest local reducer must not reject a valid old engine command.
  expect(canOrder(state, { id: 'm', type: 'fleet.move', playerId: 'p', issuedAt: 0, payload: { fleetId: 'old', to: 'old' } })).toBeNull();
  expect(canOrder(state, { id: 'n', type: 'newer.action', playerId: 'p', issuedAt: 0, payload: {} })).toBe('E_UNKNOWN_ACTION');
  useMatchCatalog(); useNetworkRules();
  expect(hashGameDataBundle(data)).toBe(originalHash);
  expect(fortressDeployPrice()).toEqual({ metal: 480 });
});
it('rejects a corrupt catalog before switching the current UI data', () => {
  const id = 'a'.repeat(64);
  expect(() => useMatchCatalog({ id, data, version: { data: data.version, manifest: `ruleset:${id}`, dataHash: 'bad' },
    config: { timeScale: 1 }, actions: [] })).toThrow('E_MATCH_RULES_MISMATCH');
  expect(hashGameDataBundle(data)).toBe(originalHash);
});
