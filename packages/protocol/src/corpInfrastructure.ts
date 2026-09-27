/** Persistent corporation infrastructure, outside the match simulation. */
export interface CorpBuildingLevel {
  cost: number;
  durationMs: number;
  headquarters: number;
  influencePerDay: number;
  constructionReduction: number;
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
  | 'E_INSUFFICIENT';

export interface CorpBuildingView extends CorpBuildingDef {
  level: number;
  next: (CorpBuildingLevel & { actualDurationMs: number }) | null;
  blocked: CorpBuildError | null;
}

export interface CorpInfrastructureView {
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
