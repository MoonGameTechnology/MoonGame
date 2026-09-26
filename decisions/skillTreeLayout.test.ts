import { describe, expect, it } from 'vitest';
import { shippedGameData } from '../data/bundle';
import { skillNodeState, skillTreeLayout } from './skillTreeLayout';
import { freshSectorZeroProgress, sectorSkillCard } from './sectorZeroProgress';

/** Узлы с предпосылками — как в `data.heroSkillTrees`. */
const tree = (edges: Record<string, string[]>) => ({
  ids: Object.keys(edges),
  requiresOf: (id: string) => edges[id] ?? [],
});

describe('раскладка дерева навыков Академии (PVR-6.25)', () => {
  it('колонка — глубина от корня, строка — порядок обхода; родитель на строке первого ребёнка', () => {
    const { ids, requiresOf } = tree({ a: [], b: ['a'], c: ['a'], d: ['b'], e: [] });
    const l = skillTreeLayout(ids, requiresOf);
    expect(l.nodes).toEqual({
      a: { col: 0, row: 0 },
      b: { col: 1, row: 0 },
      d: { col: 2, row: 0 },
      c: { col: 1, row: 1 },
      e: { col: 0, row: 2 },
    });
    expect([l.cols, l.rows]).toEqual([3, 3]);
  });

  it('связи — от предпосылки к узлу, по одной на ребро', () => {
    const { ids, requiresOf } = tree({ a: [], b: ['a'], c: ['a'] });
    expect(skillTreeLayout(ids, requiresOf).edges).toEqual([
      { from: 'a', to: 'b' },
      { from: 'a', to: 'c' },
    ]);
  });

  it('у второй предпосылки тоже есть линия: узел требует обе и показывает обе', () => {
    const { ids, requiresOf } = tree({ a: [], b: [], c: ['a', 'b'] });
    const l = skillTreeLayout(ids, requiresOf);
    expect(l.nodes.c).toEqual({ col: 1, row: 0 }); // место — по первой предпосылке
    expect(l.edges).toEqual([
      { from: 'a', to: 'c' },
      { from: 'b', to: 'c' },
    ]);
  });

  it('предпосылка вне набора (ветка другого героя) делает узел корнем, связи нет', () => {
    const { ids, requiresOf } = tree({ b: ['elsewhere'] });
    const l = skillTreeLayout(ids, requiresOf);
    expect(l.nodes.b).toEqual({ col: 0, row: 0 });
    expect(l.edges).toEqual([]);
  });

  it('петля в данных не вешает раскладку: каждый узел ставится один раз', () => {
    const { ids, requiresOf } = tree({ a: ['b'], b: ['a'], c: [] });
    const l = skillTreeLayout(ids, requiresOf);
    expect(Object.keys(l.nodes).sort()).toEqual(['a', 'b', 'c']);
  });

  it('шипнутое дерево: каждый узел на своей клетке, связь всегда идёт на колонку вправо', () => {
    const data = shippedGameData();
    const ids = Object.keys(data.heroSkillTrees);
    const l = skillTreeLayout(ids, (id) => data.heroSkillTrees[id]?.requires ?? []);
    expect(Object.keys(l.nodes).sort()).toEqual([...ids].sort());
    const cells = new Set(Object.values(l.nodes).map((n) => `${n.col}:${n.row}`));
    expect(cells.size).toBe(ids.length);
    for (const e of l.edges)
      expect(l.nodes[e.to]!.col, `${e.from}→${e.to}`).toBe(l.nodes[e.from]!.col + 1);
    // Каждая предпосылка каталога нарисована линией.
    const relations = ids.flatMap((id) =>
      (data.heroSkillTrees[id]?.requires ?? []).map((r) => `${r}>${id}`),
    );
    expect(l.edges.map((e) => `${e.from}>${e.to}`).sort()).toEqual(relations.sort());
  });
});

describe('состояние узла дерева (PVR-6.25)', () => {
  it('изучен → owned, не хватает предпосылок → locked, иначе → open', () => {
    expect(skillNodeState({ owned: true, missing: [] })).toBe('owned');
    expect(skillNodeState({ owned: false, missing: ['a'] })).toBe('locked');
    expect(skillNodeState({ owned: false, missing: [] })).toBe('open');
  });

  it('командир нового профиля: врождённые узлы изучены, их дети доступны, дальше закрыто', () => {
    const data = shippedGameData();
    const progress = freshSectorZeroProgress(data, 'tree');
    const hero = progress.heroes.commander!;
    const state = (id: string) => skillNodeState(sectorSkillCard('commander', hero, id, data));
    const innate = Object.keys(data.heroSkillTrees).filter((id) => state(id) === 'owned');
    expect(innate.length).toBeGreaterThan(0);
    for (const id of Object.keys(data.heroSkillTrees)) {
      const reqs = data.heroSkillTrees[id]!.requires ?? [];
      if (state(id) === 'owned') continue;
      // Узел закрыт ровно тогда, когда хоть одна предпосылка не изучена.
      expect([id, state(id)]).toEqual([
        id,
        reqs.every((r) => state(r) === 'owned') ? 'open' : 'locked',
      ]);
    }
  });
});
