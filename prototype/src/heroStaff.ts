import { productionHeroLayout, skillInformation, moduleInformation, productionHeroEquipment, productionHardwareEmpty } from './productionHeroLayout';
import { effectChip } from './moduleEffect';
import { canInstall } from '../../packages/shared-core/src/util/fitting';
import { heroPictogram } from './heroPictograms';
import { heroTreeRows } from '../../decisions/heroTreeRows';
import { moduleIcon } from './moduleIcons';
import { heroFlagshipHtml, retainedHeroModules } from './heroFlagshipView';
import { selectHeroFlagship } from '../../decisions/actions';
import { heroFlagshipUnit } from '../../packages/shared-core/src/state/heroFlagship';
/**
 * «Штаб героев» — the hero pane of the Верфь (STAFF-1, REFM-14).
 *
 * One place for the whole hero loop: deploy reserves (`hero.spawn`), cast abilities
 * (`hero.ability` — built-ins live, typed-but-unwired honestly say «скоро»), walk the
 * skill tree (`hero.skill.unlock`) and refit the hero's ship (`hero.install`). All gates
 * (range/cooldown/cost/slots/branch) are the core's — this only shows them.
 *
 * The pane has no window of its own: it lives inside `shipyard.ts`'s «Герои» tab, so
 * this module hands the yard exactly the two things it asks for — `paneHtml()` and
 * `click(target)`. Ranged casts and deploys cannot resolve here (their target is a tap
 * on the MAP), so they arm the host through `armCast`/`armSpawn` and answer `'close'`.
 *
 * Same REFM shape as the other screens: the markup is pure (`heroStaffBodyHtml` and the
 * per-tab builders) and the view state is a plain value (`HeroView`) normalised by a
 * pure `normalizeHeroView`; only `initHeroStaff(host)` holds anything mutable.
 */
import {
  effectiveStats,
  activeHeroCount,
  heroActiveCap,
  HERO_ACTIVE_CAP,
  matchUnitHours,
  heroModuleSlots,
  knownSkillNodes,
  moduleAllowed,
  slotUsage,
  type Action,
  type GameState,
  type HeroPassiveDef,
  type ShipSlotType,
  type SlotCounts,
} from '../../packages/shared-core/src/index';
import { t, tData } from '../../localization/runtime';
import { data } from './gameData';
import { esc, cost, fmtHrs, displayUnit } from './format';
import { liveTimerHtml } from './liveTimers';
import {
  castHeroAbility,
  unlockHeroSkill,
  installHeroModule,
  uninstallHeroModule,
  equipHeroAbility,
  unequipHeroAbility,
} from '../../decisions/actions';
import { houseDisplayName } from './setupSeats';
import { heroGradeKey, heroIdentity } from '../../decisions/heroIdentity';
import { heroPortraitHtml } from '../../packages/client/src/heroPortraits';
import { emblemTally } from './fleetTally';
import { isWingUnit } from './planetSummary';
import { matchHeroRewards, type HeroReward } from '../../decisions/heroRewards';

type HeroInst = NonNullable<GameState['heroes']>[string];
export type HeroTab = 'overview' | 'tree' | 'abilities' | 'ship';
type Bag = Record<string, number>;

/** What the pane is showing: which hero is focused, which tab is open, and which
 *  node dossier is pinned («node:<id>»). Client-only view state. */
export interface HeroView {
  sel: string | null;
  flagship?: string;
  tab: HeroTab;
  dossier: string | null;
}

/** Your heroes, in a stable order (the roster is a map — sort so the chips never jump). */
export function ownHeroes(state: GameState, me: string): HeroInst[] {
  return Object.keys(state.heroes ?? {})
    .sort()
    .map((id) => state.heroes![id]!)
    .filter((h) => h.owner === me);
}

/**
 * What to CALL a hero on screen (AUD-12, tightened by AUD-13). The two kinds of hero
 * are named from two different places, and telling them apart is the whole job:
 *
 * - the MAIN hero is named after its SEAT (`matchSetup` writes `name`): the commander's
 *   callsign in a network match, the house id in a solo one. Neither is a localization
 *   key — `houseDisplayName` translates the house and lets a callsign through untouched;
 * - every other hero is nameless in the state (AUD-13: display text can't live in
 *   `GameState` — one state, one locale per viewer) and is named from its ARCHETYPE,
 *   the same catalog text the selector chips show, so header and chips can't drift.
 *   The `hero.id` fallback below is the broken-data path only.
 */
export function heroDisplayName(hero: HeroInst): string {
  const fallback = hero.name ?? hero.id;
  if (hero.grade === 'main') return houseDisplayName(fallback);
  const identity = heroIdentity(hero.archetype);
  if (identity?.name) return t(identity.name);
  const def = hero.archetype !== undefined ? data.heroes[hero.archetype] : undefined;
  // Две РАЗНЫЕ формы, и один вызов на обе не годится (CONV-12b). Имя архетипа приходит
  // из каталога и теперь английское (`Ravager`) — его переводит `tData()` по слагу
  // `data.ravager`. Запасной путь берёт имя из СОСТОЯНИЯ (`HeroLoadout.name`), а там
  // лежит ключ локали (`hero.arch.destroyer`) — его переводит `t()`.
  return def?.name !== undefined ? tData(def.name) : t(fallback);
}

/** Can this purse cover the price? (The core decides for real — this only dims a button.) */
function affordable(res: Bag, bag: Bag | undefined): boolean {
  for (const [r, n] of Object.entries(bag ?? {})) if ((res[r] ?? 0) < n) return false;
  return true;
}

/** Pull the view back onto legal ground before it is rendered: a focus on a hero you no
 *  longer own (or none yet) snaps to the first of your roster. Pure — it returns the
 *  corrected view instead of editing it, so the markup never writes to state. */
export function normalizeHeroView(state: GameState, me: string, view: HeroView): HeroView {
  const mine = ownHeroes(state, me);
  if (!mine.length) return view.sel === null ? view : { ...view, sel: null };
  if (mine.some((h) => h.id === view.sel)) return view;
  return { ...view, sel: mine[0]!.id };
}

const HERO_BRANCH_RU: Record<string, string> = {
  transhuman: 'hero.branch.transhuman',
  psionic: 'hero.branch.psionic',
};
// Ключи степеней — ОДИН дом на карточку, чип и досье (HERO-12). Раньше эта карта жила
// локальной переменной внутри досье, и «редкость» была подписана ровно в одном месте
// экрана; теперь по ней же красится обводка, и вторая копия разошлась бы молча.
const HERO_GRADE_KEY: Record<string, string> = {
  common: 'hero.grade.common',
  rare: 'hero.grade.rare',
  legendary: 'hero.grade.legendary',
  main: 'hero.grade.main',
};
/** The cooldown slot an ability occupies — mirrors the core's `cooldownKey`. Exported
 *  because the map's command menu shows the same cooldown on the same ability. */
export const heroCdKey = (type: string): string =>
  type === 'temp_lane' ? 'path' : type === 'annihilate' ? 'annihilate' : `fx:${type}`;
// Ability types the prototype kernel can actually resolve: the three heroModule
// built-ins (`temp_lane`, `annihilate` and the boss's siege `devour`, PVR-4.7) + every
// `hero.effect.<type>` the kernel's MODULES provide (heroEffects →
// recall/aura/reveal/jump/decoy). Types not here have no engine effect yet → the «скоро»
// badge. Keeping this list in step with `heroEffectsModule` is the whole job of the
// parity test in `heroStaff.test.ts`: a provider added there and forgotten here gives a
// silently uncastable ability — exactly how `station.deploy` sat unreachable for months.
export const HERO_CASTABLE = new Set([
  'temp_lane',
  'annihilate',
  'devour',
  'recall',
  'aura',
  'reveal',
  'jump',
  'decoy',
]);
// STAFF-1 shape: one focused hero + tabs (Обзор / Дерево / Способности / Фиттинги), a
// real branch skill-tree with prereq connectors and per-node states, and a tap-to-open
// dossier that shows what a node grants BEFORE you buy it.

/** Human short labels for a passive's hook (what the bonus actually does). */
const HERO_HOOK_RU: Record<string, string> = {
  'fleet.speed': 'hero.hook.fleet-speed',
  'combat.damage': 'hero.hook.combat-damage',
};
/** A passive rendered as a one-line bonus, e.g. «+10% скорость флота» / «+8% урон · r300». */
function heroPassiveLine(pid: string): string {
  const p = data.heroPassives[pid];
  if (!p) return t(pid);
  const pct = Math.round((p.params.bonus ?? 0) * 100);
  const r = p.params.radius ? ` · r${p.params.radius}` : '';
  return `+${pct}% ${t(HERO_HOOK_RU[p.hook] ?? p.hook)}${r}`;
}

/** The «Герои» pane body: selector chips → identity header → tabs → active tab → dossier. */
function heroStaffBodyHtml(state: GameState, me: string, view: HeroView, res: Bag): string {
  const mine = Object.keys(state.heroes ?? {})
    .sort()
    .map((id) => state.heroes![id]!)
    .filter((h) => h.owner === me);
  if (!mine.length) return `<div class="hx-note">${t('hero.hq.empty')}</div>`;
  const active = activeHeroCount(state, me);
  const cap = heroActiveCap(state, me, data);
  const hero = mine.find((h) => h.id === view.sel) ?? mine[0]!;
  const def = hero.archetype !== undefined ? data.heroes[hero.archetype] : undefined;
  const dead = hero.alive === false;
  const fleet = !dead && hero.fleetId !== undefined ? state.fleets[hero.fleetId] : undefined;

  // selector chips (one focused hero at a time)
  let chips = `<header class="pw-catalog-heading"><h2>${t('production.catalog.heroes')}</h2><span>${t('hero.hq.deployed-count', { a: active, c: cap })}</span></header><div class="hx-chips">`; let statusLabel = '';
  for (const h of mine) {
    const d = h.archetype !== undefined ? data.heroes[h.archetype] : undefined;
    const dep = h.alive !== false && h.fleetId && state.fleets[h.fleetId];
    const st =
      h.mobilization
        ? h.mobilization.queued ? t('build.state.waiting') : t('hero.hq.mobilizing', { time: liveTimerHtml(h.mobilization.readyAt, 'hms') })
        : h.alive === false ? t('hero.hq.dead') : dep ? t('hero.hq.deployed') : t('hero.hq.reserve');
    if (h.id === hero.id) statusLabel = st;
    chips +=
      `<button class="hx-chip g-${heroGradeKey(h.grade)}${h.id === hero.id ? ' sel' : ''}${d?.branch === 'psionic' ? ' ps' : ''}" data-hsel="${h.id}">` +
      `${heroPortraitHtml(h.archetype)}<span class="hx-cname" title="${esc(heroDisplayName(h))}">${esc(heroDisplayName(h))}</span>` +
      `<span class="hx-cst${dep ? ' on' : ''}">${st}</span></button>`;
  }
  chips += `</div>`;
  if (state.techRules?.ruleset === 'main' && cap < HERO_ACTIVE_CAP)
    chips += `<div class="hx-note">${t('hero.hq.slot-research')}</div>`;

  // identity header — name, branch, deploy state, aggregated build bonuses
  const mobilizing = hero.mobilization
    ? hero.mobilization.queued ? t('build.state.waiting') : t('hero.hq.mobilizing', { time: liveTimerHtml(hero.mobilization.readyAt, 'hms') })
    : null;
  const deployLabel = state.techRules?.ruleset === 'main'
    ? t('hero.hq.mobilize', { h: fmtHrs(matchUnitHours(state, data.units[heroHullOf(hero)]?.buildTimeHours || 10)) })
    : t('hero.hq.deploy');
  const deploy = mobilizing ? `<span class="hx-note">${mobilizing}</span>` : dead && (state.techRules?.ruleset !== 'main' || (hero.cooldowns.respawn ?? 0) > state.time)
    ? `<span class="hx-dead">${t('hero.hq.dead')}</span>`
    : fleet
      ? `<span class="hx-dep">⚓ ${esc(typeof fleet.location === 'string' ? fleet.location : t('hero.hq.enroute'))}</span>`
      : `<button class="hx-btn btn-main" data-hspawn="${hero.id}" ${active >= cap ? 'disabled' : ''}>${esc(deployLabel)}</button>`;
  const summary = `<div class="pw-hero-stats"><div><small>${t('production.flagship')}</small><b>${esc(displayUnit(heroHullOf(hero)))}</b></div><div><small>${t('production.abilities')}</small><b>${wornOf(hero).length} / ${skillSlotsOf(hero)}</b></div><div><small>${t('production.status')}</small><b>${statusLabel}</b></div></div>`;
  const portrait = heroPortraitHtml(hero.archetype);
  const gradeKey = heroGradeKey(hero.grade);
  const ident =
    `<div class="hx-ident g-${gradeKey}${def?.branch === 'psionic' ? ' ps' : ''}">` +
    `<div class="hx-irow">${portrait}<span class="hx-name">${esc(heroDisplayName(hero))}</span>` +
    // Редкость подписана СЛОВОМ, а не только цветом обводки: цветом одним нельзя —
    // его не различит дальтоник и не передаст скриншот в оттенках серого.
    `<span class="hx-tag hx-gtag">${esc(t(HERO_GRADE_KEY[gradeKey] ?? 'hero.grade.common'))}</span>` +
    (def?.branch
      ? `<span class="hx-tag">${esc(t(HERO_BRANCH_RU[def.branch] ?? def.branch))}</span>`
      : '') +
    `<span class="hx-role">${esc(tData(def?.name ?? ''))}</span><span class="pw-hero-status">${statusLabel}</span></div>` +
    (def?.description ? `<p class="pw-hero-description">${esc(t(def.description))}</p>` : '') +
    `</div>`;


  const body = view.tab === 'tree' ? heroTreeHtml(hero)
    : view.tab === 'ship' ? heroFlagshipHtml(state, hero, view.flagship) + heroShipHtml(hero, state.players[hero.owner]?.arsenal) : '';


  const dossier = view.dossier ? heroDossierHtml(hero, view.dossier, res) : '';
  return productionHeroLayout(chips, ident + summary, heroAbilitiesHtml(hero, state.time, view.tab === 'abilities'), view.tab, body, heroOverviewHtml(hero, state.time, fleet), dossier, deploy);
}

/** The skill tree tab as tiles (production window mockup, 2026-11-09): one rail per branch —
 *  the hero's own (own-branch + branch-less common nodes) first, foreign branches dimmed.
 *  A rail is rows of chains (`heroTreeRows`); a tile carries only the pictogram and the
 *  price (✓ when learned, 🔒 when a prerequisite is missing, ◆ when it grants an ability).
 *  Any tile opens the description overlay — the purchase lives there. */
function heroTreeHtml(hero: HeroInst): string {
  const def = hero.archetype !== undefined ? data.heroes[hero.archetype] : undefined;
  // Изученное — купленное И врождённое (AUD-22): тот же набор, по которому судит ядро.
  const known = knownSkillNodes(hero.skills ?? [], hero.archetype, data);
  const entries = Object.entries(data.heroSkillTrees);
  const ownBranch = def?.branch;
  const ownNodes = entries.filter(([, n]) => n.branch === ownBranch || n.branch === undefined);
  const foreignBranches = Array.from(
    new Set(entries.map(([, n]) => n.branch).filter((b): b is NonNullable<typeof b> => b !== undefined && b !== ownBranch)),
  ).sort();
  const rails: Array<{ label: string; own: boolean; ps: boolean; nodes: typeof entries }> = [];
  if (ownNodes.length)
    rails.push({ label: ownBranch ? (HERO_BRANCH_RU[ownBranch] ?? ownBranch) : 'hero.branch.common', own: true, ps: ownBranch === 'psionic', nodes: ownNodes });
  for (const br of foreignBranches)
    rails.push({ label: HERO_BRANCH_RU[br] ?? br, own: false, ps: br === 'psionic', nodes: entries.filter(([, n]) => n.branch === br) });
  if (!rails.length) return `<div class="hx-note">${t('hero.tree.empty')}</div>`;
  const tile = (id: string, own: boolean): string => {
    const nd = data.heroSkillTrees[id]!;
    const owned = known.has(id);
    const state = !own ? 'foreign' : owned ? 'owned' : nd.requires.every((r) => known.has(r)) ? 'avail' : 'locked';
    const name = esc(tData(nd.name));
    return `<button type="button" class="hx-tile ${state}" data-hnode="${id}" title="${name}" aria-label="${name}">` +
      (nd.grants.ability ? `<span class="hx-tk" aria-hidden="true">◆</span>` : '') +
      (state === 'locked' ? `<span class="hx-tl" aria-hidden="true">🔒</span>` : '') +
      `${heroPictogram('skills', id)}<span class="hx-tf">${owned ? '✓' : cost(nd.cost)}</span></button>`;
  };
  let html = `<div class="hx-tree ha-tree">`;
  for (const rail of rails) {
    const done = rail.nodes.filter(([id]) => known.has(id)).length;
    html +=
      `<div class="hx-rail${rail.own ? '' : ' foreign'}${rail.ps ? ' ps' : ''}">` +
      `<div class="hx-rhd"><span class="hx-dot"></span>${esc(t(rail.label))}` +
      (rail.own ? `<span class="hx-rn">${done}/${rail.nodes.length}</span>` : `<span class="hx-ftag">${t('hero.tree.not-your-branch')}</span>`) +
      `</div>`;
    for (const row of heroTreeRows(Object.fromEntries(rail.nodes))) {
      if (row.from) html += `<div class="hx-from">↳ ${esc(t('hero.tree.branch-from', { n: tData(data.heroSkillTrees[row.from]?.name ?? row.from) }))}</div>`;
      html += `<div class="hx-trow">${row.items.map((id) => tile(id, rail.own)).join('<span class="hx-tar" aria-hidden="true">›</span>')}</div>`;
    }
    html += `</div>`;
  }
  return html + `</div>`;
}

/** Skill-slot budget of a hero — the rarity's `skillSlots`, mirroring the core's
 *  `heroSkillSlots`. Unknown/absent grade degrades to one slot, exactly as there. */
function skillSlotsOf(hero: HeroInst): number {
  const grade = hero.grade;
  if (grade === undefined) return 1;
  return data.heroGrades[grade]?.skillSlots ?? 1;
}

/** The hull the hero's ship is made of — mirrors the core's `heroShipUnit`. */
function heroHullOf(hero: HeroInst): string { return heroFlagshipUnit(hero, data); }

/** Module bays of the hero's ship — the core's own `heroModuleSlots`, not a copy: the
 *  hull's typed slots, the grade's bonus (§0.38 — only the main hero has one) and the
 *  hero's Sector Zero star bays. A mirror here would miss whatever the core adds next, as it
 *  missed the star bays. */
function heroBaysOf(hero: HeroInst): SlotCounts {
  return heroModuleSlots(hero, heroHullOf(hero), data);
}

/** A passive that is worn in a skill slot (PVR-6.16), or undefined for an always-on one. */
function slottedPassive(id: string): HeroPassiveDef | undefined {
  const def = data.heroPassives[id];
  return def?.slotted ? def : undefined;
}

/** Passives that act right now: always-on ones, and slotted ones only while worn — the
 *  same rule the core's `passiveBonus` applies, so the panel never lists a dead bonus. */
function activePassivesOf(hero: HeroInst): string[] {
  const worn = wornOf(hero);
  return (hero.passives ?? []).filter((p) => !slottedPassive(p) || worn.includes(p));
}

/** What the hero WEARS. Mirrors the core's `equippedOf`, including its legacy fallback:
 *  no `equipped` field ⇒ an old loadout where owning and wearing were one thing. */
function wornOf(hero: HeroInst): string[] {
  if (hero.equipped !== undefined) return hero.equipped;
  return (hero.abilities ?? []).filter((a): a is string => a !== null);
}

/**
 * The abilities tab — SLOTS, and a pool to fill them from (HPR-1.2).
 *
 * Reads as the ship loadout does on purpose: a slot is a BAY, the same shape the
 * shipyard uses for hull modules, so the two screens teach one language instead of two.
 * Filling one is tap-a-slot → tap-an-item, the interaction the whole app already uses;
 * dragging is a later layer over exactly this, never instead of it (it is also the only
 * thing that works from a keyboard).
 *
 * Three rules the layout has to keep:
 *  · the budget is a NUMBER (`2/3`), not only pips — pips stop being countable past
 *    four and never say how much room is left;
 *  · an ability that does not fit is shown DIMMED WITH ITS REASON, never hidden —
 *    hiding it would make the screen lie about what the player owns;
 *  · spawn-markers are perks, not slots: they ride in the pool and cost nothing to
 *    carry, because `hero.spawn` reads them from what the hero OWNS.
 */
function heroAbilitiesHtml(hero: HeroInst, now: number, poolOpen = false): string {
  const dead = hero.alive === false;
  // Slots hold abilities AND slotted passives (PVR-6.16): one list, one budget.
  const owned = [
    ...(hero.abilities ?? []).filter((a): a is string => a !== null && !!data.heroAbilities[a]),
    ...(hero.passives ?? []).filter((p) => !!slottedPassive(p)),
  ];
  const worn = wornOf(hero).filter((a) => !!data.heroAbilities[a] || !!slottedPassive(a));
  const slots = skillSlotsOf(hero);
  const free = Math.max(0, slots - worn.length);

  // --- слоты: занятые отсеки + пустые приглашения ---------------------------
  const bays: string[] = [];
  for (const ab of worn) {
    const pd = slottedPassive(ab);
    if (pd) {
      // A worn passive has nothing to cast: it simply acts while it sits here.
      bays.push(
        `<div class="hx-bay on"><div class="hx-grow"><span class="hx-an">${heroPictogram('passives', ab)}${esc(tData(pd.name))}</span>` +
          `${skillInformation(tData(pd.name), t(pd.description ?? ''))}</div>` +
          `<div class="hx-bayact"><span class="hx-badge on">${t('hero.tree.passive')}</span>` +
          `<button class="pw-skill-remove btn-x" aria-label="${t('hero.slot.remove')}" data-hunequip="${hero.id}" data-ab="${ab}" ${dead ? 'disabled' : ''}>×</button>` +
          `</div></div>`,
      );
      continue;
    }
    const ad = data.heroAbilities[ab]!;
    // Срок кулдауна — живой узел (`liveTimers.ts`): цифры в разметке пересобирали бы окно.
    const cdAt = hero.cooldowns?.[heroCdKey(ad.type)] ?? 0;
    const cast = cdAt > now
        ? `<span class="hx-badge cd">${t('hero.abil.cooldown', { h: liveTimerHtml(cdAt, 'hrs') })}</span>`
        : !hero.fleetId ? `<span class="hx-badge">${t('production.after-mobilization')}</span>`
        : HERO_CASTABLE.has(ad.type)
          ? `<button class="hx-btn btn-second" data-hcast="${hero.id}" data-ab="${ab}" ${dead ? 'disabled' : ''}>${(ad.range ?? 0) > 0 ? t('hero.abil.pick-target') : t('hero.abil.activate')}</button>`
          : `<span class="hx-badge">${t('hero.abil.soon')}</span>`;
    bays.push(
      `<div class="hx-bay on"><div class="hx-grow"><span class="hx-an">${heroPictogram('abilities', ab)}${esc(tData(ad.name))}</span>` +
        `${skillInformation(tData(ad.name), t(ad.description ?? ''))}</div>` +
        `<div class="hx-bayact">${cast}` +
        `<button class="pw-skill-remove btn-x" aria-label="${t('hero.slot.remove')}" data-hunequip="${hero.id}" data-ab="${ab}" ${dead ? 'disabled' : ''}>×</button>` +
        `</div></div>`,
    );
  }
  for (let i = 0; i < free; i += 1) {
    bays.push(`<button class="hx-bay off" data-htab="abilities">${t('hero.slot.empty')}</button>`);
  }

  // --- пул: чем владеет, но не носит ----------------------------------------
  const perks = owned.filter(ab => data.heroAbilities[ab]?.type.startsWith('spawn_'));
  const pool = owned.filter((ab) => !worn.includes(ab) && !perks.includes(ab));
  let poolHtml = '';
  for (const ab of pool) {
    const pd = slottedPassive(ab);
    if (pd) {
      const action =
        free > 0
          ? `<button class="hx-btn btn-second" data-hequip="${hero.id}" data-ab="${ab}" ${dead ? 'disabled' : ''}>${t('hero.slot.equip')}</button>`
          : `<span class="hx-badge">${t('hero.slot.full')}</span>`;
      poolHtml +=
        `<div class="hx-row${free > 0 ? '' : ' dim'}"><div class="hx-grow">` +
        `<span class="hx-an">${heroPictogram('passives', ab)}${esc(tData(pd.name))}</span>` +
        `${skillInformation(tData(pd.name), t(pd.description ?? ''))}<span class="hx-badge">${t('hero.tree.passive')}</span></div>${action}</div>`;
      continue;
    }
    const ad = data.heroAbilities[ab]!;
    const perk = ad.type.startsWith('spawn_');
    // Перк слот не занимает — он всегда «при герое», и кнопки надевания у него нет.
    const action = perk
      ? `<span class="hx-badge">${t('hero.abil.deploy-perk')}</span>`
      : free > 0
        ? `<button class="hx-btn btn-second" data-hequip="${hero.id}" data-ab="${ab}" ${dead ? 'disabled' : ''}>${t('hero.slot.equip')}</button>`
        : `<span class="hx-badge">${t('hero.slot.full')}</span>`;
    poolHtml +=
      `<div class="hx-row${perk || free > 0 ? '' : ' dim'}"><div class="hx-grow">` +
      `<span class="hx-an">${heroPictogram('abilities', ab)}${esc(tData(ad.name))}</span>` +
      `${skillInformation(tData(ad.name), t(ad.description ?? ''))}</div>${action}</div>`;
  }

  return (
    `<div class="hx-h pw-ability-heading"><b>${t('production.abilities')}</b><span>${t('hero.slot.head', { u: worn.length, n: slots })}</span></div>` +
    `<div class="hx-bays ha-ability-grid">${bays.join('')}</div>` +
    perks.map(ab => `<div class="pw-hero-perk">${heroPictogram('abilities', ab)}<span><b>${esc(tData(data.heroAbilities[ab]!.name))}</b><small>${t('hero.abil.deploy-perk')}</small></span>${skillInformation(tData(data.heroAbilities[ab]!.name), t(data.heroAbilities[ab]!.description ?? ''))}</div>`).join('') +
    `<details class="pw-hero-pool"${poolOpen ? ' open' : ''}><summary>${t('hero.slot.pool')}</summary><div class="ha-ability-grid">${poolHtml || `<p>${t('hero.abil.empty')}</p><button class="hx-tab" data-htab="tree">${t('production.hero-development')} ›</button>`}</div></details>`
  );
}

/** Bay-kind label per slot category. A literal map, not `t(`hero.ship.bay.${slot}`)`:
 *  the localisation gate scans for LITERAL keys, so a computed one reads as an orphan
 *  translation and the build goes red — and rightly, since nothing could prove it exists. */
const BAY_KEY: Record<ShipSlotType, string> = {
  weapon: 'hero.ship.bay.weapon',
  defense: 'hero.ship.bay.defense',
  utility: 'hero.ship.bay.utility',
};

/** One line describing a module: its stat deltas. `ModuleDef` carries no description —
 *  and does not need one here, since what a bay does to the ship IS its numbers. */
function moduleLine(id: string): string {
  const md = data.modules[id];
  if (!md) return '';
  return Object.entries(md.effects.stats)
    .map(([k, v]) => effectChip(k, v))
    .join(' · ');
}

/**
 * The ship tab — the hero's HARDWARE (HPR-1.5.2/1.5.4). The SAME bay idiom as the skill
 * slots next door, because it now really is the same mechanism: ordinary ship modules in
 * typed bays, gated by the same `canInstall`. Two screens in one language.
 *
 * What differs from the skills tab is what the DATA differs in, nothing else:
 *  · bays are TYPED, so a free bay says which kind it is — «свободен» alone would lie
 *    when the free slot is a gun mount and the player is holding an engine;
 *  · a module that cannot go in is dimmed WITH ITS REASON (wrong hull / no bay), never
 *    hidden — the same rule as the ability pool;
 *  · refit happens between deployments: a hero in the field is shown its bays read-only
 *    with the reason, because the core refuses it (`E_HERO_DEPLOYED`) and a button that
 *    only ever fails is worse than no button.
 */
function heroShipHtml(hero: HeroInst, arsenal?: { modules: string[]; stars?: Record<string, number>; rarity?: Record<string, string> }): string {
  const bays = heroBaysOf(hero);
  const total = bays.weapon + bays.defense + bays.utility + (data.units[heroHullOf(hero)]?.slots.universal ?? 0);
  if (total <= 0) return `<div class="hx-note">${t('hero.ship.none')}</div>`;
  const hull = heroHullOf(hero);
  const hullDef = data.units[hull];
  const installed = (hero.modules ?? []).filter((m) => !!data.modules[m]);
  const deployed = hero.fleetId !== undefined || hero.mobilization !== undefined;
  const used = slotUsage(installed, data);
  const free = (c: ShipSlotType): number => Math.max(0, bays[c] - used[c]);

  const rows: string[] = [];
  for (const mid of installed) {
    const md = data.modules[mid]!;
    const off = deployed
      ? `<span class="hx-badge">${t('hero.ship.deployed')}</span>`
      : `<button class="pw-hardware-remove btn-x" aria-label="${t('hero.slot.remove')}" data-huninstall="${hero.id}" data-mod="${mid}">×</button>`;
    rows.push(
      `<div class="hx-bay on pw-hardware-slot r-${esc(hero.moduleSnapshot?.rarity[mid] ?? arsenal?.rarity?.[mid] ?? md.rarity ?? 'simple')}" data-pw-installed-hero="${esc(hero.id)}" data-pw-installed-module="${esc(mid)}" data-pw-hardware-slot="${md.slot}" role="button" tabindex="0"><div class="hx-grow"><span class="hx-an">${moduleIcon(mid)}${esc(tData(md.name))}</span>` +
        `${moduleInformation(tData(md.name), moduleLine(mid))}</div>` +
        `<div class="hx-bayact"><span class="hx-g pa">${t(BAY_KEY[md.slot])}</span>${off}</div></div>`,
    );
  }
  // Пустые отсеки называют СВОЙ тип: «свободен» без типа врал бы, когда свободна
  // оружейная ячейка, а игрок держит в руках двигатель.
  for (const c of ['weapon', 'defense', 'utility'] as ShipSlotType[])
    for (let i = 0; i < free(c); i += 1)
      rows.push(productionHardwareEmpty(c, t(BAY_KEY[c]), deployed));

  const overflow = Object.keys(bays).reduce((n,c) => n + Math.max(0,used[c as ShipSlotType] - bays[c as ShipSlotType]),0);
  for (let i = overflow; i < (hullDef?.slots.universal ?? 0); i++) rows.push(productionHardwareEmpty('universal', t('yard.slot.universal'), deployed));

  let poolHtml = '';
  for (const [mid, md] of Object.entries(data.modules)) {
    const allowed = hullDef !== undefined && moduleAllowed(hull, hullDef, md);
    const owned = !arsenal || arsenal.modules.includes(mid);
    const fits = owned && allowed && canInstall({ item: id => data.modules[id], category: m => m.slot, capacity: c => bays[c as ShipSlotType], wildcard: hullDef?.slots.universal, allowed: m => !!hullDef && moduleAllowed(hull,hullDef,m) }, installed, mid).ok;
    const action = installed.includes(mid) ? `<span class="hx-badge on">${t('production.module-installed')}</span>` : !owned ? `<span class="hx-badge">${t('err.not-owned')}</span>` : !allowed
      ? `<span class="hx-badge">${t('hero.ship.wrong-hull')}</span>`
      : deployed
        ? `<span class="hx-badge">${t('hero.ship.deployed')}</span>`
        : fits
          ? `<button class="hx-btn btn-second" data-hinstall="${hero.id}" data-mod="${mid}">${t('hero.slot.equip')}</button>`
          : `<span class="hx-badge">${t('hero.ship.no-bay')}</span>`;
    poolHtml +=
      `<div class="hx-row pw-hardware-option r-${esc(arsenal?.rarity?.[mid] ?? md.rarity ?? 'simple')}${fits && !deployed ? '' : ' dim'}" data-slot="${md.slot}"><div class="hx-grow">` +
      `<span class="hx-an">${moduleIcon(mid)}${esc(tData(md.name))}</span>` +
      `${moduleInformation(tData(md.name), moduleLine(mid))}</div>` +
      `<span class="hx-g pa">${t(BAY_KEY[md.slot])}</span>${action}</div>`;
  }

  const caption = t('hero.ship.slots', { u: installed.length, n: total }) + (deployed ? ` · ${t('hero.ship.refit-docked')}` : '');
  return productionHeroEquipment(hero, hull, rows.join(''), poolHtml, caption);
}

/** The overview tab — archetype line, a stat strip (abilities / tree progress / ship bays)
 *  and the hero's live passive bonuses. */
function heroOverviewHtml(hero: HeroInst, now: number, fleet?: GameState['fleets'][string]): string {
  const def = hero.archetype !== undefined ? data.heroes[hero.archetype] : undefined;
  const known = knownSkillNodes(hero.skills ?? [], hero.archetype, data);
  const open = Object.entries(data.heroSkillTrees).filter(
    ([, n]) => n.branch === undefined || n.branch === def?.branch,
  );
  const treeTotal = open.length;
  // Счётчик сходится с галочками дерева: врождённый узел тоже изучен (AUD-22).
  const learned = open.filter(([id]) => known.has(id)).length;
  const abil = (hero.abilities ?? []).filter((a) => a !== null).length;
  const identity = heroIdentity(hero.archetype);
  const bio = hero.grade === 'main' ? t('hero.person.main.bio') : identity ? t(identity.bio) : '';
  let html =
    `<section class="hx-person">${heroPortraitHtml(hero.archetype)}<div>` +
    `<h3>${esc(t('hero.person.dossier'))}</h3><p>${esc(bio)}</p>` +
    `<dl><dt>${t('hero.person.archetype')}</dt><dd>${esc(tData(def?.name ?? hero.archetype ?? ''))}</dd>` +
    `<dt>${t('hero.person.grade')}</dt><dd>${esc(t(HERO_GRADE_KEY[heroGradeKey(hero.grade)] ?? 'hero.grade.common'))}</dd>` +
    `<dt>${t('hero.person.ships')}</dt><dd>${fleet ? emblemTally(fleet.units, [], (id) => isWingUnit(id, data)).ships : esc(t('hero.person.reserve'))}</dd></dl>` +
    `</div></section>` +
    `<div class="hx-note" style="margin-bottom:10px;">${esc(t(def?.description ?? ''))}</div>` +
    `<div class="hx-ov">` +
    `<div class="hx-ovc"><b>${abil}</b><span>${t('hero.stat.abilities')}</span></div>` +
    `<div class="hx-ovc"><b>${learned}/${treeTotal}</b><span>${t('hero.stat.tree-nodes')}</span></div>` +
    `<div class="hx-ovc"><b>${(hero.modules ?? []).length}/${(() => {
      const b = heroBaysOf(hero);
      return b.weapon + b.defense + b.utility;
    })()}</b><span>${t('hero.stat.modules')}</span></div>` +
    `</div>`;
  const bonuses = activePassivesOf(hero)
    .map(
      (p) =>
        `<div class="hx-row"><span class="hx-grow hx-an">${esc(heroPassiveLine(p))}</span><span class="hx-badge on">${t('hero.tree.passive')}</span></div>`,
    )
    .join('');
  if (bonuses) html += `<div class="hx-h">${t('hero.stat.bonuses')}</div>${bonuses}`;
  const hull = heroHullOf(hero);
  const hullDef = data.units[hull];
  if (hullDef) {
    const stack = fleet?.units.find((st) => st.unit === hull && st.count > 0);
    const stats = effectiveStats(hullDef, stack ?? { unit: hull, count: 1, modules: hero.modules ?? [] }, data);
    const hullHp = stack ? `${Math.round(stack.hp === undefined ? (stats.hp ?? 0) : stack.hp / stack.count)} / ${Math.round(stats.hp ?? 0)}` : String(Math.round(stats.hp ?? 0));
    const shieldHp = stack ? `${Math.round(stack.shieldHp === undefined ? (stats.shield ?? 0) : stack.shieldHp / stack.count)} / ${Math.round(stats.shield ?? 0)}` : String(Math.round(stats.shield ?? 0));
    const statsRows: Array<[string, string]> = [
      ['dossier.stat.atk.name', String(stats.attack ?? 0)],
      ['dossier.stat.def.name', String(stats.defense ?? 0)],
      ['dossier.stat.hull.name', hullHp],
      ['dossier.stat.shield.name', shieldHp],
      ['dossier.stat.spd.name', String(stats.speed ?? 0)],
    ];
    html += `<div class="hx-h">${t('hero.person.ship-stats')}</div><div class="hx-ov">` +
      statsRows.map(([key, value]) => `<div class="hx-ovc"><b>${esc(value)}</b><span>${t(key)}</span></div>`).join('') + '</div>';
  }
  html += heroAbilitiesHtml(hero, now);
  return html;
}

/** The description overlay of a tapped tile (production window mockup, 2026-11-09): what
 *  the node grants, what it requires and opens, its price and the commit button
 *  («Изучить»). Modules need no such card: installing one is reversible, so it commits
 *  straight from the pool row — a permanent choice earned the extra tap. */
function heroDossierHtml(hero: HeroInst, dossier: string, res: Bag): string {
  const def = hero.archetype !== undefined ? data.heroes[hero.archetype] : undefined;
  const sep = dossier.indexOf(':');
  const id = dossier.slice(sep + 1);
  const nd = dossier.slice(0, sep) === 'node' ? data.heroSkillTrees[id] : undefined;
  if (!nd) return '';
  const known = knownSkillNodes(hero.skills ?? [], hero.archetype, data);
  const name = (r: string): string => esc(tData(data.heroSkillTrees[r]?.name ?? r));
  const gAb = nd.grants.ability ? data.heroAbilities[nd.grants.ability] : undefined;
  const give = gAb
    ? `<div class="hx-dgl">${t('hero.tree.grants-ability')}</div><div class="hx-dgv">${esc(tData(gAb.name))}${(gAb.range ?? 0) > 0 ? ` · ${t('hero.tree.range', { r: gAb.range })}` : ''}${gAb.cooldownHours ? ` · ${t('hero.tree.cooldown', { h: gAb.cooldownHours })}` : ''}</div><div class="hx-note">${esc(t(gAb.description ?? ''))}</div>`
    : nd.grants.passive
      ? `<div class="hx-dgl">${t('hero.tree.grants-passive')}</div><div class="hx-dgv">${esc(heroPassiveLine(nd.grants.passive))}</div>`
      : '';
  const branchOk = nd.branch === undefined || nd.branch === def?.branch;
  const owned = known.has(id);
  const canBuy = branchOk && nd.requires.every((r) => known.has(r)) && !owned && affordable(res, nd.cost) && hero.alive !== false;
  const reqHtml = nd.requires.map((r) => `<span class="${known.has(r) ? 'hx-ok' : 'hx-no'}">${known.has(r) ? '✓' : '✗'} ${name(r)}</span>`).join(' ');
  const opens = Object.entries(data.heroSkillTrees).filter(([, n]) => n.requires.includes(id)).map(([k]) => name(k)).join(', ');
  const row = (key: string, value: string): string => `<div class="hx-drow"><span class="hx-dk">${t(key)}</span><span class="hx-dv">${value}</span></div>`;
  const btn = owned
    ? `<div class="hx-drow"><span class="hx-ok">✓ ${t('hero.tree.unlocked')}</span></div>`
    : !branchOk
      ? `<div class="hx-drow"><span class="hx-no">${t('hero.tree.other-branch')}</span></div>`
      : `<button class="hx-dbtn btn-main" data-hskill="${hero.id}" data-node="${id}" ${canBuy ? '' : 'disabled'}>${t('hero.tree.unlock')}</button>`;
  const kind = nd.grants.ability ? 'hero.tree.ability' : nd.grants.passive || nd.grants.passives ? 'hero.tree.passive' : '';
  return (
    `<div class="hx-tmodal" data-hdback><div class="hx-dossier" role="dialog" aria-modal="true" aria-label="${name(id)}">` +
    `<div class="hx-dh">${heroPictogram('skills', id)}<span class="hx-dnm">${name(id)}${kind ? `<small>${t(kind)}</small>` : ''}</span><button class="hx-dx btn-x" data-hdclose aria-label="${t('hero.tree.close')}">✕</button></div>` +
    (nd.description ? `<p class="hx-ddesc">${esc(t(nd.description))}</p>` : '') +
    (give ? `<div class="hx-give">${give}</div>` : '') +
    (reqHtml ? row('hero.tree.requires', reqHtml) : '') +
    (opens ? row('hero.tree.opens', opens) : '') +
    (owned ? '' : row('hero.tree.cost', `<span class="hx-cost">${cost(nd.cost, res)}</span>`)) +
    btn +
    `</div></div>`
  );
}
/** What the hero staff needs from the match screen. */
export interface HeroStaffHost {
  identity?(): string;
  resetRewards?(): void;
  received?(rewards: readonly HeroReward[]): void;
  /** The current match state (read fresh on every paint — it is replaced, not mutated). */
  state(): GameState;
  /** Whose roster this is: the seat you are playing. */
  me(): string;
  /** Submit a player order through the host's usual path (gate, net, replay). */
  order(action: Action): void;
  /** Toast line (what the armed map is now waiting for). */
  note(msg: string): void;
  /** A ranged cast needs a target on the map — arm the host, the next world tap fires it. */
  armCast(heroId: string, abilityId: string): void;
  /** A deploy needs a destination on the map — same deal. */
  armSpawn(heroId: string): void;
}

/** Wire the pane up. Returns exactly what `shipyard.ts`'s «Герои» tab asks for: the
 *  markup, and a click router that answers whether the window should repaint or close. */
export function initHeroStaff(host: HeroStaffHost): {
  paneHtml: () => string;
  click: (target: HTMLElement) => 'repaint' | 'close' | null;
  focus: (heroId: string) => boolean;
} {
  let view: HeroView = { sel: null, tab: 'overview', dossier: null };
  let previous: HeroInst[] | null = null;
  let previousMatch = '';
  let previousTime = 0;
  let previousPlayer = '';

  const paneHtml = (): string => {
    const state = host.state();
    const roster = ownHeroes(state, host.me());
    const sameMatch = previousMatch === (host.identity?.() ?? '') && previousPlayer === host.me() && state.time >= previousTime;
    if (previous && !sameMatch) host.resetRewards?.();
    if (previous && sameMatch) {
      const rewards = matchHeroRewards(previous, roster, data);
      if (rewards.length) host.received?.(rewards);
    }
    previous = structuredClone(roster);
    previousMatch = host.identity?.() ?? '';
    previousTime = state.time;
    previousPlayer = host.me();
    view = normalizeHeroView(state, host.me(), view);
    const res = state.players[host.me()]?.resources ?? {};
    // The `#herobody` id keeps the `.hx-*` styling the pane was designed against.
    return `<div id="herobody">${heroStaffBodyHtml(state, host.me(), view, res)}</div>`;
  };

  const click = (tg: HTMLElement): 'repaint' | 'close' | null => {
    // STAFF-1 view state: focus a hero / switch tab / open-close the node dossier.
    const selBtn = tg.closest('[data-hsel]') as HTMLElement | null;
    if (selBtn) {
      view = { ...view, sel: selBtn.dataset.hsel!, dossier: null, flagship: undefined };
      return 'repaint';
    }
    const selectedHull = tg.closest<HTMLElement>('[data-hflagship]')?.dataset.hflagship;
    if (selectedHull) { view = { ...view, flagship: selectedHull }; return 'repaint'; }
    const hullApply = tg.closest<HTMLElement>('[data-hflagapply]');
    if (hullApply) {
      const hero = host.state().heroes?.[hullApply.dataset.hflagapply!];
      const unit = hullApply.dataset.hull;
      if (hero && unit) host.order(selectHeroFlagship(host.me(), hero.id, unit, retainedHeroModules(hero, unit)));
      return 'repaint';
    }
    const htab = (tg.closest('[data-htab]') as HTMLElement | null)?.dataset.htab;
    if (htab) {
      view = { ...view, tab: view.tab === htab && htab !== 'abilities' ? 'overview' : htab as HeroTab, dossier: null };
      return 'repaint';
    }
    const nodeBtn = tg.closest('[data-hnode]') as HTMLElement | null;
    if (nodeBtn) {
      view = { ...view, dossier: `node:${nodeBtn.dataset.hnode!}` };
      return 'repaint';
    }
    if (tg.closest('[data-hdclose]') || (tg.matches?.('[data-hdback]') ?? false)) {
      view = { ...view, dossier: null };
      return 'repaint';
    }
    const castBtn = tg.closest('[data-hcast]') as HTMLElement | null;
    if (castBtn) {
      const heroId = castBtn.dataset.hcast!;
      const abilityId = castBtn.dataset.ab!;
      if ((data.heroAbilities[abilityId]?.range ?? 0) > 0) {
        host.armCast(heroId, abilityId); // ranged cast → the next world tap is the target
        host.note(t('yard.pick.target'));
        return 'close';
      }
      host.order(castHeroAbility(host.me(), heroId, abilityId));
      return 'repaint';
    }
    const spawnBtn = tg.closest('[data-hspawn]') as HTMLElement | null;
    if (spawnBtn) {
      const heroId = spawnBtn.dataset.hspawn!;
      host.armSpawn(heroId);
      const hero = host.state().heroes?.[heroId];
      const perks = (hero?.abilities ?? []).map((a) =>
        a !== null ? data.heroAbilities[a]?.type : undefined,
      );
      host.note(
        t('yard.pick.hero-world', {
          fl: perks.includes('spawn_fleet') ? t('yard.pick.own-fleet') : '',
          al: perks.includes('spawn_allied') ? t('yard.pick.ally-world') : '',
        }),
      );
      return 'close';
    }
    const skillBtn = tg.closest('[data-hskill]') as HTMLElement | null;
    if (skillBtn) {
      host.order(unlockHeroSkill(host.me(), skillBtn.dataset.hskill!, skillBtn.dataset.node!));
      view = { ...view, dossier: null }; // the node is bought — dismiss its dossier
      return 'repaint';
    }
    const equipBtn = tg.closest('[data-hequip]') as HTMLElement | null;
    if (equipBtn) {
      host.order(equipHeroAbility(host.me(), equipBtn.dataset.hequip!, equipBtn.dataset.ab!));
      return 'repaint';
    }
    const unequipBtn = tg.closest('[data-hunequip]') as HTMLElement | null;
    if (unequipBtn) {
      host.order(
        unequipHeroAbility(host.me(), unequipBtn.dataset.hunequip!, unequipBtn.dataset.ab!),
      );
      return 'repaint';
    }
    const installBtn = tg.closest('[data-hinstall]') as HTMLElement | null;
    if (installBtn) {
      host.order(
        installHeroModule(host.me(), installBtn.dataset.hinstall!, installBtn.dataset.mod!),
      );
      return 'repaint';
    }
    const uninstallBtn = tg.closest('[data-huninstall]') as HTMLElement | null;
    if (uninstallBtn) {
      host.order(
        uninstallHeroModule(host.me(), uninstallBtn.dataset.huninstall!, uninstallBtn.dataset.mod!),
      );
      return 'repaint';
    }
    return null;
  };

  const focus = (heroId: string): boolean => {
    if (host.state().heroes?.[heroId]?.owner !== host.me()) return false;
    view = { sel: heroId, tab: 'overview', dossier: null };
    return true;
  };
  return { paneHtml, click, focus };
}
