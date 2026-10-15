/** Persistent main-game economy; Sector Zero keeps its independent run economy. */
export type MaterialSource = 'match' | 'craft' | 'salvage' | 'season' | 'commerce' | 'ad';

export interface MaterialLot {
  lotId: string;
  materialId: string;
  quantity: number;
  soulbound: boolean;
  source: MaterialSource;
  sourceId: string;
  acquiredAt: number;
}

export interface MetaSeasonState {
  xp: number;
  premium: boolean;
  startedAt: number;
  claimed: string[];
  choices: Record<string, string>;
  contracts: Record<string, number>;
}

export interface MetaOperationState {
  materials: Record<string, number>;
  seasonXp: number;
  finalized: boolean;
  metrics: Record<string, number>;
  budget?: Record<string, number>;
  policyVersion?: string;
  seasonXpBudget?: number;
}

export interface MetaEconomyAccount {
  materials: MaterialLot[];
  supplyGoal?: string;
  season: Record<string, MetaSeasonState>;
  activeSeasonId?: string;
  cosmetics: string[];
  counters: Record<string, number>;
  operations: Record<string, MetaOperationState>;
  itemSources: Record<string, { source: MaterialSource; sourceId: string }>;
}

export interface MetaEconomyReceipt {
  fingerprint: string;
  response: unknown;
}

export interface MetaMaterialListing {
  id: string;
  sellerId: string;
  sellerLogin: string;
  materialId: string;
  quantity: number;
  price: number;
  createdAt: number;
}

export interface MetaMarketPurchase {
  balance: number;
  tradeId: string;
}
