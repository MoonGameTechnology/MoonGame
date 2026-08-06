/**
 * «Верфь» — the unified in-match loadout tab (CON-1, LARS-4, REFM-13).
 *
 * One window with three panes: «Корабли» and «Эскадрильи» are the same loadout
 * constructor over different hull families, «Герои» is the hero штаб the host still
 * owns (it folds in with its own brick — this module only asks the host for its
 * markup and hands hero clicks straight back).
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
import type { Action, ArsenalItem, GameState } from '../../packages/shared-core/src/index';
import { t, tData } from '../../localization/runtime';
import { data } from './prototypeData';
import { esc, displayUnit } from './format';
import { unitIconHtml } from './icons';
import { SECTOR_TYPES } from './map';
import { originOf } from './arsenal';
import { originLabel } from './arsenalScreen';
import { buildShip } from './actions';
import {
  createLoadoutEditor,
  applyLoadoutAction,
  type LoadoutModel,
  type LoadoutStatLine,
  type LoadoutEditorResult,
} from '../../packages/client/src/loadoutEditor';

export type YardTab = 'ships' | 'squads' | 'heroes';

const YARD_TABS: [YardTab, string][] = [
  ['ships', 'yard.tab.ships'],
  ['squads', 'yard.tab.squads'],
  ['heroes', 'yard.tab.heroes'],
];

/** Buildable space hulls the «Корабли» pane fits; squadron/carrier hulls → «Эскадрильи». */
export const YARD_HULLS = ['cruiser', 'siege', 'scout', 'sensor_frigate', 'dropship'];
export const YARD_SQUAD_HULLS = ['fighter_squadron', 'strike_carrier'];

/** How many hulls one order may queue at once (the ± stepper's range). */
const MAX_COUNT = 20;

const SLOT_KEY: Record<string, string> = {
  weapon: 'yard.slot.weapon',
  defense: 'yard.slot.defense',
  utility: 'yard.slot.utility',
};
const SLOT_ICON: Record<string, string> = { weapon: '🎯', defense: '🛡', utility: '⊞' };
const MODULE_ICON: Record<string, string> = {
  targeting_array: '🎯',
  shield_booster: '🛡',
  ablative_plating: '🧱',
  ion_engine: '🚀',
  radar_module: '📡',
  cargo_bay: '📦',
};
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
};

/** The order being composed: which hull, what is bolted on, how many, where. Plain
 *  data, so the pane can be rendered (and asserted) without a window. */
export interface YardDraft {
  hull: string;
  modules: string[];
  count: number;
  planet: string;
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

/** LARS-4 — a small "откуда" tag for a Верфь card, from whatever the hub Arsenal
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

/** Worlds of yours that can take a build order (buildable sector kinds only). */
function buildablePlanets(state: GameState, me: string) {
  return Object.values(state.planets).filter(
    (p) => p.owner === me && SECTOR_TYPES[p.kind ?? '']?.buildable,
  );
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
  const worlds = buildablePlanets(state, me);
  if (!next.planet || !worlds.some((p) => p.id === next.planet)) next.planet = worlds[0]?.id ?? '';
  return next;
}

/** The loadout constructor pane for a family of hulls (ships or squadrons) — same
 *  `loadoutEditor` view-model, just a different hull list. Expects an already
 *  normalised draft. */
export function loadoutPaneHtml(
  state: GameState,
  me: string,
  draft: YardDraft,
  hullList: string[],
  view: { youColor: string; arsenalItems: readonly ArsenalItem[] },
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
    .map(
      (h) =>
        `<button class="cn-hbtn${h === draft.hull ? ' on' : ''}" data-cnhull="${h}">${unitIconHtml(h, data, view.youColor, 18)} ${esc(displayUnit(h))}</button>`,
    )
    .join('');
  const freeTypes = [...new Set(m.slots.filter((sl) => !sl.moduleId).map((sl) => sl.type))];
  const hullCard =
    `<div class="cn-hull"><div class="cn-hic">${unitIconHtml(draft.hull, data, view.youColor, 40)}</div><div><div class="cn-hn">${esc(displayUnit(draft.hull))}</div>` +
    `<div class="cn-hm">${t('yard.slots.count', { n: String(m.slots.length) })}</div></div></div>`;
  const bays = m.slots
    .map((sl) => {
      if (sl.moduleId) {
        const md = data.modules[sl.moduleId];
        const eff = md
          ? Object.entries(md.effects.stats)
              .map(([k, v]) => `+${v} ${t(STAT_KEY[k] ?? k)}`)
              .join(' ')
          : '';
        return (
          `<div class="cn-bay filled" data-cnun="${sl.moduleId}" title="${t('yard.module.remove')}"><div class="cn-bic">${MODULE_ICON[sl.moduleId] ?? '▪'}</div>` +
          `<div><div class="cn-bt">${t(SLOT_KEY[sl.type] ?? sl.type)}</div><div class="cn-bn">${esc(tData(sl.moduleName ?? sl.moduleId))}${originTagHtml(view.arsenalItems, sl.moduleId)}</div></div><div class="cn-bd">${eff}</div></div>`
        );
      }
      return (
        `<div class="cn-bay empty"><div class="cn-bic">${SLOT_ICON[sl.type] ?? '＋'}</div>` +
        `<div><div class="cn-bt">${t(SLOT_KEY[sl.type] ?? sl.type)}</div><div class="cn-bn">${t('yard.slot.empty')}</div></div></div>`
      );
    })
    .join('');
  const palette = m.palette
    .map((o) => {
      const eff = Object.entries(o.effect)
        .map(([k, v]) => `+${v} ${t(STAT_KEY[k] ?? k)}`)
        .join(' ');
      if (o.installable) {
        return (
          `<button class="cn-mod" data-cnmod="${o.id}"><span class="cn-mic">${MODULE_ICON[o.id] ?? '▪'}</span>` +
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
        `<div class="cn-mod locked"><span class="cn-mic">${MODULE_ICON[o.id] ?? '▪'}</span>` +
        `<span class="cn-mn">${esc(tData(o.name))}</span><span class="cn-me">${why}</span><span class="cn-mc">${bagText(o.cost)}</span></div>`
      );
    })
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
  const worlds = buildablePlanets(state, me);
  const planOpts = worlds
    .map(
      (p) =>
        `<option value="${p.id}"${p.id === draft.planet ? ' selected' : ''}>${esc(p.id)}</option>`,
    )
    .join('');
  const cost =
    `<div class="cn-cost">` +
    `<div class="cn-crow"><span class="cn-cl">${t('yard.cost.hull', { n: String(m.count) })}</span><span class="cn-cv">${bagText(m.hullCost)}</span></div>` +
    (draft.modules.length
      ? `<div class="cn-crow"><span class="cn-cl">${t('yard.cost.modules', { n: String(m.count) })}</span><span class="cn-cv">${bagText(m.modulesCost)}</span></div>`
      : '') +
    `<div class="cn-crow total"><span class="cn-cl">${t('yard.cost.total')}</span><span class="cn-cv">${bagText(m.totalCost)}</span></div></div>`;
  const canBuild = m.affordable && draft.planet !== '';
  const right =
    `<div class="cn-side"><div class="cn-ph">${t('yard.cost.with-modules')} — <em>${t('yard.cost.live')}</em></div>${bars}${cost}` +
    `<div class="cn-row2"><div class="cn-step"><button data-cncount="-" ${draft.count <= 1 ? 'disabled' : ''}>−</button><span class="cn-sv">${draft.count}</span><button data-cncount="+" ${draft.count >= MAX_COUNT ? 'disabled' : ''}>+</button></div>` +
    `<select class="cn-plan" id="cn-planet"${worlds.length ? '' : ' disabled'}>${planOpts || `<option>${t('yard.no-worlds')}</option>`}</select></div>` +
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

/** What the Верфь needs from the match screen. */
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
  /** Toast line (build confirmations, refused fits). */
  note(msg: string): void;
  /** Localized text of a reducer error code — the host owns that vocabulary. */
  errText(code: string): string;
  /** The hub Arsenal's cached collection, for the LARS-4 "откуда" tags. */
  arsenalItems(): readonly ArsenalItem[];
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
  open: () => void;
  render: () => void;
  close: () => void;
} {
  let tab: YardTab = 'ships';
  let draft: YardDraft = { hull: YARD_HULLS[0]!, modules: [], count: 1, planet: '' };

  const hullsOf = (): string[] => (tab === 'squads' ? YARD_SQUAD_HULLS : YARD_HULLS);
  const close = (): void => host.root().classList.remove('show');

  function paint(): void {
    let body: string;
    if (tab === 'heroes') {
      body = host.heroPaneHtml();
    } else {
      draft = normalizeDraft(host.state(), host.me(), draft, hullsOf());
      body = loadoutPaneHtml(host.state(), host.me(), draft, hullsOf(), {
        youColor: host.youColor(),
        arsenalItems: host.arsenalItems(),
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
      draft = { ...draft, hull, modules: [] }; // a fresh draft per hull (its slot types differ)
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
        host.order(buildShip(host.me(), draft.planet, draft.hull, draft.count, draft.modules));
        host.note(t('yard.ordered', { n: String(draft.count), hull: displayUnit(draft.hull) }));
      }
    }
  });

  host.root().addEventListener('change', (e) => {
    const sel = e.target as HTMLSelectElement;
    if (sel.id === 'cn-planet') draft = { ...draft, planet: sel.value };
  });

  return {
    open: () => {
      host.root().classList.add('show');
      paint();
      host.onOpen();
    },
    render: paint,
    close,
  };
}
