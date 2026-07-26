/**
 * ECON-1 голодная армия — food in the owner's `arrears` (the economy module's
 * unpaid-bill marker) scales their GROUND damage by `HUNGER_MULT`. Ships run on
 * credits, not rations — the orbital phase is untouched. Extracted from `game.ts`
 * (REFP-9): a single `combat.damage` hook, no other game.ts deps. `game.ts` imports
 * `hungerModule` for `MODULES` and re-exports `HUNGER_MULT` for `main.ts` / tests.
 */
import type { GameModule } from '../../packages/shared-core/src/index';

export const HUNGER_MULT = 0.75;
export const hungerModule: GameModule = {
  id: 'hunger',
  version: '0.1.0',
  setup(api) {
    api.hook<number>('combat.damage', (damage, args, h) => {
      const a = args as { phase?: string; attacker?: string | null };
      if (a.phase !== 'ground' || typeof a.attacker !== 'string') return damage;
      const striker = h.state.players[a.attacker];
      return striker?.arrears?.includes('food') ? damage * HUNGER_MULT : damage;
    });
  },
};