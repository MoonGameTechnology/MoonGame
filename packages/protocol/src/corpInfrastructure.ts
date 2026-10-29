/** Persistent corporation infrastructure, outside the match simulation. */
export interface CorpBuildingLevel {
  cost: number;
  durationMs: number;
  headquarters: number;
  influencePerDay: number;
  constructionReduction: number;
  /** Members the corporation needs to order this level, recruits not counted (CORP-6). */
  members?: number;
  /** AvA battles the corporation has played, on either side, to order this level. */
  battles?: number;
  /** The largest AvA battle this level opens, players per side (CORP-7, operations center). */
  maxFormat?: number;
  /** Protected equipment loans per corporation and battle. */
  warehouseItems?: number;
  /** Number of corporation medals in the shared public showcase. */
  showcaseSlots?: number;
  monument?: boolean;
}

export interface CorpPublicFacilities {
  warehouseItems?: number;
  showcaseSlots?: number;
  showcase?: string[];
  monument?: boolean;
}
export type CorpShowcaseError = 'E_FORBIDDEN' | 'E_CORP_HALL_REQUIRED' | 'E_CORP_MEDAL_NOT_EARNED' | 'E_BAD_SHOWCASE';
export type CorpShowcaseResult = { ok: true } | { ok: false; code: CorpShowcaseError };

/** What the level requirements are checked against (CORP-6). */
export interface CorpStanding {
  members: number;
  battles: number;
}

export interface CorpBuildingDef {
  id: string;
  nameKey: string;
  descriptionKey: string;
  levels: CorpBuildingLevel[];
}

export interface CorpBuildOrder {
  buildingId: string;
  /** Compare-and-swap guard: a retried request cannot buy the following level. */
  expectedLevel: number;
}

export interface CorpConstruction {
  buildingId: string;
  level: number;
  startedAt: number;
  completesAt: number;
  cost: number;
}

export interface CorpInfrastructureState {
  levels: Record<string, number>;
  construction: CorpConstruction | null;
  accruedAt: number;
  /** Fractional influence numerator, in influence × milliseconds per day. */
  remainder: number;
}

export type CorpBuildError =
  | 'E_FORBIDDEN'
  | 'E_CORP_BUILDING'
  | 'E_CORP_BUILD_BUSY'
  | 'E_CORP_BUILD_LEVEL'
  | 'E_CORP_BUILD_MAX'
  | 'E_CORP_BUILD_REQUIRES'
  | 'E_CORP_BUILD_MEMBERS'
  | 'E_CORP_BUILD_BATTLES'
  | 'E_INSUFFICIENT';

export interface CorpBuildingView extends CorpBuildingDef {
  level: number;
  next: (CorpBuildingLevel & { actualDurationMs: number }) | null;
  blocked: CorpBuildError | null;
}

export interface CorpInfrastructureView extends CorpStanding {
  corpId: string;
  serverNow: number;
  influence: number;
  influencePerDay: number;
  constructionReduction: number;
  canBuild: boolean;
  construction: CorpConstruction | null;
  buildings: CorpBuildingView[];
}

export type CorpInfrastructureResult =
  { ok: true; infrastructure: CorpInfrastructureView } | { ok: false; code: CorpBuildError };
