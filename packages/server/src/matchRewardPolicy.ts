import { z } from 'zod';

const id = z
  .string()
  .regex(/^[a-z][a-z0-9_]{0,79}$/)
  .refine((value) => !['constructor', 'prototype', '__proto__'].includes(value));
const amount = z.number().int().min(1).max(1_000_000);
/** Snapshotted when the match is created; edits cannot change an ongoing match's terms. */
export const matchRewardPolicySchema = z
  .object({
    version: z.literal(1),
    scoreDivisor: amount,
    /** Hard per-match ceiling: colluding accounts can inflate peak score with legal wins. */
    maxSovereigns: z.number().int().min(0).max(1_000_000),
    baseWarrants: amount,
    killsPerWarrant: amount,
    baseMaterialCount: z.number().int().min(1).max(100),
    materialPool: z
      .array(z.object({ materialId: id, weight: amount }).strict())
      .min(1)
      .max(100),
    veteranPointsPerMaterial: amount,
    veteranMaterialCap: z.number().int().min(0).max(100),
    moduleChance: z.number().min(0).max(1),
    modulePool: z
      .array(z.object({ defId: id, weight: amount }).strict())
      .min(1)
      .max(100),
    minimumOrders: z.number().int().min(2).max(100),
    minimumContribution: amount,
    finalPresence: z.number().gt(0).max(1),
    presenceGraceMs: z.number().int().min(0).max(86_400_000),
    maxAbsenceMs: z.number().int().min(1).max(604_800_000),
  })
  .strict();
export type MatchRewardPolicy = z.infer<typeof matchRewardPolicySchema>;
