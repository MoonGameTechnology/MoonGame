import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { BUILD_ICON, UNIT_ICON } from './icons';
import { data } from './game';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

/**
 * У КАЖДОГО здания своя иконка — иначе плитка молча падает на общий фолбэк, и два
 * разных здания выглядят одинаково. Ровно так «Космопорт» показывался безымянным
 * квадратиком рядом с «ПВО»: в словаре его просто не было.
 */
describe('иконки — здания', () => {
  it('каждое здание КАТАЛОГА ПРОТОТИПА имеет свою иконку', () => {
    const missing = Object.keys(data.buildings).filter((id) => !BUILD_ICON[id]);
    expect(missing).toEqual([]);
  });

  it('каждое здание БАНДЛА тоже имеет иконку — данные общие для сети', () => {
    const bundle = JSON.parse(
      readFileSync(path.join(repoRoot, 'data/buildings.json'), 'utf8'),
    ) as Record<string, unknown>;
    const ids = Object.keys((bundle.buildings ?? bundle) as Record<string, unknown>);
    expect(ids.filter((id) => !BUILD_ICON[id])).toEqual([]);
  });

  it('иконки РАЗНЫЕ там, где здания различны по роли', () => {
    const roles = ['mine', 'radar', 'orbital_aa', 'spaceport', 'hospital', 'metal_station'];
    const glyphs = roles.map((id) => BUILD_ICON[id]);
    expect(new Set(glyphs).size).toBe(roles.length);
  });

  it('иконка — ровно один видимый глиф, а не строка', () => {
    for (const [id, glyph] of Object.entries(BUILD_ICON)) {
      expect([...glyph], id).toHaveLength(1);
    }
  });
});

describe('иконки — юниты', () => {
  // У космических корпусов есть силуэт-архетип (`unitGlyphSvg`), и текстовый глиф им
  // не нужен. А вот НАЗЕМНЫМ рисовать нечем — для них словарь единственный источник,
  // и пропуск там означает пустое место в гарнизоне.
  it('каждый НАЗЕМНЫЙ юнит имеет глиф — рисовать его больше нечем', () => {
    const ground = Object.keys(data.units).filter((id) => data.units[id]?.domain === 'ground');
    expect(ground.length).toBeGreaterThan(0);
    expect(ground.filter((id) => !UNIT_ICON[id])).toEqual([]);
  });
});
