/**
 * Раздел «Управление» в настройках (UX-KEYS-1): какие жесты и клавиши есть в игре.
 *
 * Таблица — данные, а не разметка: сторож (`controls.test.ts`) сверяет каждую строку с тем,
 * что игра делает на самом деле (`pressIntent` и обработчики прототипа). Описание, которое
 * никто не сверяет, расходится с игрой молча — урок BRWH-2.
 *
 * Горячие клавиши ПК (UIX-9.1) — строки `key-*`: что каждая делает и когда молчит, решает
 * `hotkeys.ts`, а сторож требует, чтобы у строки была клавиша в его таблице.
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
  /** Строка про кнопки скорости ×1…×7200: их у ПК нет без дев-управления временем, и
   *  тогда нет и строки. */
  speedChips?: true;
}

/** Порядок — от самого частого действия к редкому. Ключи — литералы: их видит сторож локали. */
export const CONTROLS: readonly ControlRow[] = [
  { id: 'drag', device: 'pc', keys: 'controls.drag.keys', does: 'controls.drag.does' },
  { id: 'wheel', device: 'pc', keys: 'controls.wheel.keys', does: 'controls.wheel.does' },
  { id: 'dblclick', device: 'pc', keys: 'controls.dblclick.keys', does: 'controls.dblclick.does' },
  { id: 'box', device: 'pc', keys: 'controls.box.keys', does: 'controls.box.does' },
  { id: 'add', device: 'pc', keys: 'controls.add.keys', does: 'controls.add.does' },
  { id: 'key-pause', device: 'pc', keys: 'key.space', does: 'controls.key-pause.does' },
  {
    id: 'key-speed',
    device: 'pc',
    keys: 'controls.key-speed.keys',
    does: 'controls.key-speed.does',
    speedChips: true,
  },
  {
    id: 'key-next-fleet',
    device: 'pc',
    keys: 'controls.key-next-fleet.keys',
    does: 'controls.key-next-fleet.does',
  },
  { id: 'key-home', device: 'pc', keys: 'controls.key-home.keys', does: 'controls.key-home.does' },
  { id: 'key-tech', device: 'pc', keys: 'controls.key-tech.keys', does: 'controls.key-tech.does' },
  {
    id: 'key-production',
    device: 'pc',
    keys: 'controls.key-production.keys',
    does: 'controls.key-production.does',
  },
  {
    id: 'key-events',
    device: 'pc',
    keys: 'controls.key-events.keys',
    does: 'controls.key-events.does',
  },
  {
    id: 'key-messages',
    device: 'pc',
    keys: 'controls.key-messages.keys',
    does: 'controls.key-messages.does',
  },
  { id: 'key-help', device: 'pc', keys: 'controls.key-help.keys', does: 'controls.key-help.does' },
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

/** Строки для устройства игрока: на телефоне — только жесты, на ПК — всё, а строка клавиш
 *  скорости — только когда у ПК есть кнопки скорости (`speedChips`). */
export function controlsFor(touchOnly: boolean, speedChips = false): ControlRow[] {
  return CONTROLS.filter(
    (row) => (!touchOnly || row.device === 'touch') && (!row.speedChips || speedChips),
  );
}
