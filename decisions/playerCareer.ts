import type { PlayerCareer } from '../packages/protocol/src/playerProfile';
const object = (v: unknown): v is Record<string, unknown> =>
  !!v && typeof v === 'object' && !Array.isArray(v);
const count = (n: unknown): n is number =>
  typeof n === 'number' && Number.isSafeInteger(n) && n >= 0;
function bag(v: unknown): v is Record<string, number> {
  return (
    object(v) &&
    Object.keys(v).length <= 64 &&
    Object.entries(v).every(([key, n]) => /^[a-z][a-z0-9_-]{0,63}$/.test(key) && count(n))
  );
}
export function parseCareer(raw: unknown): PlayerCareer | null {
  if (
    !object(raw) ||
    !count(raw.matches) ||
    !count(raw.wins) ||
    raw.wins > raw.matches ||
    !count(raw.since) ||
    raw.since > 8_640_000_000_000_000 ||
    !object(raw.pvp) ||
    !object(raw.modes)
  )
    return null;
  const p = raw.pvp;
  if (
    !count(p.destroyed) ||
    !count(p.lost) ||
    !bag(p.destroyedCost) ||
    !bag(p.lostCost) ||
    Object.keys(raw.modes).length > 128
  )
    return null;
  const modes: PlayerCareer['modes'] = {};
  for (const [id, v] of Object.entries(raw.modes)) {
    if (
      !/^[a-zA-Z0-9][a-zA-Z0-9._:-]{0,127}$/.test(id) ||
      !object(v) ||
      !count(v.matches) ||
      !count(v.wins) ||
      v.wins > v.matches
    )
      return null;
    Object.defineProperty(modes, id, {
      value: { matches: v.matches, wins: v.wins },
      enumerable: true,
      writable: true,
      configurable: true,
    });
  }
  return {
    matches: raw.matches,
    wins: raw.wins,
    since: raw.since,
    pvp: {
      destroyed: p.destroyed,
      lost: p.lost,
      destroyedCost: { ...p.destroyedCost },
      lostCost: { ...p.lostCost },
    },
    modes,
  };
}
/** Same progression as commander XP, with logarithmic work even for large totals. */
export function accountLevel(xp: number): { level: number; earned: number; needed: number } {
  const total = Number.isSafeInteger(xp) && xp >= 0 ? xp : 0;
  const spent = (n: number): number => 25 * n * (n + 3);
  let low = 0,
    high = 20_000_000;
  while (low < high) {
    const mid = Math.ceil((low + high) / 2);
    if (spent(mid) <= total) low = mid;
    else high = mid - 1;
  }
  return { level: low + 1, earned: total - spent(low), needed: 100 + low * 50 };
}
