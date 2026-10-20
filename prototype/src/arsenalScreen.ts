/**
 * «Арсенал» — the hub tab over the account's persistent collection and its workshop (ARS-5,
 * REFM-5; переделан по макету, заказ владельца 2026-10-19 и «Делай» 2026-10-20).
 *
 * The tab answers three questions the old grid of identical tiles did not: what the shipyard
 * of an online match may build (the rule line on top), what is still missing (dashed cards
 * with their materials), and how to get it (ways in the detail: workshop, match reward with its
 * odds, season, auction, store). Crafting, the workshop goal and salvage moved here from
 * «Снабжение», next to the module they make.
 *
 * What is shown and allowed is decided in `decisions/arsenalView.ts`; this module is the
 * markup and the wiring. Data: the collection is cache-first per callsign (the tab paints at
 * once, then the server's view replaces it), the workshop and odds come from the shared
 * economy session (`metaEconomyClient.ts`) and are never cached. A guest, or an account whose
 * collection is still unknown, sees the starter kit every account receives — for display
 * only, it carries no actions.
 *
 * PC shows the detail beside the list; a narrow tab (phone) opens it as a sheet over the hub.
 */
import type { ArsenalItem } from '../../packages/shared-core/src/index';
import type { CommerceOffer } from '../../packages/protocol/src/commerce';
import type { MetaEconomyView, MetaRecipeView } from '../../packages/protocol/src/metaEconomyView';
import { LOCALE, t, tData } from '../../localization/runtime';
import { moduleGroups } from '../../decisions/moduleGroups';
import {
  arsenalCatalog,
  canSell,
  copiesOf,
  defaultModule,
  dropOdds,
  fitsOf,
  FLAGSHIP_HULL,
  hullBays,
  hullGroups,
  isLastCopy,
  modulesFor,
  owns,
  percent,
  recipeProgress,
  seasonWays,
  shopOffersFor,
  type HullGroup,
  type StarterEntry,
} from '../../decisions/arsenalView';
import starterArsenal from '../../data/starterArsenal.json';
import { data } from './gameData';
import { esc, nfmt } from './format';
import { unitTitle } from './dossiers';
import { parseArsenalItems } from './arsenal';
import { moduleIcon, SLOT_ICON, SLOT_KEY } from './moduleIcons';
import { effectChip } from './moduleEffect';
import { catalogPortraitHtml } from './shipArt';
import { detach } from './detach';
import {
  createMetaEconomyClient,
  type MetaEconomyStatus,
  type MetaSession,
} from './metaEconomyClient';

const ORIGIN_KEY: Record<ArsenalItem['origin'], string> = {
  starter: 'arsenal.origin.starter',
  drop: 'arsenal.origin.drop',
  craft: 'arsenal.origin.craft',
  auction: 'arsenal.origin.auction',
  lootbox: 'arsenal.origin.lootbox',
  rent: 'arsenal.origin.rent',
  commerce: 'arsenal.origin.commerce',
  ad: 'arsenal.origin.ad',
  season: 'arsenal.origin.season',
};

/** Where a copy came from, in full: the copy rows of the detail. */
const FROM_KEY: Record<ArsenalItem['origin'], string> = {
  starter: 'arsenal.from.starter',
  drop: 'arsenal.from.drop',
  craft: 'arsenal.from.craft',
  auction: 'arsenal.from.auction',
  lootbox: 'arsenal.from.lootbox',
  rent: 'arsenal.from.rent',
  commerce: 'arsenal.from.commerce',
  ad: 'arsenal.from.ad',
  season: 'arsenal.from.season',
};

const RARITY_KEY: Record<string, string> = {
  simple: 'rarity.simple',
  unique: 'rarity.unique',
  mythic: 'rarity.mythic',
  legendary: 'rarity.legendary',
};

const MODULE_GROUP_KEY: Record<string, string> = {
  weapon: 'arsenal.group.weapon',
  defense: 'arsenal.group.defense',
  utility: 'arsenal.group.utility',
};

const HULL_GROUP_KEY: Record<HullGroup, string> = {
  line: 'arsenal.group.line',
  support: 'yard.tab.support',
  shuttles: 'yard.tab.squads',
};

/** «откуда» — the localized origin label. Exported because the Верфь tags its cards
 *  with it too (LARS-4), and the arsenal owns that vocabulary. */
export function originLabel(origin: ArsenalItem['origin']): string {
  return t(ORIGIN_KEY[origin]);
}

/** Display name of one owned thing, per kind: hulls read as units, modules as their
 *  catalogue name (falling back to the raw defId). */
export function arsenalItemName(item: ArsenalItem): string {
  if (item.kind === 'hull') return unitTitle(item.defId);
  return moduleName(item.defId);
}

const moduleName = (id: string): string => tData(data.modules[id]?.name ?? id);
const rarityOf = (id: string): string => data.modules[id]?.rarity ?? 'simple';
const rarityText = (id: string): string => t(RARITY_KEY[rarityOf(id)] ?? 'rarity.simple');
const effectsOf = (id: string): string[] =>
  Object.entries(data.modules[id]?.effects.stats ?? {}).map(([k, v]) => effectChip(k, v));
const materialName = (view: MetaEconomyView, id: string): string =>
  t(view.materials.find((m) => m.id === id)?.nameKey ?? `meta.material.${id}`);
const recipeOf = (view: MetaEconomyView | null, defId: string): MetaRecipeView | undefined =>
  view?.recipes.find((r) => r.defId === defId);
const goalRecipe = (view: MetaEconomyView | null): MetaRecipeView | undefined =>
  view?.supplyGoal ? view.recipes.find((r) => r.id === view.supplyGoal) : undefined;
const bar = (pct: number, ok = false): string =>
  `<span class="ar-bar${ok ? ' ok' : ''}"><i style="width:${pct}%"></i></span>`;
const off = (disabled: boolean): string => (disabled ? ' disabled' : '');
/** Selector of the button that carries `attr="value"` (focus goes back to it). */
const byAttr = (attr: string, value: string): string =>
  `[${attr}="${value.replace(/["\\]/g, '\\$&')}"]`;

/** The starter kit every account receives (`data/starterArsenal.json`). */
const STARTER: readonly StarterEntry[] = (
  starterArsenal as Array<{ kind: string; defId: string }>
).filter((s): s is StarterEntry => s.kind === 'hull' || s.kind === 'module');

/** What a guest, or an account whose collection is still unknown, is shown. Display only. */
export function starterPreview(): ArsenalItem[] {
  return STARTER.map((s) => ({
    itemId: `starter:${s.kind}:${s.defId}`,
    kind: s.kind,
    form: 'blueprint',
    defId: s.defId,
    soulbound: true,
    origin: 'starter',
    acquiredAt: 0,
  }));
}

export type ArsenalTab = 'modules' | 'hulls';
export type ArsenalConfirm =
  { kind: 'craft'; recipeId: string } | { kind: 'salvage'; itemId: string };

/** Everything one paint needs. Pure input of `arsenalHtml` / `arsenalDetailHtml`. */
export interface ArsenalState {
  /** The collection shown: the account's, or the starter preview. */
  items: readonly ArsenalItem[];
  /** The workshop, odds and seasons; null for a guest or while the server is unknown. */
  view: MetaEconomyView | null;
  offers: readonly CommerceOffer[];
  guest: boolean;
  canSignIn: boolean;
  busy: boolean;
  tab: ArsenalTab;
  /** The module and the ship whose detail is open on each tab. */
  module: string | undefined;
  hull: string | undefined;
  confirm: ArsenalConfirm | null;
  /** A read problem, shown under the head. */
  status: { text: string; error: boolean } | null;
  /** The outcome of the last action, shown on top of the detail where the action was. */
  notice: { text: string; error: boolean } | null;
  /** The detail sits beside the list: the list marks the open card. */
  wide: boolean;
}

/** The catalog of this paint: the starter kit, the collection and what a reward can bring. */
const catalogOf = (s: Pick<ArsenalState, 'items' | 'view'>) =>
  arsenalCatalog({ starter: STARTER, items: s.items, obtainable: s.view?.drops?.pool, data });

function moduleGetHtml(s: ArsenalState, id: string): string {
  const line = (text: string, cls = ''): string => `<span class="ar-get${cls}">${esc(text)}</span>`;
  if (s.guest) return line(t('arsenal.get.guest'));
  if (!s.view) return '';
  const recipe = recipeOf(s.view, id);
  if (recipe) {
    const p = recipeProgress(recipe);
    if (p.ready) return line(t('arsenal.get.ready'), ' ready');
    return `<span class="ar-get">${bar(percent(p.got, p.need))}${esc(t('arsenal.get.materials', { got: nfmt(p.got), need: nfmt(p.need) }))}</span>`;
  }
  if (s.view.drops && dropOdds(s.view.drops, id).share !== null) return line(t('arsenal.get.drop'));
  if (seasonWays(s.view.seasons, id).length > 0) return line(t('arsenal.get.season'));
  return line(t('arsenal.way.auction'));
}

function moduleCard(s: ArsenalState, id: string): string {
  const own = owns(s.items, id);
  const copies = copiesOf(s.items, id).length;
  const goal = !own && goalRecipe(s.view)?.defId === id;
  const selected = s.wide && s.tab === 'modules' && s.module === id;
  const tag = goal
    ? `<span class="ar-tag goal">${t('arsenal.tag.goal')}</span>`
    : copies > 1
      ? `<span class="ar-tag">×${copies}</span>`
      : '';
  return (
    `<button type="button" class="ar-mc r-${rarityOf(id)}${own ? '' : ' miss'}${goal ? ' goal' : ''}" data-ar-module="${esc(id)}" aria-pressed="${selected}">` +
    `<span class="ar-mc-ic" aria-hidden="true">${moduleIcon(id)}</span><span class="ar-mc-nm">${esc(moduleName(id))}</span>` +
    `<span class="ar-mc-sub"><span class="ar-rw">${rarityText(id)}</span>${effectsOf(id)
      .map((e) => `<span>${esc(e)}</span>`)
      .join('')}</span>` +
    (own ? '' : moduleGetHtml(s, id)) +
    tag +
    '</button>'
  );
}

function groupHead(icon: string, title: string, have: number, total: number): string {
  return (
    `<h3 class="ar-group-h">${icon ? `<span aria-hidden="true">${icon}</span>` : ''}${esc(title)}` +
    `<small${have === 0 ? ' class="zero"' : ''}>${t('arsenal.count', { n: have, m: total })}</small></h3>`
  );
}

function moduleListHtml(s: ArsenalState, modules: readonly string[]): string {
  return moduleGroups(modules, data)
    .map(
      (g) =>
        `<section class="ar-group">${groupHead(SLOT_ICON[g.slot] ?? '', t(MODULE_GROUP_KEY[g.slot] ?? g.slot), g.ids.filter((id) => owns(s.items, id)).length, g.ids.length)}` +
        `<div class="ar-mgrid">${g.ids.map((id) => moduleCard(s, id)).join('')}</div></section>`,
    )
    .join('');
}

function pipsHtml(hull: string): string {
  const bays = hullBays(hull, data);
  if (!bays.length) return `<span class="ar-pip none">${t('arsenal.bays.zero')}</span>`;
  return bays
    .map(
      (b) =>
        `<span class="ar-pip"><i aria-hidden="true">${SLOT_ICON[b.slot] ?? ''}</i>${t(SLOT_KEY[b.slot] ?? b.slot)} ${b.count}</span>`,
    )
    .join('');
}

function hullCard(s: ArsenalState, id: string): string {
  const own = owns(s.items, id);
  const selected = s.wide && s.tab === 'hulls' && s.hull === id;
  const art = catalogPortraitHtml('u', id, data, 'portrait') || '<span class="ar-noart"></span>';
  return (
    `<button type="button" class="ar-hc${own ? '' : ' miss'}" data-ar-hull="${esc(id)}" aria-pressed="${selected}">${art}` +
    `<span class="ar-hc-b"><span class="ar-hc-nm">${esc(unitTitle(id))}</span><span class="ar-pips">${pipsHtml(id)}</span></span></button>`
  );
}

function hullListHtml(s: ArsenalState, hulls: readonly string[]): string {
  return hullGroups(hulls, data)
    .map(
      (g) =>
        `<section class="ar-group">${groupHead('', t(HULL_GROUP_KEY[g.group]), g.ids.filter((id) => owns(s.items, id)).length, g.ids.length)}` +
        `<div class="ar-hgrid">${g.ids.map((id) => hullCard(s, id)).join('')}</div></section>`,
    )
    .join('');
}

function guestHtml(s: ArsenalState): string {
  return (
    `<section class="ar-guest"><div><b>${t('arsenal.guest.title')}</b><p>${t('arsenal.guest.body')}</p></div>` +
    (s.canSignIn
      ? `<button type="button" class="btn-main" data-ar-sign-in>${t('arsenal.guest.sign-in')}</button>`
      : '') +
    '</section>'
  );
}

/** The workshop bench on top of the modules: what the goal still needs. */
function goalHtml(s: ArsenalState): string {
  if (s.guest) return guestHtml(s);
  if (!s.view) return '';
  const recipe = goalRecipe(s.view);
  if (!recipe) {
    return (
      `<section class="ar-goal empty"><span class="ar-goal-ic" aria-hidden="true">⚒</span>` +
      `<div class="ar-goal-t"><b>${t('arsenal.goal.none')}</b><p>${t('arsenal.goal.none.hint')}</p></div>` +
      `<div class="ar-goal-act"><button type="button" class="btn-second" data-ar-pick>${t('arsenal.goal.pick')}</button></div></section>`
    );
  }
  const view = s.view;
  const id = recipe.defId;
  const p = recipeProgress(recipe);
  const chips = recipe.ingredients
    .map((i) => {
      const have = i.tradable + i.soulbound;
      return `<span class="ar-mat${have >= i.required ? ' done' : ' short'}">${esc(materialName(view, i.materialId))} <b>${nfmt(have)}/${nfmt(i.required)}</b></span>`;
    })
    .join('');
  return (
    `<section class="ar-goal r-${rarityOf(id)}"><span class="ar-goal-ic" aria-hidden="true">${moduleIcon(id)}</span>` +
    `<div class="ar-goal-t"><span class="ar-goal-k">${t('arsenal.goal.title')}</span><div class="ar-goal-n"><b>${esc(moduleName(id))}</b><span class="ar-rw">${rarityText(id)}</span></div></div>` +
    `<div class="ar-mats">${chips}</div>` +
    `<div class="ar-goal-act"><div class="ar-goal-p"><span>${t('arsenal.materials')}</span><b>${t('arsenal.count', { n: nfmt(p.got), m: nfmt(p.need) })}</b></div>${bar(percent(p.got, p.need), p.ready)}` +
    `<div class="ar-row2"><button type="button" class="btn-main" data-ar-craft="${esc(recipe.id)}"${off(!p.ready || s.busy)}>${t('arsenal.craft')}</button>` +
    `<button type="button" class="btn-second" data-ar-module="${esc(id)}">${t('arsenal.details')}</button></div></div></section>`
  );
}

function statusHtml(st: { text: string; error: boolean } | null, retry = false): string {
  if (!st?.text) return '';
  return (
    `<p class="ar-status${st.error ? ' error' : ''}" role="status">${esc(st.text)}` +
    (retry
      ? ` <button type="button" class="btn-quiet" data-ar-refresh>${t('arsenal.retry')}</button>`
      : '') +
    '</p>'
  );
}

/** The whole tab: head with the rule and the tabs, the goal (or guest) card, the list, and on
 *  a wide tab the detail beside it. */
export function arsenalHtml(s: ArsenalState): string {
  const { hulls, modules } = catalogOf(s);
  const tab = (id: ArsenalTab, key: string, list: readonly string[]): string =>
    `<button type="button" class="ar-tab" role="tab" data-ar-tab="${id}" aria-selected="${s.tab === id}">${t(key)}` +
    `<small>${t('arsenal.count', { n: list.filter((x) => owns(s.items, x)).length, m: list.length })}</small></button>`;
  const head =
    `<div class="ar-head"><div><h2>${t('hub.nav.arsenal')}</h2><p class="ar-rule">${t('arsenal.rule')}</p></div>` +
    `<div class="ar-tabs" role="tablist" aria-label="${esc(t('arsenal.tabs'))}">${tab('modules', 'arsenal.tab.modules', modules)}${tab('hulls', 'arsenal.tab.hulls', hulls)}</div></div>`;
  const list = s.tab === 'modules' ? moduleListHtml(s, modules) : hullListHtml(s, hulls);
  return (
    head +
    statusHtml(s.status, s.status?.error === true) +
    (s.tab === 'modules' || s.guest ? goalHtml(s) : '') +
    `<div class="ar-main"><div class="ar-list" role="tabpanel">${list}</div>` +
    (s.wide ? `<aside class="ar-detail">${arsenalDetailHtml(s)}</aside>` : '') +
    '</div>'
  );
}

function fitsHtml(s: ArsenalState, id: string, hulls: readonly string[]): string {
  const fits = fitsOf(id, hulls, data);
  const chips = fits.hulls.map(
    (h) =>
      `<button type="button" class="ar-fchip" data-ar-hull="${esc(h)}">${catalogPortraitHtml('u', h, data, 'thumb')}${esc(unitTitle(h))}</button>`,
  );
  if (fits.flagship)
    chips.push(
      `<span class="ar-fchip">${catalogPortraitHtml('u', FLAGSHIP_HULL, data, 'thumb')}${t('arsenal.flagship')}</span>`,
    );
  if (!chips.length) return '';
  return (
    `<div class="ar-sec"><h4>${t('arsenal.fits')}</h4><div class="ar-fits">${chips.join('')}</div>` +
    (fits.flagship && !fits.hulls.length
      ? `<p class="ar-note">${t('arsenal.fits.flagship-only')}</p>`
      : '') +
    '</div>'
  );
}

function copiesHtml(s: ArsenalState, id: string): string {
  const copies = copiesOf(s.items, id);
  if (copies.every((c) => c.origin === 'starter'))
    return `<div class="ar-sec"><h4>${t('arsenal.copies')}</h4><p class="ar-note">${t('arsenal.copies.starter')}</p></div>`;
  let actionable = false;
  const rows = copies
    .map((c) => {
      const sell = !!s.view && canSell(c);
      const salvage = !!s.view?.salvageableItemIds.includes(c.itemId);
      if (sell || salvage) actionable = true;
      const [statusKey, cls] =
        c.origin === 'starter'
          ? ['arsenal.copy.forever', '']
          : canSell(c)
            ? ['arsenal.copy.sellable', ' ok']
            : c.soulbound
              ? ['arsenal.copy.bound', ' bound']
              : ['arsenal.copy.no-sale', ''];
      const when =
        c.acquiredAt > 0
          ? `, ${new Date(c.acquiredAt).toLocaleDateString(LOCALE, { day: 'numeric', month: 'short' })}`
          : '';
      // Copies differ by grade and wear, and selling or salvaging takes THIS one.
      const state = [
        c.grade ? t('arsenal.copy.grade', { n: c.grade }) : '',
        typeof c.durability === 'number' ? t('arsenal.copy.durability', { n: c.durability }) : '',
      ]
        .filter(Boolean)
        .join(', ');
      return (
        `<div class="ar-copy"><div><b>${t(FROM_KEY[c.origin])}${esc(when)}${state ? esc(`, ${state}`) : ''}</b>` +
        `<span class="ar-copy-st${cls}">${t(statusKey)}</span></div><div class="ar-acts">` +
        (sell
          ? `<button type="button" class="btn-second" data-ar-sell="${esc(c.itemId)}"${off(s.busy)}>${t('arsenal.sell')}</button>`
          : '') +
        (salvage
          ? `<button type="button" class="btn-second" data-ar-salvage="${esc(c.itemId)}"${off(s.busy)}>${t('arsenal.salvage')}</button>`
          : '') +
        '</div></div>'
      );
    })
    .join('');
  const note =
    copies.length > 1
      ? `<p class="ar-note">${t('arsenal.copies.spare')}</p>`
      : actionable
        ? `<p class="ar-note">${t('arsenal.copies.one')}</p>`
        : '';
  return (
    `<div class="ar-sec"><h4>${t('arsenal.copies')}<small>${t('arsenal.copies.count', { n: copies.length })}</small></h4>` +
    `<div class="ar-copies">${rows}</div>${note}</div>`
  );
}

function workshopWayHtml(s: ArsenalState, view: MetaEconomyView, recipe: MetaRecipeView): string {
  const p = recipeProgress(recipe);
  const rows = recipe.ingredients
    .map((i) => {
      const have = i.tradable + i.soulbound;
      return (
        `<div class="ar-mrow"><span>${esc(materialName(view, i.materialId))}</span>` +
        `<b${have < i.required ? ' class="lack"' : ''}>${nfmt(have)}/${nfmt(i.required)}</b>${bar(percent(have, i.required), have >= i.required)}</div>`
      );
    })
    .join('');
  const short =
    !p.ready && p.short.length
      ? `<p class="ar-note warn">${esc(t('arsenal.craft.short', { list: p.short.map((m) => `${materialName(view, m.materialId)} ${nfmt(m.missing)}`).join(', ') }))}</p>`
      : '';
  const goal =
    view.supplyGoal === recipe.id
      ? `<span class="ar-tagline">${t('arsenal.goal.current')}</span>`
      : `<button type="button" class="btn-second" data-ar-goal="${esc(recipe.id)}"${off(s.busy)}>${t('arsenal.goal.set')}</button>`;
  return (
    `<div class="ar-way"><div class="ar-way-h"><i aria-hidden="true">⚒</i><b>${t('arsenal.way.workshop')}</b><small>${t('arsenal.count', { n: nfmt(p.got), m: nfmt(p.need) })}</small></div>` +
    `<div class="ar-rows">${rows}</div>${short}` +
    `<div class="ar-acts-row"><button type="button" class="btn-main" data-ar-craft="${esc(recipe.id)}"${off(!p.ready || s.busy)}>${t('arsenal.craft')}</button>${goal}</div></div>`
  );
}

function dropWayHtml(view: MetaEconomyView, id: string, kind: 'hull' | 'module'): string {
  if (!view.drops) return '';
  const odds = dropOdds(view.drops, id, kind);
  if (odds.share === null) return '';
  const places = odds.places
    .map((p) =>
      p.to === null
        ? t('arsenal.odds.rest', { chance: p.chance })
        : p.from === p.to
          ? t('arsenal.odds.one', { chance: p.chance, n: p.from })
          : t('arsenal.odds.range', { chance: p.chance, from: p.from, to: p.to }),
    )
    .join(', ');
  const text =
    t('arsenal.odds.lead', { list: places }) +
    (odds.dryRun ? ` ${t('arsenal.odds.pity', { n: odds.dryRun })}` : '');
  return (
    `<div class="ar-way"><div class="ar-way-h"><i aria-hidden="true">★</i><b>${t('arsenal.way.drop')}</b><small>${t('arsenal.way.drop.share', { n: odds.share })}</small></div>` +
    `<p>${esc(text)}</p></div>`
  );
}

function seasonWaysHtml(view: MetaEconomyView, id: string): string {
  return seasonWays(view.seasons, id)
    .map(
      (w) =>
        `<div class="ar-way"><div class="ar-way-h"><i aria-hidden="true">◎</i><b>${esc(t('arsenal.way.season', { name: t(w.nameKey) }))}</b><small>${t('arsenal.way.season.level', { n: w.level })}</small></div>` +
        `<p>${t(w.choices > 1 ? 'arsenal.season.choice' : 'arsenal.season.grant', { level: w.level, n: w.choices })} ${t('arsenal.season.yours', { n: w.current, m: w.levels })}</p>` +
        `${bar(percent(w.current, w.level), w.claimable)}<div class="ar-acts-row"><button type="button" class="btn-quiet" data-ar-season>${t(w.claimable ? 'arsenal.season.claim' : 'arsenal.season.open')}</button></div></div>`,
    )
    .join('');
}

function waysHtml(s: ArsenalState, id: string, kind: 'hull' | 'module' = 'module'): string {
  if (s.guest)
    return `<div class="ar-sec"><h4>${t('arsenal.ways')}</h4><p class="ar-note">${t('arsenal.ways.guest')}</p></div>`;
  const view = s.view;
  if (!view) return '';
  // The workshop, the season and the shop hand out modules only.
  const forModule = kind === 'module';
  const recipe = forModule ? recipeOf(view, id) : undefined;
  const ways = [
    recipe ? workshopWayHtml(s, view, recipe) : '',
    dropWayHtml(view, id, kind),
    forModule ? seasonWaysHtml(view, id) : '',
    `<div class="ar-way"><div class="ar-way-h"><i aria-hidden="true">⌖</i><b>${t('arsenal.way.auction')}</b></div>` +
      `<div class="ar-acts-row"><button type="button" class="btn-quiet" data-ar-auction>${t('arsenal.auction.open')}</button></div></div>`,
    forModule && shopOffersFor(s.offers, id).length
      ? `<div class="ar-way"><div class="ar-way-h"><i aria-hidden="true">◈</i><b>${t('arsenal.way.shop')}</b></div>` +
        `<div class="ar-acts-row"><button type="button" class="btn-quiet" data-ar-store>${t('arsenal.shop.open')}</button></div></div>`
      : '',
  ].join('');
  return `<div class="ar-sec"><h4>${t('arsenal.ways')}</h4><div class="ar-ways">${ways}</div></div>`;
}

function confirmHtml(s: ArsenalState): string {
  const c = s.confirm;
  const view = s.view;
  if (!c || !view) return '';
  const buttons = (attr: string, label: string): string =>
    `<div class="ar-acts-row"><button type="button" class="btn-main" ${attr}${off(s.busy)}>${label}</button>` +
    `<button type="button" class="btn-quiet" data-ar-cancel>${t('arsenal.cancel')}</button></div>`;
  if (c.kind === 'craft') {
    const recipe = view.recipes.find((r) => r.id === c.recipeId);
    if (!recipe) return '';
    const list = recipe.ingredients
      .map((i) => `${materialName(view, i.materialId)} ${nfmt(i.required)}`)
      .join(', ');
    const goal = goalRecipe(view);
    const clash =
      goal &&
      goal.id !== recipe.id &&
      goal.ingredients.some((g) => recipe.ingredients.some((i) => i.materialId === g.materialId));
    return (
      `<div class="ar-confirm" role="group"><p>${esc(t('arsenal.craft.confirm', { item: moduleName(recipe.defId), list }))}</p>` +
      (recipe.requiresSoulbound ? `<p class="ar-note warn">${t('arsenal.craft.bound')}</p>` : '') +
      (clash
        ? `<p class="ar-note warn">${esc(t('arsenal.craft.clash', { item: moduleName(goal.defId) }))}</p>`
        : '') +
      buttons(`data-ar-craft-do="${esc(recipe.id)}"`, t('arsenal.craft')) +
      '</div>'
    );
  }
  const item = s.items.find((i) => i.itemId === c.itemId);
  const recipe = item && recipeOf(view, item.defId);
  if (!item || !recipe) return '';
  const list = recipe.salvage
    .map((m) => `${materialName(view, m.materialId)} ${nfmt(m.quantity)}`)
    .join(', ');
  return (
    `<div class="ar-confirm" role="group"><p>${esc(t('arsenal.salvage.confirm', { item: arsenalItemName(item), list }))}</p>` +
    (item.soulbound ? `<p class="ar-note">${t('arsenal.salvage.bound')}</p>` : '') +
    (isLastCopy(s.items, item) ? `<p class="ar-note warn">${t('arsenal.salvage.last')}</p>` : '') +
    buttons(`data-ar-salvage-do="${esc(item.itemId)}"`, t('arsenal.salvage')) +
    '</div>'
  );
}

function moduleDetailHtml(s: ArsenalState, id: string, hulls: readonly string[]): string {
  const own = owns(s.items, id);
  const def = data.modules[id];
  const effects = effectsOf(id);
  return (
    `<div class="ar-dt r-${rarityOf(id)}"><div class="ar-dt-head"><span class="ar-dt-ic${own ? '' : ' miss'}" aria-hidden="true">${moduleIcon(id)}</span>` +
    `<div><h3 id="ar-dt-title">${esc(moduleName(id))}</h3><div class="ar-dt-meta"><span class="ar-rw">${rarityText(id)}</span>` +
    (def ? `<span>${t('arsenal.slot', { slot: t(SLOT_KEY[def.slot] ?? def.slot) })}</span>` : '') +
    `<span>${t(own ? 'arsenal.owned' : 'arsenal.missing')}</span></div></div></div>` +
    statusHtml(s.notice) +
    (effects.length
      ? `<div class="ar-dt-eff">${effects.map((e) => `<span>${esc(e)}</span>`).join('')}</div>`
      : '') +
    (def?.description ? `<p class="ar-note">${esc(t(def.description))}</p>` : '') +
    confirmHtml(s) +
    (own ? fitsHtml(s, id, hulls) + copiesHtml(s, id) : waysHtml(s, id) + fitsHtml(s, id, hulls)) +
    `<div class="ar-acts-row"><button type="button" class="btn-quiet" data-ar-codex="md:${esc(id)}">${t('arsenal.codex')}</button></div></div>`
  );
}

function hullDetailHtml(s: ArsenalState, id: string, modules: readonly string[]): string {
  const def = data.units[id];
  if (!def) return '';
  const own = owns(s.items, id);
  const st = def.stats;
  const stat = (key: string, value: string): string =>
    `<div class="ar-stat"><span>${t(key)}</span><b>${esc(value)}</b></div>`;
  const stats = [
    stat('codex.row.atk-def', `${nfmt(st.attack)} / ${nfmt(st.defense)}`),
    stat('codex.row.hull', nfmt(st.hp)),
    stat('codex.row.speed', nfmt(st.speed)),
    st.cargoCapacity ? stat('codex.row.cargo', nfmt(st.cargoCapacity)) : '',
    def.radarRange ? stat('codex.row.radar', nfmt(def.radarRange)) : '',
  ].join('');
  const bays = hullBays(id, data);
  const baysHtml = bays.length
    ? `<div class="ar-bays">${bays
        .map(
          (b) =>
            `<span class="ar-bay"><i aria-hidden="true">${SLOT_ICON[b.slot] ?? ''}</i>${t(SLOT_KEY[b.slot] ?? b.slot)}<b>×${b.count}</b></span>`,
        )
        .join('')}</div>` +
      (bays.some((b) => b.slot === 'universal')
        ? `<p class="ar-note">${t('arsenal.bays.universal')}</p>`
        : '')
    : `<p class="ar-note">${t('arsenal.bays.none')}</p>`;
  const fitting = bays.length ? modulesFor(id, modules, data) : [];
  const fittingHtml = fitting.length
    ? `<div class="ar-sec"><h4>${t('arsenal.hull.modules')}<small>${t('arsenal.count', { n: fitting.filter((m) => owns(s.items, m)).length, m: fitting.length })}</small></h4>` +
      `<div class="ar-mchips">${fitting
        .map(
          (m) =>
            `<button type="button" class="ar-mchip r-${rarityOf(m)}${owns(s.items, m) ? '' : ' miss'}" data-ar-module="${esc(m)}"><span class="ar-mi" aria-hidden="true">${moduleIcon(m)}</span>${esc(moduleName(m))}<span class="ar-rd" aria-hidden="true"></span></button>`,
        )
        .join('')}</div><p class="ar-note">${t('arsenal.hull.modules.note')}</p></div>`
    : '';
  const group = hullGroups([id], data)[0]?.group;
  return (
    `<div class="ar-dt">${catalogPortraitHtml('u', id, data, 'portrait')}<div><h3 id="ar-dt-title">${esc(unitTitle(id))}</h3>` +
    `<div class="ar-dt-meta">${group ? `<span>${t(HULL_GROUP_KEY[group])}</span>` : ''}<span>${t(own ? 'arsenal.owned' : 'arsenal.missing')}</span></div></div>` +
    `<div class="ar-stats">${stats}</div>${own ? '' : waysHtml(s, id, 'hull')}` +
    `<div class="ar-sec"><h4>${t('arsenal.bays')}</h4>${baysHtml}</div>${fittingHtml}` +
    `<div class="ar-acts-row"><button type="button" class="btn-quiet" data-ar-codex="u:${esc(id)}">${t('arsenal.codex')}</button></div></div>`
  );
}

/** The detail of the open module or ship: beside the list on PC, in the sheet on a phone. */
export function arsenalDetailHtml(s: ArsenalState): string {
  const { hulls, modules } = catalogOf(s);
  if (s.tab === 'modules')
    return s.module && modules.includes(s.module) ? moduleDetailHtml(s, s.module, hulls) : '';
  return s.hull && hulls.includes(s.hull) ? hullDetailHtml(s, s.hull, modules) : '';
}

/** What the tab needs from the hub. */
export interface ArsenalHost {
  /** The tab's container (`#hp-arsenal`) — painted and click-delegated here. */
  root(): HTMLElement;
  /** The phone sheet (`#arsenal-sheet`), a child of the hub outside its scrolling body. */
  sheet(): HTMLElement;
  /** The tab is too narrow for the detail beside the list. */
  narrow(): boolean;
  /** The last known collection for the CURRENT callsign, as stored (parsed here, so a
   *  corrupt blob degrades to the starter preview rather than throwing). */
  readCache(): unknown;
  /** Persist a freshly fetched collection for the current callsign. */
  writeCache(items: readonly ArsenalItem[]): void;
  /** Open the codex card for a `<kind>:<defId>` key. */
  openCodex(key: string): void;
  /** HTTP base + session token, or null when there is no server, no accounts, or no session
   *  a prior join already stashed — the tab never prompts for a password just to LOOK. */
  authorizedBase(): Promise<MetaSession | null>;
  /** A sign-in exists for this build and server. */
  canSignIn(): boolean;
  signIn(): void;
  openAuction(): void;
  /** The auction's sell form for this copy. */
  sell(itemId: string): void;
  /** «Снабжение» on its season (rewards are claimed there). */
  openSeason(): void;
  openStore(): void;
  /** After a confirmed craft or salvage (the wallet, the auction). */
  changed?(): Promise<void>;
  requestId?(): string;
}

/** Wire the tab up: paints, the cache, the shared economy session and the sheet. Call once
 *  at boot — it attaches the click delegates. */
export function initArsenal(host: ArsenalHost): {
  refresh(): Promise<void>;
  items(): readonly ArsenalItem[];
  /** Re-lay the tab after its width changed (detail beside the list ⇄ sheet). */
  relayout(): void;
  /** The phone sheet is open (a layer of the Back ladder). */
  isOpen(): boolean;
  /** Close the sheet: Back, or the hub left the tab. */
  close(): void;
} {
  let items: ArsenalItem[] = [];
  let tab: ArsenalTab = 'modules';
  let module: string | undefined;
  let hull: string | undefined;
  /** The player opened an item: the default (the goal, the first missing) no longer moves it. */
  let chosen = false;
  let confirm: ArsenalConfirm | null = null;
  let sheetOpen = false;
  let wide = !host.narrow();
  /** The card the sheet was opened from, to return focus to. */
  let returnTo: string | null = null;
  /** A write was sent from this tab and its outcome belongs on the detail. */
  let acting = false;
  /** The last accepted view, kept on screen (inert) while a read is under way. */
  let lastView: MetaEconomyView | null = null;

  const client = createMetaEconomyClient({
    authorizedBase: () => host.authorizedBase(),
    paint: () => paint(),
    accept: (view) => {
      items = parseArsenalItems(view.items);
      host.writeCache(items);
    },
    ...(host.changed ? { changed: () => host.changed!() } : {}),
    ...(host.requestId ? { requestId: () => host.requestId!() } : {}),
  });

  const readStatus = (st: MetaEconomyStatus): ArsenalState['status'] => {
    if (st.kind === 'loading') return { text: t('arsenal.loading'), error: false };
    if (st.kind === 'unavailable') return { text: t('arsenal.unavailable'), error: true };
    return null;
  };
  const actionNotice = (st: MetaEconomyStatus): ArsenalState['notice'] => {
    if (!acting) return null;
    if (st.kind === 'pending') return { text: t('arsenal.pending'), error: false };
    if (st.kind === 'done') return st.key ? { text: t(st.key), error: false } : null;
    if (st.kind === 'failed') return { text: t(st.key ?? 'arsenal.failed'), error: true };
    return null;
  };

  function state(): ArsenalState {
    const st = client.status();
    const live = client.view();
    if (live) lastView = live;
    else if (!client.busy()) lastView = null;
    const view = live ?? lastView;
    const guest = st.kind === 'guest';
    // A guest is promised the starter kit: the cache belongs to a session that is gone.
    const shown = guest || !items.length ? starterPreview() : items;
    const shownView = guest ? null : view;
    const { hulls, modules } = catalogOf({ items: shown, view: shownView });
    if (!chosen || !module || !modules.includes(module))
      module = defaultModule(modules, shown, goalRecipe(view)?.defId ?? null);
    if (!hull || !hulls.includes(hull)) hull = hulls[0];
    return {
      items: shown,
      view: shownView,
      offers: client.offers(),
      guest,
      canSignIn: host.canSignIn(),
      busy: client.busy(),
      tab,
      module,
      hull,
      confirm,
      status: readStatus(st),
      notice: actionNotice(st),
      wide,
    };
  }

  function paint(): void {
    const s = state();
    const root = host.root();
    const detail = root.querySelector?.('.ar-detail');
    const keep = detail?.scrollTop ?? 0;
    root.innerHTML = arsenalHtml(s);
    const fresh = root.querySelector?.('.ar-detail');
    if (fresh) fresh.scrollTop = keep;
    const sheet = host.sheet();
    sheet.innerHTML = sheetOpen
      ? `<div class="ar-scrim" data-ar-close></div><div class="ar-sheet" role="dialog" aria-modal="true" aria-labelledby="ar-dt-title">` +
        `<div class="ar-sheet-top"><button type="button" class="btn-x" data-ar-close aria-label="${esc(t('arsenal.close'))}">✕</button></div>` +
        `<div class="ar-sheet-body">${arsenalDetailHtml(s)}</div></div>`
      : '';
    sheet.classList.toggle('open', sheetOpen);
  }

  /** The detail box the open item lives in now. */
  const detailBox = (): Element | null | undefined =>
    sheetOpen
      ? host.sheet().querySelector?.('.ar-sheet-body')
      : host.root().querySelector?.('.ar-detail');

  function open(kind: ArsenalTab, id: string, from?: string): void {
    tab = kind;
    if (kind === 'modules') module = id;
    else hull = id;
    chosen = true;
    confirm = null;
    acting = false;
    if (!wide && !sheetOpen) {
      sheetOpen = true;
      returnTo = from ?? null;
    }
    paint();
    const box = detailBox();
    if (box) box.scrollTop = 0;
    if (sheetOpen)
      host.sheet().querySelector?.<HTMLElement>('.btn-x')?.focus({ preventScroll: true });
  }

  function close(): void {
    if (!sheetOpen) return;
    sheetOpen = false;
    confirm = null;
    acting = false;
    paint();
    if (returnTo)
      host.root().querySelector?.<HTMLElement>(returnTo)?.focus({ preventScroll: true });
    returnTo = null;
  }

  function ask(next: ArsenalConfirm): void {
    confirm = next;
    acting = false;
    paint();
    detailBox()?.querySelector?.('.ar-confirm')?.scrollIntoView?.({ block: 'nearest' });
  }

  function act(path: string, body: Record<string, unknown>, successKey?: string): void {
    confirm = null;
    acting = true;
    detach('арсенал: мастерская', client.mutate(path, body, successKey));
  }

  function onClick(ev: Event): void {
    const el = (ev.target as HTMLElement).closest<HTMLElement>('button, [data-ar-close]');
    if (!el || (el as HTMLButtonElement).disabled) return;
    const d = el.dataset;
    if (d.arClose !== undefined) return close();
    if (d.arTab) {
      tab = d.arTab === 'hulls' ? 'hulls' : 'modules';
      confirm = null;
      acting = false;
      return paint();
    }
    if (d.arModule) return open('modules', d.arModule, byAttr('data-ar-module', d.arModule));
    if (d.arHull) return open('hulls', d.arHull, byAttr('data-ar-hull', d.arHull));
    if (d.arPick !== undefined) {
      const s = state();
      const pick = defaultModule(catalogOf(s).modules, s.items, null);
      if (pick) open('modules', pick, '[data-ar-pick]');
      return;
    }
    if (d.arCodex) return host.openCodex(d.arCodex);
    if (d.arSignIn !== undefined) return host.signIn();
    if (d.arAuction !== undefined) return host.openAuction();
    if (d.arStore !== undefined) return host.openStore();
    if (d.arSeason !== undefined) return host.openSeason();
    if (d.arRefresh !== undefined) {
      detach('арсенал: обновление', refresh());
      return;
    }
    if (d.arCancel !== undefined) {
      confirm = null;
      return paint();
    }
    const view = client.view();
    if (client.busy() || !view) return;
    if (d.arSell) {
      const item = items.find((i) => i.itemId === d.arSell);
      if (!item || !canSell(item)) return;
      close();
      return host.sell(item.itemId);
    }
    if (d.arCraft) {
      const recipe = view.recipes.find((r) => r.id === d.arCraft);
      if (!recipe?.canCraft) return;
      if (tab !== 'modules' || module !== recipe.defId)
        open('modules', recipe.defId, byAttr('data-ar-craft', recipe.id));
      return ask({ kind: 'craft', recipeId: recipe.id });
    }
    if (d.arCraftDo) {
      const recipe = view.recipes.find((r) => r.id === d.arCraftDo);
      if (!recipe?.canCraft || confirm?.kind !== 'craft' || confirm.recipeId !== recipe.id) return;
      return act(
        '/meta-economy/craft',
        { recipeId: recipe.id, allowSoulbound: recipe.requiresSoulbound },
        'arsenal.craft.done',
      );
    }
    if (d.arGoal) {
      if (!view.recipes.some((r) => r.id === d.arGoal)) return;
      return act('/meta-economy/supply-goal', { recipeId: d.arGoal });
    }
    if (d.arSalvage) {
      if (!view.salvageableItemIds.includes(d.arSalvage)) return;
      return ask({ kind: 'salvage', itemId: d.arSalvage });
    }
    if (d.arSalvageDo) {
      const itemId = d.arSalvageDo;
      if (
        !view.salvageableItemIds.includes(itemId) ||
        confirm?.kind !== 'salvage' ||
        confirm.itemId !== itemId
      )
        return;
      return act('/meta-economy/salvage', { itemId }, 'arsenal.salvage.done');
    }
  }

  // Escape and Android Back close the sheet through the hub's layer ladder (`BACK_LAYERS`
  // in main.ts): a codex card opened from the sheet lies above it and closes first.
  host.root().addEventListener('click', onClick);
  host.sheet().addEventListener('click', onClick);

  /** Cache-first paint, then the server's view. A failed read keeps the cache. */
  async function refresh(): Promise<void> {
    items = parseArsenalItems(host.readCache());
    acting = false;
    paint();
    await client.refresh();
  }

  return {
    refresh,
    // A guest has no collection: the cache is not handed to the shipyard or the auction either.
    items: () => (client.status().kind === 'guest' ? [] : items),
    relayout: () => {
      const next = !host.narrow();
      if (next === wide) return;
      wide = next;
      if (wide) sheetOpen = false;
      paint();
    },
    isOpen: () => sheetOpen,
    close,
  };
}
