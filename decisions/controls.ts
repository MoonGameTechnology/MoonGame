/**
 * Раздел «Управление» в настройках (UX-KEYS-1): какие жесты и клавиши есть в игре.
 *
 * Таблица — данные, а не разметка: сторож (`controls.test.ts`) сверяет каждую строку с тем,
 * что игра делает на самом деле (`pressIntent` и обработчики прототипа). Описание, которое
 * никто не сверяет, расходится с игрой молча — урок BRWH-2.
 *
 * Буквенных горячих клавиш в игре НЕТ — таблица их не обещает.
 */

/** Где работает строка: мышь и клавиатура ПК или палец телефона. */
export type ControlDevice = 'pc' | 'touch';

export interface ControlRow {
  id: string;
  device: ControlDevice;
  /** Ключ локали: что нажать («Shift + перетаскивание»). */
  keys: string;
  /** Ключ локали: что произойдёт. */
  does: string;
}

/** Порядок — от самого частого действия к редкому. Ключи — литералы: их видит сторож локали. */
export const CONTROLS: readonly ControlRow[] = [
  { id: 'drag', device: 'pc', keys: 'controls.drag.keys', does: 'controls.drag.does' },
  { id: 'wheel', device: 'pc', keys: 'controls.wheel.keys', does: 'controls.wheel.does' },
  { id: 'dblclick', device: 'pc', keys: 'controls.dblclick.keys', does: 'controls.dblclick.does' },
  { id: 'box', device: 'pc', keys: 'controls.box.keys', does: 'controls.box.does' },
  { id: 'add', device: 'pc', keys: 'controls.add.keys', does: 'controls.add.does' },
  {
    id: 'quick-build',
    device: 'pc',
    keys: 'controls.quick-build.keys',
    does: 'controls.quick-build.does',
  },
  { id: 'back', device: 'pc', keys: 'controls.back.keys', does: 'controls.back.does' },
  {
    id: 'panel-move',
    device: 'pc',
    keys: 'controls.panel-move.keys',
    does: 'controls.panel-move.does',
  },
  {
    id: 'touch-drag',
    device: 'touch',
    keys: 'controls.touch-drag.keys',
    does: 'controls.drag.does',
  },
  { id: 'pinch', device: 'touch', keys: 'controls.pinch.keys', does: 'controls.pinch.does' },
  {
    id: 'double-tap',
    device: 'touch',
    keys: 'controls.double-tap.keys',
    does: 'controls.dblclick.does',
  },
  {
    id: 'long-press',
    device: 'touch',
    keys: 'controls.long-press.keys',
    does: 'controls.long-press.does',
  },
];

/** Строки для устройства игрока: на телефоне — только жесты, на ПК — всё. */
export function controlsFor(touchOnly: boolean): ControlRow[] {
  return CONTROLS.filter((row) => !touchOnly || row.device === 'touch');
}
