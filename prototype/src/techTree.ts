/**
 * Окно «Технологии» (TT-3.1, REFM-9, TT-5; макет владельца 2026-11-16): шесть плиток веток
 * со значком и прогрессом, строка о ветке, сама ветка — дерево из плиток-узлов по рядам
 * глубины со связями, и окошко узла по нажатию (эффект, цена, «Нужно», «Ведёт к», кнопки).
 * Слева — слоты, очередь и совет (`techTreeSide.ts`); на телефоне они сверху полосой.
 *
 * Правила живут в ядре; модель окна — `techTreeModel.ts`, раскладка рядов и значок узла —
 * `decisions/techTreeLayout.ts`. Разметка чистая (`techTreeHtml`), DOM трогает только
 * `initTechTree(host)`: он же рисует линии связей поверх уже уложенных плиток.
 */
import type { Action, GameState } from '../../packages/shared-core/src/index';
import { t, tData } from '../../localization/runtime';
import { esc, fmtDur } from './format';
import { dequeueTech, moveQueuedTech, queueTech, researchTech } from '../../decisions/actions';
import { techDepthRows, techIconKind } from '../../decisions/techTreeLayout';
import { liveTimerHtml, patchLiveTimers } from './liveTimers';
import { BRANCH_COLOR, branchIconSvg, techKindSvg } from './techIcons';
import {
  TECH_BRANCHES,
  TECH_LIVE,
  branchLabel,
  branchOf,
  techCondOk,
  techCondText,
  techCost,
  techFx,
  techLockText,
  techModel,
  type TechModel,
  type TechNodeState,
} from './techTreeModel';
import { techPhoneStripHtml, techSideHtml, type TechSheet } from './techTreeSide';
import { data } from './gameData';
import { speedupAct, speedupButton, type SpeedupButton } from './speedupButtons';

export {
  DAMAGE_SCOPE_LABEL,
  TECH_BRANCHES,
  TECH_FX_LABEL,
  TECH_LIVE,
  branchLabel,
  fmtClock,
  techCondOk,
  techCondText,
  techCost,
  techFx,
} from './techTreeModel';

const sciName = (m: TechModel, id: string | undefined): string =>
  id ? esc(tData(m.council.find((c) => c.id === id)?.def?.name ?? id)) : '';

/** Плитки веток: значок, имя, полоска «изучено N из M», голубая точка — есть что начать
 *  прямо сейчас, буква — учёный совета, который ведёт ветку. */
function branchTilesHtml(m: TechModel, tab: string): string {
  return TECH_BRANCHES.map((b) => {
    const ids = m.branchIds(b.key);
    const n = ids.filter((id) => m.done.has(id)).length;
    const ready = m.freeSlot && ids.some((id) => m.nodeState(id) === 'avail' && m.affordable(id));
    const lead = m.leadOf(b.key);
    const name = t(b.label);
    const title = t('tech.tab.title', { b: name, n, m: ids.length });
    return (
      `<button class="tt-tab${b.key === tab ? ' on' : ''}" data-ttab="${b.key}" style="--bc:${BRANCH_COLOR[b.key]}" title="${esc(title)}" aria-label="${esc(title)}">` +
      (lead ? `<span class="tt-tlead">${sciName(m, lead).slice(0, 1)}</span>` : '') +
      (ready ? `<span class="tt-ready"></span>` : '') +
      branchIconSvg(b.key) +
      `<span class="tt-tname"><span class="full">${name}</span><span class="short">${t(b.short)}</span></span>` +
      `<span class="tt-tprog"><span class="tt-tbar"><i style="width:${ids.length ? Math.round((100 * n) / ids.length) : 0}%"></i></span>` +
      `<i class="tt-cnt">${n}/${ids.length}</i></span></button>`
    );
  }).join('');
}

/** Строка под плитками: что в ветке, кто её ведёт. Предупреждение о замке «учёный» — только
 *  когда в ветке есть такой узел и вести её некому (PVR-6.17, UIX-10.7). */
function branchLineHtml(m: TechModel, tab: string): string {
  const b = TECH_BRANCHES.find((x) => x.key === tab);
  const lead = m.leadOf(tab);
  const gated = m
    .branchIds(tab)
    .some((id) => (m.techs[id]!.conditions ?? []).some((c) => c.type === 'has_scientist'));
  const leadLine = lead
    ? `<span class="tt-lead">${t('tech.curator')} <b>${sciName(m, lead)}</b></span>`
    : gated
      ? `<span class="tt-lead closed">${t('tech.curator.none')}</span>`
      : '';
  return `<div class="tt-bline"><span class="tt-bdesc">${b ? t(b.desc) : ''}</span>${leadLine}</div>`;
}

/** Короткое состояние под именем плитки: срок, место в очереди, замок или ✓. */
function nodeStatus(m: TechModel, id: string, st: TechNodeState): string {
  switch (st) {
    case 'done':
      return '✓';
    case 'res':
      return liveTimerHtml(m.active.find((a) => a.technology === id)!.completesAt, 'clock');
    case 'queued':
      return `№${m.queue.indexOf(id) + 1}`;
    case 'avail':
      return m.affordable(id) ? fmtDur(m.hours(id)) : t('tech.node.no-res');
    case 'gate':
      return t('tech.node.day', { n: m.gateOf(m.techs[id]!) + 1 });
    default:
      return '🔒';
  }
}

function nodeTileHtml(m: TechModel, id: string, sel: boolean): string {
  const td = m.techs[id]!;
  const st = m.nodeState(id);
  const run = st === 'res' ? m.active.find((a) => a.technology === id) : undefined;
  const pre = (td.prerequisites ?? []).filter((p) => m.techs[p] && branchOf(m.techs[p]!) === branchOf(td));
  const name = esc(tData(td.name));
  return (
    `<button class="tt-item st-${st}${sel ? ' sel' : ''}" data-tech="${esc(id)}" data-pre="${esc(pre.join(' '))}" ` +
    `style="--bc:${BRANCH_COLOR[branchOf(td)]}" title="${name}">` +
    `<span class="tt-ico">${techKindSvg(techIconKind(td))}` +
    (run ? `<i class="tt-ring" data-since="${Number(run.startedAt)}" data-at="${Number(run.completesAt)}"></i>` : '') +
    `</span><b>${name}</b><span class="tt-ist">${nodeStatus(m, id, st)}</span></button>`
  );
}

/** Ветка деревом: ряды по глубине (`techDepthRows`), линии к предкам рисует контроллер. */
function treeHtml(m: TechModel, tab: string, sel: string | null): string {
  const rows = techDepthRows(m.branchIds(tab), (id) => m.techs[id]?.prerequisites ?? []);
  return (
    `<div class="tt-scroll"><div class="tt-tree"><svg class="tt-lines" aria-hidden="true"></svg>` +
    rows.map((r) => `<div class="tt-row">${r.map((id) => nodeTileHtml(m, id, id === sel)).join('')}</div>`).join('') +
    `</div></div>`
  );
}

/** Ссылка на соседний узел в окошке: нажатие открывает его (и его ветку). */
function linkChip(m: TechModel, id: string, from: string, mark: string, cls: string): string {
  const td = m.techs[id];
  const other = td && branchOf(td) !== branchOf(m.techs[from]!) ? ` · ${branchLabel(branchOf(td))}` : '';
  return `<button class="tt-link ${cls}" data-pick="${esc(id)}">${mark}${esc(tData(td?.name ?? id))}${other}</button>`;
}

/** Окошко узла: значок, имя, ветка, состояние, эффект, цена и срок, «Нужно», «Ведёт к»,
 *  описание и кнопки. Перерисовывается из состояния — живой ререндер его не закрывает. */
/** Кнопка ускорения идущей темы (TEC-3.2); предлагать нечего — пусто. */
const speedHtml = (b: SpeedupButton | undefined): string =>
  b
    ? `<button class="tt-mq btn-second" data-speedact="${esc(b.act)}" data-speedarg="${esc(b.arg)}" title="${esc(b.title)}">${esc(b.label)}</button>`
    : '';

function nodeModalHtml(m: TechModel, id: string): string {
  const td = m.techs[id]!;
  const st = m.nodeState(id);
  const name = esc(tData(td.name));
  const lead = m.leadOf(branchOf(td));
  const affordable = m.affordable(id);
  const tag =
    st === 'done'
      ? `<span class="tt-tag">${t('tech.state.done')}</span>`
      : st === 'res'
        ? `<span class="tt-tag amb">${t('tech.state.running')}</span>`
        : st === 'queued'
          ? `<span class="tt-tag acc">${t('tech.state.queued', { n: m.queue.indexOf(id) + 1 })}</span>`
          : st === 'avail'
            ? `<span class="tt-tag acc">${t('tech.state.open')}</span>`
            : `<span class="tt-tag dim">${t('tech.state.locked')}</span>`;
  const gate = m.gateOf(td);
  const started = m.state.startedAt ?? 0;
  const needs = [
    ...(td.prerequisites ?? []).map((p) =>
      linkChip(m, p, id, m.done.has(p) ? '✓ ' : '✗ ', m.done.has(p) ? 'ok' : 'no'),
    ),
    ...(gate > 0
      ? [
          (() => {
            const ok = m.state.time - started >= gate * 86_400_000;
            return `<span class="tt-cond ${ok ? 'ok' : 'no'}">${ok ? '✓' : '✗'} ${t('tech.from-day', { n: gate + 1 })}</span>`;
          })(),
        ]
      : []),
    ...(td.conditions ?? []).map((c) => {
      const ok = techCondOk(m.state, m.me, c);
      return `<span class="tt-cond ${ok ? 'ok' : 'no'}">${ok ? '✓' : '✗'} ${esc(techCondText(c))}</span>`;
    }),
  ];
  const kids = Object.keys(m.techs).filter((k) => (m.techs[k]!.prerequisites ?? []).includes(id));
  const run = m.active.find((a) => a.technology === id);
  const mainBtn =
    st === 'avail'
      ? affordable && m.freeSlot
        ? `<button class="tt-mbtn btn-main" data-go="${esc(id)}">🔬 ${t('tech.action.research')} · ${fmtDur(m.hours(id))}</button>`
        : `<button class="tt-mbtn wait btn-main" disabled>${affordable ? t('tech.action.slots-full') : t('tech.action.no-resources')}</button>`
      : st === 'res' && run
        ? `<button class="tt-mbtn wait btn-main" disabled>⏳ ${t('tech.action.running-clock', { n: liveTimerHtml(run.completesAt, 'clock') })}</button>` +
          speedHtml(speedupButton(m.state, m.me, run.completesAt, 'tech', id))
        : st === 'done'
          ? `<button class="tt-mbtn wait btn-main" disabled>✓ ${t('tech.action.done')}</button>`
          : '';
  // RQ-1: «＋ В очередь», если начать прямо сейчас нельзя, а поставить в план можно;
  // «убрать», если тема уже стоит в очереди.
  const qBtn =
    st === 'queued'
      ? `<button class="tt-mq btn-second danger" data-dq="${esc(id)}">✕ ${t('tech.action.dequeue')}</button>`
      : !(st === 'avail' && affordable && m.freeSlot) && m.canQueue(id)
        ? `<button class="tt-mq btn-second" data-q="${esc(id)}">＋ ${t('tech.action.queue')}</button>`
        : '';
  const locked = st === 'chain' || st === 'gate' || st === 'cond';
  return (
    `<div class="tt-modal" data-tech-modal="${esc(id)}"><div class="tt-mback" data-mclose="1"></div>` +
    `<div class="tt-mwin" role="dialog" aria-label="${name}">` +
    `<button class="tt-mx btn-x" data-mclose="1" aria-label="${esc(t('card.close'))}">✕</button>` +
    `<div class="tt-mhead"><span class="tt-mico" style="--bc:${BRANCH_COLOR[branchOf(td)]}">${techKindSvg(techIconKind(td))}</span><div>` +
    `<div class="tt-mname">${name}</div>` +
    `<div class="tt-msub">${branchLabel(branchOf(td))}${lead ? ` · ${t('tech.curator')} ${sciName(m, lead)}` : ''}</div>` +
    `<div class="tt-mtags">${tag}</div></div></div>` +
    (techFx(td) ? `<div class="tt-mfx">${techFx(td)}</div>` : '') +
    (locked ? `<div class="tt-mwhy">🔒 ${techLockText(m, id)}</div>` : '') +
    `<div class="tt-mrow"><span class="tt-ml">${t('tech.modal.price')}</span>${techCost(m.price(id), st === 'done' ? undefined : m.res)}` +
    `<span class="tt-mdur">${fmtDur(m.hours(id))}</span></div>` +
    (needs.length ? `<div class="tt-mrow"><span class="tt-ml">${t('tech.modal.needs')}</span>${needs.join('')}</div>` : '') +
    (kids.length
      ? `<div class="tt-mrow"><span class="tt-ml">${t('tech.modal.leads')}</span>${kids.map((k) => linkChip(m, k, id, '', '')).join('')}</div>`
      : '') +
    (td.description ? `<div class="tt-mdesc">${esc(t(td.description))}</div>` : '') +
    (mainBtn || qBtn ? `<div class="tt-macts">${mainBtn}${qBtn}</div>` : '') +
    `</div></div>`
  );
}

/** Чипы в шапке окна: занятые слоты (янтарь, если есть свободный) и день матча. */
export function techChipsHtml(state: GameState, me: string): string {
  const m = techModel(state, me);
  const day = Math.floor(state.time / 86_400_000) + 1;
  return (
    `<span class="tt-chip${m.freeSlot ? ' free' : ''}">${t('tech.slots', { a: m.active.length, b: m.slots })}</span>` +
    (m.dayGates ? `<span class="tt-chip">${t('tech.day', { n: day })}</span>` : '')
  );
}

/** Тело окна на одну ветку. Чистая функция: `initTechTree` подаёт живое состояние и то, что
 *  помнит само окно (открытый узел, строка очереди с кнопками, выдвижная панель телефона). */
export function techTreeHtml(
  state: GameState,
  me: string,
  tab: string,
  modalId: string | null,
  view: { queueSel?: string | null; sheet?: TechSheet } = {},
): string {
  const m = techModel(state, me);
  const sel = modalId && m.techs[modalId] ? modalId : null;
  const sheet = view.sheet ?? null;
  return (
    techPhoneStripHtml(m) +
    `<div class="tt-body">` +
    techSideHtml(m, { queueSel: view.queueSel ?? null, sheet }) +
    `<div class="tt-main"><div class="tt-tabs">${branchTilesHtml(m, tab)}</div>` +
    branchLineHtml(m, tab) +
    treeHtml(m, tab, sel) +
    `</div></div>` +
    (sheet ? `<div class="tt-shade" data-sheetclose="1"></div>` : '') +
    (sel ? nodeModalHtml(m, sel) : '')
  );
}

/** Линии от предков к узлу внутри ветки — по уже уложенным плиткам (координаты в
 *  собственной системе дерева: `offset*` не зависят от CSS-зума окна на ПК). */
function drawTreeLines(body: HTMLElement, force: boolean): void {
  const tree = body.querySelector<HTMLElement>('.tt-tree');
  const svg = tree?.querySelector('.tt-lines');
  if (!tree || !svg) return;
  // Плитки переносятся по ширине окна: после поворота телефона или смены размера линии
  // перерисовываются, хотя разметка та же.
  const size = `${tree.clientWidth}x${tree.clientHeight}`;
  if (!force && tree.dataset.lines === size) return;
  tree.dataset.lines = size;
  const nodes = new Map<string, HTMLElement>();
  tree.querySelectorAll<HTMLElement>('.tt-item[data-tech]').forEach((n) => nodes.set(n.dataset.tech!, n));
  let d = '';
  let ok = '';
  for (const node of nodes.values()) {
    for (const p of (node.dataset.pre ?? '').split(' ').filter(Boolean)) {
      const a = nodes.get(p);
      if (!a) continue;
      const x1 = a.offsetLeft + a.offsetWidth / 2;
      const y1 = a.offsetTop + a.offsetHeight;
      const x2 = node.offsetLeft + node.offsetWidth / 2;
      const y2 = node.offsetTop;
      const my = (y1 + y2) / 2;
      const path = `M${x1} ${y1}C${x1} ${my} ${x2} ${my} ${x2} ${y2}`;
      if (a.classList.contains('st-done')) ok += path;
      else d += path;
    }
  }
  svg.innerHTML = `<path d="${d}"/><path class="ok" d="${ok}"/>`;
}

/** Кольцо прогресса на значке идущей темы: доля от начала до срока. */
function patchRings(body: HTMLElement, now: number): void {
  body.querySelectorAll<HTMLElement>('.tt-ring').forEach((el) => {
    const from = Number(el.dataset.since);
    const span = Number(el.dataset.at) - from;
    const p = span > 0 ? Math.min(1, Math.max(0, (now - from) / span)) : 1;
    const v = p.toFixed(3);
    if (el.style.getPropertyValue('--p') !== v) el.style.setProperty('--p', v);
  });
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
 *  loop calls to keep progress bars and ETAs live while the window is open.
 *  `open(focus)` opens straight on that technology's dossier, on its own branch tab — the
 *  path from a unit, building or fortress locked behind it («research it»). */
export function initTechTree(host: TechHost): {
  open: (focus?: string) => void;
  repaint: () => void;
  isOpen: () => boolean;
} {
  let tab = 'space'; // активная вкладка-ветка
  let modalId: string | null = null; // открытое досье узла
  let sheet: TechSheet = null; // телефон: выдвинутая панель «Очередь» или «Совет»
  let lastChips = '';
  let queueSel: string | null = null; // RQ-1: строка очереди, чьи кнопки открыты на телефоне
  // Появление досье анимируется одноразовым классом .pop: живой 500мс-ререндер окна
  // пересоздаёт DOM, и анимация на самом .tt-mwin переигрывалась бы каждый тик —
  // досье «схлопывалось и выпрыгивало» дважды в секунду (баг живого плейтеста).
  let modalPop = false;
  // Кэш разметки в духе lastCmdHtml/lastPanelHtml из main.ts: одинаковую строку не
  // переприсваиваем — innerHTML пересоздаёт DOM даже на идентичном тексте (и выбивал
  // бы элемент из-под пальца между touchstart и click).
  let lastHtml = '';
  let lastDrawn = '';
  // RQ-1: отклик на приказ очереди — тема, которую поставили, сдвинули или начали,
  // коротко вспыхивает там, где оказалась. Живой ререндер пересоздаёт узлы, поэтому
  // вспышка помнит, когда началась, и пересозданный узел продолжает её с того же места
  // (отрицательная задержка анимации), а не начинает заново. В сетевой игре узел
  // появляется с ответом сервера — вспышка ждёт его до `FLASH_WAIT_MS`.
  let flash: { id: string; since: number | null; asked: number } | null = null;
  const FLASH_MS = 700;
  const FLASH_WAIT_MS = 3000;
  const now = (): number => (typeof performance !== 'undefined' ? performance.now() : Date.now());

  function paintFlash(body: HTMLElement): void {
    if (!flash || typeof body.querySelectorAll !== 'function') return;
    const at = now();
    const sel = `[data-qitem="${CSS.escape(flash.id)}"],[data-now="${CSS.escape(flash.id)}"],.tt-item[data-tech="${CSS.escape(flash.id)}"]`;
    const nodes = body.querySelectorAll<HTMLElement>(sel);
    if (flash.since === null) {
      if (nodes.length) flash.since = at;
      else if (at - flash.asked > FLASH_WAIT_MS) flash = null;
      if (!flash || flash.since === null) return;
    }
    const elapsed = at - flash.since;
    if (elapsed >= FLASH_MS) {
      flash = null;
      return;
    }
    nodes.forEach((n) => {
      if (n.classList.contains('tt-flash')) return;
      n.style.animationDelay = `-${Math.round(elapsed)}ms`;
      n.classList.add('tt-flash');
    });
  }

  function repaint(): void {
    const body = host.body();
    const html = techTreeHtml(host.state(), host.me(), tab, modalId, { queueSel, sheet });
    const chips = techChipsHtml(host.state(), host.me());
    const chipHost = host.root().querySelector<HTMLElement>('.tt-chips');
    if (chipHost && chips !== lastChips) {
      chipHost.innerHTML = chips;
      lastChips = chips;
    }
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
    drawTreeLines(body, html !== lastDrawn);
    lastDrawn = html;
    patchLiveTimers(body, host.state().time, TECH_LIVE);
    patchRings(body, host.state().time);
    if (modalPop) {
      // Класс мутирует DOM, но кэш сравнивает СТРОКУ разметки, а не живой DOM —
      // .pop не делает кэш вечно «грязным».
      body.querySelector('.tt-mwin')?.classList.add('pop');
      modalPop = false;
    }
    paintFlash(body);
  }

  /** Приказ очереди: отправить, вспыхнуть на месте темы, перерисовать. */
  function queueOrder(action: Action, id: string): void {
    host.order(action);
    flash = { id, since: null, asked: now() };
    repaint();
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
    // «Исследовать» есть и в окошке узла (.tt-mbtn), и в строке очереди (.tt-qgo) —
    // спрашиваем по САМОМУ приказу (data-go), а не по классу кнопки.
    const speed = tg.closest<HTMLElement>('[data-speedact]');
    if (speed && speedupAct(speed.dataset.speedact!, speed.dataset.speedarg ?? '', host.me())) {
      modalId = null;
      repaint();
      return;
    }
    const go = (tg.closest('[data-go]') as HTMLElement | null)?.dataset.go;
    // Приказ из окошка узла закрывает его: игрок сразу видит кольцо на плитке.
    if ((go || (tg.closest('[data-q]') as HTMLElement | null)) && tg.closest('.tt-modal'))
      modalId = null;
    if (go) {
      queueOrder(researchTech(host.me(), go), go); // узел тут же перекрашивается в «исследуется»
      return;
    }
    // RQ-1: приказы очереди — поставить, снять, переставить. Как и «исследовать», они
    // гасят открытие досье: кнопки лежат внутри кликабельной строки.
    const q = (tg.closest('[data-q]') as HTMLElement | null)?.dataset.q;
    if (q) {
      queueOrder(queueTech(host.me(), q), q);
      return;
    }
    const dq = (tg.closest('[data-dq]') as HTMLElement | null)?.dataset.dq;
    if (dq) {
      host.order(dequeueTech(host.me(), dq));
      repaint();
      return;
    }
    const sh = (tg.closest('[data-sheet]') as HTMLElement | null)?.dataset.sheet;
    if (sh === 'queue' || sh === 'council') {
      sheet = sheet === sh ? null : sh;
      modalId = null;
      repaint();
      return;
    }
    if (tg.closest('[data-sheetclose]')) {
      sheet = null;
      repaint();
      return;
    }
    const mv = tg.closest('[data-qmove]') as HTMLElement | null;
    if (mv?.dataset.qmove) {
      const to = Number(mv.dataset.to);
      if (Number.isInteger(to) && to >= 0) queueOrder(moveQueuedTech(host.me(), mv.dataset.qmove, to), mv.dataset.qmove);
      return;
    }
    // Тап по строке очереди (мимо её кнопок) открывает или прячет её кнопки — на телефоне
    // они скрыты, чтобы строка занимала две строки текста, а не высоту 44-пиксельных кнопок.
    const qi = (tg.closest('[data-qitem]') as HTMLElement | null)?.dataset.qitem;
    if (qi) {
      queueSel = queueSel === qi ? null : qi;
      repaint();
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
    // Плитка узла, ссылка «Нужно» / «Ведёт к» в окошке или слот «исследуется» — открыть
    // окошко этого узла на его ветке.
    const node =
      (tg.closest('.tt-item') as HTMLElement | null)?.dataset.tech ??
      (tg.closest('[data-pick]') as HTMLElement | null)?.dataset.pick;
    if (node && data.technologies[node]) {
      tab = data.technologies[node]!.branch ?? 'space';
      sheet = null;
      modalId = node;
      modalPop = true; // реальное открытие досье — единственный случай с анимацией
      repaint();
    }
  });

  return {
    open: (focus?: string) => {
      modalId = null; // свежее открытие — без прошлого досье
      sheet = null;
      // Пришли от запертого юнита или здания — сразу досье нужной технологии на её ветке:
      // цена, срок и кнопка «Исследовать» в один тап, а не поиск по шести вкладкам.
      const td = focus ? data.technologies[focus] : undefined;
      if (focus && td) {
        tab = td.branch ?? 'space';
        modalId = focus;
        modalPop = true;
      }
      host.root().classList.add('show');
      repaint();
      host.onOpen();
    },
    repaint,
    isOpen: () => host.root().classList.contains('show'),
  };
}
