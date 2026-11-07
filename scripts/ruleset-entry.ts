/** Self-contained simulation entry. No HTTP, authentication, secrets or database. */
import { createKernel, resolveMatchConfig, GAME_MODULES, FORTRESS_DEPLOY_COST, hashGameDataBundle, mapVictoryRules, MAP_SCORE_LIMITS, type GameState, type MatchConfig } from '../packages/shared-core/src/index';
import { shippedGameData } from '../data/bundle';
import { captureKernel } from '../packages/server/src/rulesets/captureKernel';

// Replaced at build time. Reading runtime GIT_SHA here would change old identities.
declare const RULESET_SOURCE_REVISION: string;
export const sourceRevision = RULESET_SOURCE_REVISION;
export const formatVersion = 1;
export const manifestVersion = '104';
export const data = shippedGameData();
export const dataHash = hashGameDataBundle(data);
const captured = captureKernel(createKernel, GAME_MODULES);
export const kernel = captured.kernel;
export const actions = captured.actions;
export const view = { fortressDeployCost: FORTRESS_DEPLOY_COST };
export function configFor(state: Pick<GameState, 'mapId' | 'modeId'>): MatchConfig {
  const config: MatchConfig = { timeScale: 1, ...(state.modeId ? { modeId: state.modeId } : {}),
    victory: { ...(mapVictoryRules(state.mapId) ?? { scoreLimit: MAP_SCORE_LIMITS.nexus }),
      ...(state.modeId && data.modes[state.modeId]?.victory.capitalCapture ? { capitalCapture: true } : {}) } };
  const resolved = resolveMatchConfig(data, config);
  if (!resolved.ok) throw new Error(resolved.code);
  return resolved.config;
}

export { drivers } from './ruleset-drivers';

export { currentProjection as projection } from '../packages/server/src/rulesets/projection';
