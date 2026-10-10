/**
 * Жесты карты на первом шаге обучения (UIX-8.1): что показать анимацией вместо абзаца.
 *
 * Шаг «как управлять картой» описывал четыре жеста абзацем в семь строк — игрок читал
 * инструкцию к жесту, которую быстрее один раз увидеть. Теперь у шага одна строка, а под
 * ней плитки: анимация жеста, его имя и что он делает. Рисует плитки хозяин экрана; здесь —
 * какие плитки и в каком порядке.
 *
 * 1. **Набор — под устройство, а не под язык или сборку.** Колесо на телефоне так же
 *    бесполезно, как щипок на ПК. Что считать мышью, решает хозяин (в прототипе — `pcUi()`:
 *    широкий экран, точный указатель и наведение).
 * 2. **Четыре дела, один порядок на обоих устройствах:** масштаб, сдвиг, общий вид,
 *    несколько флотов. Плитка «масштаб» стоит первой и у колеса, и у щипка: сменив
 *    устройство, игрок видит ту же раскладку дел, поменялись только жесты.
 * 3. **Плитка показывает, что делает жест, а не только какой он.** Имя жеста без дела
 *    («Удержание») ничего не обещает, дело без жеста («несколько флотов») не говорит, как.
 * 4. **Жесты — те, что карта действительно понимает:** щипок (`dragIntent.ts`) и колесо
 *    масштабируют, двойной тап и двойной клик возвращают общий вид, удержание пальцем и
 *    Shift собирают флоты (`pressIntent.ts`, правила 1–4). Ctrl-клик добирает флот тоже, но
 *    плитка одна на дело — Shift делает и добор, и рамку, поэтому показан он.
 */

/** Что делает жест на карте. Порядок — правило 2. */
export type MapDeed = 'zoom' | 'pan' | 'overview' | 'group';

/** Какую анимацию рисовать. Имена — классы плиток у хозяина экрана. */
export type GestureAnim =
  | 'pinch'
  | 'swipe'
  | 'double-tap'
  | 'hold'
  | 'wheel'
  | 'drag'
  | 'double-click'
  | 'shift-box';

export interface MapGesture {
  deed: MapDeed;
  anim: GestureAnim;
  /** Ключ локали: имя жеста («Щипок»). */
  name: string;
  /** Ключ локали: что он делает («масштаб»). */
  does: string;
}

/** Дела по порядку плиток (правило 2). */
export const MAP_DEEDS: readonly MapDeed[] = ['zoom', 'pan', 'overview', 'group'];

const DOES: Record<MapDeed, string> = {
  zoom: 'onb.gesture.does.zoom',
  pan: 'onb.gesture.does.pan',
  overview: 'onb.gesture.does.overview',
  group: 'onb.gesture.does.group',
};

const TOUCH: Record<MapDeed, [GestureAnim, string]> = {
  zoom: ['pinch', 'onb.gesture.pinch'],
  pan: ['swipe', 'onb.gesture.swipe'],
  overview: ['double-tap', 'onb.gesture.double-tap'],
  group: ['hold', 'onb.gesture.hold'],
};

const MOUSE: Record<MapDeed, [GestureAnim, string]> = {
  zoom: ['wheel', 'onb.gesture.wheel'],
  pan: ['drag', 'onb.gesture.drag'],
  overview: ['double-click', 'onb.gesture.double-click'],
  group: ['shift-box', 'onb.gesture.shift-box'],
};

/** Плитки жестов для устройства (правило 1), по одной на дело в порядке `MAP_DEEDS`. */
export function mapGestures(mouse: boolean): readonly MapGesture[] {
  const set = mouse ? MOUSE : TOUCH;
  return MAP_DEEDS.map((deed) => {
    const [anim, name] = set[deed];
    return { deed, anim, name, does: DOES[deed] };
  });
}
