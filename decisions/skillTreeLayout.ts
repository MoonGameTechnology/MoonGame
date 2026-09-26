/**
 * Раскладка дерева навыков Академии (PVR-6.25, решение владельца 2026-09-25 «навыки деревом
 * с линиями»): где стоит каждый узел и какие линии его связывают. Только числа клеток — ни
 * пикселей, ни DOM: рисует прототип, а правило «кто где» живёт здесь и проверяется тестом.
 *
 * Дерево — лес: в шипнутых данных у узла не больше одной предпосылки. Колонка — глубина от
 * корня, поэтому связь идёт на соседнюю колонку вправо и не пересекает узлы. Строка — порядок
 * обхода в глубину: лист занимает следующую свободную строку, родитель встаёт на строку
 * первого ребёнка, и ветка читается слева направо одной линией. Порядок — порядок входного
 * списка (каталога), так что раскладка детерминирована.
 *
 * Место узла задаёт ПЕРВАЯ предпосылка из набора, но линия есть у КАЖДОЙ: узел с двумя
 * предпосылками иначе показывал бы одну, а требовал обе.
 */

export interface TreeCell {
  col: number;
  row: number;
}
export interface TreeLayout {
  nodes: Record<string, TreeCell>;
  edges: { from: string; to: string }[];
  cols: number;
  rows: number;
}

export function skillTreeLayout(
  ids: readonly string[],
  requiresOf: (id: string) => readonly string[],
): TreeLayout {
  const inSet = new Set(ids);
  // Предпосылка вне набора (узел чужой ветки) делает узел корнем: тянуть линию некуда.
  const parentOf = (id: string): string | undefined => requiresOf(id).find((r) => inSet.has(r));
  const children = new Map<string, string[]>();
  for (const id of ids) {
    const parent = parentOf(id);
    if (parent !== undefined) children.set(parent, [...(children.get(parent) ?? []), id]);
  }
  const nodes: Record<string, TreeCell> = {};
  const edges: { from: string; to: string }[] = [];
  let next = 0;
  const place = (id: string, col: number): number => {
    // Петля в данных (a требует b, b требует a) не вешает обход: узел ставится один раз.
    if (nodes[id]) return nodes[id].row;
    nodes[id] = { col, row: -1 };
    const kids = (children.get(id) ?? []).filter((kid) => !nodes[kid]);
    let row = -1;
    for (const kid of kids) {
      edges.push({ from: id, to: kid });
      const at = place(kid, col + 1);
      if (row < 0) row = at;
    }
    if (row < 0) row = next++;
    nodes[id].row = row;
    return row;
  };
  for (const id of ids) if (parentOf(id) === undefined) place(id, 0);
  // Узлы петли корня не имеют — ставим их отдельными корнями, чтобы ни один не пропал.
  for (const id of ids) if (!nodes[id]) place(id, 0);
  // Остальные предпосылки из набора — тоже линии (место узла они не меняют).
  const drawn = new Set(edges.map((e) => `${e.from}>${e.to}`));
  for (const id of ids)
    for (const r of requiresOf(id))
      if (inSet.has(r) && r !== id && !drawn.has(`${r}>${id}`)) {
        drawn.add(`${r}>${id}`);
        edges.push({ from: r, to: id });
      }
  const cells = Object.values(nodes);
  return {
    nodes,
    edges,
    cols: cells.reduce((m, c) => Math.max(m, c.col + 1), 0),
    rows: next,
  };
}

/** Состояние узла в дереве Академии — то, что игрок видит без чтения текста. */
export type SkillNodeState = 'owned' | 'open' | 'locked';

/**
 * Изучен, можно изучить сейчас или закрыт предпосылками. Читает карточку узла
 * (`sectorSkillCard`), а не список купленного: врождённый узел героя в покупках не лежит,
 * но изучен (AUD-22). Хватит ли на него данных — вопрос кнопки, а не узла: доступный узел
 * остаётся доступным и с пустым кошельком.
 */
export function skillNodeState(card: {
  owned: boolean;
  missing: readonly string[];
}): SkillNodeState {
  return card.owned ? 'owned' : card.missing.length > 0 ? 'locked' : 'open';
}
