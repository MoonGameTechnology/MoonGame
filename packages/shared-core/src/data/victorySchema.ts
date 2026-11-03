import { z } from 'zod';

/**
 * The victory rules a mode pins — `VictoryConfig` MINUS `endsAt`. `endsAt` is an
 * absolute match timestamp, so it belongs to the match, never to shipped content;
 * `.strict()` turns writing it here into a loud validation error instead of a field
 * zod would silently drop, which would leave a mode that reads as configured and
 * isn't (A08 — validate before use, fail-closed). Every field is optional: an
 * omitted one falls back to the victory module's base rule, which is how a preset
 * says "standard rules here".
 */
export const ModeVictorySchema = z
  .object({
    capitalCapture: z.literal(true).optional(),
    dominationPercent: z.number().gt(0).max(1).optional(),
    scoreLimit: z.number().positive().optional(),
    coalitionFactor: z.number().positive().optional(),
    /** `VictoryConfig.scripted`: the scenario, not a race, ends the match. */
    scripted: z.literal(true).optional(),
  })
  .strict();

export const ScoringRulesSchema = z
  .object({
    buildingDivisor: z.number().int().min(1).default(1),
  })
  .strict();
