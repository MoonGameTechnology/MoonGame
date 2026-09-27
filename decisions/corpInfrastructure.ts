import type {
  CorpInfrastructureView,
  CorpBuildingLevel,
} from '../packages/protocol/src/corpInfrastructure';

const object = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v);
const integer = (v: unknown): v is number =>
  typeof v === 'number' && Number.isSafeInteger(v) && v >= 0;
const id = (v: unknown): v is string => typeof v === 'string' && /^[a-z][a-z_]*$/.test(v);
const key = (v: unknown): v is string =>
  typeof v === 'string' && /^corp\.building\.[a-z.-]+$/.test(v);
const level = (v: unknown): v is CorpBuildingLevel =>
  object(v) &&
  integer(v.cost) &&
  integer(v.durationMs) &&
  v.durationMs > 0 &&
  integer(v.headquarters) &&
  integer(v.influencePerDay) &&
  integer(v.constructionReduction) &&
  v.constructionReduction <= 50;
const ERRORS = new Set([
  'E_FORBIDDEN',
  'E_CORP_BUILDING',
  'E_CORP_BUILD_BUSY',
  'E_CORP_BUILD_LEVEL',
  'E_CORP_BUILD_MAX',
  'E_CORP_BUILD_REQUIRES',
  'E_INSUFFICIENT',
]);

/** Invalid/old server payloads must never turn into enabled purchase buttons. */
export function parseCorpInfrastructure(raw: unknown): CorpInfrastructureView | null {
  if (
    !object(raw) ||
    typeof raw.corpId !== 'string' ||
    !integer(raw.serverNow) ||
    !integer(raw.influence) ||
    !integer(raw.influencePerDay) ||
    !integer(raw.constructionReduction) ||
    raw.constructionReduction > 50 ||
    typeof raw.canBuild !== 'boolean' ||
    !Array.isArray(raw.buildings) ||
    raw.buildings.length === 0 ||
    raw.buildings.length > 30
  )
    return null;
  const ids = new Set<string>();
  for (const b of raw.buildings) {
    if (
      !object(b) ||
      !id(b.id) ||
      ids.has(b.id) ||
      !key(b.nameKey) ||
      !key(b.descriptionKey) ||
      !integer(b.level) ||
      !Array.isArray(b.levels) ||
      !b.levels.length ||
      !b.levels.every(level) ||
      b.level > b.levels.length ||
      (b.blocked !== null && (typeof b.blocked !== 'string' || !ERRORS.has(b.blocked)))
    )
      return null;
    ids.add(b.id);
    if (
      b.next !== null &&
      (!level(b.next) ||
        !object(b.next) ||
        !integer(b.next.actualDurationMs) ||
        b.next.actualDurationMs < 1)
    )
      return null;
    if ((b.level === b.levels.length) !== (b.next === null)) return null;
  }
  if (raw.construction !== null) {
    const c = raw.construction;
    if (
      !object(c) ||
      !id(c.buildingId) ||
      !ids.has(c.buildingId) ||
      !integer(c.level) ||
      c.level < 1 ||
      !integer(c.startedAt) ||
      !integer(c.completesAt) ||
      c.completesAt <= c.startedAt ||
      !integer(c.cost)
    )
      return null;
  }
  return raw as unknown as CorpInfrastructureView;
}

/** Server time + elapsed local display time; changing the device clock cannot complete a job. */
export function corpConstructionProgress(
  view: CorpInfrastructureView,
  elapsedMs: number,
): { percent: number; remainingMs: number } | null {
  const job = view.construction;
  if (!job) return null;
  const now = view.serverNow + Math.max(0, elapsedMs);
  const remainingMs = Math.max(0, job.completesAt - now);
  const percent = Math.max(
    0,
    Math.min(100, ((now - job.startedAt) * 100) / (job.completesAt - job.startedAt)),
  );
  return { percent, remainingMs };
}
