import { describe, expect, it } from 'vitest';
import { skillTreeLayout } from '../../decisions/skillTreeLayout';
import { skillTreeHtml, TREE_NODE_Y, type SkillNodeView } from './academyTree';

/** a → b → c, a → d: две ветки от одного корня. */
const layout = skillTreeLayout(
  ['a', 'b', 'c', 'd'],
  (id) => ({ b: ['a'], c: ['b'], d: ['a'] })[id] ?? [],
);
const view = (state: SkillNodeView['state']): SkillNodeView => ({
  name: state,
  state,
  stateLabel: `~${state}`,
});
const html = skillTreeHtml(
  layout,
  { a: view('owned'), b: view('open'), c: view('locked'), d: view('open') },
  'b',
);

describe('дерево навыков Академии (PVR-6.25)', () => {
  it('каждая связь — линия от центра кружка предпосылки к центру кружка узла', () => {
    const lines = [
      ...html.matchAll(/<line x1="([\d.]+)" y1="([\d.]+)" x2="([\d.]+)" y2="([\d.]+)"/g),
    ].map((m) => m.slice(1).map(Number));
    expect(lines).toHaveLength(layout.edges.length);
    const center = (id: string) => [
      layout.nodes[id]!.col + 0.5,
      layout.nodes[id]!.row + TREE_NODE_Y,
    ];
    expect(lines).toEqual(layout.edges.map((e) => [...center(e.from), ...center(e.to)]));
    // Рисунок в клетках: viewBox — ровно размер сетки, и растягивается на неё целиком.
    expect(html).toContain(
      `viewBox="0 0 ${layout.cols} ${layout.rows}" preserveAspectRatio="none"`,
    );
  });

  it('линия от изученного узла светится, от неизученного — пунктир', () => {
    const classes = [...html.matchAll(/<line [^>]*class="(\w+)"/g)].map((m) => m[1]);
    // a (изучен) → b, a → d светятся; b (не изучен) → c — пунктир.
    const expected = layout.edges.map((e) => (e.from === 'a' ? 'lit' : 'dim'));
    expect(classes).toEqual(expected);
  });

  it('узел — кнопка на своей клетке с состоянием, видимым без текста', () => {
    const node = (id: string) =>
      html.match(new RegExp(`<button[^>]*data-id="${id}"[^>]*>.*?</button>`))?.[0] ?? '';
    expect(node('a')).toContain('class="sz-tree-node owned"');
    expect(node('a')).toContain('<i aria-hidden="true">✓</i>');
    expect(node('c')).toContain('class="sz-tree-node locked"');
    expect(node('d')).toContain('<i aria-hidden="true">+</i>');
    const cell = layout.nodes.c!;
    expect(node('c')).toContain(`style="--c:${cell.col};--r:${cell.row}"`);
    expect(node('c')).toContain('data-prep="skill-node"');
    // Состояние для диктора — словом, глиф ему не виден.
    expect(node('c')).toContain('aria-label="locked: ~locked"');
  });

  it('выбранный узел помечен, остальные — нет', () => {
    expect(html.match(/sz-tree-node \w+ selected/g)).toEqual(['sz-tree-node open selected']);
    expect(html).toContain('data-id="b" style="--c:1;--r:0" aria-pressed="true"');
  });
});
