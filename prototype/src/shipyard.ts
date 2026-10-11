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
 * `loadoutPaneHtml`, `orderBarHtml`, `slotLayerHtml`, `statBarHtml`, `bagText`) and the draft is a plain value
 * (`YardDraft`) normalised by a pure `normalizeDraft`; only `initShipyard(host)`
 * touches the DOM, through explicit hooks instead of `main.ts`'s module-level state.
 */
import { splitSupport } from '../../decisions/supportShips';
import { moduleGroups } from '../../decisions/moduleGroups';
import { slotCallouts, type SlotCallout } from '../../decisions/slotCallouts';
import { moduleIcon, SLOT_ICON, SLOT_KEY } from './moduleIcons';
import { isPercentStat, isPerHourShare, perHourPercent } from '../../decisions/perHourShare';
import {
  effectiveStats,
  moduleAllowed,
  unitBuildSiteBlocker,
  type Action,
  type ArsenalItem,
  type GameState,
} from '../../packages/shared-core/src/index';
import { t, tData } from '../../localization/runtime';
import { data } from './gameData';
import { esc, displayUnit, cost as priceHtml, fmtDur, fmtEta } from './format';
import { activeConstruction, hoursLeft } from './buildProgress';
import { HOUR } from './time';
import { motionOn } from './graphicsPrefs';
import { unitIconHtml } from './icons';
import { catalogPortraitHtml, portraitArt } from './shipArt';
import { SECTOR_TYPES } from './map';
import { worldName } from './planetName';
import { originOf } from './arsenal';
import { originLabel } from './arsenalScreen';
import { buildShip } from '../../decisions/actions';
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
  applyLoadoutAction,
  type LoadoutModel,
  type LoadoutStatLine,
  type LoadoutEditorResult,
} from '../../packages/client/src/loadoutEditor';

export type YardTab = 'ships' | 'support' | 'squads' | 'infantry' | 'vehicles' | 'heroes';

/** Порядок вкладок — заказ владельца дословно: Корабли · Челноки · Пехота · Техника ·
 *  Герои. Наземные посередине, а не в конце: они дешевле и заказываются чаще. */
const YARD_TABS: [YardTab, string][] = [
  ['ships', 'yard.tab.ships'],
  // ROS-SUP-1: корабли не для линии боя — своя вкладка; признак в данных (`support`).
  ['support', 'yard.tab.support'],
  ['squads', 'yard.tab.squads'],
  ['infantry', 'yard.tab.infantry'],
  ['vehicles', 'yard.tab.vehicles'],
  ['heroes', 'yard.tab.heroes'],
];

/** Buildable space hulls the «Корабли» pane fits; shuttle/carrier hulls → «Челноки». */
export const YARD_HULLS = [
  'cruiser',
  'heavy_cruiser',
  'scout',
  'frigate',
  'picket_frigate',
  // ROS-3.2: «Шаттл» — КОРАБЛЬ, который возит челноки, а не челнок. Он заказывается
  // среди кораблей, как и всякий корпус со своей линией боя.
  'shuttle_carrier',
];
export const YARD_SQUAD_HULLS = ['interceptor', 'bomber', 'heavy_striker', 'landing_shuttle'];

/** Наземный ростер экрана — тот же набор, что предлагает панель мира. РАЗДЕЛЯЕТ его по
 *  вкладкам не второй список, а ДАННЫЕ (`UnitDef.kind`, ROS-1.1): новый род войск или
 *  переезд корпуса из пехоты в технику решается юнитом, а не правкой интерфейса. */
export const YARD_GROUND_HULLS = ['militia', 'heavy_infantry', 'special_forces', 'tank'];

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

// Подписи ресурса в ценнике и статов в чипе. Ключа нет — `t()` отдаёт его как есть
// («+8 pointDefense», «25 biomass»), поэтому сторож в `shipyard.test.ts` сверяет оба
// словаря со всеми статами модулей и ресурсами из `data/` (UIX-5.1).
export const RES_KEY: Record<string, string> = {
  biomass: 'res.of.biomass',
  metal: 'res.of.metal',
  credits: 'res.of.credits',
  energy: 'res.of.energy',
  food: 'res.of.food',
  microelectronics: 'res.of.microelectronics',
};
// Short stat labels for module-effect chips («+4 атака», «+15 щит»).
export const STAT_KEY: Record<string, string> = {
  attack: 'div.stat.attack',
  defense: 'div.stat.defense',
  hp: 'stat.hp',
  shield: 'stat.shield',
  speed: 'stat.speed',
  cargoCapacity: 'stat.cargo',
  radarRange: 'stat.radar',
  pointDefense: 'stat.point-defense',
  siegeDamage: 'loadout.stat.siege',
  // Доли за игровой час (`perHourShare.ts`): без подписи чип читался бы «+0.05 hullRepair».
  shieldRegen: 'loadout.stat.shield-regen',
  hullRepair: 'loadout.stat.hull-repair',
  retreatPull: 'loadout.stat.retreat-pull',
  salvageBonus: 'loadout.stat.salvage',
  fleetHullRepair: 'loadout.stat.fleet-repair',
  mineCharge: 'loadout.stat.mine-charge',
  mineHit: 'loadout.stat.mine-hit',
};
/** Чип эффекта модуля: доля в час — процентом («+5%/ч»), прочее — как есть. */
const effectChip = (k: string, v: number): string =>
  `+${
    isPerHourShare(k)
      ? t('loadout.stat.share-per-hour', { n: perHourPercent(v) })
      : isPercentStat(k)
        ? t('loadout.stat.percent', { n: perHourPercent(v) })
        : Math.round(v * 10) / 10
  } ${t(STAT_KEY[k] ?? k)}`;

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

/** A price as text: «120 металл · 40 кредиты», or «бесплатно» when nothing is due. */
export function bagText(bag: Record<string, number>): string {
  const parts = Object.entries(bag)
    .filter(([, n]) => n)
    .map(([r, n]) => `${Math.round(n)} ${t(RES_KEY[r] ?? r)}`);
  return parts.length ? parts.join(' · ') : t('yard.free');
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
  return snap ? hullList.filter((h) => snap.hulls.includes(h)) : hullList;
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
  const owned = ownedHullsOf(state, me, hullList);
  const next = { ...draft, modules: [...draft.modules] };
  if (owned.length && !owned.includes(next.hull)) {
    next.hull = owned[0]!;
    next.modules = [];
  }
  // Мир проверяется ПОД ВЫБРАННЫЙ КОРПУС: переключение вкладки меняет и требование к
  // зданию, и годный мир вместе с ним (казармы вместо верфи — уже другой список).
  const worlds = buildSites(state, me, next.hull);
  if (!next.planet || !worlds.some((p) => p.id === next.planet)) next.planet = worlds[0]?.id ?? '';
  return next;
}

/** Что телу окна и полосе заказа нужно от игры сверх мира. */
export interface YardView {
  youColor: string;
  arsenalItems: readonly ArsenalItem[];
  /** Кого ядро примет бойцом десантного челнока на мире черновика (SHU-5.2). */
  troops?: readonly string[];
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
  const ownedHulls = ownedHullsOf(state, me, hullList);
  const ownedModules = snap ? new Set(snap.modules) : undefined;
  if (!ownedHulls.length) return `<div class="cn-soon">${t('yard.hull.none')}</div>`;
  const res = state.players[me]?.resources ?? {};
  // Звёзды и поднятая редкость места (снимок арсенала забега Сектора Зеро): с ними числа
  // карточек и характеристик — те, что получит построенный корабль.
  const boosts = { moduleStars: snap?.stars, moduleRarity: snap?.rarity };
  const ed: LoadoutEditorResult = createLoadoutEditor(draft.hull, data, res, {
    modules: draft.modules,
    count: draft.count,
    ownedModules,
    ...boosts,
  });
  if (!ed.ok) return `<div class="cn-soon">${t('yard.hull.unavailable')}</div>`;
  const m: LoadoutModel = ed;
  const hulls = ownedHulls
    .map((h) => {
      const art = catalogPortraitHtml('u', h, data, 'thumb');
      return `<button class="cn-hbtn${art ? ' with-art' : ''}${h === draft.hull ? ' on' : ''}" data-cnhull="${h}">${art || unitIconHtml(h, data, view.youColor, 18)} <span>${esc(displayUnit(h))}</span></button>`;
    })
    .join('');
  // Открытый отсек (шаг 3 переделки окна): справа — его модули, а не весь каталог.
  const sel = selectedBay(m.slots, draft.slot);
  const portrait = catalogPortraitHtml('u', draft.hull, data);
  // Слоты-выноски (шаг 2 переделки окна): точка на корпусе, плитка рядом, линия между ними.
  // Нет точек у этого арта — отсеки остаются только списком под карточкой.
  const callouts = portrait ? slotCallouts(portraitArt('u', draft.hull, data)?.key, m.slots) : null;
  const art = callouts
    ? `<div class="cn-art">${portrait}${slotLayerHtml(m.slots, callouts, sel)}</div>`
    : portrait;
  const hullCard =
    `<div class="cn-hull${portrait ? ' with-art' : ''}">${art}<div class="cn-hull-info"><div class="cn-hic">${unitIconHtml(draft.hull, data, view.youColor, 40)}</div><div><div class="cn-hn">${esc(displayUnit(draft.hull))}</div>` +
    `<div class="cn-hm">${m.hasSlots ? t('yard.slots.count', { n: String(m.slots.length) }) : t('yard.slots.none')}</div></div></div></div>`;
  // Строка отсека открывает его, как плитка на арте; снять модуль — кнопкой над его модулями.
  const bays = m.slots
    .map((sl, i) => {
      const on = i === sel ? ' sel' : '';
      if (sl.moduleId) {
        const md = data.modules[sl.moduleId];
        const own = m.palette.find((o) => o.id === sl.moduleId)?.effect ?? md?.effects.stats ?? {};
        const eff = md
          ? Object.entries(own)
              .map(([k, v]) => effectChip(k, v))
              .join(' ') + (md.description ? `<p>${esc(t(md.description))}</p>` : '')
          : '';
        return (
          `<div class="cn-bay filled${on}" data-cnsel="${i}"><div class="cn-bic">${moduleIcon(sl.moduleId)}</div>` +
          `<div><div class="cn-bt">${t(SLOT_KEY[sl.type] ?? sl.type)}</div><div class="cn-bn">${esc(tData(sl.moduleName ?? sl.moduleId))}${originTagHtml(view.arsenalItems, sl.moduleId)}</div>${moduleGradeHtml(sl.rarity ?? 'simple', sl.star ?? 0)}</div><div class="cn-bd">${eff}</div></div>`
        );
      }
      return (
        `<div class="cn-bay empty${on}" data-cnsel="${i}"><div class="cn-bic">${SLOT_ICON[sl.type] ?? '＋'}</div>` +
        `<div><div class="cn-bt">${t(SLOT_KEY[sl.type] ?? sl.type)}</div><div class="cn-bn">${t('yard.slot.empty')}</div></div></div>`
      );
    })
    .join('');
  const paletteCard = (o: LoadoutModel['palette'][number]): string => {
    const eff = Object.entries(o.effect)
      .map(([k, v]) => effectChip(k, v))
      .join(' ');
    if (o.installable) {
      return (
        `<button class="cn-mod r-${o.rarity}" data-cnmod="${o.id}"><span class="cn-mic">${moduleIcon(o.id)}</span>` +
        `<span class="cn-mn">${esc(tData(o.name))}${originTagHtml(view.arsenalItems, o.id)}</span>${moduleGradeHtml(o.rarity, o.star)}<span class="cn-me">${eff}</span><span class="cn-mc">${bagText(o.cost)}</span></button>`
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
      `<span class="cn-mn">${esc(tData(o.name))}</span>${moduleGradeHtml(o.rarity, o.star)}<span class="cn-me">${why}</span><span class="cn-mc">${bagText(o.cost)}</span></div>`
    );
  };
  // LARS-4: the palette already reads the LIVE arsenal snapshot (a module bought
  // mid-match shows up here without a new match) — this note is the only thing that
  // needed adding: make the timing honest (built, not instant).
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
          ...boosts,
        })
      : ed;
    // Модуль уже стоит в другом отсеке (ядро не даёт два одинаковых) — он виден на арте и в
    // списке отсеков, здесь он не выбор.
    const option = new Map(
      (pick.ok ? pick.palette : [])
        .filter((o) => o.id !== cur && o.code !== 'E_DUP_MODULE')
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
      (cur ? `<button class="cn-rm btn-second" data-cnrm="${cur}">${t('yard.module.take-off')}</button>` : '') +
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
    `<div class="cn-side"><div class="cn-ph">${m.hasSlots ? `${t('yard.cost.with-modules')} — <em>${t('yard.cost.live')}</em>` : t('yard.stats')}</div>${bars}${damage}${troopRow}` +
    (m.hasSlots ? `<div class="cn-lock">🔒 <span>${t('yard.loadout.note')}</span></div>` : '') +
    `</div>`;
  // Раскладка (шаг 3): на ПК три колонки — корпуса, корабль с характеристиками, модули
  // отсека; на телефоне одна колонка в том же порядке, модули сразу под артом. Корпус без
  // отсеков — без колонки модулей.
  const card = `<div class="cn-card${callouts ? ' with-tiles' : ''}">${hullCard}${bays}</div>`;
  const slotCol = panel ? `<div class="cn-slot">${panel}</div>` : '';
  return `<div class="cn-grid ${slotCol ? 'cn-g3' : 'cn-g2'}"><div class="cn-hulls">${hulls}</div>${card}${slotCol}${stats}</div>`;
}

/**
 * Что ждёт заказ юнитов на этом мире (BLD-1): мир строит один заказ юнитов за раз, остальные
 * стоят в очереди ядра (`Planet.buildQueue`). `null` — полоса свободна, заказ начнётся сразу.
 * `nextInHours` — когда закончится идущая стройка; ноль — идущей нет, голова очереди ждёт денег.
 */
export function unitLaneAhead(
  state: GameState,
  planetId: string,
): { count: number; nextInHours: number } | null {
  const active = activeConstruction(state, planetId, 'units');
  // Полоса юнитов — заказы рода `unit`: то же правило полос, что у ядра и `laneOf`.
  const queued = (state.planets[planetId]?.buildQueue ?? []).filter((q) => q.kind === 'unit');
  const count = (active ? 1 : 0) + queued.length;
  if (count === 0) return null;
  return { count, nextInHours: active ? hoursLeft(active.at, state.time, HOUR) : 0 };
}

/**
 * Слой выносок поверх арта корпуса: точка на корпусе, плитка слота рядом и линия между ними
 * (форма «Выноска», решение владельца 2026-10-10). Координаты — проценты картинки
 * (`decisions/slotCallouts.ts`), а слой лежит ровно на картинке, поэтому точка стоит на той
 * же детали корабля и на телефоне, и на ПК. Плитка открывает свой отсек: рядом встают его
 * модули (шаг 3), открытый отсек обведён.
 */
export function slotLayerHtml(
  slots: LoadoutModel['slots'],
  callouts: readonly SlotCallout[],
  sel: number,
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
      const kind = t(SLOT_KEY[sl.type] ?? sl.type);
      const on = i === sel;
      const pressed = ` aria-pressed="${on ? 'true' : 'false'}"`;
      if (sl.moduleId) {
        // Плитка несёт ступень цветом рамки и уровень прокачки значком «★2» в углу; словом
        // то же самое — в подписи для диктора и подсказке.
        const rar = sl.rarity ?? 'simple';
        const star = sl.star ?? 0;
        const grade = [t(`rarity.${rar}`), ...(star > 0 ? [t('shipcard.stars', { n: star })] : [])].join(', ');
        const label = `${kind}: ${tData(sl.moduleName ?? sl.moduleId)} (${grade})`;
        const badge = star > 0 ? `<span class="cn-tst" aria-hidden="true">★${star}</span>` : '';
        return (
          `<span class="cn-dot full" style="${dot}"></span>` +
          `<button class="cn-tile filled${on ? ' sel' : ''}" data-cnsel="${i}"${pressed} style="${at(c.t)};--rar:var(--rar-${rar})" aria-label="${esc(label)}" title="${esc(label)}">${moduleIcon(sl.moduleId)}${badge}</button>`
        );
      }
      const label = `${kind}: ${t('yard.slot.empty')}`;
      return (
        `<span class="cn-dot" style="${dot}"></span>` +
        `<button class="cn-tile empty${on ? ' sel' : ''}" data-cnsel="${i}"${pressed} style="${at(c.t)}" aria-label="${esc(label)}" title="${esc(label)}"><span class="cn-ti">${SLOT_ICON[sl.type] ?? '＋'}</span></button>`
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
  if (!ownedHullsOf(state, me, hullList).length) return '';
  const snap = state.players[me]?.arsenal;
  const res = state.players[me]?.resources ?? {};
  const ed = createLoadoutEditor(draft.hull, data, res, {
    modules: draft.modules,
    count: draft.count,
    ownedModules: snap ? new Set(snap.modules) : undefined,
  });
  if (!ed.ok) return '';
  // Цена десантного челнока — челнок с модулями ПЛЮС бойцы, срок — дольший из двух (SHU-5.2).
  const lander = isLander(data.units[draft.hull]);
  const troop =
    lander && draft.troop && (view.troops ?? []).includes(draft.troop) ? draft.troop : undefined;
  const total: Record<string, number> = { ...ed.totalCost };
  for (const [r, n] of Object.entries((troop && data.units[troop]?.cost) || {}))
    total[r] = (total[r] ?? 0) + n * ed.count;
  const affordable = Object.entries(total).every(([r, n]) => (res[r] ?? 0) >= n);
  const canBuild = affordable && draft.planet !== '' && (!lander || troop !== undefined);
  const worlds = buildSites(state, me, draft.hull);
  const ahead = draft.planet ? unitLaneAhead(state, draft.planet) : null;
  const queue = !ahead
    ? t('yard.queue.now')
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
        .join('')}</select><span class="cn-oq">${queue}</span>`
    : `<div class="cn-noplace">${t('yard.no-place')}</div>`;
  return (
    `<div class="cn-order">` +
    `<div class="cn-oprice">${priceHtml(total, res)}<span class="cn-otime" title="${t('yard.build-time')}">⏱ ${fmtDur(orderHours(data, draft.hull, troop))}</span></div>` +
    `<div class="cn-oworld">${where}</div>` +
    `<div class="cn-ogo"><div class="cn-step"><button data-cncount="-" ${draft.count <= 1 ? 'disabled' : ''}>−</button><span class="cn-sv">${draft.count}</span><button data-cncount="+" ${draft.count >= MAX_COUNT ? 'disabled' : ''}>+</button></div>` +
    `<button class="cn-build btn-main" data-cnbuild ${canBuild ? '' : 'disabled'}>${t('yard.build', { n: String(draft.count) })}</button></div>` +
    `</div>`
  );
}

/** The window chrome: title, close, the tabs, whichever pane is open and, under it, the
 *  order bar — outside the scrolling body, so it never leaves the screen. */
export function yardBoxHtml(tab: YardTab, body: string, order = '', again = ''): string {
  const tabBtn = (k: YardTab, label: string): string =>
    `<button class="cn-tab${tab === k ? ' on' : ''}" data-ctab="${k}">${t(label)}</button>`;
  return (
    `<div class="cnbox"><div class="cn-head"><b>${t('yard.title')}</b>${again}<button class="cn-close">✕</button></div>` +
    `<div class="cn-tabs">${YARD_TABS.map(([k, l]) => tabBtn(k, l)).join('')}</div>` +
    `<div id="constructorbody">${body}</div>${order}</div>`
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
  /** Submit a player order through the host's usual path (gate, net, replay). */
  order(action: Action): void;
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
export function initShipyard(host: YardHost): {
  open: (nextTab?: YardTab) => void;
  refreshHeroes: () => void;
  render: () => void;
  close: () => void;
} {
  let tab: YardTab = 'ships';
  let renderedHeroBody = '';
  let heroScrolling = false;
  let heroScrollTimer: ReturnType<typeof setTimeout> | null = null;
  let draft: YardDraft = { hull: YARD_HULLS[0]!, modules: [], count: 1, planet: '' };
  /** Вкладка последней отрисовки: прокрутка переживает перерисовку только внутри вкладки. */
  let paintedTab: YardTab | null = null;
  /** Последний заказ за эту партию — для «Как в прошлый раз». */
  let last: LastOrder | null = null;

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
  const close = (): void => host.root().classList.remove('show');

  function paint(): void {
    let body: string;
    let order = '';
    if (tab === 'heroes') {
      body = host.heroPaneHtml();
      renderedHeroBody = body;
    } else {
      draft = normalizeDraft(host.state(), host.me(), draft, hullsOf());
      const troops = troopsFor(draft);
      // Боец, которого на этом мире больше нельзя посадить, сменяется первым годным —
      // тем же правилом, каким `normalizeDraft` возвращает на землю мир и корпус.
      if (troops && !(draft.troop && troops.includes(draft.troop)))
        draft = { ...draft, troop: troops[0] };
      const view = {
        youColor: host.youColor(),
        arsenalItems: host.arsenalItems(),
        ...(troops ? { troops } : {}),
      };
      body = loadoutPaneHtml(host.state(), host.me(), draft, hullsOf(), view);
      order = orderBarHtml(host.state(), host.me(), draft, hullsOf(), view);
    }
    // Перерисовка не сбрасывает прокрутку: поставил модуль внизу списка — там и остался.
    const keep =
      paintedTab === tab ? (host.root().querySelector('#constructorbody')?.scrollTop ?? 0) : 0;
    host.root().innerHTML = yardBoxHtml(tab, body, order, repeatOrderHtml(last, tab, draft));
    const scroller = host.root().querySelector('#constructorbody');
    if (scroller && keep) scroller.scrollTop = keep;
    paintedTab = tab;
  }

  /** The loadout editor for the current order over `modules` — the core-validated model. */
  function editorFor(modules: readonly string[]): LoadoutEditorResult {
    const p = host.state().players[host.me()];
    return createLoadoutEditor(draft.hull, data, p?.resources ?? {}, {
      modules: [...modules],
      count: draft.count,
      ownedModules: p?.arsenal ? new Set(p.arsenal.modules) : undefined,
    });
  }

  /** Модуль из колонки открытого отсека. В занятом отсеке он меняет надетый и встаёт на его
   *  место; потом открывается следующий пустой отсек, а когда пустых нет — отсек с ним. */
  function pick(moduleId: string): void {
    const res = host.state().players[host.me()]?.resources ?? {};
    const ed = editorFor(draft.modules);
    if (!ed.ok) return;
    const bay = ed.slots[selectedBay(ed.slots, draft.slot)];
    const cur = bay?.moduleId;
    const swap =
      cur !== undefined && (bay!.type === 'universal' || data.modules[moduleId]?.slot === bay!.type);
    const base = swap ? editorFor(draft.modules.filter((id) => id !== cur)) : ed;
    if (!base.ok) return;
    const r = applyLoadoutAction({ kind: 'equip', moduleId }, base, data, res);
    if (!r.ok) {
      host.note('✖ ' + host.errText(r.code));
      return;
    }
    // Замена встаёт на место снятого: отсеки одного типа заполняются в порядке обвеса
    // (`loadoutBays`), а добавленный в конец модуль ушёл бы в последний отсек.
    const modules = swap ? draft.modules.map((id) => (id === cur ? moduleId : id)) : r.modules;
    const after = editorFor(modules);
    const slots = after.ok ? after.slots : [];
    const full = slots.every((sl) => sl.moduleId);
    const at = slots.findIndex((sl) => sl.moduleId === moduleId);
    draft = { ...draft, modules, slot: full && at >= 0 ? at : undefined, unfit: false };
  }

  /** Снять модуль: открытым остаётся освободившийся отсек. Отсеки одного типа сдвигаются
   *  (`loadoutBays`), поэтому пустеет последний отсек этого типа, а не тот, где модуль стоял. */
  function takeOff(moduleId: string): void {
    const res = host.state().players[host.me()]?.resources ?? {};
    const ed = editorFor(draft.modules);
    if (!ed.ok) return;
    const type = ed.slots.find((sl) => sl.moduleId === moduleId)?.type;
    const r = applyLoadoutAction({ kind: 'unequip', moduleId }, ed, data, res);
    if (!r.ok) {
      host.note('✖ ' + host.errText(r.code));
      return;
    }
    const freed = r.slots.findIndex((sl) => !sl.moduleId && sl.type === type);
    draft = { ...draft, modules: r.modules, slot: freed < 0 ? undefined : freed };
  }

  // Mobile dossier scrolling must stay compositor-cheap. The periodic hero refresh
  // rebuilds the whole pane when cooldown/time-derived markup changes; doing that while
  // a finger is actively scrolling causes visible jank and can stall slower phones.
  // Scroll does not bubble, so listen in capture on the stable window root.
  host.root().addEventListener(
    'scroll',
    () => {
      if (tab !== 'heroes' || !host.root().classList.contains('show')) return;
      heroScrolling = true;
      if (heroScrollTimer !== null) clearTimeout(heroScrollTimer);
      heroScrollTimer = setTimeout(() => {
        heroScrolling = false;
        heroScrollTimer = null;
      }, 180);
    },
    true,
  );

  host.root().addEventListener('click', (e) => {
    const tg = e.target as HTMLElement;
    if (tg === host.root() || tg.closest('.cn-close')) {
      close();
      return;
    }
    if (last && tg.closest('[data-cnagain]')) {
      tab = last.tab;
      draft = { ...last.draft };
      paint();
      return;
    }
    const nextTab = (tg.closest('.cn-tab') as HTMLElement | null)?.dataset.ctab;
    if (nextTab) {
      tab = nextTab as YardTab;
      draft = { ...draft, slot: undefined, unfit: false }; // у корпуса другой вкладки свои отсеки
      paint();
      if (tab === 'heroes') host.onHeroTab(); // ONB-3 remainder
      return;
    }
    const hull = (tg.closest('.cn-hbtn') as HTMLElement | null)?.dataset.cnhull;
    if (hull) {
      draft = { ...draft, hull, modules: host.preparedModules?.(hull) ?? [], slot: undefined, unfit: false };
      paint();
      return;
    }
    const mod = (tg.closest('.cn-mod') as HTMLElement | null)?.dataset.cnmod;
    if (mod) {
      pick(mod);
      paint();
      // Модуль выбран из глубины списка — вернуть на экран корабль: на нём видно, куда модуль
      // встал, а под ним (на ПК — рядом) уже модули следующего отсека.
      host
        .root()
        .querySelector('#constructor .cn-hull')
        ?.scrollIntoView({ block: 'nearest', behavior: motionOn() ? 'smooth' : 'auto' });
      return;
    }
    // Плитка на арте или строка отсека открывает отсек: рядом встают его модули.
    const sel = (tg.closest('[data-cnsel]') as HTMLElement | null)?.dataset.cnsel;
    if (sel !== undefined) {
      draft = { ...draft, slot: Number(sel), unfit: false };
      paint();
      return;
    }
    const rm = (tg.closest('[data-cnrm]') as HTMLElement | null)?.dataset.cnrm;
    if (rm) {
      takeOff(rm);
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
        host.order(
          buildShip(host.me(), draft.planet, draft.hull, draft.count, draft.modules, troop),
        );
        host.note(t('yard.ordered', { n: String(draft.count), hull: displayUnit(draft.hull) }));
        last = { tab, draft: { ...draft, slot: undefined, unfit: false } };
        paint(); // очередь мира и нехватка в полосе — уже с этим заказом
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
    open: (nextTab) => {
      if (nextTab) tab = nextTab;
      const prepared = host.preparedModules?.(draft.hull);
      if (prepared) draft = { ...draft, modules: [...prepared] };
      host.root().classList.add('show');
      paint();
      host.onOpen();
    },
    refreshHeroes: () => {
      if (tab !== 'heroes' || !host.root().classList.contains('show')) return;
      // Do not even build the expensive hero HTML while touch/inertial scrolling is active.
      // The next 1s host tick catches up after the 180ms idle guard expires.
      if (heroScrolling) return;
      if (host.heroPaneHtml() === renderedHeroBody) return;
      const scroll = host.root().querySelector('#constructorbody')?.scrollTop ?? 0;
      const focused = document.activeElement as HTMLElement | null;
      const focusAttrs = focused && host.root().contains(focused)
        ? Array.from(focused.attributes).filter((a) => a.name.startsWith('data-h'))
          .map((a) => [a.name, a.value] as const) : [];
      paint();
      const box = host.root().querySelector('#constructorbody');
      if (box) box.scrollTop = scroll;
      if (focusAttrs.length) {
        Array.from(host.root().querySelectorAll<HTMLElement>('button')).find((el) =>
          focusAttrs.every(([name, value]) => el.getAttribute(name) === value))?.focus({ preventScroll: true });
      }
    },
    render: paint,
    close,
  };
}
