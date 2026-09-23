import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { CONTROLS, controlsFor } from './controls';
import { longPressAction, pressIntent, type PressInput } from './pressIntent';

const src = (path: string): string => readFileSync(new URL(path, import.meta.url), 'utf8');
const main = src('../prototype/src/main.ts');
const press = (over: Partial<PressInput>): PressInput => ({
  touch: false,
  shift: false,
  ctrl: false,
  meta: false,
  overOwnFleet: false,
  orderArmed: false,
  ...over,
});

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
  window: () => {
    const windows = src('../prototype/src/floatingWindows.ts');
    expect(windows).toContain('ArrowLeft');
    expect(windows).toContain('e.shiftKey ? 30 : 10');
  },
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

  it('на телефоне — только жесты, на ПК — всё', () => {
    expect(controlsFor(true).every((row) => row.device === 'touch')).toBe(true);
    expect(controlsFor(true).length).toBeGreaterThan(0);
    expect(controlsFor(false)).toHaveLength(CONTROLS.length);
  });
});
