import {
  controlApplies,
  isInhabited,
  type GameData,
  type GameState,
  type Planet,
} from '../packages/shared-core/src/index';

/**
 * BAL-19 · Счётчик лимита управления в шапке матча: «⊙ 7/5», планеты и лимит (план пакета
 * «лимит и освоение», пункт 5: «под управлением 5/5» в HUD).
 *
 * Лимит управления виден игроку по следствиям: фишка «Вне управления» в окне мира и строка
 * карточки ресурса. Сколько планет у места и где сейчас лимит, не читалось нигде, а
 * технологии и Наместник поднимают лимит посреди партии. Чип отвечает на оба вопроса.
 *
 * Правила:
 * 1. Планеты считаются так же, как их считает ядро (`isInhabited`, тот же тест, что у модуля
 *    `control`): астероиды, мёртвые миры, туманности, базы и крепости лимит не трогает, и
 *    счётчик их не видит.
 * 2. Чипа нет там, где лимит не действует: в PvE (Sector Zero, волны) и у места без столицы
 *    (`controlApplies`, `controlledPlanets` → null). «0/5» там соврал бы о правиле.
 * 3. Число слева — все планеты места, а не только те, что под управлением: «7/5» сразу
 *    говорит, что две планеты за лимитом, как счётчик населения в стратегиях. Сверх лимита
 *    чип красный, как фишка «Вне управления».
 * 4. Лимит — каким его видит ядро, с технологиями (`controlLimitOf` хоста).
 */
export interface ControlCounterView {
  /** Планеты места, которые считает лимит. */
  planets: number;
  /** Лимит управления места. */
  limit: number;
  /** Планет сверх лимита: дают долю выхода и не строят юниты. */
  over: number;
}

/**
 * Счётчик для места `viewer` или `null`, если лимит его не касается. `planets` — миры
 * `state.planets`, когда они у хоста уже списком (кадр держит его, `worldPlanets`).
 */
export function controlCounter(
  state: GameState,
  data: GameData,
  viewer: string,
  limit: number,
  planets: Iterable<Planet> = Object.values(state.planets),
): ControlCounterView | null {
  if (!controlApplies(state, data, state.modeId)) return null;
  const capital = state.capital?.[viewer];
  if (capital === undefined || !state.planets[capital]) return null;
  let mine = 0;
  for (const p of planets) if (p.owner === viewer && isInhabited(data, p)) mine += 1;
  return { planets: mine, limit, over: Math.max(0, mine - limit) };
}

/** Подсказка по нажатию на чип: ключ локали и числа к нему. `uncontrolledOutput` — доля
 *  выхода планеты за лимитом (`UNCONTROLLED_OUTPUT`). */
export function controlTip(
  view: ControlCounterView,
  uncontrolledOutput: number,
): { key: string; args: Record<string, number> } {
  return {
    key: view.over > 0 ? 'hud.control.tip.over' : 'hud.control.tip',
    args: {
      n: Math.min(view.planets, view.limit),
      limit: view.limit,
      over: view.over,
      p: Math.round(uncontrolledOutput * 100),
    },
  };
}
