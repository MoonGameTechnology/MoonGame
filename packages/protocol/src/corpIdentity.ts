/** Fixed, code-owned insignia. A corporation never supplies SVG, markup or URLs. */
export const CORP_EMBLEMS = [
  'falcon',
  'phoenix',
  'wolf',
  'dragon',
  'lion',
  'shield',
  'blade',
  'compass',
  'orbit',
  'nova',
  'comet',
  'crystal',
  'forge',
  'beacon',
  'eye',
  'crown',
  'spire',
  'wing',
  'anchor',
  'helix',
] as const;

export type CorpEmblemId = (typeof CORP_EMBLEMS)[number];

export function isCorpEmblemId(value: unknown): value is CorpEmblemId {
  return typeof value === 'string' && (CORP_EMBLEMS as readonly string[]).includes(value);
}

/** Legacy corporations get the same emblem everywhere without rewriting their rows. */
export function corpEmblemId(corpId: string, selected?: unknown): CorpEmblemId {
  if (isCorpEmblemId(selected)) return selected;
  let hash = 2166136261;
  for (let i = 0; i < corpId.length; i++) hash = Math.imul(hash ^ corpId.charCodeAt(i), 16777619);
  return CORP_EMBLEMS[(hash >>> 0) % CORP_EMBLEMS.length]!;
}
