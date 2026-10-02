import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { CONTROLS, controlsFor } from './controls';
import { HOTKEYS, hotkeyOf, type HotkeyAction } from './hotkeys';
import { longPressAction, pressIntent, type PressInput } from './pressIntent';

const src = (path: string): string => readFileSync(new URL(path, import.meta.url), 'utf8');
const main = src('../prototype/src/main.ts');
const build = src('../prototype/build.mjs');
const hotkeys = src('../prototype/src/pcHotkeys.ts');
const press = (over: Partial<PressInput>): PressInput => ({
  touch: false,
  shift: false,
  ctrl: false,
  meta: false,
  overOwnFleet: false,
  orderArmed: false,
  ...over,
});

/** Клавиша строки (UIX-9.1): у неё есть места в таблице `hotkeys.ts`, игра заводит
 *  клавиши, а кнопка, которую клавиша жмёт, есть в разметке. */
const key = (id: string, action: HotkeyAction, codes: string[], button?: string): void => {
  expect(HOTKEYS.find((k) => k.id === id)?.action).toBe(action);
  for (const code of codes) expect(hotkeyOf(code)?.id).toBe(id);
  expect(main).toContain('initPcHotkeys({');
  if (button) {
    expect(hotkeys).toContain(`${action}: ['${button}'`);
    expect(build).toContain(`id="${button}"`);
  }
};

/** Чем в игре подтверждается каждая строка таблицы. Нет проверки — строке не место в разделе. */
const PROOF: Record<string, () => void> = {
  drag: () => expect(main).toContain('drag-pan'),
  'touch-drag': () => expect(main).toContain('drag-pan'),
  wheel: () => expect(main).toMatch(/'wheel',/),
  dblclick: () =>
    expect(main).toContain("canvas.addEventListener('dblclick', () => defaultView())"),
  'double-tap': () =>
    expect(main).toContain("canvas.addEventListener('dblclick', () => defaultView())"),
  pinch: () => expect(main).toContain('camPinchAt'),
  box: () => {
    expect(pressIntent(press({ shift: true })).boxSelect).toBe(true);
    // Над своим флотом Shift — добор, а не рамка: таблица обещает рамку с ПУСТОГО места.
    expect(pressIntent(press({ shift: true, overOwnFleet: true })).boxSelect).toBe(false);
  },
  add: () => {
    for (const key of ['ctrl', 'shift', 'meta'] as const)
      expect(pressIntent(press({ [key]: true, overOwnFleet: true })).additive).toBe(true);
  },
  'quick-build': () => {
    expect(main).toContain("side.addEventListener('contextmenu'");
    expect(main).toContain("closest('[data-buildorder]')");
  },
  back: () => expect(src('../prototype/src/backGesture.ts')).toContain("key === 'Escape'"),
  'panel-move': () => {
    const windows = src('../prototype/src/floatingWindows.ts');
    expect(windows).toContain('ArrowLeft');
    expect(windows).toContain('e.shiftKey ? 30 : 10');
  },
  'key-pause': () => {
    key('key-pause', 'pause', ['Space']);
    expect(hotkeys).toContain("byId('spd-pause')");
    expect(build).toContain('id="spd-pause"');
  },
  'key-speed': () => {
    key('key-speed', 'speed', ['Digit1', 'Digit2', 'Digit3', 'Digit4']);
    expect(hotkeys).toContain("'#speedbar .spd-mult-pc .spdmini'");
    expect(build).toMatch(/<span class="spd-mult-pc">(<button class="spdmini" data-mult="\d+"[^>]*>[^<]+<\/button>){4}<\/span>/);
  },
  'key-next-fleet': () => {
    key('key-next-fleet', 'next-fleet', ['Tab']);
    expect(main).toContain('nextFleet(cycledFleets(Object.values(s.fleets), ME, immobile), selFleet)');
    expect(main).toContain('setFleetSelection([id]);');
  },
  'key-home': () => {
    key('key-home', 'home', ['KeyH', 'Home']);
    expect(main).toContain('homeTarget(capitalOf(s, ME),');
    expect(main).toContain("if (to) jumpTo(to, 'goto');");
  },
  'key-tech': () => key('key-tech', 'tech', ['KeyT'], 'rail-tech'),
  'key-production': () => key('key-production', 'production', ['KeyB'], 'rail-constructor'),
  'key-events': () => key('key-events', 'events', ['KeyL'], 'rail-log'),
  'key-messages': () => key('key-messages', 'messages', ['KeyM'], 'rail-msgs'),
  'key-help': () => key('key-help', 'help', ['F1'], 'rail-help'),
  'long-press': () => {
    expect(pressIntent(press({ touch: true })).longPress).toBe(true);
    expect(longPressAction(true)).toBe('toggle-fleet');
    expect(longPressAction(false)).toBe('box-select');
  },
};

describe('controls — раздел «Управление» говорит правду об игре', () => {
  it('у каждой строки есть подтверждение в коде, и оно проходит', () => {
    expect(CONTROLS.map((row) => row.id).sort()).toEqual(Object.keys(PROOF).sort());
    for (const row of CONTROLS) PROOF[row.id]!();
  });

  it('id уникальны', () => {
    expect(new Set(CONTROLS.map((row) => row.id)).size).toBe(CONTROLS.length);
  });

  it('на телефоне — только жесты, на ПК — всё, клавиши скорости — при кнопках скорости', () => {
    expect(controlsFor(true).every((row) => row.device === 'touch')).toBe(true);
    expect(controlsFor(true).length).toBeGreaterThan(0);
    expect(controlsFor(true, true)).toEqual(controlsFor(true));
    expect(controlsFor(false, true)).toHaveLength(CONTROLS.length);
    expect(controlsFor(false).map((row) => row.id)).toEqual(
      CONTROLS.filter((row) => row.id !== 'key-speed').map((row) => row.id),
    );
  });

  it('у каждой горячей клавиши есть строка ПК, у каждой строки клавиши — клавиша', () => {
    const keyRows = CONTROLS.filter((row) => row.id.startsWith('key-'));
    expect(keyRows.every((row) => row.device === 'pc')).toBe(true);
    expect(keyRows.map((row) => row.id)).toEqual(HOTKEYS.map((k) => k.id));
  });
});
