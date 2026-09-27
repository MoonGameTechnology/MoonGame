/** Account cosmetics. No player-supplied grade or achievement counter crosses the write API. */
export const PORTRAIT_COUNT = 40;
export const MEDAL_SLOTS = 15;
export const PROFILE_MEDALS = [
  { id: 'first', metric: 'wins', goals: [1, 10, 50] },
  { id: 'map', metric: 'explored', goals: [20, 60, 150] },
  { id: 'shield', metric: 'defended', goals: [5, 20, 50] },
  { id: 'rescue', metric: 'rescued', goals: [1, 3, 10] },
  { id: 'colony', metric: 'worlds', goals: [1, 5, 20] },
  { id: 'ally', metric: 'teamWins', goals: [5, 20, 50] },
  { id: 'service', metric: 'matches', goals: [20, 100, 300] },
  { id: 'engineer', metric: 'buildings', goals: [50, 250, 1000] },
  { id: 'pirates', metric: 'pirateWins', goals: [5, 20, 50] },
  { id: 'flawless', metric: 'intactWins', goals: [1, 10, 30] },
  { id: 'legend', metric: 'wins', goals: [100, 250, 500] },
  { id: 'explorer', metric: 'explored', goals: [100, 250, 500] },
] as const;
export type ProfileMedalId = (typeof PROFILE_MEDALS)[number]['id'];
export type ProfileMetric = (typeof PROFILE_MEDALS)[number]['metric'];
export type ProfileProgress = Partial<Record<ProfileMetric, number>>;
export type MedalGrade = 1 | 2 | 3;
export interface ProfileAppearance {
  /** 1-based shipped asset index. Never an arbitrary image URL. */
  portrait: number;
  /** Stable medal IDs only: a new degree replaces the previous one in this same slot. */
  slots: Array<ProfileMedalId | null>;
}
export interface PlayerProfile extends ProfileAppearance {
  login: string;
  xp: number;
  progress: ProfileProgress;
}
export function defaultAppearance(): ProfileAppearance {
  return { portrait: 1, slots: Array.from({ length: MEDAL_SLOTS }, () => null) };
}
export function medalGrade(id: ProfileMedalId, progress: ProfileProgress): MedalGrade | null {
  const medal = PROFILE_MEDALS.find((m) => m.id === id)!;
  const value = progress[medal.metric] ?? 0;
  return value >= medal.goals[2]
    ? 1
    : value >= medal.goals[1]
      ? 2
      : value >= medal.goals[0]
        ? 3
        : null;
}
/** Exact write shape, bounded slots and no duplicate medals. Ownership is checked by the server. */
export function parseAppearance(raw: unknown): ProfileAppearance | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const v = raw as Record<string, unknown>;
  if (Object.keys(v).some((k) => k !== 'portrait' && k !== 'slots')) return null;
  if (
    !Number.isInteger(v.portrait) ||
    Number(v.portrait) < 1 ||
    Number(v.portrait) > PORTRAIT_COUNT
  )
    return null;
  if (!Array.isArray(v.slots) || v.slots.length !== MEDAL_SLOTS) return null;
  const ids = new Set(PROFILE_MEDALS.map((m) => m.id as string));
  if (v.slots.some((id) => id !== null && (typeof id !== 'string' || !ids.has(id)))) return null;
  const worn = v.slots.filter((id) => id !== null);
  if (new Set(worn).size !== worn.length) return null;
  return { portrait: Number(v.portrait), slots: [...v.slots] as ProfileAppearance['slots'] };
}
