import { readFileSync } from 'node:fs';
import { z } from 'zod';
import type { GameData } from '@void/shared-core';

const id = z
  .string()
  .regex(/^[a-z][a-z0-9_]{0,79}$/)
  .refine((value) => !['constructor', 'prototype', '__proto__'].includes(value));
const amount = z.number().int().min(1).max(1_000_000);
const quantities = z.record(id, amount).refine((v) => Object.keys(v).length > 0);
const grant = z
  .object({
    labelKey: z.string().min(1),
    materials: quantities.optional(),
    module: id.optional(),
    choices: z.array(id).min(1).optional(),
    cosmetic: id.optional(),
    goalMaterials: z.boolean().optional(),
  })
  .strict();

const schema = z
  .object({
    version: z.string().min(1),
    materials: z.record(id, z.object({ nameKey: z.string().min(1) }).strict()),
    recipes: z.record(
      id,
      z
        .object({
          defId: id,
          ingredients: quantities,
          salvage: quantities,
        })
        .strict(),
    ),
    rewards: z
      .object({
        materials: quantities,
        stageFractions: z.array(z.number().gt(0).lt(1)).min(1).max(10),
        resultBonuses: z.array(
          z.object({ maxPlace: amount, percent: z.number().int().min(0).max(50) }).strict(),
        ),
        seasonXp: amount,
        warrants: amount,
        dailyWarrants: amount,
        participation: z
          .object({
            reconPerPoint: amount,
            logisticsPerPoint: amount,
            defensePerPoint: amount,
            objectivesPerPoint: amount,
            stagePoints: z.array(amount).min(1).max(10),
            // Presence: distinct game days with the player's own orders for each stage,
            // and the closing share of their tenure that must hold one for the final.
            stageDays: z.array(z.number().int().min(0).max(100)).min(1).max(10),
            finalPresence: z.number().gt(0).max(1),
          })
          .strict(),
      })
      .strict(),
    market: z.object({ minimumAccountXp: z.number().int().nonnegative() }).strict(),
    seasons: z
      .array(
        z
          .object({
            id,
            nameKey: z.string().min(1),
            startsAt: z.number().int().nonnegative(),
            durationDays: amount,
            levels: amount,
            xpPerLevel: amount,
            /** Season XP for each UTC day the account gives its own orders in a match. */
            dailyXp: amount.optional(),
            milestones: z.array(z.object({ level: amount, free: grant, premium: grant }).strict()),
            contracts: z.array(
              z
                .object({
                  id,
                  week: z.number().int().min(1).max(52),
                  metric: z.enum(['matches', 'recon', 'logistics', 'defense', 'objectives']),
                  target: amount,
                  xp: amount,
                })
                .strict(),
            ),
          })
          .strict(),
      )
      .min(1),
    commerce: z
      .object({
        dailyAdLimit: z.number().int().min(0).max(10),
        products: z.record(
          id,
          z
            .object({
              source: z.enum(['payment', 'rewarded_ad']),
              materials: quantities.optional(),
              module: id.optional(),
              premiumSeason: id.optional(),
            })
            .strict(),
        ),
      })
      .strict(),
  })
  .strict();

export type MetaEconomyCatalog = z.infer<typeof schema>;
export type MetaSeasonDefinition = MetaEconomyCatalog['seasons'][number];
export type MetaSeasonGrant = MetaSeasonDefinition['milestones'][number]['free'];

/** Meta content is independent of the deterministic match bundle and validated at boot. */
export function parseMetaEconomyCatalog(
  raw: unknown,
  data: Pick<GameData, 'modules'>,
): MetaEconomyCatalog {
  const catalog = schema.parse(raw);
  const materialIds = Object.keys(catalog.materials);
  if (materialIds.length !== 5) throw new Error('E_META_MATERIALS');
  const checkMaterials = (values: Record<string, number> | undefined): void => {
    if (values && Object.keys(values).some((key) => !Object.hasOwn(catalog.materials, key))) {
      throw new Error('E_META_MATERIAL');
    }
  };
  const checkModule = (defId: string | undefined): void => {
    if (defId && !Object.hasOwn(data.modules, defId)) throw new Error('E_META_MODULE');
  };
  const uses: Record<string, number> = {};
  const outputs = new Set<string>();
  for (const recipe of Object.values(catalog.recipes)) {
    checkModule(recipe.defId);
    if (outputs.has(recipe.defId)) throw new Error('E_META_DUPLICATE_RECIPE');
    outputs.add(recipe.defId);
    checkMaterials(recipe.ingredients);
    checkMaterials(recipe.salvage);
    for (const [key, quantity] of Object.entries(recipe.salvage)) {
      if (quantity >= (recipe.ingredients[key] ?? 0)) throw new Error('E_META_SALVAGE');
    }
    for (const key of Object.keys(recipe.ingredients)) uses[key] = (uses[key] ?? 0) + 1;
  }
  if (materialIds.some((key) => (uses[key] ?? 0) < 2)) throw new Error('E_META_UNUSED_MATERIAL');
  checkMaterials(catalog.rewards.materials);
  if (catalog.rewards.dailyWarrants < catalog.rewards.warrants)
    throw new Error('E_META_WARRANT_CAP');
  if (
    catalog.rewards.resultBonuses.some(
      (row, i, rows) => i > 0 && row.maxPlace <= rows[i - 1]!.maxPlace,
    )
  ) {
    throw new Error('E_META_RESULT_BONUS');
  }
  if (
    catalog.rewards.stageFractions.some((fraction, i, rows) => i > 0 && fraction <= rows[i - 1]!)
  ) {
    throw new Error('E_META_STAGES');
  }
  if (
    catalog.rewards.participation.stagePoints.length !== catalog.rewards.stageFractions.length ||
    catalog.rewards.participation.stagePoints.some(
      (points, i, rows) => i > 0 && points <= rows[i - 1]!,
    ) ||
    catalog.rewards.participation.stageDays.length !==
      catalog.rewards.participation.stagePoints.length ||
    catalog.rewards.participation.stageDays.some((days, i, rows) => i > 0 && days < rows[i - 1]!)
  ) {
    throw new Error('E_META_PARTICIPATION');
  }
  const seasonIds = new Set<string>();
  for (const season of catalog.seasons) {
    if (seasonIds.has(season.id)) throw new Error('E_META_SEASON');
    seasonIds.add(season.id);
    const levels = new Set<number>();
    for (const milestone of season.milestones) {
      if (levels.has(milestone.level) || milestone.level > season.levels)
        throw new Error('E_META_MILESTONE');
      levels.add(milestone.level);
      for (const reward of [milestone.free, milestone.premium]) {
        if (reward.materials && reward.goalMaterials) throw new Error('E_META_MILESTONE');
        checkMaterials(reward.materials);
        checkModule(reward.module);
        reward.choices?.forEach(checkModule);
      }
    }
    if (new Set(season.contracts.map((contract) => contract.id)).size !== season.contracts.length) {
      throw new Error('E_META_CONTRACT');
    }
  }
  for (const product of Object.values(catalog.commerce.products)) {
    checkMaterials(product.materials);
    checkModule(product.module);
    if (product.premiumSeason && !seasonIds.has(product.premiumSeason))
      throw new Error('E_META_PRODUCT');
    if (
      product.source === 'rewarded_ad' &&
      (product.module || product.premiumSeason || !product.materials)
    ) {
      throw new Error('E_META_AD_PRODUCT');
    }
  }
  return catalog;
}

export function loadMetaEconomyCatalog(
  data: Pick<GameData, 'modules'>,
  path = 'data/metaEconomy.json',
): MetaEconomyCatalog {
  return parseMetaEconomyCatalog(JSON.parse(readFileSync(path, 'utf8')) as unknown, data);
}
