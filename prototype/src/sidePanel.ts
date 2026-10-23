/**
 * Хозяин боковой панели (REFM-225): какую карточку показать (`panelHtml`), лист с кэшем
 * разметки и дверью перерисовки, живые сроки в нём, досье по наведению и по тапу, подъём
 * камеры над листом на телефоне, нажатия по листу (`data-act`, ссылки на миры, параметры
 * флота, плитки) и окно деления флота.
 *
 * Лист собирается каждый кадр, а DOM трогается, только когда разметка поменялась: кэш
 * `lastPanelHtml` живёт здесь, и чужие зоны сбивают его дверью {@link invalidatePanel}, а не
 * присваиванием. Модуль — хозяин трёх состояний листа: вкладки мира `planetTab`, сводки армии
 * `fleetInfoFor` и раскола, который ждёт события (`splitAwait`, его гасит лента дверью
 * {@link endSplitAwait}); снаружи их только читают. Сами карточки рисуют их владельцы
 * (`worldCard.ts`, `fleetCard.ts`). Мир, своё место, раскладку, выбор, эскадры и вылеты,
 * досье, замок здания, окна и отход модуль получает хуками {@link initSidePanel}: импорт из
 * `main.ts` был бы циклом.
 */
import {
  effectiveStats,
  type Fleet,
  forkSiteId,
  type GameState,
  missingHull,
  type ShuttleStrike,
  type Squadron,
  squadronFerryRange,
  squadronPatrol,
} from '../../packages/shared-core/src/index';
import { feedsOnBiomass } from '../../packages/shared-core/src/util/infestation';
import { t, tData } from '../../localization/runtime';
import {
  deployForkFortress,
  disarmRocketMine,
  holdPatrol,
  recallPatrol,
  releaseHold,
  setRocketMineMode,
  splitAloft,
} from '../../decisions/actions';
import { canBuildHere } from '../../decisions/buildGate';
import { changeSectorZeroProgress, sovereignRepairCost } from '../../decisions/sectorZeroProgress';
import {
  cargoSplit,
  normalizeSlotTake,
  type SplitSlot,
  splitSlots,
  stepTake,
} from '../../decisions/splitPlan';
import { barPct } from './buildProgress';
import type { BuildKind } from './buildQueue';
import type { UnitCatalogTab } from './buildScreen';
import type { TileLock } from './catalogTile';
import { chainMode } from './chainComposer';
import { mobileOrderKind, onCommandClick } from './cmdActions';
import { invalidateCmdBar, renderCmdBar } from './cmdBar';
import { dossierLevel, nextHover, showsBody } from './dossierHover';
import type { Dossier } from './dossiers';
import { note, toast } from './eventFeed';
import {
  aloftPanelHtml,
  fleetPanelHtml,
  renderStatPop,
  taskGroupPanelHtml,
  toggleStatPop,
} from './fleetCard';
import type { ConsoleStat } from './fleetConsole';
import { fleetAnchor } from './fleetGeometry';
import { fleetCallsign } from './fleetName';
import { displayUnit, esc, fmtEta, hl } from './format';
import {
  assaultFleet,
  bombardFleet,
  cancelConstruction,
  data,
  deployStation,
  designateCapital,
  engageFleet,
  HOUR,
  instantRepairFleet,
  layMinesFleet,
  loadShuttle,
  mergeSquadron,
  premiumRepairFleet,
  repairFleet,
  resumeConstruction,
  setHoldPoint,
  setRallyPoint,
  splitFleet,
  splitSquadron,
  recallSpy,
  spyOn,
  unloadShuttle,
} from './game';
import { pcUi } from './graphicsPrefs';
import { fleetHangar, planetHangar, transferPick } from './hangarPanel';
import { type DockState, mapIsWorkspace, panelOpen } from './hudDock';
import { unitIconHtml } from './icons';
import {
  aiming,
  arm,
  assaultAim,
  deselectFleets,
  drop,
  engageAim,
  hasSelection,
  heroAim,
  heroSpawnAim,
  merging,
  pickMode,
  pickWorld,
  rallyAim,
  retreatAim,
  selFleet,
  selFleets,
  selFork,
  selPlanet,
  selStrike,
  splitState,
  squadMerge,
  strikeAim,
} from './interaction';
import { clampCam, focusWorld, panBy, world } from './mapCamera';
import { seesDetails } from './mapFog';
import { forgetAimPointer, pointers } from './mapInput';
import { youColor } from './mapPalette';
import { playerOrder } from './orderPipeline';
import { afterRebuild, FORGOTTEN, keepScroll, panelChanged } from './panelCache';
import { pickPanel } from './panelSelect';
import { parseBuildAnchor, quickBuildOrder } from './quickBuild';
import { saveSectorProgress, sectorProgress } from './sectorProfile';
import { isSectorZeroRun } from './sectorRun';
import { opensNow } from './sheetLift';
import { splitDialogHtml, splitDialogLives, splitRows } from './splitDialog';
import { splitOne } from './squadronPanel';
import { cursorTipPos } from './tipPlacement';
import { arrivalHours } from './travelEta';
import { forkPanelHtml, planetPanelHtml, type PlanetTab, unknownPlanetHtml } from './worldCard';
import { enqueueBuild, timeLeft } from './worldQueries';

/** Что листу нужно от игры. Мир, выбор, эскадры, досье и окна — в `main.ts`. */
export interface SidePanelHost {
  /** Мир на экране. */
  world(): GameState;
  /** Своё место. */
  me(): string;
  /** Телефонная раскладка. */
  mobile(): boolean;
  /** Ширина экрана в CSS-пикселях. */
  vw(): number;
  /** Высота экрана в CSS-пикселях. */
  vh(): number;
  /** Идёт партия, а не меню. */
  inMatch(): boolean;
  /** Флот, которого касается лист: выбранный или осматриваемый; `null` — ничей. */
  panelFleet(): string | null;
  /** Досье объекта по ключу; `null` — досье нет. */
  dossier(key: string): Dossier | null;
  /** Выделить флоты: свой — к приказам, чужой — на осмотр. */
  setFleetSelection(ids: string[]): void;
  /** Снять выбор целиком. */
  clearSelection(): void;
  /** Где стоит эскадра: мир или носитель; `null` — её нет. */
  squadronBase(id: string): { planetId: string } | { fleetId: string } | null;
  /** Эскадра по id вместе с базой; `null` — её нет. */
  squadronAt(id: string): { sq: Squadron; base: { planetId: string } | { fleetId: string } } | null;
  /** Свой вылет по id; чужой и пропавший — `null`. */
  ownStrike(id: string): ShuttleStrike | null;
  /** Эскадра вылета той же формы, что в ангаре. */
  strikeSquadron(st: ShuttleStrike): Squadron;
  /** База вылета размеченным адресом — как у прицела из ангара. */
  strikeFrom(st: ShuttleStrike): { planetId: string } | { fleetId: string };
  /** Почему новый заказ здания отбит; `null` — заказать можно. */
  buildingLocked(planetId: string, id: string): TileLock;
  /** Карточка корабля: стек `index` флота. */
  openShipCard(fleetId: string, index: number): void;
  /** Карточка справочника по ключу плитки. */
  openCodex(key: string): void;
  /** Дерево технологий. */
  techTree(): { open(): void };
  /** Окно построек. */
  buildWin(): { open(planetId: string, units?: UnitCatalogTab): void };
  /** Окно боя. */
  battleWindow(): { open(battleId: string): void };
  /** Пинги; `null` — в этой сборке их нет. */
  pings(): { openMenu(): void } | null;
  /** Взвести ручной отход флота. */
  armRetreat(fleetId: string): void;
}

let game: SidePanelHost;
let side: HTMLElement;
let splitdlg: HTMLElement;
let topEl: HTMLElement;
let objTipEl: HTMLElement | null = null;

/** Чей раскол ждёт события, чтобы выделить отделённую часть (`splitSelectTarget`). */
export let splitAwait: string | null = null;
let hoverObj: string | null = null; // side-panel object under the pointer (data-desc key)
export let planetTab: PlanetTab = 'buildings';
/** Открыть вкладку мира снаружи — гид обучения ведёт игрока к кораблям (TRN-7). */
export function setPlanetTab(tab: PlanetTab): void {
  planetTab = tab;
}
// Bytro-карточка: тап по имени флота открывает сводку армии — какой флот сейчас
// в режиме сводки (другой флот в панели → обычная карточка сама собой).
export let fleetInfoFor: string | null = null;
let lastPanelHtml = '';
let lastSplitHtml = '';
let lastObjDescHtml = '';

/** Поднять лист: хуки игры, узлы листа, окна деления, шапки и подсказки, слушатели
 *  нажатий. Зовётся из `main.ts` один раз, на месте прежних слушателей. */
export function initSidePanel(host: SidePanelHost): void {
  game = host;
  const $ = (id: string) => document.getElementById(id) as HTMLElement;
  side = $('side');
  splitdlg = $('splitdlg');
  topEl = $('top');
  objTipEl = document.getElementById('objtip');
  splitdlg.addEventListener('click', onSplitClick);
  side.addEventListener('keydown', onSideKeydown);
  side.addEventListener('click', onSideClick);
  side.addEventListener('pointermove', onSidePointerMove);
  side.addEventListener('pointerleave', onSidePointerLeave);
  side.addEventListener('contextmenu', onSideContextMenu);
}

/** Деление дождались — больше не ждать. Дверь ленты (`eventFeed.ts`): она выделяет отделённую
 *  часть, когда ядро сообщило о расколе. */
export function endSplitAwait(): void {
  splitAwait = null;
}

const clamp = (v: number, a: number, b: number) => Math.max(a, Math.min(b, v));
const inMatch = (): boolean => game.inMatch();
const panelFleet = (): string | null => game.panelFleet();
const objDossier = (key: string): Dossier | null => game.dossier(key);
const setFleetSelection = (ids: string[]): void => game.setFleetSelection(ids);
const clearSelection = (): void => game.clearSelection();
const squadronBase = (id: string) => game.squadronBase(id);
const squadronAt = (id: string) => game.squadronAt(id);
const ownStrike = (id: string): ShuttleStrike | null => game.ownStrike(id);
const strikeSquadron = (st: ShuttleStrike): Squadron => game.strikeSquadron(st);
const strikeFrom = (st: ShuttleStrike): { planetId: string } | { fleetId: string } =>
  game.strikeFrom(st);
const buildingLocked = (planetId: string, id: string): TileLock =>
  game.buildingLocked(planetId, id);
const openShipCard = (fleetId: string, index: number): void => game.openShipCard(fleetId, index);
const openCodex = (key: string): void => game.openCodex(key);
const armRetreat = (fleetId: string): void => game.armRetreat(fleetId);

/** The side-panel dispatcher: task group → single fleet → unknown world → known world. */
function panelHtml(): string {
  const s = game.world();
  if (selFork) return forkPanelHtml(selFork);
  // Эскадра в воздухе (SHU-6.14): села или сбита — вылета нет, и панель идёт дальше.
  const aloft = selStrike ? ownStrike(selStrike) : null;
  if (aloft) return aloftPanelHtml(aloft);
  // Приоритет претендентов и отсев мёртвых ссылок — в `panelSelect.ts` (REFM-39):
  // устаревший выбор флота проваливается на мир, а не запирает панель пустотой.
  const pick = pickPanel(
    { fleets: selFleets, fleet: panelFleet(), planet: selPlanet },
    s,
    seesDetails,
  );
  if (pick.kind === 'group') return taskGroupPanelHtml(pick.fleets);
  if (pick.kind === 'fleet') return fleetPanelHtml(pick.fleet);
  if (pick.kind === 'empty') return `<div class="hint">${t('side.empty')}</div>`;
  return pick.known ? planetPanelHtml(pick.planet) : unknownPlanetHtml(pick.planet);
}

/** A `b:<id>:<lvl>` key embeds its building level in the title (as `hl(lvl)`) — shared
 *  by the desktop hover pane and the mobile tap modal so both read identically. */
function dossierTitleHtml(key: string, d: Dossier): string {
  const lvl = dossierLevel(key); // разбор ключа — `dossierHover.ts` (REFM-82)
  return lvl ? `${esc(d.name)} ${hl(lvl)}` : esc(d.name);
}

/** Right-docked description pane HTML for the currently hovered menu object. */
function objDescHtml(): string {
  const d = hoverObj ? objDossier(hoverObj) : null;
  if (!d) {
    return `<div class="pd-empty">${t('dossier.hint')}</div>`;
  }
  return `<div class="pd-title">${dossierTitleHtml(hoverObj!, d)}</div><div class="pd-body">${d.body}</div>`;
}

/** Touch has no hover — a tap on a `[data-desc]` object opens the SAME dossier in the
 *  codex overlay instead (reuses its box/close chrome; no "Build here" button here). */
export function openDossier(key: string): boolean {
  const d = objDossier(key);
  const el = document.getElementById('codex');
  if (!el || !d) return false;
  el.innerHTML = `<div class="cxbox"><div class="cx-head"><b>${dossierTitleHtml(key, d)}</b></div><div class="cx-desc">${d.body}</div><button class="cx-close">${t('codex.close')}</button></div>`;
  el.classList.add('show');
  return true;
}

function renderObjDesc(): void {
  const pane = document.getElementById('pdesc');
  if (!pane) return;
  const html = objDescHtml();
  if (html === lastObjDescHtml) return;
  lastObjDescHtml = html;
  pane.innerHTML = html;
}

let sheetWasOpen = false;
/** Keep the selected marker above the measured sheet, without following a moving fleet. */
export function revealMobileSelection(): void {
  const s = game.world();
  const MOBILE = game.mobile();
  const VW = game.vw();
  const VH = game.vh();
  if (!MOBILE || !inMatch() || mobileOrderKind() || pickMode || chainMode || pointers.size > 0)
    return;
  const el = document.getElementById('mobile-sheet');
  if (!el || el.hidden) return;
  const fid = panelFleet();
  const f = fid ? s.fleets[fid] : null;
  const p = selPlanet ? s.planets[selPlanet] : null;
  const anchor = f ? fleetAnchor(f) : p ? world(p.position) : null;
  if (!anchor) return;
  const rect = el.getBoundingClientRect();
  const top = topEl.getBoundingClientRect().bottom + 32;
  const right = VH < 520 ? rect.left - 32 : VW - 28;
  const bottom = VH < 520 ? VH - 28 : rect.top - 32;
  panBy(
    clamp(anchor.x, 28, Math.max(28, right)) - anchor.x,
    clamp(anchor.y, top, Math.max(top, bottom)) - anchor.y,
  );
  clampCam();
}

/** Дверь перерисовки листа (REFM-206): «я поменял мир, перерисуй» после приказа, смены
 *  выделения или закрытия окна. Кэш принадлежит разметке листа и живёт здесь, а чужим
 *  зонам нужна эта функция, а не доступ к переменной. */
export function invalidatePanel(): void {
  lastPanelHtml = '';
}

export function renderPanel(): void {
  const MOBILE = game.mobile();
  // Кто прячет лист — решает hudDock.panelOpen: признак один на все режимы прицела
  // («ждём тап по карте»), и «Курс» в нём теперь наравне со слиянием, набором группы
  // и режимом «Приказ». Раньше движение было исключением: игрок жал ⤳ и тапал в лист,
  // который закрывал пол-карты (заказ владельца — убирать нижний хаб и на движении).
  const dock: DockState = {
    // Прицел ПАТРУЛЯ (SHU-6.3) и ПЕРЕЛЁТА (SHU-6.5) прячет лист и на ПК: точку и базу
    // выбирают на карте вокруг базы, а окно мира стоит ровно над ней. Ручной ОТХОД — по
    // той же причине: точка отхода — сосед узла боя, а карточка флота стоит над ним и
    // ловила клик вместо карты (плейтест 2026-10-09, PT-01).
    aiming:
      aiming ||
      !!strikeAim?.patrol ||
      !!strikeAim?.relocate ||
      !!retreatAim ||
      !!rallyAim ||
      (MOBILE && (assaultAim || engageAim || !!heroAim || !!strikeAim || !!heroSpawnAim)),
    merging,
    picking: pickMode,
    chaining: chainMode !== null,
    hasSelection: hasSelection(),
  };
  const open = panelOpen(dock);
  side.style.display = open ? 'flex' : 'none';
  document.body.classList.toggle('sheet-open', open); // mobile: hide log/comms under the sheet
  // Нижний хаб (рейл/скорость/цели) уезжает на телефоне, пока карта — рабочая
  // поверхность. Класс ставится здесь, а не в обработчиках: renderPanel гоняется
  // каждый кадр, поэтому класс физически не может разъехаться с состоянием — а
  // взводится и гасится прицел из полутора десятков мест.
  document.body.classList.toggle('aim-mode', mapIsWorkspace(dock));
  // Phone: the bottom sheet covers ~50vh — when it OPENS, pan the camera so the
  // selected object is not the one thing the panel talks about yet hides.
  // Момент открытия и величина подъёма — `sheetLift.ts` (REFM-83).
  if (opensNow(open, sheetWasOpen, MOBILE)) {
    requestAnimationFrame(revealMobileSelection);
  }
  sheetWasOpen = open;
  if (!open) {
    // Закрытый лист забывает ВСЁ — `panelCache.ts` (REFM-188): иначе при следующем
    // открытии кэш скажет «уже нарисовано», а DOM пуст, и лист откроется пустым.
    ({ panel: lastPanelHtml, objDesc: lastObjDescHtml } = FORGOTTEN);
    hoverObj = null;
    side.classList.remove('details-open');
    renderStatPop();
    return;
  }
  const html = panelHtml();
  // Раскрытая секция подробностей — это ШИРИНА листа (две колонки в `#side.details-open`),
  // а не только его содержимое. Класс снимается с самой разметки, а не со второго флага:
  // `fleetInfoFor` может указывать на флот, которого в панели уже нет.
  side.classList.toggle('details-open', html.includes('class="object-detail"'));
  if (panelChanged(html, lastPanelHtml)) {
    // Scrollable content on the left, a fixed dossier pane glued to the right edge
    // (filling the panel's empty space — see #side / .pdesc CSS). Re-rendering the
    // content rebuilds #pdesc, so force the dossier to repaint against the new DOM.
    // Preserve the scroll offset across the rebuild — the build conveyor's countdown
    // changes the HTML every frame, which would otherwise snap the list back to top
    // and make the panel impossible to scroll while anything is under construction.
    const prevScroll = (side.querySelector('.pscroll') as HTMLElement | null)?.scrollTop ?? 0;
    side.innerHTML = `<div class="pscroll">${html}</div><aside class="pdesc" id="pdesc"></aside>`;
    const ps = side.querySelector('.pscroll') as HTMLElement | null;
    if (ps && keepScroll(prevScroll)) ps.scrollTop = prevScroll;
    // Тронули DOM листа — кэш досье гаснет ВМЕСТЕ с ним (правило 2): `innerHTML`
    // пересоздал `#pdesc`, и старое «уже нарисовано» врало бы про новый пустой узел.
    ({ panel: lastPanelHtml, objDesc: lastObjDescHtml } = afterRebuild(html));
  }
  renderObjDesc();
  updatePanelLive(); // patch live countdowns in place — never rebuild the panel for them
  renderStatPop();
}

/** Patch the panel's per-frame text (build progress, travel ETA, battle round) in
 *  place each frame. These tick every frame, so they're kept OUT of the panel's HTML
 *  signature — the panel (and its buttons) only rebuilds on real structural changes,
 *  so a click whose down/up straddle a frame is never dropped. */
function updatePanelLive(): void {
  const s = game.world();
  const root = side.querySelector('.pscroll');
  if (!root) return;
  for (const el of Array.from(root.querySelectorAll('.conv-fill')) as HTMLElement[]) {
    // Зажим полосы — `buildProgress.ts` (REFM-77): кадр может прийти позже срока работы.
    const pct = barPct(Number(el.dataset.at), Number(el.dataset.dur), s.time);
    el.style.width = `${pct.toFixed(0)}%`;
  }
  for (const el of Array.from(root.querySelectorAll('.conv-time')) as HTMLElement[]) {
    el.textContent = timeLeft(Number(el.dataset.at));
  }
  for (const el of Array.from(root.querySelectorAll('.pn-eta')) as HTMLElement[]) {
    // То же правило, что и в карточке флота: `travelEta.ts` (REFM-67), без второй копии.
    const totalH = arrivalHours(Number(el.dataset.arrive), s.time, HOUR, Number(el.dataset.rest));
    el.textContent = fmtEta(totalH);
  }
  for (const el of Array.from(root.querySelectorAll('.pn-timer')) as HTMLElement[]) {
    el.textContent = timeLeft(Number(el.dataset.at));
  }
}

/** Split-dialog rows of a fleet: one per STACK (unit + loadout), ships first, then
 *  the troops in the hold (FSPLIT-1/2). A stack — not a unit type — is the addressable
 *  thing: the same hull flies fitted and bare, and the loadout is part of the stack's
 *  identity (SM-0.3), so "two cruisers" says nothing until it says WHICH two. */
function fleetSplitSlots(f: Fleet): SplitSlot[] {
  // арифметика деления — `splitPlan.ts` (REFM-76); флагман героя ядро не отделяет
  // (`E_HERO_UNIT`), и окно держит его строку неподвижной (правило 8 там же)
  return splitSlots(f.units, f.landing ?? [], (u) => !!data.units[u]?.traits.includes('hero'));
}

/** Hold capacity of one ship stack with its loadout installed (a cargo module is
 *  exactly why two stacks of the same hull carry different amounts). */
function stackCargoCapacity(unit: string, modules?: readonly string[]): number {
  const def = data.units[unit];
  if (!def) return 0;
  return (
    effectiveStats(def, { ...(modules ? { modules: [...modules] } : {}) }, data).cargoCapacity ?? 0
  );
}

/** The "Split fleet" modal: per ship type, +1 / +10 / All (and −1) move ships into
 *  a new fleet; Confirm peels them off into the same place (a sector, a point of a lane
 *  or the same leg of a journey). Closes itself if the fleet is deselected, vanishes
 *  or enters a battle. */
export function renderSplitDialog(): void {
  const s = game.world();
  const ME = game.me();
  // Жизнь окна и его разметка — `splitDialog.ts` (REFM-159): план привязан к ОДНОМУ
  // флоту, а мир под окном идёт дальше — флот летит, гибнет, дерётся, выделение уходит.
  const plan = splitState;
  const f = plan ? s.fleets[plan.fleetId] : undefined;
  const lives = splitDialogLives({
    planFleetId: plan?.fleetId ?? null,
    selectedFleetId: selFleet,
    fleetExists: !!f,
    inBattle: !!f?.battleId,
  });
  // `|| !plan || !f` — это не второе правило, а хвост для компилятора: их наличие уже
  // гарантировано `lives`, но через вызов функции TS этого не видит.
  if (!lives || !plan || !f) {
    drop('splitState');
    if (splitdlg.style.display !== 'none') splitdlg.style.display = 'none';
    lastSplitHtml = '';
    return;
  }
  const slots = fleetSplitSlots(f);
  // Состав живой: отбор пересчитывается под него на каждой перерисовке (`splitPlan.ts`).
  plan.take = normalizeSlotTake(plan.take, slots);
  const cargo = cargoSplit(
    slots,
    plan.take,
    stackCargoCapacity,
    (u) => data.units[u]?.stats.cargoSize ?? 1,
  );
  const html = splitDialogHtml(
    {
      fleetId: plan.fleetId,
      fleetName: `«${fleetCallsign(plan.fleetId)}»`,
      rows: splitRows(slots, plan.take),
      cargo,
    },
    {
      icon: (u) => unitIconHtml(u, data, youColor, 18, s.players[ME]?.faction),
      name: displayUnit,
      moduleName: (m) => {
        const mdef = data.modules[m];
        return mdef ? tData(mdef.name) : m;
      },
    },
  );
  if (html !== lastSplitHtml) {
    splitdlg.innerHTML = html;
    lastSplitHtml = html;
  }
  splitdlg.style.display = 'flex';
}

function onSplitClick(ev: MouseEvent): void {
  const s = game.world();
  const ME = game.me();
  if (ev.target === splitdlg && splitState) {
    // click on the dimmed backdrop (outside the box) cancels
    drop('splitState');
    renderSplitDialog();
    invalidateCmdBar();
    renderCmdBar();
    return;
  }
  const bEl = (ev.target as HTMLElement).closest('button') as HTMLButtonElement | null;
  if (!bEl || bEl.disabled || !splitState) return;
  const sx = bEl.dataset.sx;
  if (sx === 'cancel') {
    drop('splitState');
    renderSplitDialog();
    invalidateCmdBar();
    renderCmdBar();
    return;
  }
  if (sx === 'confirm') {
    // Приказ адресует стеки, а не типы: у каждой строки — свой лоадаут, десант едет
    // отдельным списком (FSPLIT-1/2). Без строки в отборе стек остаётся исходному флоту.
    const f0 = s.fleets[splitState.fleetId];
    const slots = f0 ? fleetSplitSlots(f0) : [];
    const take: Array<{ unit: string; modules?: string[]; count: number }> = [];
    const takeLanding: Array<{ unit: string; count: number }> = [];
    for (const slot of slots) {
      const n = splitState.take[slot.key] ?? 0;
      if (n <= 0) continue;
      if (slot.kind === 'ship')
        take.push({ unit: slot.unit, modules: slot.modules ?? [], count: n });
      else takeLanding.push({ unit: slot.unit, count: n });
    }
    if (take.length) {
      // Отделённую часть выделит событие раскола (`decisions/splitFollow.ts`): её id
      // выдаёт ядро, а в соло событие приходит ещё внутри `playerOrder`.
      splitAwait = splitState.fleetId;
      if (
        !playerOrder(
          splitFleet(ME, splitState.fleetId, take, takeLanding.length ? takeLanding : undefined),
        )
      )
        splitAwait = null;
    }
    drop('splitState');
    renderSplitDialog();
    invalidateCmdBar();
    invalidatePanel();
    renderCmdBar();
    renderPanel();
    return;
  }
  const key = bEl.dataset.key ?? '';
  const f = s.fleets[splitState.fleetId];
  if (!f) return;
  const have = fleetSplitSlots(f).find((sl) => sl.key === key)?.have ?? 0;
  const cur = splitState.take[key] ?? 0;
  if (sx === 'inc' || sx === 'dec' || sx === 'all') {
    splitState.take[key] = stepTake(cur, have, sx, Number(bEl.dataset.n));
  }
  renderSplitDialog();
}

// Числа карточки телефона — `role="button"` без своей кнопки: Enter и пробел у них
// открывают ту же всплывашку, что и тап (у консоли это настоящие кнопки).
function onSideKeydown(ev: KeyboardEvent): void {
  if (ev.key !== 'Enter' && ev.key !== ' ') return;
  const el = ev.target as HTMLElement;
  if (el.getAttribute('role') !== 'button') return;
  const stat = el.closest<HTMLElement>('[data-stat]')?.dataset.stat;
  if (!stat) return;
  ev.preventDefault();
  toggleStatPop(stat as ConsoleStat);
}
function onSideClick(ev: MouseEvent): void {
  const s = game.world();
  const ME = game.me();
  const MOBILE = game.mobile();
  // A queued order's target is a link: pan the map to that world (briefly ringed)
  // WITHOUT touching the selection — the plan panel must stay open under your finger.
  const go = (ev.target as HTMLElement).closest('[data-goto]') as HTMLElement | null;
  if (go?.dataset.goto) {
    focusWorld(go.dataset.goto);
    return;
  }
  const bEl = (ev.target as HTMLElement).closest('button') as HTMLButtonElement | null;
  // Параметр флота — всплывашка его надбавок. Кнопка ремонта в той же строке корпуса
  // остаётся своей кнопкой: параметр забирает тап, только если он и есть нажатая кнопка
  // или кнопки под пальцем нет вовсе.
  const statEl = (ev.target as HTMLElement).closest<HTMLElement>('[data-stat]');
  if (statEl?.dataset.stat && (!bEl || bEl === statEl || !statEl.contains(bEl))) {
    toggleStatPop(statEl.dataset.stat as ConsoleStat);
    return;
  }
  if (!bEl || bEl.disabled) {
    // Touch has no hover: a tap that lands on a dossier-able row (not one of its own
    // action buttons, handled below) opens the same summary the desktop pane shows
    // on hover — building/task name, current vs full output, ETA.
    if (MOBILE) {
      const key =
        (ev.target as HTMLElement).closest<HTMLElement>('[data-desc]')?.dataset.desc ?? null;
      // stat:/tab: dossiers exist for the PC hover tooltip only — the mobile tap
      // behaviour stays exactly as it was before they were added.
      if (key !== null && !key.startsWith('stat:') && !key.startsWith('tab:')) {
        openDossier(key);
      }
    }
    return;
  }
  // «Погрузка и выгрузка» консоли флота стоит в листе, но это команда ряда: её ведёт тот
  // же делегат, что и остальные приказы (⇅-меню, `troopsPlan`).
  if (bEl.dataset.cmd) {
    onCommandClick(ev);
    return;
  }
  if (bEl.dataset.shipcard) {
    // Карточка корабля: отсеки и надетые модули стека (заказ владельца 2026-09-24).
    const at = bEl.dataset.shipcard.lastIndexOf('|');
    openShipCard(bEl.dataset.shipcard.slice(0, at), Number(bEl.dataset.shipcard.slice(at + 1)));
    return;
  }
  if (bEl.dataset.codex) {
    openCodex(bEl.dataset.codex); // a build/ground tile → full specs (+ Build here)
    return;
  }
  const act = bEl.dataset.act;
  const arg = bEl.dataset.arg ?? '';
  if (act === 'close') {
    clearSelection();
  } else if (act === 'cancel') {
    deselectFleets();
  } else if (act === 'selfleet') {
    setFleetSelection([arg]);
  } else if (act === 'tab') {
    if (arg === 'ground' || arg === 'ships' || arg === 'shuttle' || arg === 'buildings') {
      planetTab = arg;
    }
  } else if (act === 'openbuild') {
    game.buildWin().open(selPlanet!);
  } else if (act === 'openunits') {
    // Вкладка панели и вкладка окна — одно и то же слово, но пришло оно из разметки:
    // сужаем строку до ростера, который окно умеет показывать.
    if (selPlanet && (arg === 'ground' || arg === 'ships' || arg === 'shuttle'))
      game.buildWin().open(selPlanet, arg);
  } else if (act === 'fortress') {
    playerOrder(deployStation(ME, selPlanet!));
  } else if (act === 'forkfortress') {
    // Крепость на развилке (FORT-6.1): встала — выбираем её саму, как мир, чтобы сразу
    // было видно ядро, постройки и кнопку стройки. Отказ оставляет карточку развилки.
    const fork = selFork;
    if (fork && playerOrder(deployForkFortress(ME, fork.province, fork.trail))) {
      pickWorld(forkSiteId(fork.province, fork.trail));
    }
  } else if (act === 'opentech') {
    game.techTree().open();
  } else if (act === 'build') {
    enqueueBuild(selPlanet!, { kind: 'building', id: arg, count: 1 });
  } else if (act === 'unit') {
    enqueueBuild(selPlanet!, { kind: 'unit', id: arg, count: 1 });
  } else if (act === 'engage') {
    // Нарочная атака чужого флота на своём же узле (`fleet.engage`). Первый залп — на
    // самом приказе (CMB-4), поэтому «атака» здесь и правда атака, а не заявка на неё.
    playerOrder(engageFleet(ME, selFleet!, arg));
  } else if (act === 'cancelbuild') {
    // The active order only — refunds the unbuilt share and pauses it (resumable).
    playerOrder(cancelConstruction(ME, selPlanet!, Number(arg)));
  } else if (act === 'resumebuild') {
    playerOrder(resumeConstruction(ME, selPlanet!, Number(arg)));
  } else if (act === 'dequeue') {
    // BLD-1: очередь в ядре, поэтому снятие ждущего — тот же приказ отмены, что и
    // снятие идущей стройки. Возврата тут не будет: ждущий заказ не оплачен.
    playerOrder(cancelConstruction(ME, selPlanet!, Number(arg)));
  } else if (act === 'wingstrike') {
    // SHU-3.1 — взвести УДАР, с SHU-4.3 — удар КОНКРЕТНОГО звена (`arg` = id эскадры).
    // Цель выбирается тапом по карте, как у наводки залпа и у каста: у вылета нет
    // «цели по умолчанию», а гадать за игрока — худший из вариантов.
    const base = squadronBase(arg);
    if (base) {
      arm('strikeAim', { from: base, squadronId: arg }); // слияние звеньев гаснет само
      note(t('hint.wing-aim'));
    }
  } else if (act === 'wingpatrol') {
    // SHU-6.3 — тот же прицел, но тап выбирает ТОЧКУ патруля, а не цель: под пальцем
    // идёт круг патруля (`drawPatrolAim`), вокруг базы — круг дальности, как у удара.
    // Часы и круг подсказка называет числами: у разных машин они разные
    // (`squadronPatrol`).
    const found = squadronAt(arg);
    if (found) {
      const plan = squadronPatrol(found.sq, data);
      arm('strikeAim', { from: found.base, squadronId: arg, patrol: true });
      // У пальца нет наведения: прежняя точка касания нарисовала бы круг там, где игрок
      // уже не целится. Круг появится с первым касанием карты.
      if (MOBILE) forgetAimPointer();
      note(t('hint.wing-patrol-aim', { h: plan.hours, r: plan.radius }));
    }
  } else if (act === 'wingrelocate') {
    // SHU-6.5 — тот же прицел, но тап выбирает СВОЮ БАЗУ, куда эскадра перелетит: вокруг
    // базы — круг дальности перелёта, подходящие базы в уголках (`drawRelocateTargets`).
    const found = squadronAt(arg);
    if (found) {
      arm('strikeAim', { from: found.base, squadronId: arg, relocate: true });
      note(t('hint.wing-relocate-aim', { r: Math.round(squadronFerryRange(found.sq, data)) }));
    }
  } else if (act === 'aloftstrike' || act === 'aloftpatrol' || act === 'aloftrelocate') {
    // SHU-6.14 — тот же прицел, что у карточки в ангаре, но для вылета `arg`: тап по карте
    // меняет его приказ (`aloftAimTap`). База прицела — база вылета: от неё ядро меряет
    // радиус удара и патруля, а круг перелёта рисуется от самой эскадры.
    const st = ownStrike(arg);
    if (st) {
      const aim = { from: strikeFrom(st), squadronId: st.squadronId, strikeId: st.id };
      if (act === 'aloftpatrol') {
        arm('strikeAim', { ...aim, patrol: true });
        if (MOBILE) forgetAimPointer(); // круг появится с первым касанием, как у ангара
        note(t('hint.aloft-patrol-aim'));
      } else if (act === 'aloftrelocate') {
        arm('strikeAim', { ...aim, relocate: true });
        note(t('hint.wing-relocate-aim', { r: Math.round(squadronFerryRange(st, data)) }));
      } else {
        arm('strikeAim', aim);
        note(t('hint.wing-aim'));
      }
    }
  } else if (act === 'aloftsplit') {
    // Делёж в воздухе (SHU-6.14) — по одной машине, как в ангаре (`splitOne`): отделённая
    // часть летит своим вылетом с тем же приказом, выбор остаётся на этой.
    const st = ownStrike(arg);
    const take = st ? splitOne(strikeSquadron(st)) : null;
    if (st && take) playerOrder(splitAloft(ME, st.id, [take]));
  } else if (act === 'wingrecall') {
    // `arg` — id ВЫЛЕТА: патруль уже не в ангаре, и адресуется он так же, как его
    // принимает ядро (`shuttle.recall { strikeId }`).
    playerOrder(recallPatrol(ME, arg));
  } else if (act === 'wingkeep') {
    // «Держать патруль» (SHU-6.6) — `arg` это id ВЫЛЕТА, как у «Вернуть». Новое
    // состояние берётся из самого патруля: строка могла устареть между отрисовкой и тапом.
    const held = (s.strikes ?? []).find((st) => st.id === arg)?.patrol?.hold === true;
    if (playerOrder(holdPatrol(ME, arg, !held)) && !held) note(t('hint.wing-keep'));
  } else if (act === 'wingrelease') {
    // Снять удержание с эскадры, которая ждёт дома перезарядки (правило 8
    // `squadronPanel.ts`): `arg` — id эскадры, база выводится из состояния.
    const base = squadronBase(arg);
    if (base) playerOrder(releaseHold(ME, base, arg));
  } else if (act === 'wingsplit') {
    // Отделяет ОДНУ машину в новое звено (правило 3 в `squadronPanel.ts`): повторный
    // тап отделяет ещё одну. Что именно уходит, решает чистый `splitOne`.
    const found = squadronAt(arg);
    const take = found ? splitOne(found.sq) : null;
    if (found && take) playerOrder(splitSquadron(ME, found.base, arg, [take]));
  } else if (act === 'wingmerge') {
    // Первый тап взводит источник; повторный по нему же — отмена (взведённый режим
    // обязан иметь выход без приказа).
    if (squadMerge?.from === arg) drop('squadMerge');
    else arm('squadMerge', { from: arg });
  } else if (act === 'wingmergeto') {
    const from = squadMerge?.from;
    const found = from ? squadronAt(from) : null;
    if (from && found) playerOrder(mergeSquadron(ME, found.base, from, arg));
    drop('squadMerge');
  } else if (act === 'wingload' || act === 'wingunload') {
    // Что именно перегружать — `hangarPanel.ts` (`transferPick`): первый живой стек
    // источника, столько, сколько влезет в приёмник. Кнопки нет, если брать нечего,
    // поэтому `null` здесь означает «состояние изменилось между отрисовкой и тапом».
    const f = s.fleets[arg];
    const at = f?.location ? s.planets[f.location] : undefined;
    const portView = at ? planetHangar(at, data) : null;
    const holdView = f ? fleetHangar(f, data, s) : null;
    const up = act === 'wingload';
    const pick = transferPick(up ? portView : holdView, up ? holdView : portView);
    if (pick) {
      playerOrder((up ? loadShuttle : unloadShuttle)(ME, arg, pick.squadronId));
    }
  } else if (act === 'spyplanet') {
    if (arg === 'recon' || arg === 'sabotage' || arg === 'theft' || arg === 'research' || arg === 'counter')
      playerOrder(spyOn(ME, selPlanet!, arg));
  } else if (act === 'spyrecall') {
    playerOrder(recallSpy(ME, selPlanet!));
  } else if (act === 'capital') {
    playerOrder(designateCapital(ME, selPlanet!));
  } else if (act === 'holdpoint') {
    playerOrder(setHoldPoint(ME, selPlanet!, arg === 'on'));
  } else if (act === 'rally') {
    // RALLY-1: «Задать»/«Сменить» взводят выбор цели на карте, «Снять» — сразу приказ.
    if (arg === 'off') playerOrder(setRallyPoint(ME, selPlanet!, null));
    else {
      arm('rallyAim', selPlanet!);
      note(t('hint.rally-pick'));
    }
  } else if (act === 'ping') {
    game.pings()?.openMenu();
  } else if (act === 'bombard') {
    playerOrder(bombardFleet(ME, selFleet!, arg === 'on'));
  } else if (act === 'assault') {
    playerOrder(assaultFleet(ME, selFleet!));
  } else if (act === 'openbattle') {
    if (arg) game.battleWindow().open(arg);
  } else if (act === 'retreat') {
    armRetreat(selFleet!);
  } else if (act === 'laymines') {
    playerOrder(layMinesFleet(ME, arg || selFleet!));
  } else if (act === 'rmmode') {
    // Ракетная мина (SM-3.7a) выделена общим путём: режим пуска — ей самой.
    if (selFleet && (arg === 'any' || arg === 'confirmed'))
      playerOrder(setRocketMineMode(ME, selFleet, arg));
  } else if (act === 'rmdisarm') {
    if (selFleet) playerOrder(disarmRocketMine(ME, selFleet));
  } else if (act === 'instantrepair') {
    // Платный мгновенный ремонт: цена и отказы — на сервере; панель перерисуется
    // по факту (полный бар = получилось), нотификаций-обещаний не даём.
    playerOrder(instantRepairFleet(ME, arg || selFleet!));
  } else if (act === 'premiumrepair') {
    // Ремонт за Суверены: сначала ядро чинит, потом профиль платит — отвергнутый ремонт
    // (бой начался между кадром и нажатием) не должен стоить игроку валюты.
    const f = s.fleets[arg || selFleet!];
    if (!f || !isSectorZeroRun()) return;
    const hull = missingHull(f, data);
    const paid = changeSectorZeroProgress(sectorProgress, { kind: 'premium-repair', hull }, data);
    if (!paid) {
      toast(t('side.fleet.repair.premium.short', { n: sovereignRepairCost(hull) }));
      return;
    }
    if (playerOrder(premiumRepairFleet(ME, f.id))) saveSectorProgress(paid);
  } else if (act === 'dockrepair') {
    // ECON-3а: экспресс-ремонт за metal — кнопка видна только у своего дока.
    playerOrder(repairFleet(ME, arg || selFleet!));
  } else if (act === 'fleetinfo') {
    // Осматриваемый чужой флот живёт вне selFleet — действие относится к карточке.
    const id = panelFleet();
    if (id) fleetInfoFor = fleetInfoFor === id ? null : id;
  } else if (act === 'summaryback') {
    // «Назад» только закрывает сводку; повторный тап не открывает её заново.
    fleetInfoFor = null;
  }
  invalidatePanel();
  renderPanel();
  if (act === 'summaryback' || act === 'fleetinfo') {
    const scroll = side.querySelector<HTMLElement>('.pscroll');
    if (scroll) scroll.scrollTop = 0;
  }
}

// Side-panel object hover → dossier. On PC the docked pane is hidden (it ate a slab
// of the panel) — the dossier follows the cursor as a translucent tooltip (#objtip)
// that sizes to its text. Below the PC breakpoint the old right-docked pane behaviour
// stays. Touch has no hover — phones keep the tap-to-open modal.
function placeObjTip(ev: PointerEvent): void {
  if (!objTipEl) return;
  // Отступ, переворот у края и поле — `tipPlacement.ts` (REFM-75).
  const at = cursorTipPos(
    { x: ev.clientX, y: ev.clientY },
    { width: objTipEl.offsetWidth, height: objTipEl.offsetHeight },
    { width: window.innerWidth, height: window.innerHeight },
  );
  objTipEl.style.left = `${at.x}px`;
  objTipEl.style.top = `${at.y}px`;
}
function onSidePointerMove(ev: PointerEvent): void {
  const MOBILE = game.mobile();
  if (MOBILE) return;
  const t = ev.target as HTMLElement;
  if (t.closest('#pdesc')) return; // over the docked pane itself — keep what's shown
  const key = (t.closest('[data-desc]') as HTMLElement | null)?.dataset.desc ?? null;
  if (pcUi() && objTipEl) {
    // Cursor tooltip: shown only while an object is actually under the pointer.
    const step = nextHover('cursor', key, hoverObj);
    if (step.changed) {
      hoverObj = step.hover;
      const d = key ? objDossier(key) : null;
      if (d) {
        // A body-less dossier (bare names — resources, plain units) shows just the title.
        objTipEl.innerHTML =
          `<div class="pd-title">${dossierTitleHtml(key!, d)}</div>` +
          (showsBody(d.body) ? `<div class="pd-body">${d.body}</div>` : '');
        objTipEl.style.display = 'block';
      } else {
        objTipEl.style.display = 'none';
      }
    }
    if (objTipEl.style.display === 'block') placeObjTip(ev);
    return;
  }
  // Docked-pane path (narrow desktop windows): переход наведения — `dossierHover.ts`
  // (REFM-82). Здесь промежуток показанное НЕ гасит: курсор идёт между строками через
  // пустоту, и панель мигала бы пустой на каждом переходе. pointerleave clears it.
  const step = nextHover('docked', key, hoverObj);
  if (step.changed) {
    hoverObj = step.hover;
    renderObjDesc();
  }
}
function onSidePointerLeave(): void {
  if (objTipEl) objTipEl.style.display = 'none';
  if (hoverObj !== null) {
    hoverObj = null;
    renderObjDesc();
  }
}

// PC: right-click on a build tile orders it immediately — same enqueue path as the
// codex «Построить здесь» button, minus the confirmation window (left-click keeps
// opening the full dossier). The browser context menu is suppressed on these tiles.
function onSideContextMenu(ev: MouseEvent): void {
  const s = game.world();
  const ME = game.me();
  if (!pcUi()) return;
  const tile = (ev.target as HTMLElement).closest('[data-buildorder]') as HTMLElement | null;
  if (!tile) return;
  ev.preventDefault();
  // Гейты быстрого заказа — `quickBuild.ts` (REFM-85). Они зеркалят те же проверки, что
  // делает кнопка «Построить здесь»: правый клик обходит окно подтверждения, но не их.
  const p = selPlanet ? s.planets[selPlanet] : undefined;
  const anchorId = parseBuildAnchor(tile.dataset.buildorder)?.id;
  const order = quickBuildOrder(tile.dataset.buildorder, {
    worldOwner: p?.owner ?? null,
    me: ME,
    sectorAllows: !!p && !!anchorId && canBuildHere(p, anchorId, data, feedsOnBiomass(s, ME, data)),
    locked: !!p && !!anchorId && !!buildingLocked(p.id, anchorId),
  });
  if (!order || !selPlanet) return;
  enqueueBuild(selPlanet, { kind: order.kind as BuildKind, id: order.id, count: 1 });
  invalidatePanel();
  renderPanel();
}
