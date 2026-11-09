import { describe, it, expect } from 'vitest';

import {
  BOUNDARY,
  MIN_BORDER,
  SEED_WEIGHT,
  clampPowerWeights,
  clipHalfPlaneTagged,
  mosaicBorderSegments,
  mosaicBorders,
  mosaicClip,
  mosaicFrame,
  mosaicOutline,
  sealPlan,
  type MosaicBorder,
  type MosaicSeed,
  type SealPlan,
} from './mosaic';

/** Ровный квадрат из четырёх центров плюс один в середине — на нём видно и то, кто
 *  граничит, и то, как местность режет бюджет, не разрывая карту. */
const RING: MosaicSeed[] = [
  { id: 'n', x: 0, y: -300, size: 1 },
  { id: 'e', x: 300, y: 0, size: 1 },
  { id: 's', x: 0, y: 300, size: 1 },
  { id: 'w', x: -300, y: 0, size: 1 },
];
const key = (b: { a: string; b: string }): string => `${b.a}|${b.b}`;

describe('mosaic — кто с кем граничит', () => {
  it('две провинции делят одну границу по серединному перпендикуляру', () => {
    const borders = mosaicBorders([
      { id: 'a', x: -100, y: 0, size: 1 },
      { id: 'b', x: 100, y: 0, size: 1 },
    ]);
    expect(borders.map(key)).toEqual(['a|b']);
    // Граница тянется через всю рамку: это раздел карты надвое, а не касание.
    const frame = mosaicFrame([
      { id: 'a', x: -100, y: 0, size: 1 },
      { id: 'b', x: 100, y: 0, size: 1 },
    ]);
    expect(borders[0]!.length).toBeCloseTo(frame.y1 - frame.y0, 6);
  });

  it('диагональ ромба — касание в ТОЧКЕ, и границей не считается', () => {
    // n/e/s/w сходятся в начале координат: у пар n–s и e–w общая «граница» нулевой
    // длины. Считать её — значит позволить проходу появляться и исчезать от последних
    // битов деления. Порог `MIN_BORDER` и существует ради этого случая.
    expect(mosaicBorders(RING).map(key)).toEqual(['e|n', 'e|s', 'n|w', 's|w']);
  });

  it('порог — правило, а не допуск: ровно он решает, есть ли проход', () => {
    // Два центра далеко друг от друга, но зажатые третьим так, что общая грань выходит
    // короче порога. Проверяем сам порог, а не конкретную пару: он ЗОЛОТОЙ, потому что
    // его сдвиг меняет карту, а не точность.
    expect(MIN_BORDER).toBe(24);
    const wide = mosaicBorders([
      { id: 'a', x: -100, y: 0, size: 1 },
      { id: 'b', x: 100, y: 0, size: 1 },
    ]);
    expect(wide[0]!.length).toBeGreaterThan(MIN_BORDER);
  });

  it('размер мира двигает границы: тяжёлый центр забирает территорию', () => {
    const light = mosaicBorders([
      { id: 'a', x: -200, y: 0, size: 1 },
      { id: 'b', x: 200, y: 0, size: 1 },
      { id: 'c', x: 0, y: 260, size: 1 },
    ]);
    const heavy = mosaicBorders([
      { id: 'a', x: -200, y: 0, size: 1 },
      { id: 'b', x: 200, y: 0, size: 1 },
      { id: 'c', x: 0, y: 260, size: 6 },
    ]);
    // При равных размерах a и b — соседи: их клетки смыкаются над `c`.
    expect(light.map(key)).toContain('a|b');
    // Раздутый `c` протиснулся между ними: соседство ИСЧЕЗЛО, хотя точки не двигались.
    // Значит размер — настоящий авторский рычаг, а не украшение заливки.
    expect(heavy.map(key)).not.toContain('a|b');
  });

  it('детерминизм: та же карта — та же геометрия, бит в бит', () => {
    expect(mosaicBorders(RING)).toEqual(mosaicBorders(RING));
  });
});

describe('mosaic — что закрывает местность', () => {
  const ids = RING.map((s) => s.id);
  const borders = mosaicBorders(RING);

  it('бюджет по умолчанию щедр — закрывать нечего', () => {
    const plan = sealPlan(borders, () => 8, ids);
    expect(plan.sealed).toEqual([]);
    expect(plan.open).toHaveLength(borders.length);
    expect(plan.overBudget).toEqual([]);
  });

  it('местность режет лишнее с САМОГО ТОНКОГО касания', () => {
    // У каждого из четырёх по две границы; бюджет 1 у одного — уходит его короткая.
    const plan = sealPlan(borders, (id) => (id === 'n' ? 1 : 8), ids);
    expect(plan.sealed).toHaveLength(1);
    const cut = plan.sealed[0]!;
    expect([cut.a, cut.b]).toContain('n');
    const mine = borders.filter((b) => b.a === 'n' || b.b === 'n');
    expect(cut.length).toBe(Math.min(...mine.map((b) => b.length)));
  });

  it('печать — закрытая дверь, а не изгнание: карта остаётся связной', () => {
    // Кольцо из четырёх: чтобы у каждого остался один путь, надо срезать две
    // противоположные границы — а это распадётся на две пары. Правило
    // останавливается на связности и ЧЕСТНО докладывает, кого не уложило в бюджет,
    // вместо того чтобы тихо оставить провинцию отрезанной.
    const plan = sealPlan(borders, () => 1, ids);
    expect(plan.overBudget.length).toBeGreaterThan(0);
    const adj = new Map<string, string[]>(ids.map((id) => [id, []]));
    for (const b of plan.open) {
      adj.get(b.a)!.push(b.b);
      adj.get(b.b)!.push(b.a);
    }
    const seen = new Set<string>([ids[0]!]);
    const queue = [ids[0]!];
    while (queue.length > 0) {
      const cur = queue.shift()!;
      for (const n of adj.get(cur) ?? [])
        if (!seen.has(n)) {
          seen.add(n);
          queue.push(n);
        }
    }
    expect(seen.size).toBe(ids.length);
  });

  it('непроходимая местность (бюджет 0) закрывается ЦЕЛИКОМ, если это никого не отрезает', () => {
    // Разлом — дыра в карте: он и есть та самая местность с нулём подходов. Кольцо
    // n–e–s–w держится без `n`, поэтому все его границы можно закрыть по-настоящему.
    const plan = sealPlan(borders, (id) => (id === 'n' ? 0 : 8), ids);
    expect(plan.overBudget).toEqual([]);
    expect(plan.open.some((b) => b.a === 'n' || b.b === 'n')).toBe(false);
    expect(plan.sealed.every((b) => b.a === 'n' || b.b === 'n')).toBe(true);
  });

  it('детерминизм: тот же бюджет — те же печати', () => {
    const once = sealPlan(borders, (id) => (id === 'n' ? 1 : 2), ids);
    const twice = sealPlan(borders, (id) => (id === 'n' ? 1 : 2), ids);
    expect(once).toEqual(twice);
  });
});

/** Определения «в лоб», без единой оптимизации: каждую клетку режем ВСЕМИ соседями, а
 *  каждую печать проверяем обходом всей карты. Быстрые пути в `mosaic.ts` обязаны давать
 *  бит в бит то же самое — иначе ускорение тихо перерисовало бы уже выпущенные карты. */
function plainSegments(seeds: readonly MosaicSeed[]): string {
  const frame = mosaicFrame(seeds);
  const sites = seeds.map((s) => ({ x: s.x, y: s.y, w: s.size * SEED_WEIGHT }));
  clampPowerWeights(sites);
  const longest = new Map<string, { length: number; p: number[]; q: number[] }>();
  sites.forEach((si, i) => {
    let poly: Array<[number, number]> = [
      [frame.x0, frame.y0],
      [frame.x1, frame.y0],
      [frame.x1, frame.y1],
      [frame.x0, frame.y1],
    ];
    let tags = [BOUNDARY, BOUNDARY, BOUNDARY, BOUNDARY];
    sites.forEach((sj, j) => {
      if (j === i || poly.length === 0) return;
      const a = 2 * (sj.x - si.x);
      const b = 2 * (sj.y - si.y);
      const c = si.x * si.x + si.y * si.y - (sj.x * sj.x + sj.y * sj.y) + (sj.w - si.w);
      ({ poly, tags } = clipHalfPlaneTagged(poly, tags, a, b, c, j));
    });
    poly.forEach((p, k) => {
      const t = tags[k]!;
      if (t < 0) return;
      const q = poly[(k + 1) % poly.length]!;
      const len = Math.sqrt((q[0] - p[0]) ** 2 + (q[1] - p[1]) ** 2);
      const [ida, idb] = [seeds[i]!.id, seeds[t]!.id];
      const pair = ida < idb ? `${ida}|${idb}` : `${idb}|${ida}`;
      if (len > (longest.get(pair)?.length ?? 0)) longest.set(pair, { length: len, p, q });
    });
  });
  const out = [...longest]
    .filter(([, e]) => e.length >= MIN_BORDER)
    .map(([pair, e]) => ({ a: pair.split('|')[0]!, b: pair.split('|')[1]!, ...e }))
    .sort((p, q) => (p.a === q.a ? (p.b < q.b ? -1 : 1) : p.a < q.a ? -1 : 1));
  return JSON.stringify(out);
}

function plainSealPlan(
  borders: readonly MosaicBorder[],
  budgetOf: (id: string) => number,
  ids: readonly string[],
): SealPlan {
  const sealed = new Set<string>();
  const openOf = (): MosaicBorder[] => borders.filter((b) => !sealed.has(key(b)));
  const reach = ids.filter((id) => budgetOf(id) > 0); // дыра — не провинция
  const whole = (open: readonly MosaicBorder[], drop: string): boolean => {
    if (reach.length < 2) return true;
    const adj = new Map<string, string[]>(reach.map((id) => [id, []]));
    for (const b of open) {
      if (key(b) === drop || !adj.has(b.a) || !adj.has(b.b)) continue;
      adj.get(b.a)!.push(b.b);
      adj.get(b.b)!.push(b.a);
    }
    const seen = new Set([reach[0]!]);
    const queue = [reach[0]!];
    while (queue.length > 0) {
      for (const next of adj.get(queue.shift()!)!) {
        if (seen.has(next)) continue;
        seen.add(next);
        queue.push(next);
      }
    }
    return seen.size === reach.length;
  };
  for (;;) {
    const open = openOf();
    const degree = new Map<string, number>(ids.map((id) => [id, 0]));
    for (const b of open) {
      degree.set(b.a, degree.get(b.a)! + 1);
      degree.set(b.b, degree.get(b.b)! + 1);
    }
    const over = ids
      .filter((id) => degree.get(id)! > budgetOf(id))
      .sort((p, q) => {
        const dp = degree.get(p)! - budgetOf(p);
        const dq = degree.get(q)! - budgetOf(q);
        return dp === dq ? (p < q ? -1 : 1) : dq - dp;
      });
    const sealedNow = (): MosaicBorder[] => borders.filter((b) => sealed.has(key(b)));
    if (over.length === 0) return { open, sealed: sealedNow(), overBudget: [] };
    let cut: string | null = null;
    for (const id of over) {
      const pick = open
        .filter((b) => b.a === id || b.b === id)
        .sort((p, q) => (p.length === q.length ? (key(p) < key(q) ? -1 : 1) : p.length - q.length))
        .find((b) => whole(open, key(b)));
      if (pick) {
        cut = key(pick);
        break;
      }
    }
    if (cut === null) return { open, sealed: sealedNow(), overBudget: over };
    sealed.add(cut);
  }
}

describe('mosaic — быстрый счёт совпадает с определением', () => {
  // Свой генератор: тесту нужен воспроизводимый разброс, а не игровой Rng.
  let state = 20261016;
  const roll = (): number => (state = (state * 1103515245 + 12345) % 2147483648) / 2147483648;
  const mosaics = Array.from({ length: 60 }, (_, m) => {
    const span = m % 4 === 0 ? 500 : 5000; // тесные россыпи — там касания самые тонкие
    return Array.from({ length: 3 + Math.floor(roll() * 70) }, (_, i) => ({
      id: `s${String(i).padStart(3, '0')}`,
      x: Math.round(roll() * span),
      y: Math.round(roll() * span),
      size: 0.5 + roll() * 3,
    }));
  });

  it('границы и их отрезки — те же, что при резке клетки всеми соседями', () => {
    for (const seeds of mosaics)
      expect(JSON.stringify(mosaicBorderSegments(seeds))).toBe(plainSegments(seeds));
  });

  it('печати — те же, что при проверке связности всей карты на каждую границу', () => {
    for (const seeds of mosaics) {
      const ids = seeds.map((s) => s.id);
      // Бюджеты от 0 (дыра) до 5; дыры местами режут карту, и тогда закрыть нельзя ничего.
      const budget = new Map(ids.map((id) => [id, roll() < 0.1 ? 0 : 1 + Math.floor(roll() * 5)]));
      const borders = mosaicBorders(seeds);
      const budgetOf = (id: string): number => budget.get(id)!;
      expect(sealPlan(borders, budgetOf, ids)).toEqual(plainSealPlan(borders, budgetOf, ids));
    }
  });
});

/** Круглая «карта»: кольцо из 24 центров и плотная середина — как большая FFA в малом. */
function disc(): MosaicSeed[] {
  const out: MosaicSeed[] = [];
  // Точки окружности без тригонометрии: рациональная параметризация (1−t², 2t)/(1+t²).
  for (let k = -12; k < 12; k++) {
    const t = k / 6;
    out.push({
      id: `r${k + 12}`,
      x: (1000 * (1 - t * t)) / (1 + t * t),
      y: (2000 * t) / (1 + t * t),
      size: 1,
    });
  }
  for (let x = -600; x <= 600; x += 300)
    for (let y = -600; y <= 600; y += 300)
      if (x * x + y * y < 700 * 700) out.push({ id: `c${x}_${y}`, x, y, size: 1 });
  return out;
}

describe('край карты — прямоугольник или обод (`mosaicClip`)', () => {
  it('без `edge` край — прежний прямоугольник: уже выпущенные карты не меняются', () => {
    const f = mosaicFrame(RING);
    expect(mosaicClip(RING)).toEqual([
      [f.x0, f.y0],
      [f.x1, f.y0],
      [f.x1, f.y1],
      [f.x0, f.y1],
    ]);
    expect(mosaicBorders(RING, undefined)).toEqual(mosaicBorders(RING));
  });

  it('обод выпуклый, держит каждый центр внутри и обходится в той же стороне, что рамка', () => {
    const seeds = disc();
    const edge = mosaicOutline(seeds);
    expect(edge.length).toBeGreaterThan(8);
    for (let i = 0; i < edge.length; i++) {
      const a = edge[i]!;
      const b = edge[(i + 1) % edge.length]!;
      const c = edge[(i + 2) % edge.length]!;
      // выпуклость: все повороты в одну сторону
      expect((b[0] - a[0]) * (c[1] - b[1]) - (b[1] - a[1]) * (c[0] - b[0])).toBeGreaterThan(0);
      // каждый центр строго внутри, с запасом не меньше пола отступа
      for (const s of seeds) {
        const len = Math.sqrt((b[0] - a[0]) ** 2 + (b[1] - a[1]) ** 2);
        expect(((b[0] - a[0]) * (s.y - a[1]) - (b[1] - a[1]) * (s.x - a[0])) / len).toBeGreaterThan(
          30,
        );
      }
    }
    expect(mosaicOutline(seeds)).toEqual(edge); // детерминизм
    expect(mosaicOutline([])).toEqual([]);
  });

  it('на круглой карте крайние провинции больше не тянутся в углы рамки', () => {
    const seeds = disc();
    const longest = (edge?: 'hull'): number =>
      Math.max(...mosaicBorderSegments(seeds, edge).map((b) => b.length));
    // Обод отрезает длинные «клинья»: самая длинная граница короче, чем у рамки.
    expect(longest('hull')).toBeLessThan(longest() * 0.7);
    // И ни одна граница не уходит за обод.
    const edge = mosaicOutline(seeds);
    const inside = (x: number, y: number): boolean =>
      edge.every((a, i) => {
        const b = edge[(i + 1) % edge.length]!;
        return (b[0] - a[0]) * (y - a[1]) - (b[1] - a[1]) * (x - a[0]) >= -1e-6;
      });
    for (const b of mosaicBorderSegments(seeds, 'hull')) {
      expect(inside(b.p[0], b.p[1]) && inside(b.q[0], b.q[1])).toBe(true);
    }
  });
});
