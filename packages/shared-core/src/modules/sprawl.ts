import type { ResourceBag } from '../data/schemas';
import type { GameModule } from '../kernel/module';
import type { GameState } from '../state/gameState';
import { isForkSite } from '../state/forkSite';
import { recordValues } from '../util/records';

/**
 * BAL-10 · Growth tax («налог на рост державы», owner decision 2026-09-30). The
 * mid-match leader used to win most matches because every province it took made
 * the next one cheaper to take. Past a threshold, each extra province now dims the
 * output of the WHOLE empire, so the bigger a power is, the harder it grows:
 * a player holding `n` provinces produces ×1/(1 + SPRAWL_RATE × max(0, n − SPRAWL_FREE)).
 *
 * The threshold matters: a flat tax on every province (measured, selfplay 200) hurt
 * the trailing player's comeback as much as the leader's lead and widened the gap.
 * Below the threshold nobody pays, so only a sprawling leader feels it.
 *
 * Hooks `economy.production`, so the core economy stays generic. Place it AFTER
 * `taxModule` in the module list: the civic tax is added into the bag there, and
 * this factor must scale it too. Every other production contributor is a pure
 * multiplier, so its position relative to them does not change the number.
 */

/** Provinces a player may hold before the growth tax starts. */
export const SPRAWL_FREE = 35;
/** Share of output lost per province held above {@link SPRAWL_FREE}. */
export const SPRAWL_RATE = 0.1;

/** Output multiplier for a player who holds `n` provinces: 1 up to the threshold,
 *  then 1/(1 + SPRAWL_RATE × excess) — 36 provinces → ×0.91, 45 → ×0.5. */
export function sprawlFactor(n: number): number {
  return 1 / (1 + SPRAWL_RATE * Math.max(0, n - SPRAWL_FREE));
}

/** Provinces (planet-map nodes of every kind) `owner` holds — the `n` fed to
 *  {@link sprawlFactor}. Neutral (`null`) owns nothing. A fortress pad on a road fork
 *  is not a province (`isForkSite`), so building a fortress does not raise the tax. */
export function ownedProvinceCount(state: GameState, owner: string | null): number {
  if (owner === null) return 0;
  let n = 0;
  for (const p of Object.values(state.planets)) if (p.owner === owner && !isForkSite(p)) n += 1;
  return n;
}

/**
 * Провинции каждого владельца за ОДИН шаг ядра. Хук спрашивают на каждый мир начисления, и
 * пересчёт всей карты на каждый мир стоил квадрат числа провинций: на FFA-20 это пятая часть
 * цены шага мира, на 800 провинциях больше. Хук зовёт только цикл начисления экономики, раз
 * за шаг, и внутри него миры хозяев не меняют, поэтому счёт берётся один раз на шаг: ключ —
 * контекст шага `h`, у следующего шага он новый. Число то же, что у {@link ownedProvinceCount}.
 */
const countsOfStep = new WeakMap<object, Map<string, number>>();
function provinceCounts(step: object, state: GameState): Map<string, number> {
  let counts = countsOfStep.get(step);
  if (!counts) {
    counts = new Map();
    for (const p of recordValues(state.planets))
      if (p.owner !== null && !isForkSite(p)) counts.set(p.owner, (counts.get(p.owner) ?? 0) + 1);
    countsOfStep.set(step, counts);
  }
  return counts;
}

export const sprawlModule: GameModule = {
  id: 'sprawl',
  version: '1.0.0',
  setup(api) {
    api.hook<ResourceBag>('economy.production', (bag, args, h) => {
      const planetId = (args as { planetId?: string }).planetId;
      const owner = planetId ? h.state.planets[planetId]?.owner : null;
      if (owner === null || owner === undefined) return bag;
      const m = sprawlFactor(provinceCounts(h, h.state).get(owner) ?? 0);
      if (m === 1) return bag;
      const out: Record<string, number> = {};
      for (const res of Object.keys(bag)) out[res] = (bag[res] ?? 0) * m;
      return out;
    });
  },
};
