/**
 * Окно коалиций (COAL-1, заказ владельца 2026-10-20): список всех коалиций партии и
 * карточка одной коалиции — эмблема, описание, состав и вместимость.
 *
 * Коалиция — сущность ядра (`state/coalition.ts`): её создаёт принятый союз, потолок
 * состава держит сервер. Окно только показывает её и отдаёт два приказа: правку эмблемы
 * с описанием и выход. Открывается кнопкой полосы `#rail-coal`.
 */
import { t } from '../../localization/runtime';
import {
  COALITION_DESC_MAX,
  COALITION_EMBLEMS,
  coalitionCapacity,
  coalitionOf,
  hasFixedSides,
  type Action,
  type Coalition,
  type GameState,
} from '../../packages/shared-core/src/index';
import { esc } from './format';
import { editCoalition, leaveCoalition } from './game';

/** Что окну нужно от игры. */
export interface CoalitionWindowHost {
  state(): GameState;
  me(): string;
  names(): Readonly<Record<string, string>>;
  ownerColor(owner: string): string;
  /** Приказ игрока: в сети — серверу, в соло — миру. */
  playerOrder(action: Action): boolean;
}

/** Картинка эмблемы: ядро хранит id, глиф выбирает клиент. */
export const EMBLEM_GLYPH: Record<(typeof COALITION_EMBLEMS)[number], string> = {
  star: '★',
  sun: '☀',
  moon: '☾',
  comet: '☄',
  swords: '⚔',
  crown: '♛',
  skull: '☠',
  gear: '⚙',
  atom: '⚛',
  trident: '♆',
  eye: '◉',
  shield: '⛨',
};
const glyph = (id: string): string => EMBLEM_GLYPH[id as keyof typeof EMBLEM_GLYPH] ?? '★';

let game: CoalitionWindowHost;
export let coalOpen = false;
/** Открытая карточка (id коалиции) или null — список. */
let viewing: string | null = null;
/** Выбранная в карточке эмблема до сохранения. */
let draftEmblem: string | null = null;
/** Первый тап «выйти» только просит подтверждения. */
let confirmLeave = false;
/** Что окно нарисовало последним: коалиции партии и описание в поле ввода. */
let drawn = '';
let drawnDesc = '';

function all(): Coalition[] {
  const c = game.state().coalitions ?? {};
  return Object.keys(c)
    .sort()
    .map((id) => c[id]!);
}
function nameOf(id: string): string {
  return game.names()[id] ?? id;
}
function titleOf(c: Coalition): string {
  return t('coal.name', { who: esc(nameOf(c.founder)) });
}
function seatsHtml(c: Coalition, cap: number): string {
  const full = c.members.length >= cap;
  return `<span class="cw-seats${full ? ' full' : ''}">☻ ${c.members.length} / ${cap}</span>`;
}

function listHtml(): string {
  const s = game.state();
  // В командном режиме стороны задаёт режим, коалиций-сущностей нет.
  if (hasFixedSides(s.modeId)) return `<div class="cw-hint">${t('coal.fixed')}</div>`;
  const cap = coalitionCapacity(s);
  const mine = coalitionOf(s, game.me());
  const rows = all()
    .map((c) => {
      const members = c.members
        .map((id) => `<b style="color:${game.ownerColor(id)}">${esc(nameOf(id))}</b>`)
        .join(', ');
      return (
        `<button class="cw-row${c.id === mine?.id ? ' mine' : ''}" data-coal="${esc(c.id)}">` +
        `<span class="cw-emb">${glyph(c.emblem)}</span>` +
        `<span class="cw-main"><span class="cw-name">${titleOf(c)}` +
        (c.id === mine?.id ? ` <em>${t('coal.mine')}</em>` : '') +
        `</span><span class="cw-members">${members}</span>` +
        (c.description ? `<span class="cw-desc">${esc(c.description)}</span>` : '') +
        `</span>${seatsHtml(c, cap)}</button>`
      );
    })
    .join('');
  return (
    `<div class="cw-cap">${t('coal.capacity', { n: cap })}</div>` +
    (mine ? '' : `<div class="cw-hint">${t('coal.how')}</div>`) +
    `<div class="cw-list">${rows || `<div class="dp-empty">${t('coal.none')}</div>`}</div>`
  );
}

function cardHtml(c: Coalition): string {
  const s = game.state();
  const cap = coalitionCapacity(s);
  const mine = c.members.includes(game.me());
  const emblem = draftEmblem ?? c.emblem;
  const members = c.members
    .map(
      (id) =>
        `<div class="cw-mem"><span class="cw-dot" style="background:${game.ownerColor(id)}"></span>${esc(nameOf(id))}</div>`,
    )
    .join('');
  const free = Math.max(0, cap - c.members.length);
  const slots = Array.from({ length: free }, () => `<div class="cw-mem empty">—</div>`).join('');
  const picker = mine
    ? `<div class="cw-sec">${t('coal.emblem')}</div><div class="cw-pick">` +
      COALITION_EMBLEMS.map(
        (id) =>
          `<button class="cw-eb${id === emblem ? ' on' : ''}" data-emblem="${id}">${glyph(id)}</button>`,
      ).join('') +
      `</div>`
    : '';
  const desc = mine
    ? `<div class="cw-sec">${t('coal.desc')}</div>` +
      `<textarea id="cw-text" maxlength="${COALITION_DESC_MAX}" rows="3" placeholder="${t('coal.desc.ph')}">${esc(c.description)}</textarea>` +
      `<div class="cw-acts"><button class="cw-save">${t('coal.save')}</button>` +
      `<button class="cw-leave${confirmLeave ? ' sure' : ''}">${confirmLeave ? t('coal.leave.confirm') : t('coal.leave')}</button></div>`
    : `<div class="cw-sec">${t('coal.desc')}</div>` +
      `<div class="cw-text">${c.description ? esc(c.description) : t('coal.desc.empty')}</div>`;
  return (
    `<button class="cw-back">${t('coal.back')}</button>` +
    `<div class="cw-hero"><span class="cw-big">${glyph(emblem)}</span>` +
    `<span class="cw-main"><span class="cw-name">${titleOf(c)}</span>${seatsHtml(c, cap)}</span></div>` +
    `<div class="cw-sec">${t('coal.members')}</div><div class="cw-mems">${members}${slots}</div>` +
    picker +
    desc
  );
}

export function renderCoalitions(): void {
  const el = document.getElementById('coalwin');
  if (!el) return;
  const card = viewing ? (game.state().coalitions?.[viewing] ?? null) : null;
  if (viewing && !card) viewing = null; // коалицию распустили, пока карточка была открыта
  // Недописанное описание переживает перерисовку от чужой правки.
  const area = document.getElementById('cw-text') as HTMLTextAreaElement | null;
  const typed = area && area.value !== drawnDesc ? area.value : null;
  drawn = signature();
  drawnDesc = card?.description ?? '';
  el.innerHTML =
    `<div class="dpbox cwbox">` +
    `<div class="dp-head"><b class="cw-title">${t('coal.win.title')}</b><button class="dp-close btn-x">✕</button></div>` +
    `<div class="cw-body">${card ? cardHtml(card) : listHtml()}</div></div>`;
  const fresh = document.getElementById('cw-text') as HTMLTextAreaElement | null;
  if (fresh && typed !== null) fresh.value = typed;
}

function signature(): string {
  const s = game.state();
  return JSON.stringify([s.coalitions ?? null, coalitionCapacity(s)]);
}
/** Новый снимок мира: перерисовать открытое окно, если коалиции изменились. Чужую
 *  правку эмблемы или описания событие не приносит — его видит только автор. */
export function syncCoalitions(): void {
  if (coalOpen && signature() !== drawn) renderCoalitions();
}

export function openCoalitions(): void {
  coalOpen = true;
  viewing = null;
  draftEmblem = null;
  confirmLeave = false;
  renderCoalitions();
  document.getElementById('coalwin')?.classList.add('show');
}
export function closeCoalitions(): void {
  coalOpen = false;
  document.getElementById('coalwin')?.classList.remove('show');
}

/** Поднять окно. Зовётся из `main.ts` один раз. */
export function initCoalitionWindow(host: CoalitionWindowHost): void {
  game = host;
  document.getElementById('rail-coal')?.addEventListener('click', openCoalitions);
  const el = document.getElementById('coalwin');
  if (!el) return;
  el.addEventListener('click', (e) => {
    const tg = e.target as HTMLElement;
    if (tg.id === 'coalwin' || tg.closest('.dp-close')) return closeCoalitions();
    if (tg.closest('.cw-back')) {
      viewing = null;
      draftEmblem = null;
      confirmLeave = false;
      return renderCoalitions();
    }
    const row = (tg.closest('[data-coal]') as HTMLElement | null)?.dataset.coal;
    if (row) {
      viewing = row;
      draftEmblem = null;
      confirmLeave = false;
      return renderCoalitions();
    }
    const emblem = (tg.closest('[data-emblem]') as HTMLElement | null)?.dataset.emblem;
    if (emblem) {
      draftEmblem = emblem; // текст описания переживает перерисовку: эмблему выбирают, пока пишут
      return renderCoalitions();
    }
    const mine = coalitionOf(game.state(), game.me());
    if (tg.closest('.cw-save') && mine) {
      // Ядро не берёт управляющих символов, а Enter в поле даёт перевод строки.
      const text = ((document.getElementById('cw-text') as HTMLTextAreaElement | null)?.value ?? '')
        // eslint-disable-next-line no-control-regex
        .replace(/[\u0000-\u001f\u007f]/g, ' ');
      game.playerOrder(
        editCoalition(game.me(), draftEmblem ?? mine.emblem, text.slice(0, COALITION_DESC_MAX)),
      );
      draftEmblem = null;
      return renderCoalitions();
    }
    if (tg.closest('.cw-leave') && mine) {
      if (!confirmLeave) {
        confirmLeave = true;
        return renderCoalitions();
      }
      confirmLeave = false;
      game.playerOrder(leaveCoalition(game.me()));
      viewing = null;
      return renderCoalitions();
    }
  });
}
