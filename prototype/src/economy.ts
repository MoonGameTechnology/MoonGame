/**
 * Prototype-side economy readouts — the HUD/observation-pipeline mirror of the
 * core's economy hooks (planetType/tax/economy), read straight off `GameState`
 * without going through a kernel tick. Extracted from `game.ts` (REFP-19):
 * `economySnapshot`/`netIncome`/`hpOfLevel` had no internal deps beyond `data` +
 * shared-core utils + `tax.ts` (REFP-4). `HOUR` stays imported FROM `game.ts` (a
 * plain re-exported constant, read only inside a function body here, so the
 * reverse edge doesn't race module init). `game.ts` imports all three and
 * re-exports them for `main.ts` / `netserver.ts` / tests.
 */
import {
  type GameState,
  isBombarded,
  buildingLevel,
  BROWNOUT,
  buildProgress,
  thresholdRamp,
} from '../../packages/shared-core/src/index';
import { isInhabited, civicTax, inhabitedWorldCount, TAX_OFFICE_BONUS } from './tax';
import { data } from './prototypeData';
import { HOUR } from './time';

/** ECON-6: почасовой экономический срез для пайплайна наблюдений хоста — казна /
 *  чистый приток / arrears per player на мировом времени `state.time`. Чистая
 *  функция состояния: кривые пишет JSONL хоста, headline-счётчики — агрегатор. */
export function economySnapshot(state: GameState): {
  kind: 'economy';
  atTime: number;
  players: Record<
    string,
    { resources: Record<string, number>; netPerHour: Record<string, number>; arrears: string[] }
  >;
} {
  const players: Record<
    string,
    { resources: Record<string, number>; netPerHour: Record<string, number>; arrears: string[] }
  > = {};
  for (const [pid, pl] of Object.entries(state.players)) {
    players[pid] = {
      resources: { ...pl.resources },
      netPerHour: netIncome(state, pid),
      arrears: [...(pl.arrears ?? [])],
    };
  }
  return { kind: 'economy', atTime: state.time, players };
}

/** Net per-hour income for a player: production from owned, un-bombarded worlds
 *  (brownout-dimmed like the core) minus unit/garrison AND building upkeep
 *  (daily ÷ 24). Drives the HUD's `+/h` deltas. */
export function netIncome(state: GameState, playerId: string): Record<string, number> {
  const out: Record<string, number> = {};
  const arrears = state.players[playerId]?.arrears ?? [];
  const inhabited = inhabitedWorldCount(state, playerId); // for the diminishing civic tax
  // BF-35: mirror the faction + tech `economy.production` hooks (factionModule /
  // technologyModule) — the HUD `+/h` used to apply only the planetType bonus, so a
  // production-boosted player (e.g. a +12% faction) saw a low readout from minute one.
  const me = state.players[playerId];
  const factionBonus = me?.faction
    ? (data.factions[me.faction]?.passives?.productionBonus ?? 0)
    : 0;
  let techBonus = 0;
  for (const id of me?.technologies?.completed ?? [])
    techBonus += data.technologies[id]?.effects?.productionBonus ?? 0;
  const bonusMult = (1 + factionBonus) * (1 + techBonus);
  for (const p of Object.values(state.planets)) {
    if (p.owner !== playerId || isBombarded(state, p.id)) continue;
    const mult =
      (1 + (p.planetType ? (data.planetTypes[p.planetType]?.productionBonus ?? 0) : 0)) * bonusMult;
    // Credits are settled per-planet so the civic tax + Tax Office boost mirror the
    // core's economy.production pipeline (taxModule); metal accrues straight to `out`.
    let credits = 0;
    // ECON-7: passive per-type base output, mirrored from the core's planetTypeModule
    // (scaled by the world's richness incl. productionByResource; base credits routed
    // through the tax accumulator so a Tax Office boosts them too).
    const ptDef = p.planetType ? data.planetTypes[p.planetType] : undefined;
    const ptByRes = ptDef?.productionByResource ?? {};
    for (const res of Object.keys(ptDef?.baseOutput ?? {})) {
      const v = (ptDef!.baseOutput[res] ?? 0) * mult * (1 + (ptByRes[res] ?? 0));
      if (res === 'credits') credits += v;
      else out[res] = (out[res] ?? 0) + v;
    }
    for (const b of p.buildings) {
      const def = data.buildings[b.type];
      if (!def) continue;
      const level = buildingLevel(def, b.level);
      // Mirror the core's brownout: a building starved of an arrears resource shows
      // its dimmed output, so the top-bar flow matches what actually accrues.
      const starved =
        arrears.length > 0 &&
        Object.keys(level.upkeep).some((r) => (level.upkeep[r] ?? 0) > 0 && arrears.includes(r));
      const bMult = mult * (starved ? BROWNOUT : 1);
      for (const res of Object.keys(level.produces)) {
        const v = (level.produces[res] ?? 0) * bMult;
        if (res === 'credits') credits += v;
        else out[res] = (out[res] ?? 0) + v;
      }
      // …and its running cost (daily → hourly), same drain the settlement applies.
      for (const res of Object.keys(level.upkeep))
        out[res] = (out[res] ?? 0) - (level.upkeep[res] ?? 0) / 24;
    }
    // Constructions in progress (≥50% built) chip in a partial/delta share too —
    // mirrors economy.ts's `pendingProduction` ramp rule. Point-evaluated (not
    // integrated) since this is a live HUD rate, not an accrual over a span; no
    // upkeep is charged on an unfinished building either, so no brownout applies here.
    for (const event of state.scheduled) {
      if (event.type !== 'construction.complete') continue;
      const cp = event.payload as {
        kind?: 'building' | 'unit' | 'upgrade';
        planetId?: string;
        building?: string;
        level?: number;
      };
      if (cp.planetId !== p.id) continue;
      if (cp.kind === 'building' && typeof cp.building === 'string') {
        const def = data.buildings[cp.building];
        if (!def) continue;
        const level1 = buildingLevel(def, 1);
        const ramp = thresholdRamp(
          buildProgress(state.time, event.at, level1.buildTimeHours * HOUR),
        );
        if (ramp <= 0) continue;
        for (const res of Object.keys(level1.produces)) {
          const v = (level1.produces[res] ?? 0) * ramp * mult;
          if (res === 'credits') credits += v;
          else out[res] = (out[res] ?? 0) + v;
        }
      } else if (
        cp.kind === 'upgrade' &&
        typeof cp.building === 'string' &&
        typeof cp.level === 'number'
      ) {
        const def = data.buildings[cp.building];
        const instance = p.buildings.find((b) => b.type === cp.building);
        if (!def || !instance) continue;
        const current = buildingLevel(def, instance.level);
        const target = buildingLevel(def, cp.level);
        const ramp = thresholdRamp(
          buildProgress(state.time, event.at, target.buildTimeHours * HOUR),
        );
        if (ramp <= 0) continue;
        const resources = new Set([
          ...Object.keys(current.produces),
          ...Object.keys(target.produces),
        ]);
        for (const res of resources) {
          const delta = ((target.produces[res] ?? 0) - (current.produces[res] ?? 0)) * ramp * mult;
          if (delta === 0) continue;
          if (res === 'credits') credits += delta;
          else out[res] = (out[res] ?? 0) + delta;
        }
      }
    }
    // A PAUSED site keeps its frozen share too — pausing halts further construction,
    // not the share of the building already standing (mirrors economy.ts's
    // `pausedProduction`: same threshold rule, held flat at `site.progress`).
    for (const site of p.pausedConstruction ?? []) {
      const ramp = thresholdRamp(site.progress);
      if (ramp <= 0) continue;
      if (site.kind === 'building' && typeof site.building === 'string') {
        const def = data.buildings[site.building];
        if (!def) continue;
        const level1 = buildingLevel(def, 1);
        for (const res of Object.keys(level1.produces)) {
          const v = (level1.produces[res] ?? 0) * ramp * mult;
          if (res === 'credits') credits += v;
          else out[res] = (out[res] ?? 0) + v;
        }
      } else if (
        site.kind === 'upgrade' &&
        typeof site.building === 'string' &&
        typeof site.level === 'number'
      ) {
        const def = data.buildings[site.building];
        const instance = p.buildings.find((b) => b.type === site.building);
        if (!def || !instance) continue;
        const current = buildingLevel(def, instance.level);
        const target = buildingLevel(def, site.level);
        const resources = new Set([
          ...Object.keys(current.produces),
          ...Object.keys(target.produces),
        ]);
        for (const res of resources) {
          const delta = ((target.produces[res] ?? 0) - (current.produces[res] ?? 0)) * ramp * mult;
          if (delta === 0) continue;
          if (res === 'credits') credits += delta;
          else out[res] = (out[res] ?? 0) + delta;
        }
      }
    }
    if (isInhabited(p)) {
      credits += civicTax(inhabited) * bonusMult; // civic tax is post-tax income → also boosted (BF-35)
      if (p.buildings.some((b) => b.type === 'tax_office')) credits *= 1 + TAX_OFFICE_BONUS;
    }
    if (credits !== 0) out.credits = (out.credits ?? 0) + credits;
  }
  const addUpkeep = (stacks: Array<{ unit: string; count: number }>) => {
    for (const st of stacks) {
      const def = data.units[st.unit];
      if (!def) continue;
      for (const res of Object.keys(def.upkeep))
        out[res] = (out[res] ?? 0) - ((def.upkeep[res] ?? 0) * st.count) / 24;
    }
  };
  for (const f of Object.values(state.fleets))
    if (f.owner === playerId) {
      addUpkeep(f.units);
      if (f.landing) addUpkeep(f.landing);
    }
  for (const p of Object.values(state.planets)) if (p.owner === playerId) addUpkeep(p.garrison);
  return out;
}

/** Per-resource income breakdown: production (gross income), building upkeep,
 *  unit upkeep, and net (production − buildingUpkeep − unitUpkeep). Used by the
 *  resource card (RC-1) to show a real split instead of just the sign of `netIncome`. */
export function incomeBreakdown(
  state: GameState,
  playerId: string,
): Record<string, { production: number; buildingUpkeep: number; unitUpkeep: number; net: number }> {
  const result: Record<string, { production: number; buildingUpkeep: number; unitUpkeep: number; net: number }> = {};
  const cell = (res: string) => {
    if (!result[res]) result[res] = { production: 0, buildingUpkeep: 0, unitUpkeep: 0, net: 0 };
    return result[res]!;
  };
  const arrears = state.players[playerId]?.arrears ?? [];
  const inhabited = inhabitedWorldCount(state, playerId);
  const me = state.players[playerId];
  const factionBonus = me?.faction ? (data.factions[me.faction]?.passives?.productionBonus ?? 0) : 0;
  let techBonus = 0;
  for (const id of me?.technologies?.completed ?? [])
    techBonus += data.technologies[id]?.effects?.productionBonus ?? 0;
  const bonusMult = (1 + factionBonus) * (1 + techBonus);

  for (const p of Object.values(state.planets)) {
    if (p.owner !== playerId || isBombarded(state, p.id)) continue;
    const mult =
      (1 + (p.planetType ? (data.planetTypes[p.planetType]?.productionBonus ?? 0) : 0)) * bonusMult;
    let credits = 0;
    const ptDef = p.planetType ? data.planetTypes[p.planetType] : undefined;
    const ptByRes = ptDef?.productionByResource ?? {};
    for (const res of Object.keys(ptDef?.baseOutput ?? {})) {
      const v = (ptDef!.baseOutput[res] ?? 0) * mult * (1 + (ptByRes[res] ?? 0));
      if (res === 'credits') credits += v;
      else { cell(res).production += v; }
    }
    for (const b of p.buildings) {
      const def = data.buildings[b.type];
      if (!def) continue;
      const level = buildingLevel(def, b.level);
      const starved =
        arrears.length > 0 &&
        Object.keys(level.upkeep).some((r) => (level.upkeep[r] ?? 0) > 0 && arrears.includes(r));
      const bMult = mult * (starved ? BROWNOUT : 1);
      for (const res of Object.keys(level.produces)) {
        const v = (level.produces[res] ?? 0) * bMult;
        if (res === 'credits') credits += v;
        else { cell(res).production += v; }
      }
      for (const res of Object.keys(level.upkeep)) {
        const v = (level.upkeep[res] ?? 0) / 24;
        if (res === 'credits') credits -= v;
        else { cell(res).buildingUpkeep += v; }
      }
    }
    if (isInhabited(p)) {
      credits += civicTax(inhabited) * bonusMult;
      if (p.buildings.some((b) => b.type === 'tax_office')) credits *= 1 + TAX_OFFICE_BONUS;
    }
    if (credits !== 0) cell('credits').production += credits;
  }
  const addUnitUpkeep = (stacks: Array<{ unit: string; count: number }>) => {
    for (const st of stacks) {
      const def = data.units[st.unit];
      if (!def) continue;
      for (const res of Object.keys(def.upkeep)) {
        const v = ((def.upkeep[res] ?? 0) * st.count) / 24;
        cell(res).unitUpkeep += v;
      }
    }
  };
  for (const f of Object.values(state.fleets))
    if (f.owner === playerId) {
      addUnitUpkeep(f.units);
      if (f.landing) addUnitUpkeep(f.landing);
    }
  for (const p of Object.values(state.planets)) if (p.owner === playerId) addUnitUpkeep(p.garrison);
  for (const res of Object.keys(result)) {
    const c = result[res]!;
    c.net = c.production - c.buildingUpkeep - c.unitUpkeep;
  }
  return result;
}

/** Max HP of a building level (mirrors the core's per-level data). */
export function hpOfLevel(type: string, level: number): number {
  const def = data.buildings[type];
  if (!def) return 0;
  if (level <= 1) return def.hp;
  return def.upgrades[level - 2]?.hp ?? def.hp;
}
