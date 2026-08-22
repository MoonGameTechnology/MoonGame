/**
 * С каким запасом крыло встаёт на дежурство и что от него остаётся, когда его снимают
 * (REFM-171).
 *
 * Кому дежурство вообще положено и почему отказ — `stanceToggle.ts` (REFM-98); как оно
 * летает и по кому бьёт — `patrol.ts`. Здесь одна вещь, которая до сих пор стояла прямо в
 * кадре: БУХГАЛТЕРИЯ вылета через выключение.
 *
 * 1. **Никогда не летавшее крыло встаёт с полным баком.** Это первый вылет, а не
 *    продолжение — ему нечего продолжать.
 * 2. **Снятое с дежурства крыло ЗАПОМИНАЕТ свой вылет, и повторная постановка его
 *    ПРОДОЛЖАЕТ** (BF-26). Иначе «выключить и включить» было бы бесплатной дозаправкой:
 *    игрок обходил бы и топливо, и перезарядку одним двойным нажатием, а дежурство
 *    перестало бы что-либо стоить.
 * 3. **Запомненное зажимается нынешней спецификацией крыла.** Состав меняется, пока
 *    дежурство снято: часть эскадрилий погибла, встали другие — и старое число топлива
 *    или раундов может оказаться больше нынешнего предела. Зажим только СВЕРХУ: усиление
 *    крыла поднимает потолок, но не подливает топлива в уже начатый вылет — иначе
 *    правило 2 обходилось бы не двойным нажатием, а прокачкой.
 * 4. **Запомненное тратится ровно один раз.** Взяв остаток, память по этому крылу
 *    очищают: тот же надкушенный бак нельзя предъявить второй раз.
 * 5. **Дежурство держит центр и радиус того мига, когда его включили.** Крыло стережёт
 *    место, а не само себя: место в приказе и есть то, за что игрок его поставил.
 */
import type { SortieState } from '../../packages/shared-core/src/index';
import type { Patrol } from './patrol';

/** Предел крыла: сколько топлива влезает и насколько длинна перезарядка. */
export interface SortieLimits {
  maxFuel: number;
  rearmRounds: number;
}

/** Что отложить, снимая дежурство: `null` — откладывать нечего (правило 2). */
export function stashOnStandDown(patrol: Patrol | undefined): SortieState | null {
  return patrol ? patrol.sortie : null;
}

/** С каким вылетом крыло встаёт: продолжение или полный бак (правила 1–3). */
export function resumeSortie(
  stashed: SortieState | undefined,
  limits: SortieLimits,
  fresh: (maxFuel: number) => SortieState,
): SortieState {
  if (!stashed) return fresh(limits.maxFuel);
  return {
    fuel: Math.min(stashed.fuel, limits.maxFuel),
    rearming: Math.min(stashed.rearming, limits.rearmRounds),
  };
}

/** Дежурство целиком: место, радиус и вылет (правила 1–3, 5). */
export function standingPatrol(
  center: { x: number; y: number },
  radius: number,
  stashed: SortieState | undefined,
  limits: SortieLimits,
  fresh: (maxFuel: number) => SortieState,
): Patrol {
  return {
    center: { x: center.x, y: center.y },
    radius,
    sortie: resumeSortie(stashed, limits, fresh),
  };
}
