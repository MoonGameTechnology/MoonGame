/**
 * КРЕПОСТЬ НА РАЗВИЛКЕ В ЖИВОЙ ПАРТИИ ПРОТОТИПА (FORT-6.1).
 *
 * Правила крепости стережёт ядро (`data/forkFortress.test.ts`). Здесь — то, что может
 * отвалиться только у хоста: площадка крепости — узел состояния, но НЕ провинция, и каждое
 * место прототипа, где мир значит «провинция», обязано её пропустить. Иначе она стала бы
 * клеткой мозаики, целью бота или лишней единицей в счёте, и разошлась бы с ядром молча.
 */
import { describe, expect, it } from 'vitest';
import { advance, data, DAY, newGame, order, scoreParts, START_CANDIDATES } from './game';
import type { SetupConfig } from './game';
import { mapNodesFromState } from './mapCatalog';
import { aiOrders } from './ai';
import { forkMarks } from '../../decisions/roadNetwork';
import { deployForkFortress } from '../../decisions/actions';
import {
  forkSiteId,
  STATION_CORE,
  technologiesUnlocking,
  type GameState,
} from '../../packages/shared-core/src/index';

const duel: SetupConfig = {
  seats: [
    { id: 'p1', name: 'A', faction: 'azure', start: START_CANDIDATES[0]!, ai: false },
    { id: 'p2', name: 'B', faction: 'crimson', start: START_CANDIDATES[1]!, ai: true },
  ],
};

/** Партия, где у p1 стоит крепость на развилке своей провинции. */
function withForkFortress(): { state: GameState; site: string } {
  const start = newGame(duel);
  // Развилка в провинции p1; своей развилки у дома может не быть — тогда отдаём p1 любую
  // провинцию с развилкой: правило «провинция твоя» от этого не меняется.
  const marks = forkMarks(start.planets);
  const mark = marks.find((m) => start.planets[m.province]?.owner === 'p1') ?? marks[0];
  if (!mark) throw new Error('на карте нет ни одной развилки');
  const p1 = start.players.p1!;
  const state: GameState = {
    ...start,
    planets: { ...start.planets, [mark.province]: { ...start.planets[mark.province]!, owner: 'p1' } },
    players: {
      ...start.players,
      p1: {
        ...p1,
        resources: { ...p1.resources, metal: 9000 },
        technologies: {
          ...p1.technologies,
          completed: [...(p1.technologies?.completed ?? []), ...technologiesUnlocking(data, 'building', STATION_CORE)],
        } as NonNullable<typeof p1.technologies>,
      },
    },
  };
  const r = order(state, deployForkFortress('p1', mark.province, mark.trail), state.time);
  if (r.error) throw new Error(`отказ ${r.error}`);
  const site = forkSiteId(mark.province, mark.trail);
  if (!r.state.planets[site]) throw new Error('крепость не встала');
  return { state: r.state, site };
}

describe('крепость на развилке в прототипе — не провинция', () => {
  it('в узлах карты её нет: ни клетки мозаики, ни подписи провинции', () => {
    const { state, site } = withForkFortress();
    const nodes = mapNodesFromState(state);
    expect(nodes.some((n) => n.id === site)).toBe(false);
    expect(nodes).toHaveLength(Object.keys(state.planets).length - 1);
  });

  it('разбор счёта сходится с ядром и с площадкой на карте', () => {
    const { state } = withForkFortress();
    const s = advance(state, state.time + DAY).state; // ядро пересчитало счёт на отрезке
    const parts = scoreParts(s, data);
    for (const seat of ['p1', 'p2'] as const) {
      expect([seat, parts[seat]!.total]).toEqual([seat, s.match.scores?.[seat]?.total ?? 0]);
      expect(parts[seat]!.planets).toBe(s.match.scores?.[seat]?.controlledPlanets ?? 0);
    }
  });

  it('бот не видит площадку ни целью, ни базой', () => {
    const { state, site } = withForkFortress();
    const orders = [...aiOrders(state, 'p2'), ...aiOrders(state, 'p1')];
    expect(JSON.stringify(orders)).not.toContain(site);
  });
});
