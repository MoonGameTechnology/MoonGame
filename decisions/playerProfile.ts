import { parseCareer } from './playerCareer';
import {
  BOT_PROFILE_HISTORY_LIMIT,
  PROFILE_MEDALS,
  parseAppearance,
  medalGrade,
  type PlayerProfile,
  type ProfileAppearance,
  type ProfileMedalId,
  type ProfileProgress,
  type ProfileMetric,
  type BotProfileMatch,
} from '../packages/protocol/src/playerProfile';

export function profileMetricKey(metric: ProfileMetric): string {
  return 'profile.metric.' + metric.replace(/[A-Z]/g, (letter) => '-' + letter.toLowerCase());
}

function historyId(value: unknown): value is string {
  return typeof value === 'string' && /^[a-zA-Z0-9][a-zA-Z0-9._:-]{0,127}$/.test(value);
}

function parseBotMatch(raw: unknown): BotProfileMatch | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const row = raw as Record<string, unknown>;
  if (
    !historyId(row.matchId) ||
    !historyId(row.mapId) ||
    typeof row.endedAt !== 'number' ||
    !Number.isSafeInteger(row.endedAt) ||
    row.endedAt < 0 ||
    row.endedAt > 8_640_000_000_000_000 ||
    (row.outcome !== 'win' && row.outcome !== 'draw' && row.outcome !== 'loss') ||
    typeof row.xp !== 'number' ||
    !Number.isSafeInteger(row.xp) ||
    row.xp < 0 ||
    (row.place !== null &&
      (typeof row.place !== 'number' || !Number.isSafeInteger(row.place) || row.place < 1))
  )
    return null;
  return {
    matchId: row.matchId,
    mapId: row.mapId,
    endedAt: row.endedAt,
    outcome: row.outcome,
    xp: row.xp,
    place: row.place,
  };
}

/** Strict read boundary for cached/network data; no arbitrary URL, CSS or grade. */
export function parsePlayerProfile(raw: unknown): PlayerProfile | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const v = raw as Record<string, unknown>;
  const appearance = parseAppearance({ portrait: v.portrait, slots: v.slots });
  if (
    !appearance ||
    typeof v.login !== 'string' ||
    v.login.length > 64 ||
    typeof v.xp !== 'number' ||
    !Number.isSafeInteger(v.xp) ||
    v.xp < 0 ||
    (v.kind !== undefined && v.kind !== 'bot') ||
    (v.kind === 'bot' && !Number.isSafeInteger(v.xp))
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
  const career = v.career == null ? v.career : parseCareer(v.career);
  if (v.career != null && !career) return null;
  let statistics: PlayerProfile['statistics'];
  if (v.statistics !== undefined) {
    const st = v.statistics as { matches?: unknown; wins?: unknown } | null;
    if (
      !st ||
      !Number.isSafeInteger(st.matches) ||
      !Number.isSafeInteger(st.wins) ||
      Number(st.wins) < 0 ||
      Number(st.matches) < Number(st.wins)
    )
      return null;
    statistics = { matches: Number(st.matches), wins: Number(st.wins) };
  }
  let corporation: PlayerProfile['corporation'];
  if (v.corporation === null) corporation = null;
  else if (v.corporation !== undefined) {
    const c = v.corporation as { id?: unknown; name?: unknown } | null;
    if (
      !c ||
      !historyId(c.id) ||
      typeof c.name !== 'string' ||
      !c.name.trim() ||
      c.name.length > 128
    )
      return null;
    corporation = { id: c.id, name: c.name };
  }
  let recentMatches: BotProfileMatch[] | undefined;
  if (v.recentMatches !== undefined) {
    if (
      v.kind !== 'bot' ||
      !Array.isArray(v.recentMatches) ||
      v.recentMatches.length > BOT_PROFILE_HISTORY_LIMIT
    )
      return null;
    recentMatches = [];
    for (const raw of v.recentMatches) {
      const match = parseBotMatch(raw);
      if (!match) return null;
      recentMatches.push(match);
    }
  }
  return {
    ...appearance,
    ...(career !== undefined ? { career } : {}),
    ...(statistics !== undefined ? { statistics } : {}),
    ...(corporation !== undefined ? { corporation } : {}),
    login: v.login,
    xp: v.xp,
    progress,
    slots: appearance.slots.map((id) => (id && medalGrade(id, progress) ? id : null)),
    ...(v.premium === true ? { premium: true } : {}),
    ...(v.kind === 'bot' ? { kind: 'bot' as const } : {}),
    ...(recentMatches !== undefined ? { recentMatches } : {}),
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
