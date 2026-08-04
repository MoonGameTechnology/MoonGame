// BACK-1: сторож реестра слоёв. Две половины.
//
// 1) МОДЕЛЬ — лестница закрывает РОВНО ОДИН верхний слой и отчитывается, какой именно.
// 2) ПОЛНОТА — опись сверяется с настоящим CSS и с настоящей лестницей в main.ts.
//    Именно этой половины не хватало: слои заводили, а в реестр не вписывали, и Back
//    закрывал слой ПОД видимым окном. Опись нашла 37 оверлеев, из них 29 были вне
//    реестра. Теперь новый оверлей обязан объявить себя слоем или не-слоем с причиной.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import {
  closeTopLayer,
  topLayerOpen,
  LAYER_INVENTORY,
  EXTRA_LAYERS,
  type BackLayer,
} from './backLayers';

const read = (rel: string) => readFileSync(fileURLToPath(new URL(rel, import.meta.url)), 'utf8');

/** Слой-пустышка: считает, сколько раз его закрыли. */
function fake(id: string, open: boolean): BackLayer & { closed: number } {
  const l = {
    id,
    closed: 0,
    isOpen: () => open,
    close: () => {
      l.closed += 1;
      open = false;
    },
  };
  return l;
}

describe('лестница закрывает верхний слой и только его', () => {
  it('закрывается ПЕРВЫЙ открытый по порядку, остальные не трогаются', () => {
    const a = fake('a', false);
    const b = fake('b', true);
    const c = fake('c', true);
    expect(closeTopLayer([a, b, c])).toBe('b');
    expect([a.closed, b.closed, c.closed]).toEqual([0, 1, 0]);
  });

  it('нечего закрывать — null, и ни один close() не позван', () => {
    const a = fake('a', false);
    expect(closeTopLayer([a])).toBeNull();
    expect(closeTopLayer([])).toBeNull();
    expect(a.closed).toBe(0);
  });

  it('проба не имеет побочных эффектов и честна к пустому списку', () => {
    const a = fake('a', true);
    expect(topLayerOpen([a])).toBe(true);
    expect(topLayerOpen([fake('b', false)])).toBe(false);
    expect(topLayerOpen([])).toBe(false);
    expect(a.closed).toBe(0);
  });

  it('повторные нажатия снимают слои сверху вниз', () => {
    const stack = [fake('верх', true), fake('середина', true), fake('низ', true)];
    expect(closeTopLayer(stack)).toBe('верх');
    expect(closeTopLayer(stack)).toBe('середина');
    expect(closeTopLayer(stack)).toBe('низ');
    expect(closeTopLayer(stack)).toBeNull();
  });
});

/**
 * Опись оверлеев прямо из CSS прототипа: правило с `position:fixed` и `display:none` —
 * это элемент, который кто-то показывает. Групповые селекторы (`#tech,#steward,#market`)
 * разбираются поимённо: на них сканер уже один раз обжёгся и потерял «Хранителя».
 */
function overlayIdsFromCss(source: string): Map<string, number> {
  const found = new Map<string, number>();
  // Комментарии прилипают к списку селекторов и рвут разбор (сканер на этом уже
  // спотыкался), а `${...}` — это JS-интерполяция внутри шаблонной строки со стилями:
  // её фигурные скобки сбили бы счёт правил. Убираем и то, и другое.
  const css = source.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/\$\{[^}]*\}/g, ' ');
  const rule = /([^{}]+)\{([^{}]*)\}/g;
  let m: RegExpExecArray | null;
  while ((m = rule.exec(css))) {
    const body = m[2] ?? '';
    if (!/position\s*:\s*fixed/.test(body) || !/display\s*:\s*none/.test(body)) continue;
    const z = Number(/z-index\s*:\s*(\d+)/.exec(body)?.[1] ?? 0);
    for (const sel of (m[1] ?? '').split(',')) {
      const id = /^#([A-Za-z][-A-Za-z0-9_]*)$/.exec(sel.trim())?.[1];
      if (id) found.set(id, Math.max(found.get(id) ?? 0, z));
    }
  }
  return found;
}

describe('опись полна: каждый оверлей объявлен слоем или не-слоем', () => {
  const css = read('../build.mjs');
  const overlays = overlayIdsFromCss(css);

  it('сканер CSS вообще что-то находит (иначе сторож охраняет пустоту)', () => {
    expect(overlays.size).toBeGreaterThan(25);
    // Контрольные точки: групповой селектор и одиночный — оба должны попадаться.
    expect([...overlays.keys()]).toEqual(expect.arrayContaining(['steward', 'settings', 'corp']));
  });

  it('НЕТ оверлея без вердикта — новый экран обязан выбрать: слой или нет', () => {
    const unclassified = [...overlays.keys()].filter((id) => !LAYER_INVENTORY.has(id));
    expect(unclassified, `не классифицированы: ${unclassified.join(', ')}`).toEqual([]);
  });

  it('НЕТ вердикта без оверлея — опись не хранит снесённые экраны', () => {
    const stale = [...LAYER_INVENTORY.keys()].filter((id) => !overlays.has(id));
    expect(stale, `в описи есть, в CSS нет: ${stale.join(', ')}`).toEqual([]);
  });
});

describe('лестница main.ts совпадает с описью', () => {
  const main = read('./main.ts');
  const block = /const BACK_LAYERS: BackLayer\[\] = \[([\s\S]*?)\n\];/.exec(main)?.[1] ?? '';
  const ladder = [...block.matchAll(/\bid: '([^']+)'/g)].map((m) => m[1] as string);

  it('лестница найдена в main.ts и не пуста', () => {
    expect(ladder.length).toBeGreaterThan(20);
  });

  it('каждый слой описи есть в лестнице — иначе Back его не закроет', () => {
    const declared = [...LAYER_INVENTORY].filter(([, v]) => v === 'layer').map(([id]) => id);
    const missing = declared.filter((id) => !ladder.includes(id));
    expect(missing, `объявлены слоями, но не в лестнице: ${missing.join(', ')}`).toEqual([]);
  });

  it('в лестнице нет посторонних ступеней', () => {
    const allowed = new Set([
      ...[...LAYER_INVENTORY].filter(([, v]) => v === 'layer').map(([id]) => id),
      ...EXTRA_LAYERS,
    ]);
    const extra = ladder.filter((id) => !allowed.has(id));
    expect(extra, `ступени без вердикта в описи: ${extra.join(', ')}`).toEqual([]);
  });

  it('ступени не дублируются', () => {
    expect(ladder.length).toBe(new Set(ladder).size);
  });
});
