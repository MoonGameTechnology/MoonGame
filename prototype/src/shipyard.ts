import { saveNamedTemplate } from './productionTemplateDialog';
import { holoIcon } from './holographicIcons';
import { productionCatalogHeading, productionCatalogTile } from './productionCatalog';
import { closeProductionOverlay, fittingSheet, presentProduction, rememberProductionDetails, productionOrderHtml } from './productionPresentation';
import { initProductionRefresh } from './productionRefresh';
import { completedUnitSpend } from './economy';
import { productionIncomeHtml, productionStockHtml } from './productionIncome';
import { worldOrdersHtml } from './worldOrdersPane';
import { productionClick } from './productionInteraction';
import { YARD_TABS, yardBoxHtml } from './productionFrame';
export { yardBoxHtml } from './productionFrame';
import { equipModule, unequipModule } from './productionFitting';
import { laneOfSection, sectionForLane, type ProductionLane, type ProductionSection } from '../../decisions/productionSections';
/**
 * «ПРОИЗВОДСТВО» — the unified in-match order screen (CON-1, LARS-4, REFM-13, ROS-3.1).
 *
 * ROS-0.2 + ROS-3.1 (заказ владельца, п. 3). Экран назывался «Верфь»/«Конструктор» и
 * умел заказывать только то, что летает. Теперь это ОДНО место заказа на все пять типов:
 * «Корабли» · «Челноки» · «Пехота» · «Техника» · «Герои». Новым МЕСТОМ постройки он при
 * этом не стал: место у каждого рода своё (казармы / завод / космопорт-верфь), и экран
 * лишь показывает, где заказ пройдёт, — а где своих подходящих миров нет, вместо выбора
 * планеты стоит «нет подходящего места».
 *
 * ГДЕ МОЖНО ЗАЛОЖИТЬ — спрашивается у ЯДРА (`unitBuildSiteBlocker`), а не считается
 * здесь второй копией правил. Своя копия разъехалась бы на первой правке, и игрок
 * выбирал бы мир, на котором ядро отвечает отказом. Ровно та же дисциплина, что у
 * радиусов огня (RANGE-UX) и у кнопки режима огня (ROS-2.1a).
 *
 * Панель мира заказ НЕ отняла: там он локальный — «здесь и сейчас на этом мире», — и
 * второй способ у игрока остаётся.
 *
 * The constructor renders the framework-agnostic `loadoutEditor` view-model from
 * `@void/client` — typed slots + live derived stats + cost — and confirms into
 * `unit.build{modules}`, so the core validates, prices and stamps the set; nothing
 * here decides what a build costs or whether it is legal.
 *
 * Same REFM shape as the other screens: the markup is pure (`yardBoxHtml`,
 * `loadoutPaneHtml`, `orderBarHtml`, `slotLayerHtml`, `statBarHtml`) and the draft is a plain value
 * (`YardDraft`) normalised by a pure `normalizeDraft`; only `initShipyard(host)`
 * touches the DOM, through explicit hooks instead of `main.ts`'s module-level state.
 */
import { buildScreenHtml, type BuildCategory } from './buildScreen';
import { splitSupport } from '../../decisions/supportShips';
import { moduleGroups } from '../../decisions/moduleGroups';
import type { SlotCallout } from '../../decisions/slotCallouts';
import { moduleIcon, SLOT_ICON, SLOT_KEY } from './moduleIcons';
import { effectChip, STAT_KEY } from './moduleEffect';
import {
  effectiveStats,
  matchCost,
  matchUnitHours,
  moduleAllowed,
  unitBuildSiteBlocker,
  unitLane,
  type Action,
  type ArsenalItem,
  type GameState,
} from '../../packages/shared-core/src/index';
import { t, tData } from '../../localization/runtime';
import { data } from './gameData';
import { esc, displayUnit, cost as priceHtml, fmtDur, fmtEta } from './format';
import { patchLiveTimers } from './liveTimers';
import { hoursLeft, unitLaneOrders } from './buildProgress';
import { HOUR } from './time';
import { motionOn } from './graphicsPrefs';
import { unitIconHtml } from './icons';
import { catalogPortraitHtml } from './shipArt';
import { SECTOR_TYPES } from './map';
import { worldName } from './planetName';
import { originOf } from './arsenal';
import { originLabel } from './arsenalScreen';
import { buildShip } from '../../decisions/actions';
import {
  fitTemplate,
  parseTemplates,
  removeTemplate,
  sameTemplate,
  MAX_TEMPLATES,
  type BuildTemplate,
} from '../../decisions/buildTemplates';
import { readRaw, writeRaw } from './prefs';
import {
  isLander,
  landerTroopCandidates,
  orderableTroops,
  orderHours,
} from '../../decisions/landerTroops';
import { unitDamageProfile } from '../../decisions/unitDamage';
import { unitDamageHtml } from './unitDamageView';
import { termHtml } from './termTip';
import {
  createLoadoutEditor,
  type LoadoutModel,
  type LoadoutStatLine,
  type LoadoutEditorResult,
} from '../../packages/client/src/loadoutEditor';

export type YardTab = ProductionSection;

import { YARD_HULLS, YARD_SQUAD_HULLS, YARD_GROUND_HULLS } from './productionRoster';
export { YARD_HULLS, YARD_SQUAD_HULLS, YARD_GROUND_HULLS } from './productionRoster';

export function groundHullsOf(kind: 'infantry' | 'vehicle'): string[] {
  return YARD_GROUND_HULLS.filter((id) => data.units[id]?.kind === kind);
}

/** Корпуса вкладки. Одно место, где вкладка превращается в ростер, — им пользуются и
 *  отрисовка, и нормализация черновика, и обработчик кликов. */
export function hullsOfTab(tab: YardTab): string[] {
  switch (tab) {
    case 'squads':
      return YARD_SQUAD_HULLS;
    case 'infantry':
      return groundHullsOf('infantry');
    case 'vehicles':
      return groundHullsOf('vehicle');
    case 'support':
      return splitSupport(YARD_HULLS, data).support;
    default:
      return splitSupport(YARD_HULLS, data).line;
  }
}

/** How many hulls one order may queue at once (the ± stepper's range). */
const MAX_COUNT = 20;

// Подписи статов и чип эффекта модуля — у арсенала и верфи общие (`moduleEffect.ts`). Ключа
// нет — `t()` отдаёт его как есть («+8 pointDefense»), поэтому сторож в `shipyard.test.ts`
// сверяет словарь со всеми статами модулей из `data/` (UIX-5.1).
export { STAT_KEY };

/**
 * Редкость и звёзды модуля — языком карточек Сектора Зеро: слово ступени её цветом и горящие
 * звёзды (★ — уровень прокачки). Нет звёзд (★0 или обычный матч без кузни) — ряда звёзд нет,
 * как в карточке корабля: пустые звёзды звали бы к кузне, которой в этой партии нет.
 */
export function moduleGradeHtml(rarity: string, star: number): string {
  const stars =
    star > 0
      ? ` <span class="cn-st" role="img" aria-label="${esc(t('shipcard.stars', { n: star }))}">${'★'.repeat(star)}</span>`
      : '';
  return `<span class="cn-mr r-${esc(rarity)}"><span class="cn-rw">${t(`rarity.${rarity}`)}</span>${stars}</span>`;
}

/** The order being composed: which hull, what is bolted on, how many, where. Plain
 *  data, so the pane can be rendered (and asserted) without a window. */
export interface YardDraft {
  hull: string;
  modules: string[];
  count: number;
  planet: string;
  /** Боец десантного челнока (SHU-5.2) — по одному на каждую машину заказа. */
  troop?: string;
  /** Открытый в окне отсек (индекс в раскладке ядра) — что смотрит игрок, а не что заказано;
   *  без него открыт первый пустой ({@link selectedBay}). */
  slot?: number;
  /** Развёрнуты ли модули, которые на этот корпус не встают. */
  unfit?: boolean;
}

/** Какой отсек открыт: выбранный игроком, пока такой есть; иначе первый пустой; иначе первый. */
export function selectedBay(slots: readonly { moduleId?: string }[], wanted?: number): number {
  if (wanted !== undefined && wanted >= 0 && wanted < slots.length) return wanted;
  const free = slots.findIndex((sl) => !sl.moduleId);
  return free < 0 ? 0 : free;
}

/** Статья словаря у строки характеристики (UIX-9.4): подпись строки — слово-термин. «Урон в
 *  атаке» и «Урон в защите» — те же атака и защита, что в окне флота, и объяснение у них одно. */
const STAT_TERM: Record<string, string> = {
  attack: 'attack',
  defense: 'defense',
  hp: 'hull',
  shield: 'shield',
  speed: 'speed',
};

/** One live stat row: label · base → effective (+delta) · track bar (base cyan, delta green). */
export function statBarHtml(line: LoadoutStatLine, max: number): string {
  const basePct = max > 0 ? Math.min(100, (line.base / max) * 100) : 0;
  const deltaPct = max > 0 ? Math.min(100 - basePct, (Math.max(0, line.delta) / max) * 100) : 0;
  // Звёзды модулей дают дробный вклад (×1.1): число — до десятых, иначе «+5.3999999999».
  const r = (v: number): number => Math.round(v * 10) / 10;
  const val =
    line.delta !== 0
      ? `${r(line.base)} <span class="dim">→</span> <b>${r(line.effective)}</b> <span class="cn-up">${line.delta > 0 ? '+' : ''}${r(line.delta)}</span>`
      : `<b>${r(line.effective)}</b>`;
  return (
    `<div class="cn-stat"><div class="cn-srow"><span class="cn-snm">${STAT_TERM[line.stat] ? termHtml(STAT_TERM[line.stat]!, line.label) : esc(line.label)}</span><span class="cn-sval">${val}</span></div>` +
    `<div class="cn-strack"><span class="cn-sbar" style="width:${basePct}%"></span><span class="cn-sdelta" style="width:${deltaPct}%"></span></div></div>`
  );
}

/** LARS-4 — a small "откуда" tag for a «Производство» card, from whatever the hub Arsenal
 *  витрина has cached (best-effort: blank if the player never opened that tab this
 *  session, never a guess). Only flags a NON-starter origin — a starter blueprint
 *  sitting in every match isn't news; a fresh drop/craft/auction pickup is. */
export function originTagHtml(items: readonly ArsenalItem[], defId: string): string {
  const origin = originOf(items, defId);
  if (!origin || origin === 'starter') return '';
  return `<span class="cn-mo">${originLabel(origin)}</span>`;
}

/** Which hulls of a family the player may actually order. ARS-5: the constructor
 *  offers only what the match's arsenal snapshot (ARS-3) says is owned — the same
 *  `Player.arsenal` the core build gate reads, so the palette can never promise a
 *  build the server would then reject. No snapshot (regular/dev match, bots) ⇒
 *  unrestricted, mirroring the core's own degradation. */
export function ownedHullsOf(state: GameState, me: string, hullList: string[]): string[] {
  const snap = state.players[me]?.arsenal;
  return snap ? hullList.filter((h) => data.units[h]?.domain === 'ground' || snap.hulls.includes(h)) : hullList;
}

/**
 * Ваши миры, где ЭТОТ корпус можно заложить (ROS-3.1).
 *
 * Два условия, и оба чужие — свои правила экран не выдумывает: сектор должен быть
 * застраиваемым (`SECTOR_TYPES`), а здания на мире — открывать производство ИМЕННО
 * этого рода. Второе спрашивается у ядра (`unitBuildSiteBlocker`): космопорт для
 * челнока, верфь для корабля, казармы для пехоты, завод для техники. Пустой список
 * означает не «нет своих миров», а «нет ПОДХОДЯЩЕГО места» — разница для игрока
 * существенная, и подпись под селектором её называет.
 */
export function buildSites(state: GameState, me: string, hull: string) {
  const def = data.units[hull];
  return Object.values(state.planets).filter((p) => {
    if (p.owner !== me || !SECTOR_TYPES[p.kind ?? '']?.buildable) return false;
    return def ? unitBuildSiteBlocker(p, def, data) === null : true;
  });
}

/** Pull a draft back onto legal ground before it is rendered or sent: a hull outside
 *  this pane's family (a tab switch) snaps to the first owned one and drops the
 *  modules with it (slot types differ), and a lost/never-picked world snaps to the
 *  first buildable one. Pure — it returns the corrected draft instead of editing it. */
export function normalizeDraft(
  state: GameState,
  me: string,
  draft: YardDraft,
  hullList: string[],
): YardDraft {
  const owned = hullList;
  const next = { ...draft, modules: [...draft.modules] };
  if (owned.length && !owned.includes(next.hull)) {
    next.hull = owned[0]!;
    next.modules = [];
  }
  // Мир проверяется ПОД ВЫБРАННЫЙ КОРПУС: переключение вкладки меняет и требование к
  // зданию, и годный мир вместе с ним (казармы вместо верфи — уже другой список).
  const worlds = productionWorlds(state, me);
  if (!next.planet || !worlds.some((p) => p.id === next.planet)) next.planet = worlds[0]?.id ?? '';
  return next;
}

/** Что телу окна и полосе заказа нужно от игры сверх мира. */
export interface YardView {
  youColor: string;
  arsenalItems: readonly ArsenalItem[];
  /** Кого ядро примет бойцом десантного челнока на мире черновика (SHU-5.2). */
  troops?: readonly string[];
  block?: string | null;
  blockText?: string;
  section?: YardTab;
}

/** The loadout constructor pane for a family of hulls (ships or shuttles) — same
 *  `loadoutEditor` view-model, just a different hull list. Expects an already
 *  normalised draft. */
export function loadoutPaneHtml(
  state: GameState,
  me: string,
  draft: YardDraft,
  hullList: string[],
  view: YardView,
): string {
  const snap = state.players[me]?.arsenal;
  const ownedHulls = hullList;
  const ownedModules = snap ? new Set(snap.modules) : undefined;
  if (!ownedHulls.length) return `<div class="cn-soon">${t('yard.hull.none')}</div>`;
  const res = state.players[me]?.resources ?? {};
  // Звёзды и поднятая редкость места (снимок арсенала забега Сектора Зеро): с ними числа
  // карточек и характеристик — те, что получит построенный корабль. Слоты, купленные звёздами
  // корабля, — тоже отсеки: без них модуль под купленный слот было не поставить.
  const boosts = { moduleStars: snap?.stars, moduleRarity: snap?.rarity, bonusSlots: snap?.slots?.[draft.hull] };
  const ed: LoadoutEditorResult = createLoadoutEditor(draft.hull, data, res, {
    modules: draft.modules,
    count: draft.count,
    ownedModules,
    pricing: state.pricing,
    ...boosts,
  });
  if (!ed.ok) return `<div class="cn-soon">${t('yard.hull.unavailable')}</div>`;
  const m: LoadoutModel = ed;
  const hulls = [...ownedHulls].sort((a,b) => data.units[a]!.buildTimeHours - data.units[b]!.buildTimeHours || a.localeCompare(b)).map(h => productionCatalogTile(state, me, draft.planet, h, draft.hull)).join('');
  // Открытый отсек (шаг 3 переделки окна): справа — его модули, а не весь каталог.
  const sel = selectedBay(m.slots, draft.slot);
  const portrait = catalogPortraitHtml('u', draft.hull, data);
  const art = portrait ? `<div class="cn-art">${portrait}</div>` : '';
  const slotsLine = slotCountText(m.slots);
  const hullCard =
    `<div class="cn-hull${portrait ? ' with-art' : ''}">${art}<div class="cn-hull-info"><div class="cn-hic">${unitIconHtml(draft.hull, data, view.youColor, 40)}</div><div><div class="cn-hn">${esc(displayUnit(draft.hull))}</div>` +
    `${slotsLine ? `<div class="cn-hm">${slotsLine}</div>` : ''}</div></div></div>`;
  // Строка отсека открывает его, как плитка на арте; снять модуль — крестиком у открытой
  // плитки, а у корпуса без арта с плитками — кнопкой над модулями отсека.
  const bays = m.slots
    .map((sl, i) => {
      const on = i === sel ? ' sel' : '';
      // Слот, купленный звездой корабля, помечен той же золотой звездой, что плитка на арте.
      const bought = sl.bonus ? ` <span class="cn-bbuy" title="${esc(t('yard.slot.bonus'))}">★</span>` : '';
      if (sl.moduleId) {
        const md = data.modules[sl.moduleId];
        const own = m.palette.find((o) => o.id === sl.moduleId)?.effect ?? md?.effects.stats ?? {};
        const eff = md
          ? Object.entries(own)
              .map(([k, v]) => effectChip(k, v))
              .join(' ') + (md.description ? `<p>${esc(t(md.description))}</p>` : '')
          : '';
        return (
          `<div class="cn-bay filled${on} r-${sl.rarity ?? 'simple'}" data-cnsel="${i}" role="button" tabindex="0"><div class="cn-bic">${moduleIcon(sl.moduleId)}</div>` +
          `<div><div class="cn-bt">${t(SLOT_KEY[sl.type] ?? sl.type)}${bought}</div><div class="cn-bn">${esc(tData(sl.moduleName ?? sl.moduleId))}${originTagHtml(view.arsenalItems, sl.moduleId)}</div>${moduleGradeHtml(sl.rarity ?? 'simple', sl.star ?? 0)}</div><div class="cn-bd">${eff}</div><button class="cn-tx btn-x" data-cnrm="${sl.moduleId}" aria-label="${t('yard.module.take-off')}">✕</button></div>`
        );
      }
      return (
        `<div class="cn-bay empty${on}" data-cnsel="${i}" role="button" tabindex="0"><div class="cn-bic">${holoIcon('plus-circle')}</div>` +
        `<div><div class="cn-bt">${t(SLOT_KEY[sl.type] ?? sl.type)}${bought}</div><div class="cn-bn">${t('yard.slot.empty')}</div></div></div>`
      );
    })
    .join('');
  const paletteCard = (o: LoadoutModel['palette'][number]): string => {
    const eff = Object.entries(o.effect)
      .map(([k, v]) => effectChip(k, v))
      .join(' ');
    if (o.installable) {
      return (
        `<button class="cn-mod r-${o.rarity}${o.id === m.slots[sel]?.moduleId ? ' on' : ''}" data-cnmod="${o.id}" aria-pressed="${o.id === m.slots[sel]?.moduleId}"><span class="cn-mic">${moduleIcon(o.id)}</span>` +
        `<span class="cn-mn">${esc(tData(o.name))}${originTagHtml(view.arsenalItems, o.id)}</span>${moduleGradeHtml(o.rarity, o.star)}<span class="cn-me">${eff}</span><span class="cn-mc">${priceHtml(o.cost)}</span></button>`
      );
    }
    // Причина берётся из КОДА отказа ядра, а не гадается: «нет слота» и «не для
    // этого корпуса» — разные вещи, и подпись «нужен слот: утилита» на корпусе, у
    // которого утилита свободна, читалась бы как враньё.
    const why =
      o.code === 'E_NOT_ALLOWED'
        ? t('yard.module.not-allowed')
        : t('yard.slot.named', { s: t(SLOT_KEY[o.slot] ?? o.slot) });
    return (
      `<div class="cn-mod locked r-${o.rarity}"><span class="cn-mic">${moduleIcon(o.id)}</span>` +
      `<span class="cn-mn">${esc(tData(o.name))}</span>${moduleGradeHtml(o.rarity, o.star)}<span class="cn-me">${why}</span><span class="cn-mc">${priceHtml(o.cost)}</span></div>`
    );
  };
  // LARS-4: the palette already reads the LIVE arsenal snapshot (a module bought
  // mid-match shows up here without a new match) and the note says so. That it works on
  // a new build only is the lock note's line under the stats (UIX-10.8: said once).
  const liveNote = snap ? `<div class="cn-note">${t('yard.arsenal.note')}</div>` : '';
  // Модули открытого отсека. Надетый в нём модуль на время выбора снят: так его замена
  // предлагается как годная и встаёт в тот же отсек.
  const bay = m.slots[sel];
  let panel = '';
  if (bay) {
    const cur = bay.moduleId;
    const pick = cur
      ? createLoadoutEditor(draft.hull, data, res, {
          modules: m.modules.filter((id) => id !== cur),
          count: draft.count,
          ownedModules,
          pricing: state.pricing,
          ...boosts,
        })
      : ed;
    // Модуль уже стоит в другом отсеке (ядро не даёт два одинаковых) — он виден на арте и в
    // списке отсеков, здесь он не выбор.
    const option = new Map(
      (pick.ok ? pick.palette : [])
        .filter((o) => o.code !== 'E_DUP_MODULE')
        .map((o) => [o.id, o] as const),
    );
    const fitDef = data.units[m.unit];
    // Порядок — группы по типу отсека, внутри по редкости (заказ владельца 2026-09-26,
    // `moduleGroups.ts`); типизированному отсеку — одна его группа, универсальному — все.
    const groups = moduleGroups([...option.keys()], data, {
      fits: (id) => fitDef !== undefined && moduleAllowed(m.unit, fitDef, data.modules[id]!),
    }).filter((g) => bay.type === 'universal' || g.slot === bay.type);
    const fitting = groups
      .map(({ slot, ids }) => {
        const ok = ids.filter((id) => option.get(id)!.installable);
        if (!ok.length) return '';
        const head =
          bay.type === 'universal'
            ? `<div class="cn-pg" data-slot="${slot}"><span aria-hidden="true">${SLOT_ICON[slot] ?? '＋'}</span> ${t(SLOT_KEY[slot] ?? slot)}</div>`
            : '';
        return head + ok.map((id) => paletteCard(option.get(id)!)).join('');
      })
      .join('');
    // Не встающие на этот корпус модули свёрнуты в одну строку (UIX-13.1): они не выбор,
    // а справка, и раньше занимали больше места, чем годные.
    const unfit = groups.flatMap((g) => g.ids).filter((id) => !option.get(id)!.installable);
    const fold = unfit.length
      ? `<button class="cn-unfit btn-quiet" data-cnunfit aria-expanded="${draft.unfit ? 'true' : 'false'}">${draft.unfit ? t('yard.modules.unfit-hide') : t('yard.modules.unfit', { n: unfit.length })}</button>` +
        (draft.unfit ? `<div class="cn-pal">${unfit.map((id) => paletteCard(option.get(id)!)).join('')}</div>` : '')
      : '';
    panel =
      `<div class="cn-sh"><div class="cn-ph"><span aria-hidden="true">${SLOT_ICON[bay.type] ?? '＋'}</span> ${t('yard.modules.for-slot', { s: t(SLOT_KEY[bay.type] ?? bay.type) })}</div>` +
      `</div><div class="cn-pal">${fitting || `<div class="cn-none">${t('yard.modules.none')}</div>`}</div>${fold}${liveNote}`;
  }
  // stats: live preview of the fitted hull
  const maxStat = Math.max(1, ...m.preview.map((p) => p.effective));
  const bars = m.preview.map((p) => statBarHtml(p, maxStat)).join('');
  // Урон по целям — с тем же оснащением, что и полосы над ним: надел осадный модуль —
  // выросла ячейка «по зданиям».
  const hullDef = data.units[m.unit];
  const damage = hullDef
    ? unitDamageHtml(
        unitDamageProfile(
          hullDef,
          effectiveStats(
            hullDef,
            {
              modules: m.modules,
              ...(snap?.stars ? { moduleStars: snap.stars } : {}),
              ...(snap?.rarity ? { moduleRarity: snap.rarity } : {}),
            },
            data,
          ),
        ),
      )
    : '';
  // ДЕСАНТНЫЙ ЧЕЛНОК (SHU-5.2) строится с бойцом внутри: выбор бойца — здесь, его цена и
  // срок — в полосе заказа. Список бойцов считает хозяин пробой ядра (`orderableTroops`).
  const troopRow = !isLander(hullDef)
    ? ''
    : (view.troops ?? []).length
      ? `<div class="cn-trow"><span class="cn-cl">${t('yard.cost.troop', { n: String(m.count) })}</span>` +
        `<select class="cn-plan" id="cn-troop">${(view.troops ?? [])
          .map(
            (g) =>
              `<option value="${esc(g)}"${g === draft.troop ? ' selected' : ''}>${esc(displayUnit(g))}</option>`,
          )
          .join('')}</select></div>`
      : `<div class="cn-noplace">${t('yard.troop.none')}</div>`;
  const stats =
    `<details class="cn-side pw-fit-stats"><summary>${t('yard.stats')}</summary>${bars}${damage}` +
    (m.hasSlots ? `<div class="cn-lock">🔒 <span>${t('yard.loadout.note')}</span></div>` : '') +
    `</details>${troopRow}`;
  // Раскладка (шаг 3): на ПК три колонки — корпуса, корабль с характеристиками, модули
  // отсека; на телефоне одна колонка в том же порядке, модули сразу под артом. Корпус без
  // отсеков — без колонки модулей.
  const card = `<div class="cn-card${m.hasSlots ? ' with-tiles' : ''}">${hullCard}<div class="pw-bays">${bays}</div></div>`;
  const slotCol = panel ? `<div class="cn-slot">${panel}</div>` : '';
  return `<div class="cn-grid ${data.units[draft.hull]?.domain === 'ground' ? 'pw-ground' : ''} ${slotCol ? 'cn-g3' : 'cn-g2'}"><div class="cn-hulls">${productionCatalogHeading(view.section)}${hulls}</div>${fittingSheet(card + slotCol + stats, displayUnit(draft.hull), hullDef?.domain === 'ground')}</div>`;
}

/**
 * Что ждёт заказ этого юнита на мире (BLD-1): полоса его постройки (BLD-2.1) строит один заказ
 * за раз, остальные стоят в очереди ядра (`Planet.buildQueue`). `null` — полоса свободна.
 * `nextInHours` — когда закончится идущая стройка; ноль — идущей нет, голова очереди ждёт денег.
 */
export function unitLaneAhead(
  state: GameState,
  planetId: string,
  unit: string,
): { count: number; nextInHours: number } | null {
  const { active, queued } = unitLaneOrders(state, planetId, unit, data);
  const heroes = unitLane(data.units[unit]) === 'mobilization'
    ? Object.values(state.heroes ?? {}).flatMap(h => h.mobilization?.target === planetId ? [h.mobilization] : []) : [];
  const count = (active ? 1 : 0) + queued.length + heroes.length;
  if (count === 0) return null;
  const nextAt = active?.at ?? heroes.find(h => !h.queued)?.readyAt;
  return { count, nextInHours: nextAt === undefined ? 0 : hoursLeft(nextAt, state.time, HOUR) };
}

/** Подпись под корпусом: сколько у него слотов и сколько из них куплено звёздами корабля. Корпус
 *  без слотов подписи не получает: ноль не пишется (UIX-10.8), а что модулей нет, видно и так —
 *  на арте нет выносок, в окне нет отсеков. */
function slotCountText(slots: LoadoutModel['slots']): string {
  if (slots.length === 0) return '';
  const bought = slots.filter((sl) => sl.bonus).length;
  return bought > 0
    ? t('yard.slots.count-bonus', { n: String(slots.length), b: String(bought) })
    : t('yard.slots.count', { n: String(slots.length) });
}

/**
 * Слой выносок поверх арта корпуса: точка на корпусе, плитка слота рядом и линия между ними
 * (форма «Выноска», решение владельца 2026-10-10). Координаты — проценты картинки
 * (`decisions/slotCallouts.ts`), а слой лежит ровно на картинке, поэтому точка стоит на той
 * же детали корабля и на телефоне, и на ПК. Плитка открывает свой отсек: рядом встают его
 * модули (шаг 3), открытый отсек обведён. Слот, купленный звездой корабля, несёт золотую
 * звезду в углу, а только что купленный (`fresh`) один раз вспыхивает.
 */
export function slotLayerHtml(
  slots: readonly (LoadoutModel['slots'][number] & { fresh?: boolean })[],
  callouts: readonly SlotCallout[],
  sel: number,
  // Чем плитка сообщает о себе по клику: верфь ловит `data-cnsel`, подготовка Сектора Зеро —
  // свои `data-prep`.
  attr: (i: number, sl: LoadoutModel['slots'][number]) => string = (i) => `data-cnsel="${i}"`,
  // Крестик «снять» в углу открытой занятой плитки (заказ владельца 2026-11-01): атрибуты,
  // по которым хозяин ловит клик. Не задан — крестика нет.
  remove?: (sl: LoadoutModel['slots'][number]) => string,
): string {
  // Плитка не вылезает за картинку: центр не ближе половины плитки к краю.
  const at = ([x, y]: readonly [number, number]): string =>
    `left:clamp(22px,${x}%,calc(100% - 22px));top:clamp(22px,${y}%,calc(100% - 22px))`;
  const lines = callouts
    .map((c) => `<line x1="${c.a[0]}%" y1="${c.a[1]}%" x2="${c.t[0]}%" y2="${c.t[1]}%"/>`)
    .join('');
  const marks = slots
    .map((sl, i) => {
      const c = callouts[i]!;
      const dot = `left:${c.a[0]}%;top:${c.a[1]}%`;
      const kind = sl.bonus
        ? `${t(SLOT_KEY[sl.type] ?? sl.type)} (${t('yard.slot.bonus')})`
        : t(SLOT_KEY[sl.type] ?? sl.type);
      const on = i === sel;
      const pressed = ` aria-pressed="${on ? 'true' : 'false'}"`;
      const mark = (sl.bonus ? ' bonus' : '') + (sl.fresh ? ' fresh' : '');
      const bought = sl.bonus ? `<span class="cn-tbuy" aria-hidden="true">★</span>` : '';
      if (sl.moduleId) {
        // Плитка несёт ступень цветом рамки и уровень прокачки значком «★2» в углу; словом
        // то же самое — в подписи для диктора и подсказке.
        const rar = sl.rarity ?? 'simple';
        const star = sl.star ?? 0;
        const grade = [t(`rarity.${rar}`), ...(star > 0 ? [t('shipcard.stars', { n: star })] : [])].join(', ');
        const label = `${kind}: ${tData(sl.moduleName ?? sl.moduleId)} (${grade})`;
        const badge = star > 0 ? `<span class="cn-tst" aria-hidden="true">★${star}</span>` : '';
        // Крестик — соседний узел, а не часть плитки: кнопка внутри кнопки недопустима.
        const off = `${t('yard.module.take-off')}: ${tData(sl.moduleName ?? sl.moduleId)}`;
        const x =
          on && remove
            ? `<button class="cn-tx btn-x" ${remove(sl)} style="${at(c.t)}" aria-label="${esc(off)}" title="${esc(off)}">✕</button>`
            : '';
        return (
          `<span class="cn-dot full" style="${dot}"></span>` +
          `<button class="cn-tile filled${on ? ' sel' : ''}${mark}" ${attr(i, sl)}${pressed} style="${at(c.t)};--rar:var(--rar-${rar})" aria-label="${esc(label)}" title="${esc(label)}">${moduleIcon(sl.moduleId)}${badge}${bought}</button>` +
          x
        );
      }
      const label = `${kind}: ${t('yard.slot.empty')}`;
      return (
        `<span class="cn-dot" style="${dot}"></span>` +
        `<button class="cn-tile empty${on ? ' sel' : ''}${mark}" ${attr(i, sl)}${pressed} style="${at(c.t)}" aria-label="${esc(label)}" title="${esc(label)}"><span class="cn-ti">${SLOT_ICON[sl.type] ?? '＋'}</span>${bought}</button>`
      );
    })
    .join('');
  return `<div class="cn-slots"><svg class="cn-lines" aria-hidden="true">${lines}</svg>${marks}</div>`;
}

/**
 * Полоса заказа внизу окна: цена значками с нехваткой, срок постройки, мир с его очередью,
 * число и «Построить». Стоит ВНЕ прокрутки: раньше цена и кнопка заканчивали длинную колонку —
 * на телефоне это был пятый экран, на ПК они уезжали вверх, пока листаешь к модулям.
 * Пустая строка — заказывать нечего (корпусов нет или корпус недоступен). Ожидает уже
 * нормализованный черновик, как и `loadoutPaneHtml`.
 */
export function orderBarHtml(
  state: GameState,
  me: string,
  draft: YardDraft,
  hullList: string[],
  view: YardView,
): string {
  if (!hullList.length) return '';
  const snap = state.players[me]?.arsenal;
  const res = state.players[me]?.resources ?? {};
  const ed = createLoadoutEditor(draft.hull, data, res, {
    modules: draft.modules,
    count: draft.count,
    ownedModules: snap ? new Set(snap.modules) : undefined,
    bonusSlots: snap?.slots?.[draft.hull],
    pricing: state.pricing,
  });
  if (!ed.ok) return '';
  // Цена десантного челнока — челнок с модулями ПЛЮС бойцы, срок — дольший из двух (SHU-5.2).
  const lander = isLander(data.units[draft.hull]);
  const troop =
    lander && draft.troop && (view.troops ?? []).includes(draft.troop) ? draft.troop : undefined;
  const total: Record<string, number> = { ...ed.totalCost };
  for (const [r, n] of Object.entries((troop && matchCost(state, data.units[troop]?.cost)) || {}))
    total[r] = (total[r] ?? 0) + n * ed.count;
  const affordable = Object.entries(total).every(([r, n]) => (res[r] ?? 0) >= n);
  const site = state.planets[draft.planet];
  const siteBlocked = !site || !!unitBuildSiteBlocker(site, data.units[draft.hull]!, data);
  const canBuild = !siteBlocked && !view.block && affordable && draft.planet !== '' && (!lander || troop !== undefined);
  const worlds = productionWorlds(state, me);
  const ahead = draft.planet ? unitLaneAhead(state, draft.planet, draft.hull) : null;
  // Пустая очередь — обычный случай и не подписывается («Начнётся сразу» снято, UIX-10.8):
  // строка появляется, только когда перед заказом кто-то есть.
  const queue = !ahead
    ? ''
    : ahead.nextInHours > 0
      ? t('yard.queue.ahead', { n: ahead.count, eta: fmtEta(ahead.nextInHours) })
      : t('yard.queue.waiting', { n: ahead.count });
  // Нет годного мира — вместо селектора ПРЯМАЯ надпись (заказ владельца): пустой
  // выпадающий список игрок читает как «сейчас загрузится», а не как отказ.
  const where = worlds.length
    ? `<select class="cn-plan" id="cn-planet" aria-label="${t('yard.where')}">${worlds
        .map(
          (p) =>
            // Мир по имени, как на карте (UIX-5.2); значение опции — id.
            `<option value="${p.id}"${p.id === draft.planet ? ' selected' : ''}>${esc(worldName(state, p.id))}</option>`,
        )
        .join('')}</select>${queue ? `<span class="cn-oq">${queue}</span>` : ''}`
    : `<div class="cn-noplace">${t('yard.no-place')}</div>`;
  return productionOrderHtml({
    count: draft.count, max: MAX_COUNT, world: draft.planet,
    worldName: draft.planet ? worldName(state, draft.planet) : t('yard.no-place'),
    price: priceHtml(total, res), time: fmtDur(matchUnitHours(state, orderHours(data, draft.hull, troop))),
    queue, where: worlds.length ? '' : where, affordable, canBuild, block: view.block ? view.blockText ?? '' : '',
  });
}

/** Вкладки, на которых собирается заказ, — у них и бывают шаблоны. */
const TEMPLATE_TABS = YARD_TABS.map(([k]) => k).filter((k) => k !== 'heroes' && k !== 'buildings');
/** Ключ хранилища шаблонов: они общие для всех партий на этом устройстве. */
export const TEMPLATES_KEY = 'vd.yard.templates.v1';


/** Шаблон заказа из черновика окна. */
export function templateOf(tab: YardTab, draft: YardDraft): BuildTemplate {
  return {
    tab,
    hull: draft.hull,
    modules: [...draft.modules],
    count: draft.count,
    ...(draft.troop && isLander(data.units[draft.hull]) ? { troop: draft.troop } : {}),
  };
}

/**
 * Панель шаблонов под шапкой: строка на шаблон (корпус, число, значки модулей), крестик
 * удаления и «Сохранить текущий». Шаблон, корпуса которого в этой партии нет, стоит
 * погашенным: удалять его незачем, в другой партии он пригодится.
 */
export function templatesPaneHtml(
  state: GameState,
  me: string,
  list: readonly BuildTemplate[],
  current: BuildTemplate | null,
  _color: string,
  lane?: YardTab,
): string {
  const snap = state.players[me]?.arsenal;
  const rows = list
    .map((tpl, i) => {
      if (lane && unitLane(data.units[tpl.hull]) !== unitLane(data.units[hullsOfTab(lane)[0]!])) return '';
      const ok = fitTemplate(tpl, hullsOfTab(tpl.tab as YardTab), data, snap) !== null;
      const mods = tpl.modules.map((m) => `<span class="cn-tpm" title="${esc(tData(data.modules[m]?.name ?? m))}">${moduleIcon(m)}</span>`).join('');
      const hull = `${esc(displayUnit(tpl.hull))} ×${tpl.count}`;
      const name = tpl.name ? `<b>${esc(tpl.name)}</b><small>${hull}</small>` : hull;
      const price = priceHtml(completedUnitSpend(state, { unit: tpl.hull, count: tpl.count, modules: tpl.modules, troop: tpl.troop }), state.players[me]?.resources);
      const on = current !== null && sameTemplate(tpl, current);
      return (
        `<div class="cn-tplrow${on ? ' on' : ''}"><button class="cn-tpluse" data-cntpluse="${i}" ${ok ? '' : `disabled title="${t('yard.tpl.unavailable')}"`}>` +
        `${catalogPortraitHtml('u', tpl.hull, data, 'thumb')}<span class="cn-tpn">${name}${price}</span><span class="cn-tpms">${mods}</span></button>` +
        `<button class="cn-tpldel btn-x" data-cntpldel="${i}" aria-label="${t('yard.tpl.delete')}" title="${t('yard.tpl.delete')}">✕</button></div>`
      );
    })
    .join('');
  const saved = current !== null && list.some((tpl) => sameTemplate(tpl, current));
  const canSave = current !== null && !saved && list.length < MAX_TEMPLATES;
  return (
    `<div class="cn-tpl">${rows || `<div class="cn-tplnone">${t('yard.tpl.empty')}</div>`}` +
    `<button class="cn-tplsave btn-quiet" data-cntplsave ${canSave ? '' : 'disabled'}>＋ ${t(saved ? 'yard.tpl.saved' : 'yard.tpl.save')}</button></div>`
  );
}

/** Последний отправленный заказ окна: вкладка и черновик, каким он ушёл в ядро. */
export interface LastOrder {
  tab: YardTab;
  draft: YardDraft;
}

/**
 * Кнопка «Как в прошлый раз» в шапке окна (UIX-7.3): собирает последний заказ заново —
 * вкладку, корпус, модули, число и мир. Пока окно и так стоит на этом заказе, кнопки нет:
 * повторить его можно самой «Построить».
 */
export function repeatOrderHtml(last: LastOrder | null, tab: YardTab, draft: YardDraft): string {
  if (!last) return '';
  const d = last.draft;
  const same =
    last.tab === tab &&
    d.hull === draft.hull &&
    d.count === draft.count &&
    d.planet === draft.planet &&
    d.troop === draft.troop &&
    d.modules.length === draft.modules.length &&
    d.modules.every((id, i) => id === draft.modules[i]);
  if (same) return '';
  const what = `${esc(displayUnit(d.hull))} ×${d.count}`;
  const label = `${t('yard.again')}: ${what}`;
  return (
    `<button class="cn-again btn-quiet" data-cnagain aria-label="${label}" title="${label}">` +
    `<span aria-hidden="true">↻</span> <span class="cn-ag-k">${t('yard.again')}:</span> ${what}</button>`
  );
}

/** What «Производство» needs from the match screen. */
export interface YardHost {
  /** The window element (`#constructor`) — painted and click-delegated here. */
  root(): HTMLElement;
  /** The current match state (read fresh on every paint — it is replaced, not mutated). */
  state(): GameState;
  /** Whose yard this is: the seat you are playing. */
  me(): string;
  /** Your side tint, for the hull silhouettes. */
  youColor(): string;
  /** Submit a player order through the host's usual path (gate, net, replay). `false` —
   *  the order was refused on the spot (solo); the host has already said why. */
  order(action: Action): boolean | void;
  /** Проба ядра (`canOrder`): кого можно посадить в десантный челнок (SHU-5.2). Без
   *  неё список бойцов — все кандидаты, и отказ, если он будет, скажет ядро. */
  probe?(action: Action): string | null;
  /** Toast line (build confirmations, refused fits). */
  note(msg: string): void;
  /** Localized text of a reducer error code — the host owns that vocabulary. */
  errText(code: string): string;
  /** The hub Arsenal's cached collection, for the LARS-4 "откуда" tags. */
  arsenalItems(): readonly ArsenalItem[];
  /** Snapshot of Sector Zero's pre-run set, never a live read of meta progress. */
  preparedModules?(hull: string): string[] | undefined;
  /** Fired when the window opens — the host shows its just-in-time intro card here. */
  onOpen(): void;
  openTech?(id: string): void;
  openInfo?(key: string, world: string): void;
  /** The «Герои» pane, still owned by the host (its own brick). */
  heroPaneHtml(): string;
  /** Fired when the «Герои» tab is picked — the host's hero intro card. */
  onHeroTab(): void;
  /** A click inside the «Герои» pane: the host handles it and says what should follow
   *  — repaint the window, close it (a cast that needs a map target), or neither. */
  heroClick(target: HTMLElement): 'repaint' | 'close' | null;
}

/** Wire the window up: tabs, hull picking, fitting modules, the order. Call once at
 *  boot (it attaches the window's delegates); `open()` is what the rail button calls. */

function orderView(host: YardHost, draft: YardDraft, hulls: string[], troopsFor: (d: YardDraft) => string[] | undefined, section: YardTab): { draft: YardDraft; body: string; order: string } {
  draft = normalizeDraft(host.state(), host.me(), draft, hulls);
  const troops = troopsFor(draft);
  // Боец, которого на этом мире больше нельзя посадить, сменяется первым годным —
  // тем же правилом, каким `normalizeDraft` возвращает на землю мир и корпус.
  if (troops && !(draft.troop && troops.includes(draft.troop)))
    draft = { ...draft, troop: troops[0] };
  const view = {
    youColor: host.youColor(),
    arsenalItems: host.arsenalItems(),
    block: host.probe?.(buildShip(host.me(), draft.planet, draft.hull, draft.count, draft.modules, draft.troop)),
    ...(troops ? { troops } : {}),
  };
  const presentation = { ...view, section, blockText: view.block ? host.errText(view.block) : '' };
  const body = loadoutPaneHtml(host.state(), host.me(), draft, hulls, presentation);
  const order = orderBarHtml(host.state(), host.me(), draft, hulls, presentation);
  return { draft, body, order };
}

export function initShipyard(host: YardHost) {
  let tab: YardTab = 'ships';
  /** Открытая линия; `null` — окно стоит на списке линий, каталога нет. */
  let lane: ProductionLane | null = null;
  let category: BuildCategory | null = null;
  let renderedHeroBody = '';
  let draft: YardDraft = { hull: YARD_HULLS[0]!, modules: [], count: 1, planet: '' };
  /** Вкладка последней отрисовки: прокрутка переживает перерисовку только внутри вкладки. */
  let paintedTab: string | null = null;
  /** Последний заказ за эту партию — для «Как в прошлый раз». */
  let last: LastOrder | null = null;
  let tplOpen = false;
  let templates: BuildTemplate[] = parseTemplates(readRaw(TEMPLATES_KEY), data, TEMPLATE_TABS);
  const saveTemplates = (): void => writeRaw(TEMPLATES_KEY, JSON.stringify(templates));
  const refresh = initProductionRefresh({
    ...host, tab: () => (lane ? tab : ''), lane: () => lane, planet: () => draft.planet,
    renderedHeroBody: () => renderedHeroBody, paint,
  });

  const hullsOf = (): string[] => hullsOfTab(tab);
  /** Бойцы десантного челнока для черновика (SHU-5.2); `undefined` — корпус не десантный. */
  const troopsFor = (d: YardDraft): string[] | undefined => {
    if (!isLander(data.units[d.hull])) return undefined;
    const candidates = landerTroopCandidates(data);
    if (!host.probe || !d.planet) return d.planet ? candidates : [];
    return orderableTroops(candidates, (g) =>
      host.probe!(buildShip(host.me(), d.planet, d.hull, 1, d.modules, g)),
    );
  };
  const close = (): void => host.root().classList.remove('show', 'pw-fitting-open');

  function paint(): void {
    refresh.painted();
    const state = host.state(), me = host.me();
    const worlds = productionWorlds(state, me);
    let body = '';
    let order = '';
    if (!lane || tab === 'buildings' || tab === 'heroes') {
      if (!worlds.some(p => p.id === draft.planet)) draft.planet = worlds[0]?.id ?? '';
      if (lane && tab === 'buildings')
        body = buildScreenHtml(state, me, draft.planet, a => host.probe ? host.probe(a) : 'E_FORBIDDEN', () => false, host.errText, undefined, category, true);
      else if (lane) body = renderedHeroBody = host.heroPaneHtml();
    } else {
      ({ draft, body, order } = orderView(host, draft, hullsOf(), troopsFor, tab));
    }
    // Перерисовка не сбрасывает прокрутку: поставил модуль внизу списка — там и остался.
    const painting = `${lane}/${tab}`;
    const keep =
      paintedTab === painting ? (host.root().querySelector('#constructorbody')?.scrollTop ?? 0) : 0;
    const tplPane =
      lane && tplOpen && tab !== 'heroes' && tab !== 'buildings'
        ? templatesPaneHtml(state, me, templates, templateOf(tab, draft), host.youColor(), tab)
        : '';
    const restoreDetails = rememberProductionDetails(host.root());
    const context = `<div class="pw-context">${productionStockHtml(state, me)}${productionWorldSelect(state, me, draft.planet)}${draft.planet ? productionIncomeHtml(state, me, draft.planet) : ''}</div>`;
    host.root().innerHTML = yardBoxHtml(tab, body, order, lane ? repeatOrderHtml(last, tab, draft) : '', refresh.queueHtml(), tplPane, {
      lane, context, strip: refresh.stripHtml(),
      orders: draft.planet ? worldOrdersHtml(state, me, draft.planet) : '',
    });
    if (paintedTab === painting) restoreDetails();
    const scroller = host.root().querySelector('#constructorbody');
    paintedTab = painting;
    presentProduction(host.root()); patchLiveTimers(host.root(), state.time);
    if (scroller && keep) scroller.scrollTop = keep;
  }

  /** Открыть линию (или подвкладку внутри неё); `null` — вернуться к списку линий. */
  function showLane(next: ProductionLane | null, section?: YardTab): void {
    lane = next;
    if (next) tab = section ?? sectionForLane(next, tab);
    draft = { ...draft, slot: undefined, unfit: false }; // у корпуса другой вкладки свои отсеки
    category = null;
    tplOpen = false;
    paint();
    if (next && tab === 'heroes') host.onHeroTab(); // ONB-3 remainder
  }

  host.root().addEventListener('click', (e) => {
    const tg = e.target as HTMLElement;
    if (tg === host.root() || tg.closest('.cn-close')) {
      close();
      return;
    }
    const laneHit = (tg.closest('[data-pw-lane]') as HTMLElement | null)?.dataset.pwLane as ProductionLane | undefined;
    // Повторное нажатие на открытую линию прячет её каталог (на ПК список стоит рядом).
    if (laneHit) return showLane(laneHit === lane ? null : laneHit);
    if (tg.closest('[data-pw-back]')) return showLane(null);
    if (last && tg.closest('[data-cnagain]')) {
      tab = last.tab;
      lane = laneOfSection(tab);
      draft = { ...last.draft };
      paint();
      return;
    }
    if (tg.closest('[data-cntpl]')) {
      tplOpen = !tplOpen;
      paint();
      return;
    }
    const use = (tg.closest('[data-cntpluse]') as HTMLElement | null)?.dataset.cntpluse;
    if (use !== undefined) {
      const tpl = templates[Number(use)];
      const fit = tpl && fitTemplate(tpl, hullsOfTab(tpl.tab as YardTab), data, host.state().players[host.me()]?.arsenal);
      if (!fit) {
        host.note('✖ ' + t('yard.tpl.unavailable'));
        return;
      }
      if (fit.modules.length < tpl!.modules.length) host.note(t('yard.tpl.trimmed'));
      tab = fit.tab as YardTab;
      lane = laneOfSection(tab);
      draft = {
        ...draft,
        hull: fit.hull,
        modules: fit.modules,
        count: fit.count,
        troop: fit.troop,
        slot: undefined,
        unfit: false,
      };
      tplOpen = false;
      paint();
      return;
    }
    const del = (tg.closest('[data-cntpldel]') as HTMLElement | null)?.dataset.cntpldel;
    if (del !== undefined) {
      templates = removeTemplate(templates, Number(del));
      saveTemplates();
      paint();
      return;
    }
    if (tg.closest('[data-cntplsave]')) {
      const r = saveNamedTemplate(host.root(), templates, templateOf(tab, draft));
      if (r.ok) {
        templates = r.list;
        saveTemplates();
        paint();
      }
      return;
    }
    if (productionClick(tg, host, {
      planet: draft.planet, repaint: paint,
      open: (next, building) => { showLane(laneOfSection(next), next); if (building) anchorBuilding(host.root(), building); },
      category: value => { category = value; },
    })) return;
    const nextTab = (tg.closest('.cn-tab') as HTMLElement | null)?.dataset.ctab as YardTab | undefined;
    if (nextTab) return showLane(laneOfSection(nextTab), nextTab);
    const hull = (tg.closest('.cn-hbtn') as HTMLElement | null)?.dataset.cnhull;
    if (hull) {
      draft = { ...draft, hull, modules: host.preparedModules?.(hull) ?? [], slot: undefined, unfit: false };
      paint();
      return;
    }
    const mod = (tg.closest('.cn-mod') as HTMLElement | null)?.dataset.cnmod;
    if (mod) {
      draft = equipModule(host, draft, mod);
      paint();
      // Модуль выбран из глубины списка — вернуть на экран корабль: на нём видно, куда модуль
      // встал, а под ним (на ПК — рядом) уже модули следующего отсека.
      host
        .root()
        .querySelector('#constructor .cn-hull')
        ?.scrollIntoView({ block: 'nearest', behavior: motionOn() ? 'smooth' : 'auto' });
      return;
    }
    const rm = (tg.closest('[data-cnrm]') as HTMLElement | null)?.dataset.cnrm;
    if (rm) {
      draft = unequipModule(host, draft, rm);
      paint();
      return;
    }
    // Плитка на арте или строка отсека открывает отсек: рядом встают его модули.
    const sel = (tg.closest('[data-cnsel]') as HTMLElement | null)?.dataset.cnsel;
    if (sel !== undefined) {
      draft = { ...draft, slot: Number(sel), unfit: false };
      paint();
      return;
    }
    if (tg.closest('[data-cnunfit]')) {
      draft = { ...draft, unfit: !draft.unfit };
      paint();
      return;
    }
    const step = (tg.closest('[data-cncount]') as HTMLElement | null)?.dataset.cncount;
    if (step) {
      const count = Math.max(1, Math.min(MAX_COUNT, draft.count + (step === '+' ? 1 : -1)));
      draft = { ...draft, count };
      paint();
      return;
    }
    // The «Герои» pane still lives in the host — hand its clicks over untouched.
    const hero = host.heroClick(tg);
    if (hero === 'repaint') {
      paint();
      return;
    }
    if (hero === 'close') {
      close();
      return;
    }
    if (tg.closest('[data-cnbuild]')) {
      if (draft.planet) {
        const troop = isLander(data.units[draft.hull]) ? draft.troop : undefined;
        const action = buildShip(host.me(), draft.planet, draft.hull, draft.count, draft.modules, troop);
        const planet = host.state().planets[draft.planet];
        const block = host.probe?.(action) ?? (planet ? unitBuildSiteBlocker(planet, data.units[draft.hull]!, data) : 'E_NO_PLANET');
        if (block) { host.note(host.errText(block)); return; }
        const sent = host.order(action);
        // Отказ ядра хозяин уже назвал; «заказано» рядом с ним читалось бы как успех.
        if (sent === false) return;
        host.note(t('yard.ordered', { n: String(draft.count), hull: displayUnit(draft.hull) }));
        last = { tab, draft: { ...draft, slot: undefined, unfit: false } };
        host.root().classList.remove('pw-fitting-open'); paint(); // заказ принят — вернуться в каталог
      }
    }
  });

  host.root().addEventListener('change', (e) => {
    const sel = e.target as HTMLSelectElement;
    if (sel.id === 'cn-planet') {
      draft = { ...draft, planet: sel.value };
      // От мира зависят его очередь в полосе заказа и, у десантного челнока, список бойцов.
      paint();
    }
    // Выбор бойца меняет цену — перерисовка сразу, а не на следующем тике.
    if (sel.id === 'cn-troop') {
      draft = { ...draft, troop: sel.value };
      paint();
    }
  });

  return {
    /** Без раздела окно открывается списком линий мира; с разделом — сразу его линией. */
    open: (nextTab?: YardTab, world?: string, building?: string) => {
      if (world) draft.planet = world;
      lane = nextTab ? laneOfSection(nextTab) : null;
      if (nextTab) tab = nextTab;
      category = null;
      tplOpen = false;
      const prepared = host.preparedModules?.(draft.hull);
      if (prepared) draft = { ...draft, modules: [...prepared] };
      host.root().classList.add('show');
      paint();
      host.onOpen();
      if (building) anchorBuilding(host.root(), building);
    },
    refreshHeroes: refresh.refreshHeroes,
    refreshQueue: refresh.refreshQueue,
    back: () => { if (!closeProductionOverlay(host.root())) close(); },
    render: paint,
    close,
  };
}

/** Include owned worlds with unmet requirements so the player can resolve them here. */
function productionWorlds(state: GameState, me: string) {
  return Object.values(state.planets).filter(p => p.owner === me && SECTOR_TYPES[p.kind ?? '']?.buildable);
}
function productionWorldSelect(state: GameState, me: string, selected: string): string {
  return `<select id="cn-planet" class="cn-plan" aria-label="${t('yard.where')}">${productionWorlds(state, me).map(p => `<option value="${esc(p.id)}"${p.id === selected ? ' selected' : ''}>${esc(worldName(state, p.id))}</option>`).join('')}</select>`;
}
function anchorBuilding(root: HTMLElement, id: string): void {
  const target = Array.from(root.querySelectorAll<HTMLElement>('[data-bw]')).find(el => el.dataset.bw === id);
  target?.classList.add('pw-anchor');
  target?.scrollIntoView({ block: 'center' });
}
