// Палитра меню-экранов (UIX-15) — две копии одного факта: типизированная `surfaceTheme` в
// packages/client/src/theme.ts и CSS-переменные --sf-* в prototype/build.mjs (скилл
// frontend-design §2). Сторож держит копии одинаковыми: правка одной без второй красит
// гейт, а не экраны в два разных цвета.
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { surfaceTheme, type SurfaceTheme } from '../../packages/client/src/theme';

const BUILD = readFileSync(new URL('../build.mjs', import.meta.url), 'utf8');
/** Первый :root листа — там живут токены. */
const ROOT = /:root\{([\s\S]*?)\n\}/.exec(BUILD)?.[1] ?? '';

const VAR: Record<keyof SurfaceTheme, string> = {
  text: '--sf-text',
  textDim: '--sf-dim',
  textHead: '--sf-head',
  textHi: '--sf-hi',
  card: '--sf-card',
  cardOff: '--sf-card-off',
  inset: '--sf-inset',
  edge: '--sf-edge',
  edgeHi: '--sf-edge-hi',
  panelFrom: '--sf-panel-from',
  panelTo: '--sf-panel-to',
  panelEdge: '--sf-panel-edge',
};

/** Составные переменные: собраны из токенов выше и --cyan, своего цвета у них нет. */
const COMPOSED = [
  '--sf-panel',
  '--sf-accent',
  '--sf-sel',
  '--sf-primary',
  '--sf-primary-hi',
  '--sf-glow',
  '--sf-shadow',
  '--sf-font',
];

/** `rgba(8,26,38,0.72)` и `rgba(8,26,38,.72)` — один цвет. */
const norm = (v: string): string =>
  v
    .replace(/\s+/g, '')
    .replace(/([(,])0\./g, '$1.')
    .toLowerCase();

describe('палитра меню-экранов: theme.ts и build.mjs — одна правда (UIX-15)', () => {
  it.each(Object.entries(VAR))('%s живёт в %s с тем же значением', (key, name) => {
    const m = new RegExp(`${name}:([^;]+);`).exec(ROOT);
    expect(m, `${name} нет в :root build.mjs`).not.toBeNull();
    expect(norm(m![1]!)).toBe(norm(surfaceTheme[key as keyof SurfaceTheme]));
  });

  it('новый цвет --sf-* не заводится мимо theme.ts', () => {
    const declared = [...ROOT.matchAll(/(--sf-[a-z-]+):/g)].map((m) => m[1]);
    const known = new Set<string>([...Object.values(VAR), ...COMPOSED]);
    expect(declared.filter((name) => !known.has(name!))).toEqual([]);
    expect(declared.length).toBe(known.size);
  });
});
