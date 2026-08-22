import type { GameData } from '../data/schemas';
import type { MatchConfig } from './types';

/**
 * Turning a match's `modeId` into concrete rules — the ONE place a game mode
 * (docs/pve-team-modes-roadmap.md PVE-0.2) stops being a name and becomes the
 * `MatchConfig` the reducer reads.
 *
 * Two properties this file exists to guarantee:
 *
 * 1. **Consumed once, at birth.** The caller resolves before the room is built, and
 *    `MatchRoom` keeps the result in a private `readonly` field — so "the mode is
 *    pinned at start and cannot be swapped mid-match" (GDD §2) is enforced by there
 *    being nothing to swap, not by a guard someone can forget to call.
 * 2. **An unknown mode is a REFUSAL, never a silent fallback.** A match that believes
 *    it is running PvE waves while the engine quietly applies the base rules is the
 *    same failure MP-4 refuses for a swapped content bundle: the rules changed under
 *    the match. Fail-secure (A10) — a stable code, no detail (`E_UNKNOWN_MODE`).
 *
 * A match WITHOUT `modeId` passes through untouched: every session created before this
 * brick has no mode, and resolving must not rewrite the rules of a running world.
 */

/** Fail-secure result: the resolved config, or a stable code and nothing else. */
export type ModeResolution =
  | { ok: true; config: MatchConfig }
  | { ok: false; code: 'E_UNKNOWN_MODE' };

/**
 * Resolve `config.modeId` against `data.modes`, layering the mode's victory preset
 * UNDER the match's own `victory`: the preset is the mode's baseline, an explicit
 * per-match rule overrides it field by field. Fields neither one sets fall through to
 * the victory module's base rules, exactly as they do today.
 *
 * Never mutates its input — the returned config is a fresh object (invariant #2).
 */
export function resolveMatchConfig(data: GameData, config: MatchConfig): ModeResolution {
  const modeId = config.modeId;
  if (modeId === undefined) {
    return { ok: true, config };
  }
  const mode = data.modes[modeId];
  if (!mode) {
    return { ok: false, code: 'E_UNKNOWN_MODE' };
  }
  return {
    ok: true,
    config: { ...config, victory: { ...mode.victory, ...config.victory } },
  };
}
