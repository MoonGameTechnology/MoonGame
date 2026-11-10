/**
 * Дерево развития героя рядами плиток (окно «Производство», макет 2026-11-09).
 *
 * 1. **Ряд — цепочка прокачки.** Корень (узел без родителей внутри ветки) открывает ряд;
 *    первый ребёнок продолжает его, остальные дети открывают свои ряды с пометкой
 *    «ветка от …». Так ряд читается слева направо в порядке покупки.
 * 2. **Ряд продолжает самая длинная цепочка.** Из детей узла дальше по ряду идёт тот, у
 *    кого под ним больше ступеней: главная лестница ветки остаётся одной строкой, а
 *    боковой узел уходит отдельным коротким рядом. При равенстве — по id, чтобы ряды не
 *    прыгали между перерисовками.
 * 3. **Каждый узел — ровно один раз.** Узел с двумя родителями встаёт под первого,
 *    дошедшего до него. Цикл в данных (каталог правится руками) не вешает обход: узел,
 *    который уже стоит, не обходится повторно, а узлы, до которых от корней не дойти,
 *    встают отдельными рядами в конце.
 */
export interface HeroTreeRow {
  /** Узел, от которого ряд отходит; `null` — ряд начинается с корня. */
  from: string | null;
  items: string[];
}

export function heroTreeRows(
  nodes: Readonly<Record<string, { requires: readonly string[] }>>,
): HeroTreeRow[] {
  const ids = Object.keys(nodes).sort();
  const inside = new Set(ids);
  const children = new Map<string, string[]>(ids.map((id) => [id, []]));
  for (const id of ids)
    for (const parent of nodes[id]!.requires) if (inside.has(parent)) children.get(parent)!.push(id);
  const heights = new Map<string, number>();
  const height = (id: string, path: ReadonlySet<string>): number => {
    const known = heights.get(id);
    if (known !== undefined) return known;
    const next = new Set(path).add(id);
    const kids = children.get(id)!.filter((c) => !path.has(c) && c !== id);
    const h = kids.length ? 1 + Math.max(...kids.map((c) => height(c, next))) : 0;
    heights.set(id, h);
    return h;
  };
  const placed = new Set<string>();
  const rows: HeroTreeRow[] = [];
  const walk = (id: string, row: HeroTreeRow): void => {
    placed.add(id);
    row.items.push(id);
    const kids = children
      .get(id)!
      .filter((c) => !placed.has(c))
      .sort((a, b) => height(b, new Set()) - height(a, new Set()) || a.localeCompare(b));
    kids.forEach((kid, i) => {
      if (placed.has(kid)) return;
      if (i === 0) return walk(kid, row);
      const branch: HeroTreeRow = { from: id, items: [] };
      rows.push(branch);
      walk(kid, branch);
    });
  };
  const roots = ids.filter((id) => !nodes[id]!.requires.some((p) => inside.has(p)));
  for (const id of [...roots, ...ids]) {
    if (placed.has(id)) continue;
    const row: HeroTreeRow = { from: null, items: [] };
    rows.push(row);
    walk(id, row);
  }
  return rows;
}
