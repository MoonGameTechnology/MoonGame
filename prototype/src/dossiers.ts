/**
 * Object dossiers + the build/unit codex (REFM-4).
 *
 * Two neighbouring screens over the same corpus, so they move as one brick:
 *  - **dossiers** — the hover/tap blurbs behind every `data-desc` tag in the side
 *    panel (`"b:<id>:<lvl>"` buildings, `"u:<id>"` units, `"c:…"` construction
 *    orders, `stat:`/`tab:`/`res:` chrome). Lore + LIVE numbers, the numbers wrapped
 *    in `<em class="hl">`.
 *  - **codex** — the full-info card a tile opens (`codexHtml`), which reuses the
 *    dossier body as its description.
 *
 * When you add a new buildable or unit, add its case here too — the panel wires the
 * hover up from the `data-desc` tag alone.
 *
 * Shape (see the REFM method note in docs/backlog.md): `main.ts` has no export
 * surface, so a screen module takes its host dependencies EXPLICITLY. Everything
 * that only needs the catalogue is a plain exported function; the three renderers
 * that read live match state come out of `createDossiers(host)`.
 */
import {
  buildingLevel,
  thresholdRamp,
  COMBAT_UNIT_CAP,
  TAX_OFFICE_BONUS,
  type GameState,
} from '../../packages/shared-core/src/index';
// Straight from the source modules, not through the `game.ts` barrel — same as
// `game.ts` itself sources them, and it keeps this module off the façade.
import { data } from './prototypeData';
import { HOUR } from './time';
import { t, tData } from '../../localization/runtime';
import { GLOSSARY } from './codexIndex';
import { esc, hl, round1, cost, displayUnit, fmtEta } from './format';
import { BUILD_ICON, unitIcon, unitIconHtml } from './icons';
import type { ActiveBuild, BuildKind, BuildLane, PlanetBuildQueue } from './buildQueue';

/** A dossier card: the object's name plus an HTML body (live numbers highlighted). */
export interface Dossier {
  name: string;
  body: string;
}

/** What the dossiers need from the live match screen. */
export interface DossierHost {
  /** The current match state (read fresh on every call — it is replaced, not mutated). */
  state(): GameState;
  /** PC layout? The desktop tooltip shows the name alone; mobile keeps a filler line. */
  pcUi(): boolean;
  /** Your side's colour, for the unit silhouettes in codex cards. */
  youColor(): string;
  queueOf(planetId: string): PlanetBuildQueue;
  activeConstruction(planetId: string, lane: BuildLane): ActiveBuild | null;
  progressPct(active: ActiveBuild): number;
}

export function buildingDossier(id: string, level: number): Dossier | null {
  const def = data.buildings[id];
  if (!def) return null;
  const lv = buildingLevel(def, Math.max(1, level));
  const pct = (n: number) => `+${Math.round(n * 100)}%`;
  const metal = lv.produces.metal ?? 0;
  const credits = lv.produces.credits ?? 0;
  const name = tData(def.name);
  switch (id) {
    case 'mine':
      return {
        name,
        body: t('dossier.building.mine', { m: hl(metal) }),
      };
    case 'refinery':
      return {
        name,
        body: t('dossier.building.refinery', { c: hl(credits) }),
      };
    case 'barracks':
      return {
        name,
        body: t('dossier.building.barracks'),
      };
    case 'radar':
      return {
        name,
        body: t('dossier.building.radar', { r: hl(lv.radarRange ?? 0) }),
      };
    case 'fort':
      return {
        name,
        body: t('dossier.building.fort', { d: hl(pct(lv.defenseBonus ?? 0)), hp: hl(lv.hp) }),
      };
    case 'starfort':
      return {
        name,
        body: t('dossier.building.starfort', { d: hl(pct(lv.defenseBonus ?? 0)), hp: hl(lv.hp) }),
      };
    case 'orbital_aa':
      return {
        name,
        body: t('dossier.building.orbital-aa', { dmg: hl(lv.aaDamage ?? 0) }),
      };
    case 'metal_station':
      return {
        name,
        body: t('dossier.building.metal-station', { m: hl(metal) }),
      };
    case 'tax_office':
      return {
        name,
        body: t('dossier.building.tax-office', { b: hl(pct(TAX_OFFICE_BONUS)) }),
      };
    case 'farm':
      return {
        name,
        body: t('dossier.building.farm', { f: hl(lv.produces.food ?? 0) }),
      };
    case 'power_plant':
      return {
        name,
        body: t('dossier.building.power-plant', { e: hl(lv.produces.energy ?? 0) }),
      };
    case 'fabricator':
      return {
        name,
        body: t('dossier.building.fabricator', { m: hl(lv.produces.microelectronics ?? 0) }),
      };
    default:
      return { name, body: t('dossier.building.default') };
  }
}

/** `pcUi` decides the DEFAULT case only: the desktop tooltip skips an empty body, so
 *  an unnamed unit shows just its name there; mobile's tap-modal keeps a filler line. */
export function unitDossier(id: string, pcUi: boolean): Dossier | null {
  const def = data.units[id];
  if (!def) return null;
  const st = def.stats;
  switch (id) {
    case 'scout':
      return {
        name: t('dossier.unit.scout.name'),
        body: t('dossier.unit.scout.desc', { sp: hl(st.speed), sig: hl(def.signature ?? 1) }),
      };
    case 'cruiser':
      return {
        name: t('dossier.unit.cruiser.name'),
        body: t('dossier.unit.cruiser.desc', {
          a: hl(st.attack),
          hp: hl(st.hp),
          c: hl(st.cargoCapacity ?? 0),
        }),
      };
    case 'siege':
      return {
        name: t('dossier.unit.siege.name'),
        body: t('dossier.unit.siege.desc', {
          a: hl(st.attack),
          r: hl(st.range ?? 0),
          d: hl(st.defense),
        }),
      };
    case 'strike_carrier':
      return {
        name: t('dossier.unit.strike-carrier.name'),
        body: t('dossier.unit.strike-carrier.desc', {
          hp: hl(st.hp),
          c: hl(st.cargoCapacity ?? 0),
        }),
      };
    case 'fighter_squadron':
      return {
        name: t('dossier.unit.fighter-squadron.name'),
        body: t('dossier.unit.fighter-squadron.desc', {
          sp: hl(st.speed),
          a: hl(st.attack),
          hp: hl(st.hp),
          r: hl(st.strikeRange ?? 0),
        }),
      };
    case 'hero':
      return {
        name: t('dossier.unit.hero.name'),
        body: t('dossier.unit.hero.desc', { a: hl(st.attack), hp: hl(st.hp), b: hl('+5%') }),
      };
    default:
      return { name: displayUnit(id), body: pcUi ? '' : t('dossier.unit.default') };
  }
}

/** The unit's display name as the UI shows it everywhere: its dossier title when the
 *  unit has one, else the plain data name. Layout-independent on purpose — `pcUi` only
 *  ever decided the dossier BODY, so a caller that wants just the name needs no host. */
export function unitTitle(id: string): string {
  return unitDossier(id, true)?.name ?? displayUnit(id);
}

/** "+10 металл/ч, +5 кредиты/ч" — the always-visible output readout on a built
 *  building's row (not just on hover). Empty string for a produces-less building
 *  (defense/radar/etc.), so the row's dim-text separator (" · ") is skipped. */
export function producesLine(produces: Record<string, number>): string {
  return Object.entries(produces)
    .filter(([, n]) => (n ?? 0) > 0)
    .map(([res, n]) => `+${round1(n ?? 0)} ${tData(res)}/ч`)
    .join(', ');
}

/** Dossier for an in-flight/queued/paused construction/upgrade/unit order — "what is
 *  this, what does it yield NOW vs once finished". `progress` is 0 for a not-yet-
 *  started queued order, the live 0..1 fraction for an active one, or the frozen
 *  `PausedConstructionSite.progress` for a paused one; `remainingH` is null only for
 *  a queued order (it hasn't started, so there's no ETA yet). The same base+delta×ramp
 *  formula construction.ts/economy.ts use: for a fresh building `base` is 0 (nothing
 *  exists below the threshold), for an upgrade `base` is the CURRENT level's output
 *  (already running in full) and only the delta to the target level ramps in. */
export function taskDossier(
  state: GameState,
  planetId: string,
  kind: BuildKind,
  building: string | undefined,
  unit: string | undefined,
  count: number | undefined,
  level: number | undefined,
  progress: number,
  remainingH: number | null,
): Dossier {
  const eta =
    remainingH !== null
      ? t('dossier.task.eta', { r: hl(fmtEta(remainingH)) })
      : t('dossier.task.queued');
  if (kind === 'unit' && unit) {
    return {
      name: `${count ?? 1}× ${unitIcon(unit, data)} ${displayUnit(unit)}`,
      body: [eta, t('dossier.task.unit-ready')].join('<br>'),
    };
  }
  if (!building) return { name: t('dossier.task.title'), body: eta };
  const def = data.buildings[building];
  if (!def) return { name: building, body: eta };
  const name =
    kind === 'upgrade'
      ? `${BUILD_ICON[building] ?? '▣'} ${tData(def.name)} → L${level ?? '?'}`
      : `${BUILD_ICON[building] ?? '▣'} ${tData(def.name)}`;
  const ramp = thresholdRamp(progress);
  let base: Record<string, number> = {};
  let final: Record<string, number>;
  if (kind === 'upgrade' && typeof level === 'number') {
    const instance = state.planets[planetId]?.buildings.find((b) => b.type === building);
    base = instance ? buildingLevel(def, instance.level).produces : {};
    final = buildingLevel(def, level).produces;
  } else {
    final = buildingLevel(def, 1).produces;
  }
  const lines: string[] = [];
  for (const res of new Set([...Object.keys(base), ...Object.keys(final)])) {
    const b = base[res] ?? 0;
    const f = final[res] ?? 0;
    if (b === 0 && f === 0) continue;
    const now = b + (f - b) * ramp;
    lines.push(
      t('dossier.task.output', {
        r: tData(res),
        now: hl(round1(now)),
        final: hl(round1(f)),
      }),
    );
  }
  return { name, body: [eta, ...lines].join('<br>') };
}

/** One stat row for the codex popup. */
export function cxRow(k: string, v: string): string {
  return `<div class="cx-row"><span class="cx-k">${k}</span><span class="cx-v">${v}</span></div>`;
}

/** Wire the live-state renderers to the match screen. The pure exports above need no
 *  host and are imported directly. */
export function createDossiers(host: DossierHost): {
  constructionDossier: (key: string) => Dossier | null;
  objDossier: (key: string) => Dossier | null;
  codexHtml: (kind: string, id: string) => string;
} {
  const unitDos = (id: string): Dossier | null => unitDossier(id, host.pcUi());

  function constructionDossier(key: string): Dossier | null {
    const s = host.state();
    const [, planetId, lane, state, ref] = key.split(':');
    if (!planetId || !lane || !state || ref === undefined) return null;
    if (state === 'active') {
      const active = host.activeConstruction(planetId, lane as BuildLane);
      if (!active || String(active.seq) !== ref) return null;
      const p = active.payload;
      return taskDossier(
        s,
        planetId,
        (p.kind ?? 'building') as BuildKind,
        p.building,
        p.unit,
        p.count,
        p.level,
        host.progressPct(active) / 100,
        Math.max(0, (active.at - s.time) / HOUR),
      );
    }
    if (state === 'queued') {
      const q = host.queueOf(planetId)[lane as BuildLane][Number(ref)];
      if (!q) return null;
      const level =
        q.kind === 'upgrade'
          ? (s.planets[planetId]?.buildings.find((b) => b.type === q.id)?.level ?? 0) + 1
          : undefined;
      return taskDossier(
        s,
        planetId,
        q.kind,
        q.kind === 'unit' ? undefined : q.id,
        q.kind === 'unit' ? q.id : undefined,
        q.count,
        level,
        0,
        null,
      );
    }
    if (state === 'paused') {
      const site = (s.planets[planetId]?.pausedConstruction ?? []).find(
        (p) => String(p.id) === ref,
      );
      if (!site) return null;
      return taskDossier(
        s,
        planetId,
        site.kind,
        site.building,
        site.unit,
        site.count,
        site.level,
        site.progress,
        site.remainingHours,
      );
    }
    return null;
  }

  function objDossier(key: string): Dossier | null {
    if (key === 'fleet') {
      return {
        name: t('dossier.fleet.name'),
        body: t('dossier.fleet.desc'),
      };
    }
    if (key === 'tab:ground') {
      // The ЗЕМЛЯ tab's hover dossier — carries what used to be the tab's bottom hint.
      return {
        name: t('dossier.tab.ground.name'),
        body: t('dossier.tab.ground.desc'),
      };
    }
    if (key === 'tab:ships') {
      return {
        name: t('dossier.tab.ships.name'),
        body: t('dossier.tab.ships.desc'),
      };
    }
    if (key === 'tab:squadron') {
      return {
        name: t('dossier.tab.squadron.name'),
        body: t('dossier.tab.squadron.desc'),
      };
    }
    if (key === 'tab:buildings') {
      return {
        name: t('dossier.tab.buildings.name'),
        body: t('dossier.tab.buildings.desc'),
      };
    }
    if (key === 'division') {
      return {
        name: t('dossier.division.name'),
        body: t('dossier.division.desc'),
      };
    }
    if (key.startsWith('stat:')) {
      const STAT_DOSSIER: Record<string, [string, string]> = {
        atk: [t('dossier.stat.atk.name'), t('dossier.stat.atk.desc')],
        def: [t('dossier.stat.def.name'), t('dossier.stat.def.desc')],
        hp: [t('dossier.stat.hp.name'), t('dossier.stat.hp.desc')],
        cap: [
          t('dossier.stat.cap.name'),
          t('dossier.stat.cap.desc', {
            n: COMBAT_UNIT_CAP,
          }),
        ],
        hull: [t('dossier.stat.hull.name'), t('dossier.stat.hull.desc')],
        shield: [t('dossier.stat.shield.name'), t('dossier.stat.shield.desc')],
        spd: [t('dossier.stat.spd.name'), t('dossier.stat.spd.desc')],
        garrison: [t('dossier.stat.garrison.name'), t('dossier.stat.garrison.desc')],
        ground: [t('dossier.stat.ground.name'), t('dossier.stat.ground.desc')],
        gships: [t('dossier.stat.gships.name'), t('dossier.stat.gships.desc')],
        pbuild: [t('dossier.stat.pbuild.name'), t('dossier.stat.pbuild.desc')],
        datk: [t('dossier.stat.datk.name'), t('dossier.stat.datk.desc')],
        ddef: [t('dossier.stat.ddef.name'), t('dossier.stat.ddef.desc')],
        dhp: [t('dossier.stat.dhp.name'), t('dossier.stat.dhp.desc')],
      };
      const d = STAT_DOSSIER[key.slice(5)];
      return d ? { name: d[0], body: d[1] } : null;
    }
    if (key.startsWith('res:')) {
      // Resource glyph → the resource's localized name (data name, e.g. metal/credits).
      const r = key.slice(4);
      return { name: tData(r), body: '' };
    }
    if (key === 'act:divdesign') {
      return {
        name: t('dossier.divdesign.name'),
        body: t('dossier.divdesign.desc'),
      };
    }
    if (key.startsWith('c:')) return constructionDossier(key);
    const [kind, id, lvl] = key.split(':');
    if (id === undefined) return null; // bare "b"/"u" key with no id — nothing to show
    if (kind === 'b') return buildingDossier(id, Number(lvl) || 1);
    if (kind === 'u') return unitDos(id);
    return null;
  }

  /** Full info card — cost + every stat + the lore blurb — for a building ('b') or unit ('u'). */
  function codexHtml(kind: string, id: string): string {
    if (kind === 'm') {
      // ONB-4 glossary article — a short mechanic/term explainer (plain text copy).
      const g = GLOSSARY.find((x) => x.id === id);
      if (!g) return '';
      return (
        `<div class="cx-head"><span class="cx-ic">?</span><b>${esc(t(g.titleKey))}</b><span class="cx-tag">${t('codex.tag.mechanic')}</span></div>` +
        `<div class="cx-desc">${esc(t(g.bodyKey))}</div>`
      );
    }
    if (kind === 'b') {
      const def = data.buildings[id];
      if (!def) return '';
      const lv = buildingLevel(def, 1);
      const maxLvl = 1 + (def.upgrades?.length ?? 0);
      const rows = [
        cxRow(t('codex.row.cost'), cost(def.cost)),
        cxRow(t('codex.row.build-time'), t('codex.value.hours', { n: def.buildTimeHours ?? 0 })),
        cxRow(t('codex.row.hp'), String(def.hp ?? 0)),
      ];
      const prod = Object.entries(lv.produces ?? {})
        .filter(([, n]) => (n ?? 0) > 0)
        .map(([r, n]) => t('codex.value.per-hour', { n: n ?? 0, r: tData(r) }))
        .join(', ');
      if (prod) rows.push(cxRow(t('codex.row.produces'), prod));
      const keep = Object.entries(lv.upkeep ?? {})
        .filter(([, n]) => (n ?? 0) > 0)
        .map(([r, n]) => t('codex.value.per-day', { n: n ?? 0, r: tData(r) }))
        .join(', ');
      if (keep) rows.push(cxRow(t('codex.row.upkeep'), keep));
      if ((lv.defenseBonus ?? 0) > 0.01)
        rows.push(
          cxRow(t('codex.row.garrison-defense'), `+${Math.round((lv.defenseBonus ?? 0) * 100)}%`),
        );
      if ((lv.aaDamage ?? 0) > 0) rows.push(cxRow(t('codex.row.aa'), String(lv.aaDamage)));
      if ((lv.radarRange ?? 0) > 0) rows.push(cxRow(t('codex.row.radar'), String(lv.radarRange)));
      if ((def.scoreValue ?? 0) > 0)
        rows.push(
          cxRow(t('codex.row.score'), t('codex.value.per-level', { n: def.scoreValue ?? 0 })),
        );
      rows.push(
        cxRow(
          t('codex.row.levels'),
          maxLvl > 1 ? t('codex.value.levels-upgradable', { n: maxLvl }) : '1',
        ),
      );
      const dos = buildingDossier(id, 1);
      return (
        `<div class="cx-head"><span class="cx-ic">${BUILD_ICON[id] ?? '▣'}</span><b>${esc(tData(def.name))}</b><span class="cx-tag">${t('codex.tag.building')}</span></div>` +
        `<div class="cx-stats">${rows.join('')}</div><div class="cx-desc">${dos?.body ?? ''}</div>`
      );
    }
    // ARS-5: module/hero-fitting cards deep-link here too — the arsenal witryna is the
    // first caller for kinds the codex never covered (only units/buildings had pages).
    if (kind === 'md') {
      const def = data.modules[id];
      if (!def) return '';
      const rows = [
        cxRow(t('codex.row.slot'), tData(def.slot)),
        cxRow(t('codex.row.cost'), cost(def.cost)),
      ];
      for (const [k, v] of Object.entries(def.effects?.stats ?? {}))
        rows.push(cxRow(tData(k), String(v)));
      return (
        `<div class="cx-head"><span class="cx-ic">◆</span><b>${esc(tData(def.name))}</b><span class="cx-tag">${t('codex.tag.module')}</span></div>` +
        `<div class="cx-stats">${rows.join('')}</div>`
      );
    }
    if (kind === 'hf') {
      const def = data.heroFittings[id];
      if (!def) return '';
      const rows = [cxRow(t('codex.row.cost'), cost(def.cost))];
      for (const [k, v] of Object.entries(def.statMods ?? {}))
        rows.push(cxRow(tData(k), (v > 0 ? '+' : '') + String(v)));
      return (
        `<div class="cx-head"><span class="cx-ic">◆</span><b>${esc(tData(def.name))}</b><span class="cx-tag">${t('codex.tag.fitting')}</span></div>` +
        `<div class="cx-stats">${rows.join('')}</div><div class="cx-desc">${esc(t(def.description ?? ''))}</div>`
      );
    }
    const def = data.units[id];
    if (!def) return '';
    const st = def.stats;
    const rows = [
      cxRow(t('codex.row.cost'), cost(def.cost)),
      cxRow(t('codex.row.build-time'), t('codex.value.hours', { n: def.buildTimeHours ?? 0 })),
      cxRow(t('codex.row.atk-def'), `${st.attack ?? 0} / ${st.defense ?? 0}`),
      cxRow(t('codex.row.hull'), String(st.hp ?? 0)),
    ];
    if ((st.speed ?? 0) > 0) rows.push(cxRow(t('codex.row.speed'), String(st.speed)));
    if ((st.range ?? 0) > 0) rows.push(cxRow(t('codex.row.range'), String(st.range)));
    if ((st.cargoCapacity ?? 0) > 0)
      rows.push(cxRow(t('codex.row.cargo'), String(st.cargoCapacity)));
    if ((st.aaDamage ?? 0) > 0) rows.push(cxRow(t('codex.row.aa'), String(st.aaDamage)));
    rows.push(cxRow(t('codex.row.signature'), String(def.signature ?? 1)));
    if ((def.radarRange ?? 0) > 0) rows.push(cxRow(t('codex.row.radar'), String(def.radarRange)));
    const upkeep = Object.entries(def.upkeep ?? {})
      .map(([r, n]) => t('codex.value.per-day', { n: n ?? 0, r: tData(r) }))
      .join(', ');
    if (upkeep) rows.push(cxRow(t('codex.row.upkeep'), upkeep));
    // Домен и трейты могут нести один и тот же ключ (у наземных юнитов domain:
    // 'ground' И трейт 'ground' — два разных механических флага, см. fleetLaunch
    // vs fleetOps), а игроку это одна и та же «земля» — схлопываем дубли.
    const tags = [
      ...new Set([def.domain ?? 'space', def.line, ...(def.traits ?? [])].filter((x): x is string => !!x)),
    ]
      .map((x) => tData(x))
      .join(', ');
    if (tags) rows.push(cxRow(t('codex.row.class'), tags));
    const dos = unitDos(id);
    return (
      `<div class="cx-head"><span class="cx-ic">${unitIconHtml(id, data, host.youColor(), 24)}</span><b>${esc(dos?.name ?? displayUnit(id))}</b><span class="cx-tag">${def.domain === 'ground' ? t('codex.tag.ground-unit') : t('codex.tag.ship')}</span></div>` +
      `<div class="cx-stats">${rows.join('')}</div><div class="cx-desc">${dos?.body ?? ''}</div>`
    );
  }

  return { constructionDossier, objDossier, codexHtml };
}
