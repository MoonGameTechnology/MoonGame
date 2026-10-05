import {
  squadronReach,
  type GameData,
  type GameState,
  type Squadron,
  type StrikeBase,
} from '../packages/shared-core/src/index';
import { relocateTargets, type RelocateTarget, type XY } from './relocateTargets';

/**
 * ПЕРЕЛЁТ К ФРОНТУ (SHU-6.8) — на какую свою базу бот перебазирует ударную эскадру.
 *
 * Удар поднимается с базы, от которой цель в радиусе, а радиус машин 120–260: из тыла до
 * чужих миров он не дотягивается. Раньше эскадра уезжала к фронту только в трюме корабля,
 * вставшего у её порта (`pickHoldFleet`); перелёт (SHU-6.4) везёт её сам, к идущему кораблю
 * тоже. Правила:
 *
 * 1. **Есть по кому бить отсюда — эскадра остаётся.** Цели (`targets`) даёт вызывающий: у
 *    страйкера это чужие миры и флоты, у десантного челнока — миры, которые можно взять.
 *    Граница радиуса включена, как у ядра.
 * 2. **Фронт — чужие миры на войне** (`front`). Нет фронта — перелетать незачем.
 * 3. **Куда — только туда, что примет ядро** (`relocateTargets`): своя база обеих форм, мир
 *    с портом или корабль с трюмом, в дальности перелёта; корабль — если эскадра влезает
 *    целиком.
 * 4. **Лучшая база — ближайшая к фронту**, при равенстве — порядок `relocateTargets` (ближе
 *    к эскадре, мир раньше корабля, дальше по id).
 * 5. **Шаг к фронту — не меньше половины радиуса удара** (`FRONT_STEP`). Перелёт тратит
 *    вылет базы: ради нескольких единиц пути он не окупается, а две почти равные базы
 *    качали бы эскадру туда-обратно.
 */

/** Минимальный шаг к фронту — доля радиуса удара эскадры (правило 5). */
export const FRONT_STEP = 0.5;

const dist = (a: XY, b: XY): number => Math.hypot(a.x - b.x, a.y - b.y);

/** Своя база ближе к фронту, куда эскадре стоит перелететь, или `null` — пусть стоит. */
export function frontRebase(
  state: GameState,
  opts: {
    me: string;
    from: StrikeBase;
    squadron: Pick<Squadron, 'units'>;
    data: GameData;
    /** Где база сейчас — та же функция, что у `relocateTargets`. */
    pos: (base: StrikeBase) => XY | null;
    /** Куда эскадра может ударить (правило 1). */
    targets: readonly XY[];
    /** Чужие миры на войне (правило 2). */
    front: readonly XY[];
  },
): RelocateTarget | null {
  const { targets, front } = opts;
  const reach = squadronReach(opts.squadron, opts.data);
  const here = opts.pos(opts.from);
  if (!(reach > 0) || !here || front.length === 0) return null;
  if (targets.some((t) => dist(here, t) <= reach)) return null; // правило 1
  const gap = (at: XY): number => front.reduce((m, f) => Math.min(m, dist(at, f)), Infinity);
  let best: RelocateTarget | null = null;
  let bestGap = Infinity;
  for (const c of relocateTargets(state, opts)) {
    const g = gap(c.at);
    if (g < bestGap) {
      best = c;
      bestGap = g;
    }
  }
  return best && bestGap <= gap(here) - FRONT_STEP * reach ? best : null; // правила 4–5
}
