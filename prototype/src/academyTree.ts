/**
 * Дерево навыков Академии (PVR-6.25, решение владельца 2026-09-25 «навыки деревом с
 * линиями»): узлы стоят по клеткам `skillTreeLayout`, связи — линии SVG под узлами.
 *
 * Клетка — CSS-переменные `--c`/`--r`, шаг клетки задаёт CSS (`--px`/`--py`, на телефоне
 * свой). Линии лежат в SVG с `viewBox` в КЛЕТКАХ и `preserveAspectRatio="none"`: рисунок
 * растягивается на ту же сетку, и концы линий попадают в центры кружков при любом шаге —
 * без пересчёта в пиксели.
 *
 * Состояние узла видно без чтения текста: изученный — залитый кружок с ✓, доступный —
 * яркий контур с «+», закрытый — пунктир с замком. Линия от изученного узла светится, от
 * неизученного идёт пунктиром.
 */
import type { SkillNodeState, TreeLayout } from '../../decisions/skillTreeLayout';
import { esc } from './format';

export interface SkillNodeView {
  /** Имя узла, уже переведённое. */
  name: string;
  state: SkillNodeState;
  /** Подпись состояния для экранного диктора: глиф в кружке ему не виден. */
  stateLabel: string;
}

/** Центр кружка по вертикали — доля высоты клетки. Та же доля стоит в CSS
 *  (`.sz-tree-node`, отступ сверху `--py × 0.4 − 20px`). */
export const TREE_NODE_Y = 0.4;

const GLYPH: Record<SkillNodeState, string> = { owned: '✓', open: '+', locked: '🔒' };

export function skillTreeHtml(
  layout: TreeLayout,
  nodes: Record<string, SkillNodeView>,
  selected: string | null,
): string {
  const lines = layout.edges
    .map(({ from, to }) => {
      const a = layout.nodes[from];
      const b = layout.nodes[to];
      if (!a || !b) return '';
      const lit = nodes[from]?.state === 'owned';
      return `<line x1="${a.col + 0.5}" y1="${a.row + TREE_NODE_Y}" x2="${b.col + 0.5}" y2="${b.row + TREE_NODE_Y}" class="${lit ? 'lit' : 'dim'}"/>`;
    })
    .join('');
  const buttons = Object.entries(layout.nodes)
    .map(([id, cell]) => {
      const v = nodes[id];
      if (!v) return '';
      const on = id === selected;
      return `<button type="button" class="sz-tree-node ${v.state}${on ? ' selected' : ''}" data-prep="skill-node" data-id="${esc(id)}" style="--c:${cell.col};--r:${cell.row}" aria-pressed="${on}" aria-label="${esc(`${v.name}: ${v.stateLabel}`)}"><i aria-hidden="true">${GLYPH[v.state]}</i><span>${esc(v.name)}</span></button>`;
    })
    .join('');
  return `<div class="sz-tree-wrap"><div class="sz-tree" style="--cols:${layout.cols};--rows:${layout.rows}"><svg viewBox="0 0 ${layout.cols} ${layout.rows}" preserveAspectRatio="none" aria-hidden="true">${lines}</svg>${buttons}</div></div>`;
}
