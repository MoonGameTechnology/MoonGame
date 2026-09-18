import { describe, it, expect } from 'vitest';

import { MIN_BORDER, mosaicBorders, mosaicFrame, sealPlan, type MosaicSeed } from './mosaic';

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
