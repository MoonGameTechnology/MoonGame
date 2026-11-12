import {
  diploDisplayName,
  type DiploParticipant,
  type DiploRosterOptions,
  type DiploSort,
} from '../../decisions/diploRoster';
import { t } from '../../localization/runtime';
import type { DiplomaticStance } from '../../packages/shared-core/src/index';
import { STANCES } from './diploEvents';
import { esc } from './format';

interface RosterView extends DiploRosterOptions {
  rows: DiploParticipant[];
  total: number;
  expanded: string | null;
  /** Phone: sorting and filters sit behind one button; PC shows them always and ignores this. */
  toolsOpen: boolean;
  ownerColor(id: string): string;
  stanceCol(stance: DiplomaticStance): string;
  stanceLabel(stance: DiplomaticStance): string;
  badge(id: string): { icon: string; tag: string };
  favour(id: string): string;
  actions(id: string): string;
}

/** Explicit labels also explain equal-value lists where changing the sort may not move a row. */
function orderLabel(view: DiploRosterOptions): string {
  const desc = view.sort.direction === 'desc';
  if (view.sort.key === 'name') return desc ? t('diplo.sort.name.desc') : t('diplo.sort.name.asc');
  if (view.sort.key === 'worlds')
    return desc ? t('diplo.sort.worlds.desc') : t('diplo.sort.worlds.asc');
  return desc ? t('diplo.sort.stance.desc') : t('diplo.sort.stance.asc');
}

function nameHtml(row: DiploParticipant, tag: string): string {
  const nick = row.kind === 'human' && row.nick;
  if (!nick) return `<span class="dp-name">${esc(row.house)} <em>${tag}</em></span>`;
  return (
    `<span class="dp-name"><button class="dp-prof" data-prof="${esc(row.id)}" title="${t('diplo.profile')}">${esc(nick)}</button>` +
    ` <em>${esc(row.house)} · ${tag}</em></span>`
  );
}

/** The list, its search and controls are one surface; treaty actions remain with diploWindow. */
export function diploRosterHtml(view: RosterView): string {
  const sortBtn = (key: DiploSort, label: string): string => {
    const active = view.sort.key === key;
    const arrow = active ? (view.sort.direction === 'asc' ? ' ↑' : ' ↓') : '';
    return `<button class="dp-sortb btn-second${active ? ' on' : ''}" data-sort="${key}" aria-pressed="${active}">${label}<span aria-hidden="true">${arrow}</span></button>`;
  };
  const stChip = (key: DiplomaticStance): string =>
    `<button class="dp-fchip btn-second${view.stances.has(key) ? ' on' : ''}" data-fstance="${key}" aria-pressed="${view.stances.has(key)}">${view.stanceLabel(key)}</button>`;
  const tyChip = (key: 'human' | 'ai', label: string): string =>
    `<button class="dp-fchip ty btn-second${view.kinds.has(key) ? ' on' : ''}" data-ftype="${key}" aria-pressed="${view.kinds.has(key)}">${label}</button>`;
  const filtered = view.query.length || view.stances.size || view.kinds.size;
  const rows = view.rows
    .map((row) => {
      const isMe = row.stance === null;
      const expanded = view.expanded === row.id && !isMe;
      const badge = view.badge(row.id);
      const stance =
        row.stance === null
          ? `<span class="dp-tag">${t('comms.you')}</span>`
          : `<span class="dp-stance" style="color:${view.stanceCol(row.stance)};border-color:${view.stanceCol(row.stance)}">${view.stanceLabel(row.stance)}</span>`;
      return (
        `<div class="dp-row${expanded ? ' open' : ''}${isMe ? ' me' : ''}" data-roster-seat="${esc(row.id)}"${isMe ? '' : ` data-seat="${esc(row.id)}"`}>` +
        `<span class="dp-ic" style="color:${view.ownerColor(row.id)}">${badge.icon}</span>` +
        nameHtml(row, badge.tag) +
        `<span class="dp-w" title="${t('comms.provinces')}">⬣ ${row.worlds}</span>` +
        stance +
        (isMe
          ? ''
          : `<button class="dp-expand btn-quiet" data-expand="${esc(row.id)}" aria-expanded="${expanded}" aria-label="${esc(t('diplo.actions', { name: diploDisplayName(row) }))}">${expanded ? '▴' : '▾'}</button>`) +
        (!isMe && row.kind === 'ai' ? view.favour(row.id) : '') +
        `</div>` +
        (expanded ? view.actions(row.id) : '')
      );
    })
    .join('');
  const active = view.stances.size + view.kinds.size;
  const toggle =
    `<button class="dp-ftoggle btn-second${view.toolsOpen ? ' on' : ''}" aria-expanded="${view.toolsOpen}">` +
    `${t('diplo.filter')}${active ? ` <b>${active}</b>` : ''}</button>`;
  return (
    `<div class="dp-tools${view.toolsOpen ? ' open' : ''}${filtered ? ' filtered' : ''}">` +
    `<label class="dp-search"><span>${t('diplo.search')}</span><input id="dp-search" type="search" autocomplete="off" maxlength="120" placeholder="${t('diplo.search')}" value="${esc(view.query)}"></label>` +
    toggle +
    `<div class="dp-sorts" role="group" aria-label="${t('diplo.sort')}"><span>${t('diplo.sort')}</span>` +
    sortBtn('name', t('diplo.sort.name')) +
    sortBtn('worlds', t('diplo.sort.provinces')) +
    sortBtn('stance', t('diplo.sort.stance')) +
    `</div>` +
    `<div class="dp-filters" role="group" aria-label="${t('diplo.filter')}">${STANCES.map(stChip).join('')}` +
    `<span class="dp-fsep"></span>${tyChip('human', t('diplo.filter.human'))}${tyChip('ai', t('diplo.filter.ai'))}</div>` +
    `<div class="dp-summary"><span role="status">${t('diplo.results', { shown: view.rows.length, total: view.total })}</span>` +
    `<span>${orderLabel(view)}</span>${filtered ? `<button class="dp-fclear btn-quiet">${t('diplo.filter.reset')}</button>` : ''}</div></div>` +
    `<div class="dp-list">${rows || `<div class="dp-empty">${t('comms.filter.empty')}</div>`}</div>`
  );
}

/** Full window renders must not discard a typed query's caret, keyboard focus or scroll. */
export function rememberRosterUi(root: HTMLElement, resetScroll: boolean): () => void {
  if (!root.querySelector) return () => {};
  const active = document.activeElement as HTMLInputElement | null;
  const focused = active && root.contains?.(active) ? active : null;
  const attrs = ['data-sort', 'data-fstance', 'data-ftype', 'data-expand', 'data-prof'];
  const attr = attrs.find((key) => focused?.hasAttribute(key));
  const selector =
    focused?.id === 'dp-search'
      ? '#dp-search'
      : attr
        ? `[${attr}="${CSS.escape(focused!.getAttribute(attr)!)}"]`
        : focused?.classList.contains('dp-fclear')
          ? '#dp-search'
          : focused?.classList.contains('dp-ftoggle')
            ? '.dp-ftoggle'
            : null;
  const start = focused?.selectionStart;
  const end = focused?.selectionEnd;
  const scroll = resetScroll ? 0 : (root.querySelector<HTMLElement>('.dp-list')?.scrollTop ?? 0);
  const toolsScroll = root.querySelector<HTMLElement>('.dp-tools')?.scrollTop ?? 0;
  return () => {
    const input = selector ? root.querySelector<HTMLInputElement>(selector) : null;
    input?.focus({ preventScroll: true });
    if (input?.id === 'dp-search' && start != null && end != null)
      input.setSelectionRange(start, end);
    const list = root.querySelector<HTMLElement>('.dp-list');
    if (list) list.scrollTop = scroll;
    const tools = root.querySelector<HTMLElement>('.dp-tools');
    if (tools) tools.scrollTop = toolsScroll;
  };
}
