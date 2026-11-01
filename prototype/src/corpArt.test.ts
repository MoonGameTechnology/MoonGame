import expansion from '../art/corp/expansion/manifest.json';
import { readdirSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import manifest from '../art/corp/manifest.json';
import { CORP_ART_BUILDINGS, CORP_STYLES, corpArt, corpStyleName } from './corpArt';
import { CORP_LOTS, corpSprite } from './corpSprites';

const images = (svg: string): string[] => [...svg.matchAll(/<image [^>]*>/g)].map((m) => m[0]);

describe('рисунки зданий корпорации (CORP-13)', () => {
  it('каждое здание панорамы нарисовано на всех уровнях каталога', () => {
    expect([...CORP_ART_BUILDINGS].sort()).toEqual(Object.keys(CORP_LOTS).sort());
    for (const id of CORP_ART_BUILDINGS) {
      const count = id === 'headquarters' ? 5 : id === 'monument' ? 1 : 3;
      const frames = Array.from({ length: count }, (_, i) => JSON.stringify(corpArt(id, i + 1)));
      expect(new Set(frames).size, id).toBe(count);
    }
  });

  it('папка рисунков совпадает с манифестом нарезки', () => {
    for (const [style, buildings] of Object.entries(manifest)) {
      const expected = Object.entries(buildings).flatMap(([id, sheet]) => {
        expect(sheet.box, `${style}/${id}`).toHaveLength(3);
        return [1, 2, 3].map((level) => `${id}-${level}.webp`);
      });
      const onDisk = readdirSync(new URL(`../art/corp/${style}/`, import.meta.url));
      expect(onDisk.sort(), style).toEqual(expected.sort());
    }
  });

  it('уровень вне нарисованных берёт ближайший рисунок, чужое здание — без рисунка', () => {
    expect(corpArt('headquarters', 0)?.src).toBe(corpArt('headquarters', 1)?.src);
    expect(corpArt('headquarters', 99)).toEqual(corpArt('headquarters', 5));
    expect(corpArt('headquarters', 4)).not.toEqual(corpArt('headquarters', 5));
    expect(corpArt('orbital_dock', 1)).toBeNull();
  });
});

describe('стили базы (CORP-14)', () => {
  it('каждый стиль из магазина нарисован целиком, и все стили разные', () => {
    const catalog = JSON.parse(
      readFileSync(new URL('../../data/metaEconomy.json', import.meta.url), 'utf8'),
    ) as { store: { offers: Record<string, { corpStyle?: string }> } };
    const sold = Object.values(catalog.store.offers).flatMap((o) => (o.corpStyle ? [o.corpStyle] : []));
    expect([...CORP_STYLES].sort()).toEqual(['standard', ...sold].sort());
    const srcs = new Set<string>();
    for (const style of CORP_STYLES)
      for (const id of CORP_ART_BUILDINGS)
        for (const level of Array.from({ length: id === 'headquarters' ? 5 : id === 'monument' ? 1 : 3 }, (_, i) => i + 1)) srcs.add(JSON.stringify(corpArt(id, level, style)));
    expect(srcs.size).toBe(CORP_STYLES.length * 21);
  });

  it('стиль без рисунков в этой сборке рисуется и называется стандартным', () => {
    expect(corpArt('headquarters', 2, '__proto__')).toEqual(corpArt('headquarters', 2));
    expect(corpArt('headquarters', 2, 'art_deco')).toEqual(corpArt('headquarters', 2));
    expect(corpStyleName('art_deco')).toBe(corpStyleName('standard'));
    expect(corpStyleName('high_tech')).toBe('corp.style.high-tech');
  });

  it('здание на панораме стоит в стиле базы — и строящийся уровень тоже', () => {
    const [scaf, current] = images(corpSprite('headquarters', 1, 'build', 'imperial_gothic'));
    expect(scaf).toContain(`href="${corpArt('headquarters', 2, 'imperial_gothic')!.src}"`);
    expect(current).toContain(`href="${corpArt('headquarters', 1, 'imperial_gothic')!.src}"`);
  });
});

describe('здание на панораме (corpSprite)', () => {
  it('построенное — картинка своего уровня', () => {
    const [image, ...rest] = images(corpSprite('headquarters', 2, 'built'));
    expect(rest).toEqual([]);
    expect(image).toContain(`href="${corpArt('headquarters', 2)!.src}"`);
    expect(image).not.toContain('filter=');
  });

  it('строящееся — следующий уровень голограммой лесов позади нынешнего', () => {
    const [scaf, current, ...rest] = images(corpSprite('supply_center', 1, 'build'));
    expect(rest).toEqual([]);
    expect(scaf).toContain(`href="${corpArt('supply_center', 2)!.src}"`);
    expect(scaf).toContain('filter="url(#corpScaf)"');
    expect(current).toContain(`href="${corpArt('supply_center', 1)!.src}"`);
    expect(current).not.toContain('filter=');
    // Первая стройка: нынешнего здания ещё нет.
    expect(images(corpSprite('supply_center', 0, 'build'))).toHaveLength(1);
  });

  it('доступное к стройке — голограмма первого уровня, закрытое — его тёмный силуэт', () => {
    for (const [mode, filter] of [['open', 'corpGhost'], ['locked', 'corpShade']] as const) {
      const [first, ...rest] = images(corpSprite('engineering_complex', 0, mode));
      expect(rest).toEqual([]);
      expect(first).toContain(`href="${corpArt('engineering_complex', 1)!.src}"`);
      expect(first).toContain(`filter="url(#${filter})"`);
    }
  });

  it('зона нажатия — только на панораме и внутри участка', () => {
    expect(corpSprite('headquarters', 1, 'built')).not.toContain('class="hit"');
    const lot = CORP_LOTS.headquarters!;
    const hit = /class="hit" x="([\d.]+)" y="([\d.]+)" width="([\d.]+)" height="([\d.]+)"/.exec(
      corpSprite('headquarters', 1, 'built', 'standard', true),
    );
    const [x, y, w, h] = hit!.slice(1).map(Number) as [number, number, number, number];
    expect(x).toBeGreaterThanOrEqual(0);
    expect(y).toBeGreaterThan(0); // первый уровень ниже холста: небо над ним не нажимается
    expect(x + w).toBeLessThanOrEqual(lot.w + 0.1);
    expect(y + h).toBeCloseTo(lot.h, 0);
  });

  it('здание без рисунка получает корпус-заглушку', () => {
    const svg = corpSprite('orbital_dock', 1, 'built');
    expect(images(svg)).toEqual([]);
    expect(svg).toContain('class="f"');
  });
});

it('atlas frames stay inside the source sheet and share a ground-aligned canvas', () => {
  for (const buildings of Object.values(expansion)) for (const frames of Object.values(buildings)) {
    expect(new Set(frames.map((f) => `${f.w}:${f.h}`)).size).toBe(1);
    for (const { frame: f, box, h } of frames) {
      expect(f.sx + f.sw).toBeLessThanOrEqual(f.iw);
      expect(f.sy + f.sh).toBeLessThanOrEqual(f.ih);
      expect(f.dy + f.dh).toBeCloseTo(h);
      expect(box.every((n) => Number.isFinite(n) && n >= 0 && n <= 1)).toBe(true);
    }
  }
});
