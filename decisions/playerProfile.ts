import {
  PROFILE_MEDALS,
  parseAppearance,
  medalGrade,
  type PlayerProfile,
  type ProfileAppearance,
  type ProfileMedalId,
  type ProfileProgress,
  type ProfileMetric,
} from '../packages/protocol/src/playerProfile';

export function profileMetricKey(metric: ProfileMetric): string {
  return 'profile.metric.' + metric.replace(/[A-Z]/g, (letter) => '-' + letter.toLowerCase());
}

/** Strict read boundary for cached/network data; no arbitrary URL, CSS or grade. */
export function parsePlayerProfile(raw: unknown): PlayerProfile | null {
  if (!raw || typeof raw !== 'object') return null;
  const v = raw as Record<string, unknown>;
  const appearance = parseAppearance({ portrait: v.portrait, slots: v.slots });
  if (
    !appearance ||
    typeof v.login !== 'string' ||
    v.login.length > 64 ||
    typeof v.xp !== 'number' ||
    !Number.isFinite(v.xp) ||
    v.xp < 0
  )
    return null;
  if (!v.progress || typeof v.progress !== 'object' || Array.isArray(v.progress)) return null;
  const source = v.progress as Record<string, unknown>;
  const progress: ProfileProgress = {};
  for (const { metric } of PROFILE_MEDALS) {
    const value = source[metric];
    if (
      value !== undefined &&
      (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0)
    )
      return null;
    if (typeof value === 'number') progress[metric] = value;
  }
  return {
    ...appearance,
    login: v.login,
    xp: v.xp,
    progress,
    slots: appearance.slots.map((id) => (id && medalGrade(id, progress) ? id : null)),
  };
}

export function placeProfileMedal(
  appearance: ProfileAppearance,
  slot: number,
  id: ProfileMedalId | null,
): ProfileAppearance {
  if (!Number.isInteger(slot) || slot < 0 || slot >= appearance.slots.length) return appearance;
  return {
    ...appearance,
    slots: appearance.slots.map((old, i) => (i === slot ? id : old === id ? null : old)),
  };
}

/** Artist-approved tunic placement, shared by owner and public view. */
const FITS = [
  [55.6, 59.2, 26, 1, 0.047, -0.033, 0.975, 0.92],
  [56.3, 60.5, 25.2, 0.99, 0.025, -0.018, 0.97, 0.95],
  [55.3, 60.3, 26.1, 0.985, 0.056, -0.025, 0.965, 0.9],
  [55.7, 60, 25.4, 1, 0.018, -0.008, 0.98, 0.95],
  [55.6, 60.3, 26, 0.99, 0.043, -0.03, 0.97, 0.9],
  [53.7, 60.6, 20, 0.99, -0.018, -0.12, 0.97, 0.92],
  [55.4, 60.1, 26, 0.995, 0.029, -0.018, 0.975, 0.94],
  [55.8, 60.4, 25.7, 1, 0.025, -0.018, 0.97, 0.94],
  [56, 59.4, 26, 0.99, 0.039, -0.023, 0.975, 0.92],
  [54.5, 60.3, 23, 1, 0.028, -0.055, 0.975, 0.94],
];
export function tunicFit(portrait: number): string {
  const [left, top, width, a, b, c, d, light] = FITS[portrait - 1] ?? [
    55.6, 60.2, 25.5, 1, 0.028, -0.025, 0.975, 0.94,
  ];
  return `left:${left}%;top:${top}%;width:${width}%;transform:matrix(${a},${b},${c},${d},0,0);filter:brightness(${light})`;
}
