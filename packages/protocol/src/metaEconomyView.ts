import type { ArsenalItem } from '@void/shared-core';
import type { MaterialSource } from './metaEconomy';

/** Main-game economy wire model. No Sector Zero balances or client-awarded value. */
export interface MetaMaterialView {
  id: string;
  nameKey: string;
  tradable: number;
  soulbound: number;
}

export interface MetaIngredientView {
  materialId: string;
  required: number;
  tradable: number;
  soulbound: number;
}

export interface MetaRecipeView {
  id: string;
  defId: string;
  ingredients: MetaIngredientView[];
  canCraft: boolean;
  requiresSoulbound: boolean;
  salvage: Array<{ materialId: string; quantity: number }>;
}

export interface MetaSeasonView {
  id: string;
  nameKey: string;
  startsAt: number;
  endsAt: number;
  levels: number;
  xpPerLevel: number;
  /** Season XP for each UTC day with the player's own orders in a match. */
  dailyXp?: number;
  xp: number;
  level: number;
  premium: boolean;
  active: boolean;
  started: boolean;
  archived: boolean;
  contracts: Array<{
    id: string;
    metric: string;
    target: number;
    progress: number;
    xp: number;
    available: boolean;
    completed: boolean;
  }>;
  milestones: Array<{
    level: number;
    free: string;
    premium: string;
    freeClaimed: boolean;
    premiumClaimed: boolean;
    choices: string[];
    /** The module a free reward grants outright (not a choice); absent otherwise. */
    module?: string;
  }>;
}

/** The end-of-match drop tables as the server rolls them, so the arsenal can disclose
 *  the odds instead of keeping a copy that could drift from the server's file. */
export interface MetaDropOddsView {
  /** A drop is guaranteed on the `pityAfter`-th consecutive dry match. */
  pityAfter: number;
  /** Chance by final place, ascending `maxPlace`: the first row with `place <= maxPlace`. */
  byPlace: Array<{ maxPlace: number; chance: number }>;
  pool: Array<{ kind: 'hull' | 'module'; defId: string; weight: number }>;
}

export interface MetaEconomyView {
  catalogVersion: string;
  materials: MetaMaterialView[];
  recipes: MetaRecipeView[];
  supplyGoal: string | null;
  items: ArsenalItem[];
  salvageableItemIds: string[];
  seasons: MetaSeasonView[];
  cosmetics: string[];
  /** Absent from a server that predates the arsenal's odds disclosure. */
  drops?: MetaDropOddsView;
}

export interface MetaCommandReceipt {
  id: string;
  kind: string;
  at: number;
  materials?: Array<{ materialId: string; quantity: number; soulbound: boolean }>;
  itemIds?: string[];
  seasonXp?: number;
  warrants?: number;
  soulbound?: boolean;
  drop?: { kind: 'hull' | 'module'; defId: string; forced: boolean } | null;
  dropOdds?: { chance: number; pity: number; forced: boolean; tablesHash: string };
  spentMaterials?: Array<{
    materialId: string;
    quantity: number;
    soulbound: boolean;
    lotId: string;
    source: MaterialSource;
    sourceId: string;
  }>;
  consumedItem?: {
    itemId: string;
    defId: string;
    origin: ArsenalItem['origin'];
    soulbound: boolean;
    sourceId?: string;
  };
  goalElapsedMs?: number;
  firstSelectedCraft?: boolean;
  seasonCompleted?: boolean;
}

export type MetaCommandResult =
  { ok: true; receipt: MetaCommandReceipt } | { ok: false; code: string };

export interface MetaMatchRewardsView {
  receipts: MetaCommandReceipt[];
  /** False while no successful final settlement receipt has been committed. */
  finalReady: boolean;
}

export interface MetaCraftCommand {
  requestId: string;
  recipeId: string;
  allowSoulbound: boolean;
}
export interface MetaSupplyGoalCommand {
  requestId: string;
  recipeId: string | null;
}
export interface MetaSalvageCommand {
  requestId: string;
  itemId: string;
}
export interface MetaSelectPassCommand {
  requestId: string;
  seasonId: string;
}
export interface MetaSeasonChoiceCommand {
  requestId: string;
  seasonId: string;
  level: number;
  defId: string;
}
