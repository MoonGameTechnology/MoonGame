/**
 * Tech-tree screen (TT-3.1, REFM-9) — the session research window: branch tabs, a
 * shared day rail, a node grid, and the tap-through node dossier with the «research»
 * button.
 *
 * The rules live in the core (`technologyModule` / `technologyLock` decides what may
 * start); everything here is a READ of that truth plus the layout map. `techCondOk`
 * форвардит вопрос в ядро (`conditionMet`) — своей копии перебора условий здесь нет
 * (RULES-4); неизвестный тип условия ядро считает невыполненным (fail-secure).
 *
 * Same REFM shape as the other screens: the markup is pure (`techTreeHtml`), the shared
 * label helpers are plain exports (the scientist-council picker imports `branchLabel`),
 * and only `initTechTree(host)` touches the host, through explicit hooks.
 */
import { conditionMet } from '../../packages/shared-core/src/index';
import type { Action, GameState } from '../../packages/shared-core/src/index';
import { t, tData } from '../../localization/runtime';
import { data } from './prototypeData';
import { DAY, HOUR } from './time';
import { esc, cost, displayUnit } from './format';
import { researchTech } from './actions';

const clamp = (v: number, a: number, b: number): number => Math.max(a, Math.min(b, v));

export const TECH_BRANCHES: Array<{ key: string; label: string }> = [
  { key: 'space', label: 'tech.branch.space' },
  { key: 'ground', label: 'tech.branch.ground' },
  { key: 'squadron', label: 'tech.branch.squadron' },
  { key: 'missile', label: 'tech.branch.missile' },
  { key: 'command', label: 'tech.branch.command' }, // automation / C2 — «Хранитель» lives here
];
export const branchLabel = (key: string): string =>
  t(TECH_BRANCHES.find((b) => b.key === key)?.label ?? key);
// Делегирует общему cost(): те же SVG-чипы, что в баре и карточках, и тот же
// показ нехватки — второй аргумент красит дефицит прямо в модалке технологии.
export const techCost = (c: Record<string, number>, have?: Record<string, number>): string =>
  Object.keys(c).length ? cost(c, have) : '';
// --- TT-3.1: экран-дерево (макет v4) — вкладки-ветки, рельса дней, досье по тапу ----
// Presentation-only layout: named sub-columns per branch, ids in day order. The
// canonical data stays layout-free; a tech missing from this map falls into an
// auto-column appended at the end, so fresh data never breaks the screen.
export const TECH_COLS: Record<string, Array<{ label: string; ids: string[] }>> = {
  space: [
    {
      label: 'tech.group.industry',
      ids: ['industrial_automation', 'microelectronics_fabrication'],
    },
    { label: 'tech.group.fleet', ids: ['orbital_logistics', 'siege_doctrine', 'void_armadas'] },
    { label: 'tech.group.sensors', ids: ['deep_survey'] },
  ],
  ground: [
    { label: 'tech.group.doctrines', ids: ['combined_arms', 'garrison_networks'] },
    { label: 'tech.group.fortifications', ids: ['fortified_infrastructure', 'planetary_bastions'] },
  ],
  squadron: [
    { label: 'tech.group.airwing', ids: ['flight_decks', 'strike_vectors', 'ace_programs'] },
  ],
  missile: [
    {
      label: 'tech.group.arsenal',
      ids: ['guidance_arrays', 'warhead_miniaturization', 'saturation_barrage'],
    },
  ],
  command: [
    { label: 'tech.group.comms', ids: ['signal_corps', 'logistics_command'] },
    { label: 'tech.group.automation', ids: ['ai_stewardship'] },
  ],
};
export const TECH_ICONS: Record<string, string> = {
  industrial_automation: '⚙',
  microelectronics_fabrication: '▣',
  deep_survey: '📡',
  orbital_logistics: '⛽',
  siege_doctrine: '☄',
  void_armadas: '🛸',
  combined_arms: '⚔',
  garrison_networks: '⛺',
  fortified_infrastructure: '🏰',
  planetary_bastions: '🛡',
  flight_decks: '🛫',
  strike_vectors: '🎯',
  ace_programs: '🎖',
  guidance_arrays: '🧭',
  warhead_miniaturization: '🧨',
  saturation_barrage: '🚀',
  signal_corps: '📶',
  logistics_command: '🧠',
  ai_stewardship: '😴',
};
export const TECH_FX_LABEL: Record<string, string> = {
  productionBonus: 'tech.fx.production',
  fleetSpeedBonus: 'tech.fx.fleet-speed',
  combatDamageBonus: 'tech.fx.damage',
  radarRangeBonus: 'tech.fx.radar',
};
type TechDefLike = (typeof data.technologies)[string];
type TechCond = TechDefLike['conditions'][number];
export function techCondText(c: TechCond): string {
  switch (c.type) {
    case 'has_scientist':
      return t('tech.req.scientist', {
        b: c.branch ? branchLabel(c.branch) : t('tech.req.scientist.any'),
      });
    case 'own_sectors':
      return t('tech.req.sectors', { n: c.min });
    case 'has_building':
      return t('tech.req.building', {
        b: tData(data.buildings[c.building]?.name ?? c.building),
        n: c.min,
      });
    case 'controls_planet_type':
      return t('tech.req.planet', { p: tData(c.planetType), n: c.min });
    case 'has_unit':
      // Unit defs carry no `name` field (buildings do) — the display name is the
      // space-joined id via displayUnit(); the old `?.name ?? id` fallback built a
      // broken l10n key for multiword ids ('strike_carrier' → data.strikecarrier).
      return t('tech.req.unit', { u: displayUnit(c.unit), n: c.min });
    default:
      return t('tech.req.special');
  }
}
/** Выполнено ли ОДНО условие узла — для галочки в строке требований. Финальную правду
 *  про весь узел по-прежнему говорит `technologyLock` в ядре. */
export function techCondOk(state: GameState, me: string, c: TechCond): boolean {
  // RULES-4: правило «выполнено ли условие» живёт в ядре и спрашивается, а не
  // переписывается. Прежняя копия перебирала 2 типа из 5 и на остальных возвращала
  // false — узел с условием `has_building` / `controls_planet_type` / `has_unit`
  // читался бы как запертый НАВСЕГДА, хотя ядро исследование разрешает. Fail-secure
  // при этом не ослаблен: неизвестный тип ядро тоже считает невыполненным.
  return conditionMet(c as Parameters<typeof conditionMet>[0], state, me, data);
}
/** «+10% производство · открывает: Fort» — эффекты и анлоки узла одной строкой. */
export function techFx(td: TechDefLike): string {
  const fx = Object.entries(td.effects ?? {})
    .filter(([, v]) => (v as number) !== 0)
    .map(([k, v]) => `+${Math.round((v as number) * 100)}% ${t(TECH_FX_LABEL[k] ?? k)}`);
  for (const u of td.unlocks?.units ?? [])
    // no `name` on unit defs — displayUnit() is the canonical unit label (see has_unit)
    fx.push(t('tech.grants', { x: esc(displayUnit(u)) }));
  for (const b of td.unlocks?.buildings ?? [])
    fx.push(t('tech.grants', { x: esc(tData(data.buildings[b]?.name ?? b)) }));
  for (const a of td.unlocks?.abilities ?? [])
    fx.push(t('tech.grants.ability', { x: a === 'steward' ? t('tech.grants.steward') : esc(a) }));
  return fx.join(' · ');
}

/** The whole window body for one branch tab: day rail + node columns + (optionally) the
 *  open node's dossier. Pure — `initTechTree` feeds it the live state and the two bits
 *  of view state the window owns. */
export function techTreeHtml(
  state: GameState,
  me: string,
  tab: string,
  modalId: string | null,
): string {
  const seat = state.players[me];
  // Meta-progression grants (meta_*) are account perks, not researchable session
  // techs — the tree shows only the real nodes.
  const techs = Object.fromEntries(
    Object.entries(data.technologies).filter(([id]) => !id.startsWith('meta_')),
  );
  const done = new Set(seat?.technologies?.completed ?? []);
  // Research runs in CONCURRENT slots (core: technologies.active is a list).
  const activeRaw = seat?.technologies?.active;
  const activeList = Array.isArray(activeRaw) ? activeRaw : activeRaw ? [activeRaw] : [];
  const res = (seat?.resources ?? {}) as Record<string, number>;
  const started = state.startedAt ?? 0;
  const hudDay = Math.floor(state.time / DAY) + 1; // счёт статус-бара: день 1 — первый
  // Рельса дней: объединение day-гейтов ВСЕХ веток (+ старт) — календарь общий,
  // при смене вкладки строки не прыгают (правило макета). Подпись = dayGate+1,
  // тот же счёт, что у часов в статус-баре.
  const gates = [
    ...new Set(
      Object.values(techs)
        .map((td) => td.dayGate ?? 0)
        .concat(0),
    ),
  ].sort((a, b) => a - b);
  const nowGate = gates.filter((g) => g + 1 <= hudDay).pop() ?? 0;
  // Пилюля слотов зеркалит кламп ядра: 2 базовых, +1 от учёного, максимум 3.
  const slotBonus = (seat?.scientists ?? []).reduce(
    (n, c) => n + (data.scientists[c.id]?.slotBonus ?? 0),
    0,
  );
  const slots = Math.min(3, Math.max(2, 2 + slotBonus));
  // Состояние узла в порядке проверок ядра (technologyLock): prereq → день → условия.
  const nodeState = (id: string): { st: string; prog: number; eta: number } => {
    const td = techs[id]!;
    if (done.has(id)) return { st: 'done', prog: 1, eta: 0 };
    const act = activeList.find((a) => a.technology === id);
    if (act) {
      const total = act.completesAt - act.startedAt;
      return {
        st: 'res',
        prog: total > 0 ? clamp((state.time - act.startedAt) / total, 0, 1) : 1,
        eta: Math.max(0, Math.ceil((act.completesAt - state.time) / HOUR)),
      };
    }
    if ((td.prerequisites ?? []).some((p) => !done.has(p))) return { st: 'chain', prog: 0, eta: 0 };
    if ((td.dayGate ?? 0) > 0 && state.time - started < (td.dayGate ?? 0) * DAY)
      return { st: 'gate', prog: 0, eta: 0 };
    if ((td.conditions ?? []).some((c) => !techCondOk(state, me, c))) return { st: 'cond', prog: 0, eta: 0 };
    return { st: 'avail', prog: 0, eta: 0 };
  };
  const tabs = TECH_BRANCHES.map(
    (b) =>
      `<button class="tt-tab${b.key === tab ? ' on' : ''}" data-ttab="${b.key}">${t(b.label)}</button>`,
  ).join('');
  // Кто из совета курирует эту ветку — и честное предупреждение, если никто.
  const lead = (seat?.scientists ?? [])
    .map((c) => data.scientists[c.id])
    .find((d) => d?.branch === tab);
  const leadHtml = lead
    ? `🧪 ${t('tech.curator')} <b>${esc(t(lead.name))}</b>`
    : `🔭 ${t('tech.curator.none')}`;
  // Колонки вкладки: из карты раскладки; техи вне карты — в автоколонку в конце.
  const colsDef = TECH_COLS[tab] ?? [];
  const branchIds = Object.keys(techs).filter((id) => (techs[id]!.branch ?? 'space') === tab);
  const placed = new Set(colsDef.flatMap((c) => c.ids));
  const extras = branchIds
    .filter((id) => !placed.has(id))
    .sort((a, b) => techs[a]!.tier - techs[b]!.tier || a.localeCompare(b));
  const cols = [
    ...colsDef.map((c) => ({ label: c.label, ids: c.ids.filter((id) => branchIds.includes(id)) })),
    ...(extras.length ? [{ label: '—', ids: extras }] : []),
  ].filter((c) => c.ids.length);
  const wide = cols.length <= 2 ? ' w2' : '';
  let rail = `<div class="tt-rail"><div class="tt-dhead">${t('tech.rail.day')}</div>`;
  for (const g of gates) {
    const cls = g === nowGate ? ' now' : g + 1 > hudDay ? ' future' : '';
    rail += `<div class="tt-drow${cls}"><b>${g + 1}</b><small>${g === 0 ? t('tech.rail.start') : t('tech.rail.day-short')}</small></div>`;
  }
  rail += `</div>`;
  let colsHtml = '';
  for (const col of cols) {
    let cells = '';
    for (const g of gates) {
      const nodes = col.ids
        .filter((id) => (techs[id]!.dayGate ?? 0) === g)
        .map((id) => {
          const td = techs[id]!;
          const st = nodeState(id);
          const badge =
            st.st === 'done'
              ? `<span class="tt-tick">✓</span>`
              : st.st === 'gate'
                ? `<span class="tt-lock">🔒</span>`
                : st.st === 'cond'
                  ? `<span class="tt-cnd">⚗</span>`
                  : '';
          const prog =
            st.st === 'res'
              ? `<span class="tt-prog"><i style="width:${Math.round(st.prog * 100)}%"></i></span>`
              : '';
          return (
            `<div class="tt-node st-${st.st}" data-tech="${id}">` +
            `<div class="tt-box">${TECH_ICONS[id] ?? '🔬'}${prog}${badge}</div>` +
            `<div class="tt-lbl">${esc(tData(td.name))}</div></div>`
          );
        })
        .join('');
      cells += `<div class="tt-cell${g === nowGate ? ' now' : ''}">${nodes}</div>`;
    }
    colsHtml += `<div class="tt-col${wide}"><div class="tt-chead">${t(col.label)}</div><div class="tt-cellwrap">${cells}</div></div>`;
  }
  // Досье узла (тап) — рендерится из состояния, так что живой 500мс-ререндер
  // обновляет прогресс/день, не закрывая окно.
  let modal = '';
  if (modalId && !techs[modalId]) modalId = null;
  if (modalId) {
    const id = modalId;
    const td = techs[id]!;
    const st = nodeState(id);
    const gate = td.dayGate ?? 0;
    const prereqNames = (td.prerequisites ?? [])
      .map((p) => esc(tData(techs[p]?.name ?? p)))
      .join(', ');
    const condRows = (td.conditions ?? [])
      .map((c) => `<span>${techCondOk(state, me, c) ? '☑' : '⚗'} <b>${esc(techCondText(c))}</b></span>`)
      .join('');
    const affordable = Object.entries(td.cost).every(([k, v]) => (res[k] ?? 0) >= (v as number));
    const tag =
      st.st === 'done'
        ? `<span class="tt-tag">${t('tech.state.done')}</span>`
        : st.st === 'res'
          ? `<span class="tt-tag amb">${t('tech.state.running')}</span>`
          : st.st === 'avail'
            ? `<span class="tt-tag">${t('tech.state.open')}</span>`
            : `<span class="tt-tag dim">${t('tech.state.locked')}</span>`;
    const btn =
      st.st === 'avail'
        ? `<button class="tt-mbtn" data-go="${id}"${affordable ? '' : ' disabled'}>🔬 ${affordable ? t('tech.action.research') : t('tech.action.no-resources')}</button>`
        : st.st === 'done'
          ? `<button class="tt-mbtn wait" disabled>✓ ${t('tech.action.done')}</button>`
          : st.st === 'res'
            ? `<button class="tt-mbtn wait" disabled>⏳ ${t('tech.action.running', { n: st.eta })}</button>`
            : st.st === 'gate'
              ? `<button class="tt-mbtn wait" disabled>🔒 ${t('tech.action.opens-day', { n: gate + 1 })}</button>`
              : st.st === 'chain'
                ? `<button class="tt-mbtn wait" disabled>🔒 ${t('tech.action.needs-parent')}</button>`
                : `<button class="tt-mbtn wait" disabled>⚗ ${t('tech.action.unmet')}</button>`;
    modal =
      `<div class="tt-modal"><div class="tt-mback" data-mclose="1"></div><div class="tt-mwin">` +
      `<button class="tt-mx" data-mclose="1">✕</button>` +
      `<div class="tt-mhead"><div class="tt-mico">${TECH_ICONS[id] ?? '🔬'}</div><div>` +
      `<div class="tt-mname">${esc(tData(td.name))}<span class="tt-tier">T${td.tier}</span></div>` +
      `<div class="tt-mtags">${tag}</div></div></div>` +
      (td.description ? `<div class="tt-mdesc">${esc(t(td.description))}</div>` : '') +
      `<div class="tt-mstats">` +
      `<span>💰 <b>${techCost(td.cost, res)} · ${t('fmt.hours', { n: td.researchTimeHours })}</b></span>` +
      (techFx(td) ? `<span>✦ <b>${techFx(td)}</b></span>` : '') +
      (gate > 0 ? `<span>📅 <b>${t('tech.from-day', { n: gate + 1 })}</b></span>` : '') +
      (prereqNames ? `<span>🔗 <b>${t('tech.req.title')} ${prereqNames}</b></span>` : '') +
      condRows +
      `</div>${btn}</div></div>`;
  }
  const html =
    `<div class="tt-top"><span class="tt-day">📅 ${t('tech.day', { n: hudDay })}</span>` +
    `<span class="tt-slots">⚛ ${t('tech.slots', { a: activeList.length, b: slots })}</span></div>` +
    `<div class="tt-tabs">${tabs}</div>` +
    `<div class="tt-lead${lead ? '' : ' closed'}">${leadHtml}</div>` +
    `<div class="tt-scroll"><div class="tt-grid">${rail}${colsHtml}</div></div>` +
    modal;
  return html;
}

/** What the tech window needs from the match screen. */
export interface TechHost {
  /** The window element (`#tech`) — shown/hidden and click-delegated here. */
  root(): HTMLElement;
  /** The body element inside it (`#techbody`) — the part that repaints. */
  body(): HTMLElement;
  /** The current match state (read fresh on every paint — it is replaced, not mutated). */
  state(): GameState;
  /** Whose research this is: the seat you are playing. */
  me(): string;
  /** Submit a player order through the host's usual path (gate, net, replay). */
  order(action: Action): void;
  /** Fired when the window opens — the host shows its just-in-time intro card here. */
  onOpen(): void;
}

/** Wire the window up. Call once at boot (it attaches the click delegate); `open()` is
 *  what the rail button and the Steward's «research it» call, `repaint()` what the frame
 *  loop calls to keep progress bars and ETAs live while the window is open. */
export function initTechTree(host: TechHost): {
  open: () => void;
  repaint: () => void;
  isOpen: () => boolean;
} {
  let tab = 'space'; // активная вкладка-ветка
  let modalId: string | null = null; // открытое досье узла
  // Появление досье анимируется одноразовым классом .pop: живой 500мс-ререндер окна
  // пересоздаёт DOM, и анимация на самом .tt-mwin переигрывалась бы каждый тик —
  // досье «схлопывалось и выпрыгивало» дважды в секунду (баг живого плейтеста).
  let modalPop = false;
  // Кэш разметки в духе lastCmdHtml/lastPanelHtml из main.ts: одинаковую строку не
  // переприсваиваем — innerHTML пересоздаёт DOM даже на идентичном тексте (и выбивал
  // бы элемент из-под пальца между touchstart и click).
  let lastHtml = '';

  function repaint(): void {
    const body = host.body();
    const html = techTreeHtml(host.state(), host.me(), tab, modalId);
    if (html !== lastHtml) {
      // A live re-render (innerHTML) would reset the panel's scroll — save and restore it.
      const before = body.querySelector('.tt-scroll');
      const sx = before?.scrollLeft ?? 0;
      const sy = before?.scrollTop ?? 0;
      body.innerHTML = html;
      lastHtml = html;
      const after = body.querySelector('.tt-scroll');
      if (after) {
        after.scrollLeft = sx;
        after.scrollTop = sy;
      }
    }
    if (modalPop) {
      // Класс мутирует DOM, но кэш сравнивает СТРОКУ разметки, а не живой DOM —
      // .pop не делает кэш вечно «грязным».
      body.querySelector('.tt-mwin')?.classList.add('pop');
      modalPop = false;
    }
  }

  host.root().addEventListener('click', (e) => {
    const tg = e.target as HTMLElement;
    if (tg === host.root() || tg.classList.contains('tw-close')) {
      modalId = null;
      host.root().classList.remove('show');
      return;
    }
    if (tg.closest('[data-mclose]')) {
      modalId = null;
      repaint();
      return;
    }
    const go = (tg.closest('.tt-mbtn') as HTMLElement | null)?.dataset.go;
    if (go) {
      host.order(researchTech(host.me(), go));
      repaint(); // узел тут же перекрашивается в «исследуется»
      return;
    }
    const next = (tg.closest('.tt-tab') as HTMLElement | null)?.dataset.ttab;
    if (next) {
      if (next !== tab) {
        tab = next;
        modalId = null;
      }
      repaint();
      return;
    }
    const node = (tg.closest('.tt-node') as HTMLElement | null)?.dataset.tech;
    if (node) {
      modalId = node;
      modalPop = true; // реальное открытие досье — единственный случай с анимацией
      repaint();
    }
  });

  return {
    open: () => {
      modalId = null; // свежее открытие — без прошлого досье
      host.root().classList.add('show');
      repaint();
      host.onOpen();
    },
    repaint,
    isOpen: () => host.root().classList.contains('show'),
  };
}
