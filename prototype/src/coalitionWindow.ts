/**
 * Окно коалиций (COAL-1, заказ владельца 2026-10-20): список всех коалиций партии и
 * карточка одной коалиции — эмблема, описание, состав и вместимость.
 *
 * Коалиция — сущность ядра (`state/coalition.ts`): игрок создаёт её явно или через
 * принятый союз, потолок состава держит сервер. Окно отправляет намерения создания,
 * правки и выхода. Открывается кнопкой полосы `#rail-coal`.
 */
import { t } from '../../localization/runtime';
import { canCreateCoalition, canKickCoalitionMember, coalitionInviteBlock } from '../../decisions/coalitionCreation';
import {
  COALITION_DESC_MAX,
  COALITION_EMBLEMS,
  coalitionCapacity,
  coalitionOf,
  coalitionWallNow,
  hasFixedSides,
  getOffer,
  type Action,
  type Coalition,
  type GameState,
} from '../../packages/shared-core/src/index';
import { esc } from './format';
import { createCoalition, editCoalition, leaveCoalition, kickCoalitionMember, declareWar } from '../../decisions/actions';

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
let confirmKick: string | null = null;
/** Open the created card only after the authoritative state contains it. */
let openMineOnSync = false;
/** Что окно нарисовало последним: коалиции партии и описание в поле ввода. */
let drawn = '';
let drawnDesc = '';
let drawnTimerMinute = -1;

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

function remaining(at: number): string {
  const hours = Math.max(0, at - coalitionWallNow(game.state())) / 3_600_000;
  // These are real durations; Sector Zero's accelerated display clock must not rescale them.
  return hours >= 1 ? t('fmt.hours', { n: hours.toFixed(1) }) : t('fmt.minutes', { n: Math.ceil(hours * 60) });
}

function timerText(kind: string, at: number): string {
  const key = kind === 'kick' ? 'coal.departure.kick' : kind === 'leave' ? 'coal.departure.leave' : 'coal.cooldown';
  return t(key, { time: remaining(at) });
}
function cooldownHtml(): string {
  const at = game.state().coalitionJoinAfter?.[game.me()] ?? 0;
  return at > coalitionWallNow(game.state())
    ? `<div class="cw-hint" data-coal-timer="cooldown" data-coal-deadline="${at}">${timerText('cooldown', at)}</div>` : '';
}
function invitationsHtml(c: Coalition): string {
  const state = game.state();
  const me = game.me();
  const candidates = Object.values(state.players).filter((p) =>
    p.status === 'active' && !p.ai && !p.npc && !c.members.includes(p.id) && !coalitionOf(state, p.id),
  ).sort((a, b) => a.id.localeCompare(b.id));
  const rows = candidates.map((p) => {
    const blocked = coalitionInviteBlock(state, me, p.id);
    const incoming = getOffer(state, p.id, me) === 'alliance';
    const waiting = !incoming && getOffer(state, me, p.id) === 'alliance';
    const label = incoming ? t('coal.invite.accept') : waiting ? t('coal.invite.waiting') : t('coal.invite');
    return `<div class="cw-invite-row"><span>${esc(nameOf(p.id))}</span>` +
      `<button class="cw-invite" data-invite="${esc(p.id)}"${blocked || waiting ? ' disabled' : ''}` +
      `${blocked ? ` title="${esc(t(blocked))}"` : ''}>${label}</button></div>`;
  }).join('');
  return `<div class="cw-sec">${t('coal.invite.title')}</div><div class="cw-invites">` +
    (rows || `<div class="cw-hint">${t('coal.invite.none')}</div>`) + '</div>';
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
    (canCreateCoalition(s, game.me())
      ? `<button class="cw-create">${t('coal.create')}</button>`
      : '') +
    (mine ? '' : `<div class="cw-hint">${t('coal.how')}</div>`) +
    cooldownHtml() +
    `<div class="cw-list">${rows || `<div class="dp-empty">${t('coal.none')}</div>`}</div>`
  );
}

function cardHtml(c: Coalition): string {
  const s = game.state();
  const cap = coalitionCapacity(s);
  const mine = c.members.includes(game.me());
  const emblem = draftEmblem ?? c.emblem;
  const members = c.members.map((id) => {
    const departure = c.departures?.[id];
    const deadline = departure ? (departure.wallAt ?? coalitionWallNow(s, departure.at)) : 0;
    const status = departure
      ? `<span class="cw-timer" data-coal-timer="${departure.kind}" data-coal-deadline="${deadline}">${timerText(departure.kind, deadline)}</span>` : '';
    const kick = canKickCoalitionMember(s, game.me(), id)
      ? `<button class="cw-kick${confirmKick === id ? ' sure' : ''}" data-kick="${esc(id)}">${confirmKick === id ? t('coal.kick.confirm') : t('coal.kick')}</button>` : '';
    return `<div class="cw-mem"><span class="cw-dot" style="background:${game.ownerColor(id)}"></span>` +
      `<span class="cw-member-name">${esc(nameOf(id))}${status}</span>${kick}</div>`;
  }).join('');
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
      (c.departures?.[game.me()] ? '' : `<button class="cw-leave${confirmLeave ? ' sure' : ''}">${confirmLeave ? t('coal.leave.confirm') : t('coal.leave')}</button>`) + '</div>'
    : `<div class="cw-sec">${t('coal.desc')}</div>` +
      `<div class="cw-text">${c.description ? esc(c.description) : t('coal.desc.empty')}</div>`;
  return (
    `<button class="cw-back">${t('coal.back')}</button>` + cooldownHtml() +
    `<div class="cw-hero"><span class="cw-big">${glyph(emblem)}</span>` +
    `<span class="cw-main"><span class="cw-name">${titleOf(c)}</span>${seatsHtml(c, cap)}</span></div>` +
    `<div class="cw-sec">${t('coal.members')}</div><div class="cw-mems">${members}${slots}</div>` +
    (mine ? `<div class="cw-hint">${t('coal.how')}</div><div class="cw-hint">${t('coal.timing')}</div>` + invitationsHtml(c) : '') +
    picker +
    desc
  );
}

export function renderCoalitions(): void {
  const el = document.getElementById('coalwin');
  if (!el) return;
  const mine = coalitionOf(game.state(), game.me());
  if (openMineOnSync && mine) {
    viewing = mine.id;
    openMineOnSync = false;
  }
  const card = viewing ? (game.state().coalitions?.[viewing] ?? null) : null;
  if (viewing && !card) viewing = null; // коалицию распустили, пока карточка была открыта
  // Недописанное описание переживает перерисовку от чужой правки.
  const area = document.getElementById('cw-text') as HTMLTextAreaElement | null;
  const typed = area && area.value !== drawnDesc ? area.value : null;
  drawn = signature();
  drawnTimerMinute = Math.floor(coalitionWallNow(game.state()) / 60_000);
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
  // Only the absolute deadline is visible; a host clock rebase changes the internal
  // projection without changing this card or replacing its focused editor.
  const coalitions = Object.values(s.coalitions ?? {}).map((c) => ({
    ...c,
    departures: Object.entries(c.departures ?? {}).map(([id, departure]) => [
      id, departure.kind, departure.by, departure.wallAt ?? coalitionWallNow(s, departure.at),
    ]),
  }));
  return JSON.stringify([
    s.modeId, game.me(), coalitions, coalitionCapacity(s),
    canCreateCoalition(s, game.me()), s.coalitionJoinAfter, s.diplomacyOffers,
    Object.values(s.players).map((p) => [p.id, p.status, p.ai, p.npc,
      (s.coalitionJoinAfter?.[p.id] ?? 0) > coalitionWallNow(s)]),
  ]);
}
/** Новый снимок мира: перерисовать открытое окно, если коалиции изменились. Чужую
 *  правку эмблемы или описания событие не приносит — его видит только автор. */
export function syncCoalitions(): void {
  if (!coalOpen) return;
  if (signature() !== drawn) return renderCoalitions();
  const minute = Math.floor(coalitionWallNow(game.state()) / 60_000);
  if (minute === drawnTimerMinute) return;
  drawnTimerMinute = minute;
  // Timer ticks never replace the textarea, preserving focus and the mobile keyboard.
  document.getElementById('coalwin')?.querySelectorAll<HTMLElement>('[data-coal-timer]').forEach((el) => {
    el.textContent = timerText(el.dataset.coalTimer!, Number(el.dataset.coalDeadline));
  });
}

export function openCoalitions(): void {
  coalOpen = true;
  viewing = null;
  draftEmblem = null;
  confirmLeave = false;
  confirmKick = null;
  openMineOnSync = false;
  renderCoalitions();
  document.getElementById('coalwin')?.classList.add('show');
}
export function closeCoalitions(): void {
  coalOpen = false;
  openMineOnSync = false;
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
    if (tg.closest('.cw-create')) {
      if (!canCreateCoalition(game.state(), game.me())) return;
      if (game.playerOrder(createCoalition(game.me()))) {
        openMineOnSync = true;
        renderCoalitions();
      }
      return;
    }
    if (tg.closest('.cw-back')) {
      viewing = null;
      draftEmblem = null;
      confirmLeave = false;
      openMineOnSync = false;
      return renderCoalitions();
    }
    const row = (tg.closest('[data-coal]') as HTMLElement | null)?.dataset.coal;
    if (row) {
      openMineOnSync = false;
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
    const invite = (tg.closest('[data-invite]') as HTMLElement | null)?.dataset.invite;
    if (invite && mine && !mine.members.includes(invite)) {
      if (coalitionInviteBlock(game.state(), game.me(), invite)) return;
      if (getOffer(game.state(), invite, game.me()) !== 'alliance' && getOffer(game.state(), game.me(), invite) === 'alliance') return;
      game.playerOrder(declareWar(game.me(), invite, 'alliance'));
      return renderCoalitions();
    }
    const kick = (tg.closest('[data-kick]') as HTMLElement | null)?.dataset.kick;
    if (kick && canKickCoalitionMember(game.state(), game.me(), kick)) {
      if (confirmKick !== kick) {
        confirmKick = kick;
        return renderCoalitions();
      }
      confirmKick = null;
      game.playerOrder(kickCoalitionMember(game.me(), kick));
      return renderCoalitions();
    }
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
    if (tg.closest('.cw-leave') && mine && !mine.departures?.[game.me()]) {
      if (!confirmLeave) {
        confirmLeave = true;
        return renderCoalitions();
      }
      confirmLeave = false;
      game.playerOrder(leaveCoalition(game.me()));
      return renderCoalitions();
    }
  });
}
