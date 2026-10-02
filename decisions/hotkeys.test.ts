import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  HOTKEYS,
  HOTKEY_SILENT_LAYERS,
  capOf,
  cycledFleets,
  homeTarget,
  hotkeyOf,
  hotkeyStep,
  nextFleet,
  type HotkeyScene,
  type KeyPress,
} from './hotkeys';

const press = (code: string, over: Partial<KeyPress> = {}): KeyPress => ({
  code,
  ctrl: false,
  alt: false,
  meta: false,
  shift: false,
  repeat: false,
  ...over,
});
const scene = (over: Partial<HotkeyScene> = {}): HotkeyScene => ({
  pc: true,
  inMatch: true,
  typing: false,
  silentLayer: false,
  keyboardFocus: false,
  timeShown: true,
  ...over,
});
/** Что сделает клавиша: имя действия, `pass` или `swallow`. */
const does = (p: KeyPress, sc: HotkeyScene = scene()): string => {
  const step = hotkeyStep(p, sc);
  return step.do === 'act' ? step.hotkey.action : step.do;
};

describe('hotkeys — горячие клавиши ПК (UIX-9.1)', () => {
  it('клавиша — место на клавиатуре: T, B, L, M, F1, H и Home, Tab, пробел, 1–4', () => {
    expect(does(press('KeyT'))).toBe('tech');
    expect(does(press('KeyB'))).toBe('production');
    expect(does(press('KeyL'))).toBe('events');
    expect(does(press('KeyM'))).toBe('messages');
    expect(does(press('F1'))).toBe('help');
    expect(does(press('KeyH'))).toBe('home');
    expect(does(press('Home'))).toBe('home');
    expect(does(press('Tab'))).toBe('next-fleet');
    expect(does(press('Space'))).toBe('pause');
    expect(does(press('Digit3'))).toBe('speed');
    expect(does(press('KeyQ'))).toBe('pass');
    expect(does(press('Escape'))).toBe('pass');
  });

  it('1–4 и цифры цифрового блока — номер кнопки скорости', () => {
    const slot = (code: string): number | null => {
      const step = hotkeyStep(press(code), scene());
      return step.do === 'act' ? step.slot : null;
    };
    expect(['Digit1', 'Digit2', 'Digit3', 'Digit4'].map(slot)).toEqual([0, 1, 2, 3]);
    expect(['Numpad1', 'Numpad4'].map(slot)).toEqual([0, 3]);
    expect(slot('Digit5')).toBeNull();
    expect(slot('KeyT')).toBe(0);
  });

  it('только ПК и только в партии', () => {
    expect(does(press('KeyT'), scene({ pc: false }))).toBe('pass');
    expect(does(press('KeyT'), scene({ inMatch: false }))).toBe('pass');
  });

  it('в поле ввода и в чате клавиш нет', () => {
    for (const code of ['KeyT', 'Space', 'Tab', 'Digit1', 'KeyH'])
      expect(does(press(code), scene({ typing: true }))).toBe('pass');
  });

  it('с Ctrl, Alt или ⌘ клавиш нет — это сочетания браузера', () => {
    expect(does(press('KeyT', { ctrl: true }))).toBe('pass');
    expect(does(press('KeyT', { alt: true }))).toBe('pass');
    expect(does(press('KeyT', { meta: true }))).toBe('pass');
    expect(does(press('KeyT', { shift: true }))).toBe('tech');
  });

  it('над слоем выше окон клавиши молчат', () => {
    for (const code of ['KeyT', 'Space', 'Tab', 'Digit1', 'Home'])
      expect(does(press(code), scene({ silentLayer: true }))).toBe('pass');
  });

  it('пробел и Tab уступают навигации с клавиатуры, буквы — нет; Shift+Tab всегда у браузера', () => {
    const keyboard = scene({ keyboardFocus: true });
    expect(does(press('Space'), keyboard)).toBe('pass');
    expect(does(press('Tab'), keyboard)).toBe('pass');
    expect(does(press('KeyT'), keyboard)).toBe('tech');
    expect(does(press('Digit2'), keyboard)).toBe('speed');
    expect(does(press('Tab', { shift: true }))).toBe('pass');
  });

  it('пробел и 1–4 — только при видимом управлении временем', () => {
    const noTime = scene({ timeShown: false });
    expect(does(press('Space'), noTime)).toBe('pass');
    expect(does(press('Digit1'), noTime)).toBe('pass');
    expect(does(press('KeyT'), noTime)).toBe('tech');
    expect(does(press('Tab'), noTime)).toBe('next-fleet');
  });

  it('зажатая клавиша срабатывает один раз: повтор глотается, чужой повтор — браузеру', () => {
    expect(does(press('Space', { repeat: true }))).toBe('swallow');
    expect(does(press('Tab', { repeat: true }))).toBe('swallow');
    expect(does(press('KeyT', { repeat: true }))).toBe('swallow');
    expect(does(press('Space', { repeat: true }), scene({ keyboardFocus: true }))).toBe('pass');
    expect(does(press('KeyQ', { repeat: true }))).toBe('pass');
  });

  it('каждое место клавиши — у одной клавиши', () => {
    const codes = HOTKEYS.flatMap((k) => k.codes);
    expect(new Set(codes).size).toBe(codes.length);
    for (const code of codes) expect(hotkeyOf(code)).toBeDefined();
  });

  it('надпись клавиши: буква, цифра, имя; пробел — словом локали', () => {
    expect(['KeyT', 'Digit1', 'Numpad4', 'F1', 'Home', 'Tab'].map((c) => capOf(c, '·'))).toEqual([
      'T',
      '1',
      '4',
      'F1',
      'Home',
      'Tab',
    ]);
    expect(capOf('Space', 'Пробел')).toBe('Пробел');
  });

  it('Tab перебирает свои живые флоты, способные двигаться, с числами по значению', () => {
    const immobile = (unit: string): boolean => unit === 'gun' || unit === 'mine';
    const fleets = [
      { id: 'fleet:10', owner: 'p1', units: [{ unit: 'frigate', count: 2 }] },
      { id: 'fleet:2', owner: 'p1', units: [{ unit: 'frigate', count: 1 }] },
      { id: 'fleet:3', owner: 'p2', units: [{ unit: 'frigate', count: 1 }] }, // чужой
      { id: 'fleet:4', owner: 'p1', units: [{ unit: 'gun', count: 3 }] }, // орудия крепости
      { id: 'fleet:5', owner: 'p1', units: [{ unit: 'mine', count: 1 }] }, // мина
      { id: 'fleet:6', owner: 'p1', units: [{ unit: 'frigate', count: 0 }] }, // пустой
      // Неподвижный юнит без живых — не держит флот на месте.
      { id: 'fleet:7', owner: 'p1', units: [{ unit: 'frigate', count: 1 }, { unit: 'gun', count: 0 }] },
      { id: 'fleet:8', owner: 'p1', units: [{ unit: 'frigate', count: 1 }, { unit: 'gun', count: 1 }] },
    ];
    expect(cycledFleets(fleets, 'p1', immobile)).toEqual(['fleet:2', 'fleet:7', 'fleet:10']);
  });

  it('следующий флот — по кругу от выбранного; выбран чужой или никакой — первый', () => {
    const order = ['a', 'b', 'c'];
    expect(nextFleet(order, null)).toBe('a');
    expect(nextFleet(order, 'a')).toBe('b');
    expect(nextFleet(order, 'c')).toBe('a');
    expect(nextFleet(order, 'enemy')).toBe('a');
    expect(nextFleet(['a'], 'a')).toBe('a');
    expect(nextFleet([], 'a')).toBeNull();
  });

  it('«к столице» — к своей столице; потерянная или незаданная — к дому стартового вида', () => {
    const owner = (id: string): string | null => ({ cap: 'p1', lost: 'p2' })[id] ?? null;
    expect(homeTarget('cap', owner, 'p1', 'home')).toBe('cap');
    expect(homeTarget('lost', owner, 'p1', 'home')).toBe('home');
    expect(homeTarget(undefined, owner, 'p1', 'home')).toBe('home');
    expect(homeTarget('lost', owner, 'p1', null)).toBeNull();
  });

  it('молчащие слои — ступени лестницы «Назад» выше окон, все и в её порядке', () => {
    // Лестница идёт сверху вниз; первая ступень окон — меню меток (z47).
    const main = readFileSync(new URL('../prototype/src/main.ts', import.meta.url), 'utf8');
    const ladder = main.slice(main.indexOf('const BACK_LAYERS: BackLayer[] = ['));
    const ids = [...ladder.slice(0, ladder.indexOf('\n];')).matchAll(/\{\s*id: '([\w-]+)'/g)].map((m) => m[1]);
    expect(ids.length).toBeGreaterThan(HOTKEY_SILENT_LAYERS.length);
    expect(HOTKEY_SILENT_LAYERS).toEqual(ids.slice(0, ids.indexOf('pingmenu')));
  });
});
