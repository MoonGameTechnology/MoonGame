import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chapterMapSvg } from './sectorZeroMenu';
import type { ChapterMapView } from '../../decisions/chapterMap';

const here = path.dirname(fileURLToPath(import.meta.url));
const css = readFileSync(path.join(here, '../sector-zero.css'), 'utf8');
const build = readFileSync(path.join(here, '../build.mjs'), 'utf8');

const square = (x: number, y: number): Array<[number, number]> => [
  [x, y],
  [x + 10, y],
  [x + 10, y + 10],
  [x, y + 10],
];

const view: ChapterMapView = {
  frame: { x: 0, y: 0, w: 30, h: 10 },
  cells: [
    { id: 'home', poly: square(0, 0), x: 5, y: 5, known: true, kind: 'planet', side: 'you', objective: null },
    { id: 'rift', poly: square(10, 0), x: 15, y: 5, known: false, kind: null, side: null, objective: 'active' },
    { id: 'nest', poly: square(20, 0), x: 25, y: 5, known: true, kind: 'pirate_base', side: 'hostile', objective: 'later' },
  ],
  lanes: [[5, 5, 25, 5]],
  known: 2,
  total: 3,
};

describe('карта главы — разметка (PVR-6.15)', () => {
  it('неразведанная клетка — только туман: ни вида, ни стороны', () => {
    const svg = chapterMapSvg(view);
    const fog = svg.match(/<polygon class="([^"]*)" points="10,0 20,0 20,10 10,10"\/>/);
    expect(fog?.[1]).toBe('fog');
    expect(svg).toContain('<radialGradient id="sz-fog"');
    expect(svg).toContain('class="known side-hostile kind-pirate_base"');
  });

  it('у SVG нет своего размера — высоту панель берёт из пропорций viewBox', () => {
    const svg = chapterMapSvg(view);
    expect(svg).toMatch(/^<svg viewBox="0 0 30 10" preserveAspectRatio="xMidYMid meet"/);
    expect(svg).not.toMatch(/^<svg[^>]*\s(width|height)=/);
  });

  // Раньше коробка карты стояла фиксированной высоты, и карта другой формы получала
  // чёрные полосы по бокам, а на телефоне — ещё и своя высота поверх. Сторож: высота
  // коробки — от содержимого, SVG — `height: auto`.
  it('коробка карты не задаёт высоту ни на ПК, ни на телефоне', () => {
    const rules = [...css.matchAll(/\.sz-map-body\s*\{([^}]*)\}/g)].map((m) => m[1]!);
    expect(rules.length).toBeGreaterThan(0);
    for (const body of rules) expect(body).not.toMatch(/(^|;)\s*height\s*:/);
    expect(css).toMatch(/\.sz-map-body svg\s*\{[^}]*height:\s*auto/);
  });
});

describe('крестик панелей меню', () => {
  // Глиф «×» сидел выше центра кольца (своя посадка в строке шрифта). Вектор в сетке —
  // ровно по центру; сторож не даёт глифу вернуться в карту. У досье панели больше нет —
  // оно открывается своим окном с кнопкой «назад» (заказ владельца 2026-09-24).
  it.each(['sz-map-close'])('%s — векторный крест, не глиф', (id) => {
    const button = new RegExp(`<button id="${id}"[^>]*>([\\s\\S]*?)</button>`).exec(build);
    expect(button).not.toBeNull();
    expect(button![0]).toContain('class="sz-panel-x"');
    expect(button![1]).toMatch(/^<svg viewBox="0 0 12 12" aria-hidden="true"/);
    expect(button![1]).not.toContain('×');
    expect(button![0]).toMatch(/data-i18n-aria="[^"]+"/); // имя кнопки — подпись, а не картинка
  });
});
