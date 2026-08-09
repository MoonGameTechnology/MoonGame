/**
 * Кто забирает тап по карте и с каким радиусом попадания (REFM-64).
 *
 * На один тап претендуют режим планирования, пять вооружённых приказов, режим набора
 * группы и обычное выделение. Порядок между ними — не вкусовщина, а поведение игры.
 *
 * 1. **Режим «Приказ» стоит ПЕРВЫМ и глушит всё.** Пока он жив, карта — рабочая
 *    поверхность плана: тап это всегда точка плана, а не выделение и не приказ. Пропусти
 *    его вперёд кого-нибудь — и построение плана будет рассыпаться от случайного тапа.
 * 2. **Вооружённый приказ забирает тап у выделения.** Игрок уже прицелился; отдай тап
 *    выделению — и вместо приказа он молча сменит выбранный объект, а приказ пропадёт.
 * 3. **Обычное выделение — ПОСЛЕДНИЙ вариант, а не первый.** Стой оно раньше, ни один
 *    вооружённый режим не сработал бы ни разу.
 * 4. **Набор группы уступает вооружённому ходу.** «Выбрать+» держит карту как
 *    поверхность набора, но если ход уже вооружён, игрок целится — и приказ важнее.
 *
 * Радиусы попадания шире у пальца (правило цели в 44 px): на телефоне в скоплении
 * объектов иначе не попасть. Метка меньше узла специально — она висит НАД узлом, и
 * равный радиус позволил бы ей воровать тапы по самому миру.
 */

/** Кто обслуживает этот тап. */
export type TapOwner =
  | 'chain-plan' // режим «Приказ»
  | 'merge' // слияние флотов
  | 'barrage' // наводка залпа
  | 'cast' // применение способности героя
  | 'deploy' // высадка героя
  | 'assault' // штурм с ПК
  | 'pick-group' // набор группы «Выбрать+»
  | 'move' // вооружённый ход
  | 'squadron-strike' // удар эскадрильи (свободный полёт к цели)
  | 'select'; // обычное выделение

/** Какие режимы сейчас включены. */
export interface TapModes {
  chainMode: boolean;
  merging: boolean;
  barrageAim: boolean;
  heroAim: boolean;
  heroSpawnAim: boolean;
  assaultAim: boolean;
  pickMode: boolean;
  /** Вооружён ход («Курс»). */
  aiming: boolean;
  /** Вооружён удар эскадрильи (squadron.strike). */
  squadronStrikeAim: boolean;
}

/** Решить, кто забирает тап. Порядок ветвей — и есть правила 1–4. */
export function tapOwner(m: TapModes): TapOwner {
  if (m.chainMode) return 'chain-plan'; // правило 1
  if (m.merging) return 'merge';
  if (m.barrageAim) return 'barrage';
  if (m.heroAim) return 'cast';
  if (m.heroSpawnAim) return 'deploy';
  if (m.assaultAim) return 'assault';
  if (m.squadronStrikeAim) return 'squadron-strike';
  if (m.pickMode && !m.aiming) return 'pick-group'; // правило 4
  if (m.aiming) return 'move'; // правило 2
  return 'select'; // правило 3
}

/** Что именно ищем под пальцем. */
export type TapTarget = 'fleet' | 'ping' | 'node';

/** Радиусы попадания: [мышь, палец]. Палец шире — правило цели в 44 px. */
export const TAP_RADIUS: Record<TapTarget, readonly [number, number]> = {
  fleet: [16, 24],
  ping: [12, 18], // меньше узла: метка висит НАД ним и не должна воровать его тапы
  node: [24, 30],
};

/** Радиус попадания для цели и вида ввода. */
export function tapRadius(target: TapTarget, touch: boolean): number {
  const [mouse, finger] = TAP_RADIUS[target];
  return touch ? finger : mouse;
}
