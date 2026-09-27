import type {
  CorpBuildError,
  CorpBuildOrder,
  CorpBuildingDef,
  CorpInfrastructureState,
  CorpInfrastructureResult,
  CorpInfrastructureView,
} from '@void/protocol';
import rawCatalog from '../../../data/corpBuildings.json';
import type { CorpAuditEntry, CorpRole } from './store/types';

const DAY = 86_400_000;
const integer = (value: unknown): value is number =>
  typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;

/** Meta-only catalog: validated once, embedded in both server bundles. */
export function parseCorpBuildings(raw: unknown): CorpBuildingDef[] {
  const rows = (raw as { buildings?: unknown } | null)?.buildings;
  if (!Array.isArray(rows) || rows.length === 0) throw new Error('E_CORP_CATALOG');
  const ids = new Set<string>();
  for (const row of rows as CorpBuildingDef[]) {
    if (
      !row ||
      typeof row.id !== 'string' ||
      !/^[a-z][a-z_]*$/.test(row.id) ||
      ids.has(row.id) ||
      typeof row.nameKey !== 'string' ||
      typeof row.descriptionKey !== 'string' ||
      !/^corp\.building\./.test(row.nameKey) ||
      !/^corp\.building\./.test(row.descriptionKey) ||
      !Array.isArray(row.levels) ||
      row.levels.length === 0
    )
      throw new Error('E_CORP_CATALOG');
    ids.add(row.id);
    for (const level of row.levels) {
      if (
        !level ||
        !integer(level.cost) ||
        !integer(level.durationMs) ||
        level.durationMs < 1 ||
        !integer(level.headquarters) ||
        !integer(level.influencePerDay) ||
        !integer(level.constructionReduction) ||
        level.constructionReduction > 50
      ) {
        throw new Error('E_CORP_CATALOG');
      }
    }
  }
  const buildings = structuredClone(rows as CorpBuildingDef[]);
  const hq = buildings.find((b) => b.id === 'headquarters');
  if (!hq || buildings.some((b) => b.levels.some((l) => l.headquarters > hq.levels.length))) {
    throw new Error('E_CORP_CATALOG');
  }
  return buildings;
}

export const CORP_BUILDINGS = parseCorpBuildings(rawCatalog);

function effects(state: CorpInfrastructureState): {
  influencePerDay: number;
  constructionReduction: number;
} {
  let influencePerDay = 0;
  let constructionReduction = 0;
  for (const def of CORP_BUILDINGS) {
    const level = def.levels[(state.levels[def.id] ?? 0) - 1];
    influencePerDay += level?.influencePerDay ?? 0;
    constructionReduction += level?.constructionReduction ?? 0;
  }
  return { influencePerDay, constructionReduction: Math.min(50, constructionReduction) };
}

function blocked(
  state: CorpInfrastructureState,
  influence: number,
  role: CorpRole,
  order: CorpBuildOrder,
): CorpBuildError | null {
  if (role !== 'head') return 'E_FORBIDDEN';
  const def = CORP_BUILDINGS.find((b) => b.id === order.buildingId);
  if (!def) return 'E_CORP_BUILDING';
  const level = state.levels[def.id] ?? 0;
  if (!integer(order.expectedLevel) || order.expectedLevel !== level) return 'E_CORP_BUILD_LEVEL';
  if (state.construction) return 'E_CORP_BUILD_BUSY';
  const next = def.levels[level];
  if (!next) return 'E_CORP_BUILD_MAX';
  if ((state.levels.headquarters ?? 0) < next.headquarters) return 'E_CORP_BUILD_REQUIRES';
  if (influence < next.cost) return 'E_INSUFFICIENT';
  return null;
}

/** One atomic store operation. No I/O: memory and SQL execute identical rules.
 *  Absolute timestamps settle construction/income after downtime without a timer.
 *  Rejecting an order still settles already-earned income, but never charges it. */
export function updateCorpInfrastructure(
  corpId: string,
  actor: string,
  role: CorpRole,
  balance: number,
  saved: CorpInfrastructureState | null,
  now: number,
  order?: CorpBuildOrder,
): {
  state: CorpInfrastructureState;
  influence: number;
  audit: CorpAuditEntry[];
  result: CorpInfrastructureResult;
} {
  if (!integer(now) || !integer(balance)) throw new Error('E_CORP_STATE');
  const state = saved
    ? structuredClone(saved)
    : { levels: {}, construction: null, accruedAt: now, remainder: 0 };
  const audit: CorpAuditEntry[] = [];
  let influence = balance;
  // A wall-clock correction cannot move accrual backwards or grant the same span twice.
  const at = Math.max(now, state.accruedAt);
  const accrue = (until: number): void => {
    const numerator = (until - state.accruedAt) * effects(state).influencePerDay + state.remainder;
    if (!integer(numerator)) throw new Error('E_CORP_STATE');
    const earned = Math.floor(numerator / DAY);
    influence += earned;
    if (!integer(influence)) throw new Error('E_CORP_STATE');
    state.remainder = numerator % DAY;
    state.accruedAt = until;
    if (earned > 0)
      audit.push({
        corpId,
        at: until,
        actor: 'system',
        action: 'building_income',
        detail: String(earned),
      });
  };
  const job = state.construction;
  if (job && job.completesAt <= at) {
    accrue(job.completesAt);
    state.levels[job.buildingId] = job.level;
    state.construction = null;
    audit.push({
      corpId,
      at: job.completesAt,
      actor: 'system',
      action: 'building_complete',
      target: job.buildingId,
      detail: String(job.level),
    });
  }
  accrue(at);
  if (order) {
    const code = blocked(state, influence, role, order);
    if (code) return { state, influence, audit, result: { ok: false, code } };
    const def = CORP_BUILDINGS.find((b) => b.id === order.buildingId)!;
    const level = state.levels[def.id] ?? 0;
    const next = def.levels[level]!;
    const durationMs = Math.ceil(
      (next.durationMs * (100 - effects(state).constructionReduction)) / 100,
    );
    influence -= next.cost;
    state.construction = {
      buildingId: def.id,
      level: level + 1,
      startedAt: at,
      completesAt: at + durationMs,
      cost: next.cost,
    };
    audit.push({
      corpId,
      at,
      actor,
      action: 'building_start',
      target: def.id,
      detail: JSON.stringify({ level: level + 1, cost: next.cost }),
    });
  }
  const bonuses = effects(state);
  const infrastructure: CorpInfrastructureView = {
    corpId,
    serverNow: at,
    influence,
    ...bonuses,
    canBuild: role === 'head',
    construction: state.construction,
    buildings: CORP_BUILDINGS.map((def) => {
      const level = state.levels[def.id] ?? 0;
      const next = def.levels[level];
      return {
        ...structuredClone(def),
        level,
        next: next
          ? {
              ...next,
              actualDurationMs: Math.ceil(
                (next.durationMs * (100 - bonuses.constructionReduction)) / 100,
              ),
            }
          : null,
        blocked: blocked(state, influence, role, { buildingId: def.id, expectedLevel: level }),
      };
    }),
  };
  return { state, influence, audit, result: { ok: true, infrastructure } };
}
