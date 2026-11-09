/**
 * СПИСОК «◇ АВИАЦИЯ» (UIX-10.15, концепт «Управление эскадрой», заказ владельца 2026-11-08):
 * все свои эскадры одним списком, чтобы не искать их по карте. Группы и порядок —
 * `decisions/aviationList.ts`; здесь сбор строк из мира, разметка и проводка.
 *
 * ПК: чип «◇ Авиация N» в строке статуса справа, список — панелью справа; карточка
 * выбранной эскадры при этом открыта слева, оба окна живут вместе. Телефон: плавающая
 * кнопка над нижней панелью справа (только когда эскадры есть и ничего не выделено),
 * список — листом на нижние 56% экрана; тап по строке закрывает его и открывает карточку.
 *
 * Строка: позывной, число бортов и та же строка состояния, что в карточке эскадры. Тап
 * выделяет эскадру и ведёт к ней камеру.
 */
import type { GameState } from '../../packages/shared-core/src/index';
import { t } from '../../localization/runtime';
import { aloftCard } from '../../decisions/aloftCard';
import {
  aviationFabShown,
  aviationGroups,
  type AviationGroupId,
  type AviationRow,
} from '../../decisions/aviationList';
import { aloftOrderText } from './fleetCard';
import { fleetPos, strikeWorldPos } from './fleetGeometry';
import { esc } from './format';
import { data } from './game';
import { fleetHangar, planetHangar, type HangarView } from './hangarPanel';
import { liveTimerHtml, patchLiveTimers } from './liveTimers';
import { parkedStatusText } from './squadronCardView';
import { squadronCallsignOf } from './squadronPanel';

/** Что списку нужно от игры. */
export interface AviationHost {
  world(): GameState;
  me(): string;
  mobile(): boolean;
  /** Выделено ли что-нибудь на карте: плавающая кнопка тогда уступает место листу. */
  selected(): boolean;
  /** Выделить эскадру (стоянка) или её вылет (воздух) и подвести камеру к точке. */
  pick(row: AviationRow, at: { x: number; y: number } | null): void;
}

let host: AviationHost;
let panel: HTMLElement;
let fab: HTMLButtonElement;
let open = false;
let lastHtml = '';

/** Строки последнего мира: кнопка и лист спрашивают их каждый кадр, а мир между приказами
 *  и шагами часов — тот же объект (состояние неизменяемое). */
let memo: { s: GameState; me: string; rows: AviationRow[] } | null = null;

/** Строки списка: свои вылеты, затем стоянки — порты миров и трюмы носителей. */
export function aviationRows(s: GameState, me: string): AviationRow[] {
  if (memo?.s === s && memo.me === me) return memo.rows;
  const rows: AviationRow[] = [];
  for (const st of s.strikes ?? []) {
    if (st.owner !== me) continue;
    const ships = st.units.reduce((n, u) => n + u.count, 0);
    if (ships > 0)
      rows.push({
        kind: 'aloft',
        strikeId: st.id,
        squadronId: st.squadronId,
        ships,
        endsAt: st.arrivesAt,
      });
  }
  const parked = (view: HangarView | null) => {
    for (const sq of view?.squadrons ?? []) {
      const ships = sq.units.reduce((n, u) => n + u.count, 0);
      if (ships === 0) continue;
      const rearmHours = view!.blocked === 'rearming' ? (view!.sortie?.rearming ?? null) : null;
      rows.push({ kind: 'parked', squadronId: sq.id, ships, block: view!.blocked, rearmHours });
    }
  };
  for (const p of Object.values(s.planets))
    if (p.owner === me && p.hangar?.length) parked(planetHangar(p, data));
  for (const f of Object.values(s.fleets))
    if (f.owner === me && f.hangar?.length) parked(fleetHangar(f, data, s));
  memo = { s, me, rows };
  return rows;
}

/** Сколько своих эскадр — число на кнопке. */
export function aviationCount(): number {
  return aviationRows(host.world(), host.me()).length;
}

const GROUP_KEY: Record<AviationGroupId, string> = {
  aloft: 'avia.group.aloft',
  ready: 'avia.group.ready',
  waiting: 'avia.group.waiting',
};

function statusHtml(row: AviationRow, s: GameState, me: string): string {
  if (row.kind === 'parked') return esc(parkedStatusText(row.squadronId, { world: s, me }) ?? '');
  const st = (s.strikes ?? []).find((x) => x.id === row.strikeId);
  const card = st && aloftCard(st, { me, data, relocate: false, split: false });
  return card ? `${esc(aloftOrderText(card))} · ${liveTimerHtml(card.until)}` : '';
}

/** Разметка списка: шапка и группы, без пустых. */
export function aviationHtml(s: GameState, me: string): string {
  const groups = aviationGroups(aviationRows(s, me));
  let h =
    `<header class="av-head"><b>◇ ${esc(t('avia.title'))}</b>` +
    `<button type="button" class="btn-x" data-avia-close="1" aria-label="${esc(t('card.close'))}">✕</button></header>`;
  if (groups.length === 0) return h + `<div class="av-empty dim">${esc(t('avia.empty'))}</div>`;
  for (const g of groups) {
    h += `<div class="av-group"><div class="av-gh">${esc(t(GROUP_KEY[g.id]))} · ${g.rows.length}</div>`;
    for (const row of g.rows) {
      const arg = row.kind === 'aloft' ? `strike:${row.strikeId}` : `sq:${row.squadronId}`;
      h +=
        `<button type="button" class="av-row" data-avia="${esc(arg)}">` +
        `<span class="av-name"><b>${esc(squadronCallsignOf(row.squadronId))}</b>` +
        `<i>${esc(t('avia.ships', { n: row.ships }))}</i></span>` +
        `<span class="av-st">${statusHtml(row, s, me)}</span></button>`;
    }
    h += `</div>`;
  }
  return h;
}

/** Где эскадра сейчас — в мировых координатах. */
function rowPoint(row: AviationRow, s: GameState): { x: number; y: number } | null {
  if (row.kind === 'aloft') return strikeWorldPos(row.strikeId);
  for (const p of Object.values(s.planets))
    if ((p.hangar ?? []).some((q) => q.id === row.squadronId)) return p.position;
  for (const f of Object.values(s.fleets))
    if ((f.hangar ?? []).some((q) => q.id === row.squadronId)) return fleetPos(f);
  return null;
}

export function aviationOpen(): boolean {
  return open;
}

export function closeAviation(): void {
  open = false;
  panel.classList.remove('show');
}

export function toggleAviation(): void {
  open = !open;
  lastHtml = '';
  panel.classList.toggle('show', open);
  renderAviation();
}

/** Кадр: список, пока открыт (разметка меняется только при смене состава), и кнопка телефона. */
export function renderAviation(): void {
  const s = host.world();
  if (open) {
    const html = aviationHtml(s, host.me());
    if (html !== lastHtml) {
      panel.innerHTML = html;
      lastHtml = html;
    }
    patchLiveTimers(panel, s.time);
  }
  const count = host.mobile() ? aviationRows(s, host.me()).length : 0;
  const shown = host.mobile() && !open && aviationFabShown(count, host.selected());
  if (fab.hidden === shown) fab.hidden = !shown;
  const label = `◇ ${count}`;
  if (shown && fab.textContent !== label) fab.textContent = label;
}

/** Подключить список к игре. Зовётся из `main.ts` один раз. */
export function initAviation(h: AviationHost): void {
  host = h;
  panel = document.getElementById('aviapanel')!;
  fab = document.getElementById('avia-fab') as HTMLButtonElement;
  fab.setAttribute('aria-label', t('avia.title'));
  fab.addEventListener('click', toggleAviation);
  panel.addEventListener('click', (ev) => {
    const el = ev.target as Element;
    if (el.closest('[data-avia-close]')) return closeAviation();
    const arg = el.closest<HTMLElement>('[data-avia]')?.dataset.avia;
    if (!arg) return;
    const s = host.world();
    const row = aviationRows(s, host.me()).find((r) =>
      r.kind === 'aloft' ? arg === `strike:${r.strikeId}` : arg === `sq:${r.squadronId}`,
    );
    if (!row) return;
    // Телефон: лист списка уступает место карточке (правило концепта).
    if (host.mobile()) closeAviation();
    host.pick(row, rowPoint(row, s));
  });
}
