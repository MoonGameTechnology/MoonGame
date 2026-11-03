/**
 * Что панель мира предлагает сделать с этим миром (REFM-91).
 *
 * Два предложения — «сделать столицей» и «точка удержания Хранителя» — живут рядом и
 * оба выглядят как «кнопка или метка». Условия у них разные, и в разметке они были
 * вложенными тернарниками, где легко потерять, почему кнопки нет.
 *
 * 1. **Чужой мир не предлагает ничего.** Ни столицы, ни точки удержания: это приказы
 *    владельца, и кнопка обещала бы то, чего ядро не даст.
 * 2. **Столицей можно сделать только ОБИТАЕМЫЙ мир.** В столице возрождается герой — на
 *    пустом камне ему негде появиться, и назначение было бы ловушкой.
 * 3. **Текущая столица кнопки не предлагает** — она уже столица; вместо кнопки метка.
 * 4. **Точки удержания за ТЕХГЕЙТОМ.** Без технологии Хранителя предложения нет вовсе —
 *    не серая кнопка, а пусто: приказа ещё не существует.
 * 5. **Отмеченный мир предлагает СНЯТЬ, а не поставить второй раз.**
 * 6. **Ставить можно, пока точек меньше лимита; СНИМАТЬ — всегда.** Иначе игрок,
 *    исчерпавший лимит, запрётся: ни поставить новую, ни убрать старую.
 */

import { isInhabited, type GameData, type GameState, type Planet } from '../packages/shared-core/src/index';

/** Что показать про столицу. */
export type CapitalOffer =
  /** Это и есть столица — метка. */
  | 'marked'
  /** Можно назначить — кнопка. */
  | 'designate'
  /** Ничего не показывать. */
  | 'none';

/** Что показать про точку удержания. */
export type HoldOffer =
  /** Ничего: чужой мир или нет технологии. */
  | 'none'
  /** Мир уже точка — предложить снять. */
  | 'clear'
  /** Можно поставить. */
  | 'set'
  /** Кнопка есть, но лимит точек исчерпан. */
  | 'set-disabled';

/** Предложение про столицу (правила 1–3). */
export function capitalOffer(mine: boolean, isCapital: boolean, inhabited: boolean, locked = false): CapitalOffer {
  if (!mine) return 'none';
  if (isCapital) return 'marked';
  return inhabited && !locked ? 'designate' : 'none';
}

/** Both clients use the authoritative habitation rule and the published mode lock. */
export function worldCapitalOffer(state: GameState, viewer: string, planet: Planet, data?: GameData): CapitalOffer {
  const locked = !!state.match.capitalObjectives ||
    !!(state.modeId && data?.modes[state.modeId]?.victory.capitalCapture);
  return capitalOffer(planet.owner === viewer, state.capital?.[viewer] === planet.id,
    !!data && isInhabited(data, planet), locked);
}

/** Предложение про точку удержания (правила 1, 4–6). `settable` — можно ли этот узел
 *  ПОСТАВИТЬ точкой (площадку крепости на развилке ядро не принимает, `steward` 1.1.0);
 *  уже записанную точку снять можно всегда — ядро это разрешает, и иначе она занимала бы
 *  лимит до гибели крепости (замечание Codex на #1416). */
export function holdOffer(
  mine: boolean,
  techDone: boolean,
  isPoint: boolean,
  used: number,
  max: number,
  settable = true,
): HoldOffer {
  if (!mine || !techDone) return 'none';
  if (isPoint) return 'clear';
  if (!settable) return 'none';
  return used < max ? 'set' : 'set-disabled';
}
