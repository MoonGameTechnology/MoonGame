import { approvalView, coalitionWallNow, effectiveVictoryRules, flashBattles, getStance, identifiedNodes, inVisionBloc, visibleView } from '@void/shared-core';
/** Local harness default. Network rooms select these functions from their capsule. */
export const currentProjection = { hostFog: approvalView, coalitionWallNow, effectiveVictoryRules, flashBattles, getStance, identifiedNodes, inVisionBloc, visibleView };
export type RulesetProjection = typeof currentProjection;
