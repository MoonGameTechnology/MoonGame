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
 * `loadoutPaneHtml`, `statBarHtml`, `bagText`) and the draft is a plain value
 * (`YardDraft`) normalised by a pure `normalizeDraft`; only `initShipyard(host)`
 * touches the DOM, through explicit hooks instead of `main.ts`'s module-level state.
 */
import { splitSupport } from '../../decisions/supportShips';
import { moduleGroups } from '../../decisions/moduleGroups';
import { moduleIcon, SLOT_ICON, SLOT_KEY } from './moduleIcons';
import { isPerHourShare, perHourPercent } from '../../decisions/perHourShare';
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
import { esc, displayUnit } from './format';
import { unitIconHtml } from './icons';
import { catalogPortraitHtml } from './shipArt';
import { SECTOR_TYPES } from './map';
import { originOf } from './arsenal';
import { originLabel } from './arsenalScreen';
import { buildShip } from '../../decisions/actions';
import { isLander, landerTroopCandidates, orderableTroops } from '../../decisions/landerTroops';
import { unitDamageProfile } from '../../decisions/unitDamage';
import { unitDamageHtml } from './unitDamageView';
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

const RES_KEY: Record<string, string> = {
  metal: 'res.of.metal',
  credits: 'res.of.credits',
  energy: 'res.of.energy',
  food: 'res.of.food',
  microelectronics: 'res.of.microelectronics',
};
// Short stat labels for module-effect chips («+4 атака», «+15 щит»).
const STAT_KEY: Record<string, string> = {
  attack: 'div.stat.attack',
  defense: 'div.stat.defense',
  hp: 'stat.hp',
  shield: 'stat.shield',
  speed: 'stat.speed',
  cargoCapacity: 'stat.cargo',
  radarRange: 'stat.radar',
  // Доли за игровой час (`perHourShare.ts`): без подписи чип читался бы «+0.05 hullRepair».
  shieldRegen: 'loadout.stat.shield-regen',
  hullRepair: 'loadout.stat.hull-repair',
};
/** Чип эффекта модуля: доля в час — процентом («+5%/ч»), прочее — как есть. */
const effectChip = (k: string, v: number): string =>
  `+${isPerHourShare(k) ? t('loadout.stat.share-per-hour', { n: perHourPercent(v) }) : v} ${t(STAT_KEY[k] ?? k)}`;

/** The order being composed: which hull, what is bolted on, how many, where. Plain
 *  data, so the pane can be rendered (and asserted) without a window. */
export interface YardDraft {
  hull: string;
  modules: string[];
  count: number;
  planet: string;
  /** Боец десантного челнока (SHU-5.2) — по одному на каждую машину заказа. */
  troop?: string;
}

/** A price as text: «120 металл · 40 кредиты», or «бесплатно» when nothing is due. */
export function bagText(bag: Record<string, number>): string {
  const parts = Object.entries(bag)
    .filter(([, n]) => n)
    .map(([r, n]) => `${Math.round(n)} ${t(RES_KEY[r] ?? r)}`);
  return parts.length ? parts.join(' · ') : t('yard.free');
}

/** One live stat row: label · base → effective (+delta) · track bar (base cyan, delta green). */
export function statBarHtml(line: LoadoutStatLine, max: number): string {
  const basePct = max > 0 ? Math.min(100, (line.base / max) * 100) : 0;
  const deltaPct = max > 0 ? Math.min(100 - basePct, (Math.max(0, line.delta) / max) * 100) : 0;
  const val =
    line.delta !== 0
      ? `${line.base} <span class="dim">→</span> <b>${line.effective}</b> <span class="cn-up">${line.delta > 0 ? '+' : ''}${line.delta}</span>`
      : `<b>${line.effective}</b>`;
  return (
    `<div class="cn-stat"><div class="cn-srow"><span class="cn-snm">${esc(line.label)}</span><span class="cn-sval">${val}</span></div>` +
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

/** The loadout constructor pane for a family of hulls (ships or shuttles) — same
 *  `loadoutEditor` view-model, just a different hull list. Expects an already
 *  normalised draft. */
export function loadoutPaneHtml(
  state: GameState,
  me: string,
  draft: YardDraft,
  hullList: string[],
  view: {
    youColor: string;
    arsenalItems: readonly ArsenalItem[];
    /** Кого ядро примет бойцом десантного челнока на мире черновика (SHU-5.2). */
    troops?: readonly string[];
  },
): string {
  const snap = state.players[me]?.arsenal;
  const ownedHulls = ownedHullsOf(state, me, hullList);
  const ownedModules = snap ? new Set(snap.modules) : undefined;
  if (!ownedHulls.length) return `<div class="cn-soon">${t('yard.hull.none')}</div>`;
  const res = state.players[me]?.resources ?? {};
  const ed: LoadoutEditorResult = createLoadoutEditor(draft.hull, data, res, {
    modules: draft.modules,
    count: draft.count,
    ownedModules,
  });
  if (!ed.ok) return `<div class="cn-soon">${t('yard.hull.unavailable')}</div>`;
  const m: LoadoutModel = ed;
  const hulls = ownedHulls
    .map((h) => {
      const art = catalogPortraitHtml('u', h, data, 'thumb');
      return `<button class="cn-hbtn${art ? ' with-art' : ''}${h === draft.hull ? ' on' : ''}" data-cnhull="${h}">${art || unitIconHtml(h, data, view.youColor, 18)} <span>${esc(displayUnit(h))}</span></button>`;
    })
    .join('');
  const freeTypes = [...new Set(m.slots.filter((sl) => !sl.moduleId).map((sl) => sl.type))];
  const portrait = catalogPortraitHtml('u', draft.hull, data);
  const hullCard =
    `<div class="cn-hull${portrait ? ' with-art' : ''}">${portrait}<div class="cn-hull-info"><div class="cn-hic">${unitIconHtml(draft.hull, data, view.youColor, 40)}</div><div><div class="cn-hn">${esc(displayUnit(draft.hull))}</div>` +
    `<div class="cn-hm">${t('yard.slots.count', { n: String(m.slots.length) })}</div></div></div></div>`;
  const bays = m.slots
    .map((sl) => {
      if (sl.moduleId) {
        const md = data.modules[sl.moduleId];
        const eff = md
          ? Object.entries(md.effects.stats)
              .map(([k, v]) => effectChip(k, v))
              .join(' ') + (md.description ? `<p>${esc(t(md.description))}</p>` : '')
          : '';
        return (
          `<div class="cn-bay filled" data-cnun="${sl.moduleId}" title="${t('yard.module.remove')}"><div class="cn-bic">${moduleIcon(sl.moduleId)}</div>` +
          `<div><div class="cn-bt">${t(SLOT_KEY[sl.type] ?? sl.type)}</div><div class="cn-bn">${esc(tData(sl.moduleName ?? sl.moduleId))}${originTagHtml(view.arsenalItems, sl.moduleId)}</div></div><div class="cn-bd">${eff}</div></div>`
        );
      }
      return (
        `<div class="cn-bay empty"><div class="cn-bic">${SLOT_ICON[sl.type] ?? '＋'}</div>` +
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
        `<button class="cn-mod" data-cnmod="${o.id}"><span class="cn-mic">${moduleIcon(o.id)}</span>` +
        `<span class="cn-mn">${esc(tData(o.name))}${originTagHtml(view.arsenalItems, o.id)}</span><span class="cn-me">${eff}</span><span class="cn-mc">${bagText(o.cost)}</span></button>`
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
      `<div class="cn-mod locked"><span class="cn-mic">${moduleIcon(o.id)}</span>` +
      `<span class="cn-mn">${esc(tData(o.name))}</span><span class="cn-me">${why}</span><span class="cn-mc">${bagText(o.cost)}</span></div>`
    );
  };
  // Модули группами по типу отсека (заказ владельца 2026-09-26, `moduleGroups.ts`): в том же
  // порядке, что отсеки выше; внутри группы сначала то, что встаёт на этот корпус, по редкости.
  const option = new Map(m.palette.map((o) => [o.id, o] as const));
  const fitDef = data.units[m.unit];
  const palette = moduleGroups([...option.keys()], data, {
    fits: (id) => fitDef !== undefined && moduleAllowed(m.unit, fitDef, data.modules[id]!),
  })
    .map(
      ({ slot, ids }) =>
        `<div class="cn-pg"><span aria-hidden="true">${SLOT_ICON[slot] ?? '＋'}</span> ${t(SLOT_KEY[slot] ?? slot)}</div>` +
        ids.map((id) => paletteCard(option.get(id)!)).join(''),
    )
    .join('');
  const palHead = freeTypes.length
    ? t('yard.modules.for-slot', {
        s: freeTypes.map((ty) => t(SLOT_KEY[ty] ?? ty)).join(' / '),
      })
    : t('yard.modules.all-taken');
  // LARS-4: the palette above already reads the LIVE arsenal snapshot (a module
  // bought mid-match shows up here without a new match) — this note is the only
  // thing that needed adding: make the timing honest (built, not instant).
  const liveNote = snap ? `<div class="cn-note">${t('yard.arsenal.note')}</div>` : '';
  const left =
    `<div class="cn-fit"><div class="cn-hulls">${hulls}</div>${hullCard}${bays}` +
    `<div class="cn-ph">${palHead}</div><div class="cn-pal">${palette}</div>` +
    `<div class="cn-note">${t('yard.slots.note')}</div>${liveNote}</div>`;
  // right: live preview + cost + build
  const maxStat = Math.max(1, ...m.preview.map((p) => p.effective));
  const bars = m.preview.map((p) => statBarHtml(p, maxStat)).join('');
  // Урон по целям — с тем же оснащением, что и полосы над ним: надел осадный модуль —
  // выросла ячейка «по зданиям».
  const hullDef = data.units[m.unit];
  const damage = hullDef
    ? unitDamageHtml(
        unitDamageProfile(hullDef, effectiveStats(hullDef, { modules: m.modules }, data)),
      )
    : '';
  const worlds = buildSites(state, me, draft.hull);
  const planOpts = worlds
    .map(
      (p) =>
        `<option value="${p.id}"${p.id === draft.planet ? ' selected' : ''}>${esc(p.id)}</option>`,
    )
    .join('');
  // ДЕСАНТНЫЙ ЧЕЛНОК (SHU-5.2) строится с бойцом внутри: выбор бойца и его цена — в
  // том же блоке цены, итог — челнок с модулями ПЛЮС бойцы. Список бойцов считает
  // хозяин пробой ядра (`orderableTroops`), здесь — только разметка.
  const lander = isLander(hullDef);
  const troop =
    lander && draft.troop && (view.troops ?? []).includes(draft.troop) ? draft.troop : undefined;
  const troopCost: Record<string, number> = {};
  for (const [r, n] of Object.entries((troop && data.units[troop]?.cost) || {}))
    troopCost[r] = n * m.count;
  const total: Record<string, number> = { ...m.totalCost };
  for (const [r, n] of Object.entries(troopCost)) total[r] = (total[r] ?? 0) + n;
  const troopRow = !lander
    ? ''
    : (view.troops ?? []).length
      ? `<div class="cn-crow"><span class="cn-cl">${t('yard.cost.troop', { n: String(m.count) })}</span>` +
        `<select class="cn-plan" id="cn-troop">${(view.troops ?? [])
          .map(
            (g) =>
              `<option value="${esc(g)}"${g === troop ? ' selected' : ''}>${esc(displayUnit(g))}</option>`,
          )
          .join('')}</select><span class="cn-cv">${bagText(troopCost)}</span></div>`
      : `<div class="cn-noplace">${t('yard.troop.none')}</div>`;
  const cost =
    `<div class="cn-cost">` +
    `<div class="cn-crow"><span class="cn-cl">${t('yard.cost.hull', { n: String(m.count) })}</span><span class="cn-cv">${bagText(m.hullCost)}</span></div>` +
    (draft.modules.length
      ? `<div class="cn-crow"><span class="cn-cl">${t('yard.cost.modules', { n: String(m.count) })}</span><span class="cn-cv">${bagText(m.modulesCost)}</span></div>`
      : '') +
    troopRow +
    `<div class="cn-crow total"><span class="cn-cl">${t('yard.cost.total')}</span><span class="cn-cv">${bagText(total)}</span></div></div>`;
  const affordable = lander
    ? Object.entries(total).every(([r, n]) => (res[r] ?? 0) >= n)
    : m.affordable;
  const canBuild = affordable && draft.planet !== '' && (!lander || troop !== undefined);
  const right =
    `<div class="cn-side"><div class="cn-ph">${t('yard.cost.with-modules')} — <em>${t('yard.cost.live')}</em></div>${bars}${damage}${cost}` +
    `<div class="cn-row2"><div class="cn-step"><button data-cncount="-" ${draft.count <= 1 ? 'disabled' : ''}>−</button><span class="cn-sv">${draft.count}</span><button data-cncount="+" ${draft.count >= MAX_COUNT ? 'disabled' : ''}>+</button></div>` +
    // Нет годного мира — вместо селектора ПРЯМАЯ надпись (заказ владельца): пустой
    // выпадающий список игрок читает как «сейчас загрузится», а не как отказ, и жмёт
    // кнопку заказа, которой всё равно нечего отправить.
    (worlds.length
      ? `<select class="cn-plan" id="cn-planet">${planOpts}</select></div>`
      : `<div class="cn-noplace">${t('yard.no-place')}</div></div>`) +
    `<button class="cn-build" data-cnbuild ${canBuild ? '' : 'disabled'}>${t('yard.build', { n: String(draft.count) })}</button>` +
    `<div class="cn-lock">🔒 <span>${t('yard.loadout.note')}</span></div></div>`;
  return `<div class="cn-grid">${left}${right}</div>`;
}

/** The window chrome: title, close, the three tabs, and whichever pane is open. */
export function yardBoxHtml(tab: YardTab, body: string): string {
  const tabBtn = (k: YardTab, label: string): string =>
    `<button class="cn-tab${tab === k ? ' on' : ''}" data-ctab="${k}">${t(label)}</button>`;
  return (
    `<div class="cnbox"><div class="cn-head"><b>${t('yard.title')}</b><button class="cn-close">✕</button></div>` +
    `<div class="cn-tabs">${YARD_TABS.map(([k, l]) => tabBtn(k, l)).join('')}</div>` +
    `<div id="constructorbody">${body}</div></div>`
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
      body = loadoutPaneHtml(host.state(), host.me(), draft, hullsOf(), {
        youColor: host.youColor(),
        arsenalItems: host.arsenalItems(),
        ...(troops ? { troops } : {}),
      });
    }
    host.root().innerHTML = yardBoxHtml(tab, body);
  }

  /** Equip / unequip a module through the core-validated reducer, then re-render. */
  function fit(moduleId: string, remove: boolean): void {
    const snap = host.state().players[host.me()]?.arsenal;
    const res = host.state().players[host.me()]?.resources ?? {};
    const ed = createLoadoutEditor(draft.hull, data, res, {
      modules: draft.modules,
      count: draft.count,
      ownedModules: snap ? new Set(snap.modules) : undefined,
    });
    if (!ed.ok) return;
    const r = applyLoadoutAction({ kind: remove ? 'unequip' : 'equip', moduleId }, ed, data, res);
    if (r.ok) draft = { ...draft, modules: r.modules };
    else host.note('✖ ' + host.errText(r.code));
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
    const nextTab = (tg.closest('.cn-tab') as HTMLElement | null)?.dataset.ctab;
    if (nextTab) {
      tab = nextTab as YardTab;
      paint();
      if (tab === 'heroes') host.onHeroTab(); // ONB-3 remainder
      return;
    }
    const hull = (tg.closest('.cn-hbtn') as HTMLElement | null)?.dataset.cnhull;
    if (hull) {
      draft = { ...draft, hull, modules: host.preparedModules?.(hull) ?? [] };
      paint();
      return;
    }
    const mod = (tg.closest('.cn-mod') as HTMLElement | null)?.dataset.cnmod;
    if (mod) {
      fit(mod, false);
      paint();
      return;
    }
    const un = (tg.closest('.cn-bay.filled') as HTMLElement | null)?.dataset.cnun;
    if (un) {
      fit(un, true);
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
      }
    }
  });

  host.root().addEventListener('change', (e) => {
    const sel = e.target as HTMLSelectElement;
    if (sel.id === 'cn-planet') {
      draft = { ...draft, planet: sel.value };
      // У десантного челнока от мира зависит и список бойцов (казармы/завод здесь).
      if (isLander(data.units[draft.hull])) paint();
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
