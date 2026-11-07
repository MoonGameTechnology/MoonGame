import type { GameData, GameState, GameVersion, Kernel, MatchConfig, ResourceBag } from '@void/shared-core';

export interface RulesetDescriptor {
  format: 1;
  id: string;
  source: string;
  data: { version: string; hash: string };
  manifest: string;
  modules: Array<{ id: string; version: string }>;
  actions: string[];
  view?: { fortressDeployCost?: ResourceBag };
}

/** Executable bytes are authenticated independently of the database holding them. */
export interface RulesetArtifact {
  descriptor: RulesetDescriptor;
  bundle: Uint8Array;
  signature: string;
}

export interface RulesetStore {
  hasAny(): Promise<boolean>;
  get(id: string): Promise<RulesetArtifact | null>;
  put(artifact: RulesetArtifact): Promise<void>;
}

export interface LegacyRulesOrigin {
  version: GameVersion;
  source: string;
  deployedAt: number;
  nextDeployedAt?: number;
}

/** Outside the deterministic world; the signature binds this pin to ONE match. */
export interface MatchRulesetBinding {
  id: string;
  version: Required<GameVersion>;
  config: MatchConfig;
  origin?: LegacyRulesOrigin;
  signature: string;
}

export interface RulesetDrivers {
  ai(state: GameState, seat: string, posture: import('@void/shared-core').StewardPosture | 'expand'): import('@void/shared-core').Action[];
  bot(state: GameState, seat: string, seed: number): import('@void/shared-core').Action[][];
  slices(actions: import('@void/shared-core').Action[]): import('@void/shared-core').Action[][];
  pve(state: GameState, seq: number, session: string): import('@void/shared-core').Action[];
  standing(state: GameState): Array<{ actions: import('@void/shared-core').Action[]; stopOnFailure: boolean }>;
  canonicalStanding(state: GameState, probe: (state: GameState, actions: readonly import('@void/shared-core').Action[]) => string | null): Array<{ playerId: string; action: import('@void/shared-core').Action }>;
}

export interface RulesetRuntime {
  projection: import('./projection').RulesetProjection;
  drivers: RulesetDrivers;
  descriptor: RulesetDescriptor;
  kernel: Kernel;
  data: GameData;
  configFor(state: Pick<GameState, 'mapId' | 'modeId'>): MatchConfig;
}

export type RulesetErrorCode =
  | 'E_RULESET_INTEGRITY'
  | 'E_RULESET_MISSING'
  | 'E_RULESET_INVALID'
  | 'E_RULESET_UNSUPPORTED'
  | 'E_RULESET_PIN_CONFLICT'
  | 'E_RULESET_KEY';

export class RulesetError extends Error {
  constructor(readonly code: RulesetErrorCode) { super(code); }
}
