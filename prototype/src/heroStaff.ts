/**
 * «Штаб героев» — the hero pane of the Верфь (STAFF-1, REFM-14).
 *
 * One place for the whole hero loop: deploy reserves (`hero.spawn`), cast abilities
 * (`hero.ability` — built-ins live, typed-but-unwired honestly say «скоро»), walk the
 * skill tree (`hero.skill.unlock`) and install fittings (`hero.fit`). All gates
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
import type { Action, GameState } from '../../packages/shared-core/src/index';
import { t } from '../../localization/runtime';
import { data } from './prototypeData';
import { esc, cost, fmtHrs } from './format';
import { HOUR } from './time';
import { castHeroAbility, unlockHeroSkill, fitHero } from './actions';
import { houseDisplayName } from './setupSeats';

type HeroInst = NonNullable<GameState['heroes']>[string];
export type HeroTab = 'overview' | 'tree' | 'abilities' | 'fittings';
type Bag = Record<string, number>;

/** What the pane is showing: which hero is focused, which tab is open, and which
 *  node/fitting dossier is pinned («node:<id>» | «fit:<id>»). Client-only view state. */
export interface HeroView {
  sel: string | null;
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
 * What to CALL a hero on screen (AUD-12). One state field, `name`, carries two
 * different things, and telling them apart is the whole job:
 *
 * - the MAIN hero is named after its seat (`matchSetup`): the commander's callsign in a
 *   network match, the house name in a solo one. Neither is a localization key —
 *   `houseDisplayName` translates the house and lets a callsign through untouched;
 * - every other hero carries the roster KEY (`hero.arch.destroyer`), so it must be
 *   translated — rendered raw, the player reads the key itself. The archetype's catalog
 *   name is the same text and is what the selector chips already show, so the header
 *   takes it from there and the two can't drift.
 */
export function heroDisplayName(hero: HeroInst): string {
  const fallback = hero.name ?? hero.id;
  if (hero.grade === 'main') return houseDisplayName(fallback);
  const def = hero.archetype !== undefined ? data.heroes[hero.archetype] : undefined;
  return t(def?.name ?? fallback);
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

const HERO_ACTIVE_CAP = 3; // mirrors the core heroModule's active cap (not exported)
const HERO_BRANCH_RU: Record<string, string> = {
  transhuman: 'hero.branch.transhuman',
  psionic: 'hero.branch.psionic',
};
/** The cooldown slot an ability occupies — mirrors the core's `cooldownKey`. Exported
 *  because the map's command menu shows the same cooldown on the same ability. */
export const heroCdKey = (type: string): string =>
  type === 'temp_lane' ? 'path' : type === 'annihilate' ? 'annihilate' : `fx:${type}`;
// Ability types the prototype kernel can actually resolve: the two heroModule
// built-ins + every `hero.effect.<type>` the kernel's MODULES provide (heroEffects →
// recall/aura/reveal). Types not here have no engine effect yet → the «скоро» badge.
export const HERO_CASTABLE = new Set(['temp_lane', 'annihilate', 'recall', 'aura', 'reveal']);
// STAFF-1 shape: one focused hero + tabs (Обзор / Дерево / Способности / Фиттинги), a
// real branch skill-tree with prereq connectors and per-node states, and a tap-to-open
// dossier that shows what a node/fitting grants BEFORE you buy it.

/** The pane's tabs. A GRID of four pills (2×2), not a strip of equal flex cells: at a
 *  quarter of a phone's width «Способности» had no room and the row read as one grey
 *  smear. `icon` is what makes the grid scannable — same shape as the corp cabinet's. */
export const HERO_TABS: Array<{ key: HeroTab; label: string; icon: string }> = [
  { key: 'overview', label: 'hero.hq.tab.overview', icon: '◈' },
  { key: 'tree', label: 'hero.hq.tab.tree', icon: '⋔' },
  { key: 'abilities', label: 'hero.hq.tab.abilities', icon: '✦' },
  { key: 'fittings', label: 'hero.hq.tab.fittings', icon: '▣' },
];

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
  const active = mine.filter(
    (h) => h.alive !== false && h.fleetId && state.fleets[h.fleetId],
  ).length;
  const hero = mine.find((h) => h.id === view.sel) ?? mine[0]!;
  const def = hero.archetype !== undefined ? data.heroes[hero.archetype] : undefined;
  const dead = hero.alive === false;
  const fleet = !dead && hero.fleetId !== undefined ? state.fleets[hero.fleetId] : undefined;

  // selector chips (one focused hero at a time)
  let chips = `<div class="hx-chips">`;
  for (const h of mine) {
    const d = h.archetype !== undefined ? data.heroes[h.archetype] : undefined;
    const dep = h.alive !== false && h.fleetId && state.fleets[h.fleetId];
    const st =
      h.alive === false ? t('hero.hq.dead') : dep ? t('hero.hq.deployed') : t('hero.hq.reserve');
    chips +=
      `<button class="hx-chip${h.id === hero.id ? ' sel' : ''}${d?.branch === 'psionic' ? ' ps' : ''}" data-hsel="${h.id}">` +
      `<span class="hx-cr">♔</span>${esc(t(d?.name ?? h.archetype ?? h.id))}` +
      `<span class="hx-cst${dep ? ' on' : ''}">${st}</span></button>`;
  }
  chips += `<span class="hx-cap">${t('hero.hq.deployed-count', { a: active, c: HERO_ACTIVE_CAP })}</span></div>`;

  // identity header — name, branch, deploy state, aggregated build bonuses
  const deploy = dead
    ? `<span class="hx-dead">${t('hero.hq.dead')}</span>`
    : fleet
      ? `<span class="hx-dep">⚓ ${esc(typeof fleet.location === 'string' ? fleet.location : t('hero.hq.enroute'))}</span>`
      : `<button class="hx-btn" data-hspawn="${hero.id}" ${active >= HERO_ACTIVE_CAP ? 'disabled' : ''}>${t('hero.hq.deploy')}</button>`;
  const bonuses = (hero.passives ?? [])
    .map((p) => `<span class="hx-trait">${esc(heroPassiveLine(p))}</span>`)
    .join('');
  const slots = def?.slots ?? 0;
  const used = (hero.fittings ?? []).length;
  const fitPips =
    slots > 0
      ? `<span class="hx-trait">${t('hero.hq.fittings')} <span class="hx-pips">${'●'.repeat(used)}${'○'.repeat(Math.max(0, slots - used))}</span></span>`
      : '';
  const ident =
    `<div class="hx-ident${def?.branch === 'psionic' ? ' ps' : ''}">` +
    `<div class="hx-irow"><span class="hx-name">♔ ${esc(heroDisplayName(hero))}</span>` +
    (def?.branch
      ? `<span class="hx-tag">${esc(t(HERO_BRANCH_RU[def.branch] ?? def.branch))}</span>`
      : '') +
    `<span class="hx-dstat">${deploy}</span></div>` +
    (bonuses || fitPips ? `<div class="hx-traits">${bonuses}${fitPips}</div>` : '') +
    `</div>`;

  // tabs
  const tabs =
    `<div class="hx-tabs">` +
    HERO_TABS.map(
      ({ key, label, icon }) =>
        `<button class="hx-tab${view.tab === key ? ' on' : ''}" data-htab="${key}">` +
        `<i>${icon}</i>${t(label)}</button>`,
    ).join('') +
    `</div>`;

  const body =
    view.tab === 'tree'
      ? heroTreeHtml(hero, res)
      : view.tab === 'abilities'
        ? heroAbilitiesHtml(hero, state.time)
        : view.tab === 'fittings'
          ? heroFittingsHtml(hero, res)
          : heroOverviewHtml(hero);

  const dossier = view.dossier ? heroDossierHtml(hero, view.dossier, res) : '';
  return chips + ident + tabs + `<div class="hx-view">${body}</div>` + dossier;
}

/** The skill tree tab — the hero's own rail (own-branch nodes + branch-less «common»
 *  nodes any hero may take) plus a dimmed rail per foreign branch; nodes ordered
 *  roots-first with a prereq connector; tap an own, un-owned node → dossier. */
function heroTreeHtml(hero: HeroInst, res: Bag): string {
  const def = hero.archetype !== undefined ? data.heroes[hero.archetype] : undefined;
  const skills = hero.skills ?? [];
  const entries = Object.entries(data.heroSkillTrees);
  const ownBranch = def?.branch;
  // The hero's rail carries own-branch AND branch-less common nodes (both unlockable),
  // so the tree membership matches heroOverviewHtml's node count. Foreign branches get a
  // dimmed reference rail.
  const ownNodes = entries.filter(([, n]) => n.branch === ownBranch || n.branch === undefined);
  const foreignBranches = Array.from(
    new Set(
      entries
        .map(([, n]) => n.branch)
        .filter((b): b is NonNullable<typeof b> => b !== undefined && b !== ownBranch),
    ),
  ).sort();
  const rails: Array<{ label: string; own: boolean; ps: boolean; nodes: typeof entries }> = [];
  if (ownNodes.length) {
    rails.push({
      label: ownBranch ? (HERO_BRANCH_RU[ownBranch] ?? ownBranch) : 'hero.branch.common',
      own: true,
      ps: ownBranch === 'psionic',
      nodes: ownNodes,
    });
  }
  for (const br of foreignBranches) {
    rails.push({
      label: HERO_BRANCH_RU[br] ?? br,
      own: false,
      ps: br === 'psionic',
      nodes: entries.filter(([, n]) => n.branch === br),
    });
  }
  if (!rails.length) return `<div class="hx-note">${t('hero.tree.empty')}</div>`;
  let html = `<div class="hx-tree">`;
  for (const rail of rails) {
    const rn = rail.nodes
      .slice()
      .sort((a, b) => a[1].requires.length - b[1].requires.length || a[0].localeCompare(b[0]));
    html +=
      `<div class="hx-rail${rail.own ? '' : ' foreign'}${rail.ps ? ' ps' : ''}">` +
      `<div class="hx-rhd"><span class="hx-dot"></span>${esc(t(rail.label))}` +
      (rail.own ? '' : `<span class="hx-ftag">${t('hero.tree.not-your-branch')}</span>`) +
      `</div>`;
    for (const [nid, nd] of rn) {
      const owned = skills.includes(nid);
      const reqMet = nd.requires.every((r) => skills.includes(r));
      let cls = 'hx-node';
      let crest: string;
      let foot: string;
      if (!rail.own) {
        cls += ' foreignn';
        crest = '·';
        foot = `<span class="hx-st">${t('hero.tree.other-branch')}</span>`;
      } else if (owned) {
        cls += ' owned';
        crest = '✓';
        foot = `<span class="hx-st on">✓ ${t('hero.tree.unlocked')}</span>`;
      } else if (!reqMet) {
        cls += ' locked';
        crest = '🔒';
        const need = esc(nd.requires.map((r) => t(data.heroSkillTrees[r]?.name ?? r)).join(', '));
        foot = `<span class="hx-st">${t('hero.tree.needs', { n: need })}</span>`;
      } else {
        cls += ' avail';
        crest = '◆';
        foot = `<span class="hx-cost">${cost(nd.cost, res)}</span>`;
      }
      const conn = nd.requires.length
        ? `<span class="hx-conn${rail.own && reqMet ? ' lit' : ''}"></span>`
        : '';
      const grant = nd.grants.ability
        ? `<span class="hx-g ab">${t('hero.tree.ability')}</span>`
        : nd.grants.passive
          ? `<span class="hx-g pa">${t('hero.tree.passive')}</span>`
          : '';
      const tap = rail.own && !owned ? ` data-hnode="${nid}"` : '';
      html +=
        `<div class="${cls}"${tap}>${conn}<div class="hx-nn"><span class="hx-crest">${crest}</span>${esc(t(nd.name))}</div>` +
        `<div class="hx-nd">${esc(t(nd.description ?? ''))}</div>` +
        `<div class="hx-nf">${grant}${foot}</div></div>`;
    }
    html += `</div>`;
  }
  return html + `</div>`;
}

/** The abilities tab — the hero's equipped, castable loadout (cast via the command flow;
 *  ranged casts arm the map, self/aura fire in place). Spawn-markers show as passive perks. */
function heroAbilitiesHtml(hero: HeroInst, now: number): string {
  const dead = hero.alive === false;
  const abilities = (hero.abilities ?? []).filter(
    (a): a is string => a !== null && !!data.heroAbilities[a],
  );
  if (!abilities.length) return `<div class="hx-note">${t('hero.abil.empty')}</div>`;
  let html = '';
  for (const ab of abilities) {
    const ad = data.heroAbilities[ab]!;
    const cdLeft = Math.max(0, (hero.cooldowns?.[heroCdKey(ad.type)] ?? 0) - now);
    const action = ad.type.startsWith('spawn_')
      ? `<span class="hx-badge">${t('hero.abil.deploy-perk')}</span>`
      : cdLeft > 0
        ? `<span class="hx-badge cd">${t('hero.abil.cooldown', { h: fmtHrs(cdLeft / HOUR) })}</span>`
        : HERO_CASTABLE.has(ad.type)
          ? `<button class="hx-btn" data-hcast="${hero.id}" data-ab="${ab}" ${dead ? 'disabled' : ''}>${(ad.range ?? 0) > 0 ? t('hero.abil.pick-target') : t('hero.abil.activate')}</button>`
          : `<span class="hx-badge">${t('hero.abil.soon')}</span>`;
    html +=
      `<div class="hx-row"><div class="hx-grow"><span class="hx-an">${esc(t(ad.name))}</span>` +
      `<div class="hx-note">${esc(t(ad.description ?? ''))}</div></div>${action}</div>`;
  }
  return html;
}

/** The fittings tab — slot budget as pips, each fitting a row; tap an installable one to
 *  open its dossier (with the irreversibility warning) before committing a slot. */
function heroFittingsHtml(hero: HeroInst, res: Bag): string {
  const def = hero.archetype !== undefined ? data.heroes[hero.archetype] : undefined;
  const slots = def?.slots ?? 0;
  if (slots <= 0) return `<div class="hx-note">${t('hero.fit.none')}</div>`;
  const fitted = hero.fittings ?? [];
  let html = `<div class="hx-h">${t('hero.fit.slots', { u: fitted.length, n: slots })}</div>`;
  for (const [fid, fd] of Object.entries(data.heroFittings)) {
    const installed = fitted.includes(fid);
    const grant = fd.grants.ability
      ? `<span class="hx-g ab">${t('hero.tree.ability')}</span>`
      : fd.grants.passive
        ? `<span class="hx-g pa">${t('hero.tree.passive')}</span>`
        : fd.statMods
          ? `<span class="hx-g pa">${t('hero.fit.hull')}</span>`
          : '';
    const canFit = !installed && fitted.length < slots;
    const action = installed
      ? `<span class="hx-badge on">✓ ${t('hero.fit.installed')}</span>`
      : canFit
        ? `<span class="hx-cost">${cost(fd.cost, res)}</span>`
        : `<span class="hx-badge">${t('hero.fit.no-slots')}</span>`;
    const tap = canFit ? ` data-hfitd="${fid}"` : '';
    html +=
      `<div class="hx-row"${tap}><div class="hx-grow"><span class="hx-an">${esc(t(fd.name))}</span>` +
      `<div class="hx-note">${esc(t(fd.description ?? ''))}</div></div>${grant}${action}</div>`;
  }
  return html;
}

/** The overview tab — archetype line, a stat strip (abilities / tree progress / fittings)
 *  and the hero's live passive bonuses. */
function heroOverviewHtml(hero: HeroInst): string {
  const def = hero.archetype !== undefined ? data.heroes[hero.archetype] : undefined;
  const learned = (hero.skills ?? []).length;
  const treeTotal = Object.values(data.heroSkillTrees).filter(
    (n) => n.branch === undefined || n.branch === def?.branch,
  ).length;
  const abil = (hero.abilities ?? []).filter((a) => a !== null).length;
  let html =
    `<div class="hx-note" style="margin-bottom:10px;">${esc(t(def?.description ?? ''))}</div>` +
    `<div class="hx-ov">` +
    `<div class="hx-ovc"><b>${abil}</b><span>${t('hero.stat.abilities')}</span></div>` +
    `<div class="hx-ovc"><b>${learned}/${treeTotal}</b><span>${t('hero.stat.tree-nodes')}</span></div>` +
    `<div class="hx-ovc"><b>${(hero.fittings ?? []).length}/${def?.slots ?? 0}</b><span>${t('hero.stat.fittings')}</span></div>` +
    `</div>`;
  const bonuses = (hero.passives ?? [])
    .map(
      (p) =>
        `<div class="hx-row"><span class="hx-grow hx-an">${esc(heroPassiveLine(p))}</span><span class="hx-badge on">${t('hero.stat.active')}</span></div>`,
    )
    .join('');
  if (bonuses) html += `<div class="hx-h">${t('hero.stat.bonuses')}</div>${bonuses}`;
  return html;
}

/** The dossier card — what the tapped node/fitting grants, its prereqs and price, and the
 *  commit button (a node's «Изучить», a fitting's irreversible «Установить»). */
function heroDossierHtml(hero: HeroInst, dossier: string, res: Bag): string {
  const def = hero.archetype !== undefined ? data.heroes[hero.archetype] : undefined;
  const dead = hero.alive === false;
  const sep = dossier.indexOf(':');
  const kind = dossier.slice(0, sep);
  const id = dossier.slice(sep + 1);
  const close = `<button class="hx-dx" data-hdclose>✕</button>`;
  if (kind === 'node') {
    const nd = data.heroSkillTrees[id];
    if (!nd) return '';
    const skills = hero.skills ?? [];
    const gAb = nd.grants.ability ? data.heroAbilities[nd.grants.ability] : undefined;
    const give = gAb
      ? `<div class="hx-dgl">${t('hero.tree.grants-ability')}</div><div class="hx-dgv">${esc(t(gAb.name))}${(gAb.range ?? 0) > 0 ? ` · ${t('hero.tree.range', { r: gAb.range })}` : ''}${gAb.cooldownHours ? ` · ${t('hero.tree.cooldown', { h: gAb.cooldownHours })}` : ''}</div><div class="hx-note">${esc(t(gAb.description ?? ''))}</div>`
      : nd.grants.passive
        ? `<div class="hx-dgl">${t('hero.tree.grants-passive')}</div><div class="hx-dgv">${esc(heroPassiveLine(nd.grants.passive))}</div>`
        : '';
    const branchOk = nd.branch === undefined || nd.branch === def?.branch;
    const reqMet = nd.requires.every((r) => skills.includes(r));
    const owned = skills.includes(id);
    const reqHtml = nd.requires
      .map(
        (r) =>
          `<span class="${skills.includes(r) ? 'hx-ok' : 'hx-no'}">${skills.includes(r) ? '✓' : '✗'} ${esc(t(data.heroSkillTrees[r]?.name ?? r))}</span>`,
      )
      .join(' ');
    const canBuy = branchOk && reqMet && !owned && affordable(res, nd.cost) && !dead;
    const btn = owned
      ? `<div class="hx-drow"><span class="hx-ok">✓ ${t('hero.tree.unlocked')}</span></div>`
      : !branchOk
        ? `<div class="hx-drow"><span class="hx-no">${t('hero.tree.other-branch')}</span></div>`
        : `<button class="hx-dbtn" data-hskill="${hero.id}" data-node="${id}" ${canBuy ? '' : 'disabled'}>${t('hero.tree.unlock')} · ${cost(nd.cost, res)}</button>`;
    return (
      `<div class="hx-dossier">` +
      `<div class="hx-dh">${def?.branch ? `<span class="hx-tag">${esc(t(HERO_BRANCH_RU[def.branch] ?? def.branch))}</span>` : ''}<span class="hx-dnm">${esc(t(nd.name))}</span>${close}</div>` +
      (give ? `<div class="hx-give">${give}</div>` : '') +
      (reqHtml
        ? `<div class="hx-drow"><span class="hx-dk">${t('hero.tree.requires')}</span><span class="hx-dv">${reqHtml}</span></div>`
        : '') +
      `<div class="hx-drow"><span class="hx-dk">${t('hero.tree.cost')}</span><span class="hx-cost">${cost(nd.cost, res)}</span></div>` +
      btn +
      `</div>`
    );
  }
  if (kind === 'fit') {
    const fd = data.heroFittings[id];
    if (!fd) return '';
    const fitted = hero.fittings ?? [];
    const slots = def?.slots ?? 0;
    const gAb = fd.grants.ability ? data.heroAbilities[fd.grants.ability] : undefined;
    const give = gAb
      ? `<div class="hx-dgl">${t('hero.tree.grants-ability')}</div><div class="hx-dgv">${esc(t(gAb.name))}</div><div class="hx-note">${esc(t(gAb.description ?? ''))}</div>`
      : fd.grants.passive
        ? `<div class="hx-dgl">${t('hero.tree.grants-passive')}</div><div class="hx-dgv">${esc(heroPassiveLine(fd.grants.passive))}</div>`
        : fd.statMods
          ? `<div class="hx-dgl">${t('hero.fit.hull-mod')}</div><div class="hx-dgv">${esc(
              Object.entries(fd.statMods)
                .map(([k, v]) => `${k} +${v}`)
                .join(', '),
            )}</div>`
          : '';
    const canBuy =
      !fitted.includes(id) && fitted.length < slots && affordable(res, fd.cost) && !dead;
    return (
      `<div class="hx-dossier">` +
      `<div class="hx-dh"><span class="hx-dnm">${esc(t(fd.name))}</span>${close}</div>` +
      (give ? `<div class="hx-give">${give}</div>` : '') +
      `<div class="hx-drow"><span class="hx-dk">${t('hero.tree.cost')}</span><span class="hx-cost">${cost(fd.cost, res)}</span></div>` +
      `<div class="hx-warn">${t('hero.fit.permanent')}</div>` +
      `<button class="hx-dbtn danger" data-hfit="${hero.id}" data-fit="${id}" ${canBuy ? '' : 'disabled'}>${t('hero.fit.install')} · ${cost(fd.cost, res)}</button>` +
      `</div>`
    );
  }
  return '';
}
/** What the hero staff needs from the match screen. */
export interface HeroStaffHost {
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
} {
  let view: HeroView = { sel: null, tab: 'tree', dossier: null };

  const paneHtml = (): string => {
    const state = host.state();
    view = normalizeHeroView(state, host.me(), view);
    const res = state.players[host.me()]?.resources ?? {};
    // The `#herobody` id keeps the `.hx-*` styling the pane was designed against.
    return `<div id="herobody">${heroStaffBodyHtml(state, host.me(), view, res)}</div>`;
  };

  const click = (tg: HTMLElement): 'repaint' | 'close' | null => {
    // STAFF-1 view state: focus a hero / switch tab / open-close the node·fitting dossier.
    const selBtn = tg.closest('[data-hsel]') as HTMLElement | null;
    if (selBtn) {
      view = { ...view, sel: selBtn.dataset.hsel!, dossier: null };
      return 'repaint';
    }
    const htab = (tg.closest('[data-htab]') as HTMLElement | null)?.dataset.htab;
    if (htab) {
      view = { ...view, tab: htab as HeroTab, dossier: null };
      return 'repaint';
    }
    const nodeBtn = tg.closest('[data-hnode]') as HTMLElement | null;
    if (nodeBtn) {
      view = { ...view, dossier: `node:${nodeBtn.dataset.hnode!}` };
      return 'repaint';
    }
    const fitdBtn = tg.closest('[data-hfitd]') as HTMLElement | null;
    if (fitdBtn) {
      view = { ...view, dossier: `fit:${fitdBtn.dataset.hfitd!}` };
      return 'repaint';
    }
    if (tg.closest('[data-hdclose]')) {
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
    const fitBtn = tg.closest('[data-hfit]') as HTMLElement | null;
    if (fitBtn) {
      host.order(fitHero(host.me(), fitBtn.dataset.hfit!, fitBtn.dataset.fit!));
      view = { ...view, dossier: null }; // the fitting is installed — dismiss its dossier
      return 'repaint';
    }
    return null;
  };

  return { paneHtml, click };
}
