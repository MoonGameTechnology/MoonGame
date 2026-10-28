import type { DomainEvent, GameState } from '@void/shared-core';
import type { PlayerCareer } from '@void/protocol';

export interface CareerOwners {
  [player: string]: { accountId: string; claimedAt: number | null };
}
export interface CareerCombat {
  destroyed: number;
  lost: number;
  destroyedCost: Record<string, number>;
  lostCost: Record<string, number>;
}
/** Server-only: saved with the world, never projected into fog or client messages. */
export interface CareerLedger {
  since: number;
  owners: CareerOwners;
  players: Record<string, CareerCombat>;
}
export const emptyCareer = (since: number): CareerLedger => ({ since, owners: {}, players: {} });
export function careerOwners(state: GameState, accounts: Record<string, string>): CareerOwners {
  return Object.fromEntries(
    Object.entries(accounts)
      .filter(([id]) => !state.players[id]?.npc)
      .map(([id, accountId]) => [
        id,
        { accountId, claimedAt: state.players[id]?.claimedAt ?? null },
      ]),
  );
}
const competitive = (s: GameState): boolean =>
  !s.pve && !!s.mapId && !/training|tutorial|test|proving|pve|sector[-_]zero/i.test(s.mapId + ':' + (s.modeId ?? ''));
function human(s: GameState, owners: CareerOwners, id: unknown): string | null {
  if (typeof id !== 'string') return null;
  const p = s.players[id],
    owner = owners[id];
  return p?.seated && !p.npc && owner && (p.claimedAt ?? null) === owner.claimedAt
    ? owner.accountId
    : null;
}
const combat = (): CareerCombat => ({ destroyed: 0, lost: 0, destroyedCost: {}, lostCost: {} });
function addBag(to: Record<string, number>, from: Record<string, number>): void {
  for (const [key, n] of Object.entries(from)) {
    if (
      /^[a-z][a-z0-9_-]{0,63}$/.test(key) &&
      Number.isSafeInteger(n) &&
      n >= 0 &&
      Number.isSafeInteger((to[key] ?? 0) + n)
    )
      to[key] = (to[key] ?? 0) + n;
  }
}
/** Fold only authoritative events from one committed world transition. */
export function foldCareerEvents(
  previous: CareerLedger,
  events: readonly DomainEvent[],
  state: GameState,
  owners = previous.owners,
): CareerLedger {
  const next = structuredClone(previous);
  next.owners = structuredClone(owners);
  if (!competitive(state)) return next;
  for (const event of events) {
    if (event.type !== 'unit.died' && event.type !== 'career.casualty') continue;
    const p = event.payload as {
      owner?: unknown;
      killedBy?: unknown;
      count?: unknown;
      lossCost?: Record<string, number>;
      damageShares?: Record<string, number>;
    } | null;
    if (!p || !Number.isSafeInteger(p.count) || Number(p.count) <= 0 || !p.lossCost) continue;
    const victim = human(state, owners, p.owner);
    if (!victim) continue;
    const shares = Object.entries(
      p.damageShares ?? (typeof p.killedBy === 'string' ? { [p.killedBy]: 1 } : {}),
    )
      .filter(([, n]) => Number.isFinite(n) && n > 0)
      .sort(([a], [b]) => a.localeCompare(b));
    if (!shares.length) continue;
    // Largest remainder preserves integer casualties/value. Bot contributions keep
    // their share but earn no PvP credit, so a human cannot farm a bot's damage.
    const allocate = (total: number): number[] => {
      const sum = shares.reduce((n, [, v]) => n + v, 0);
      const exact = shares.map(([, v]) => (total * v) / sum),
        result = exact.map(Math.floor);
      let rest = total - result.reduce((a, b) => a + b, 0);
      const order = exact
        .map((v, i) => ({ i, rest: v - result[i]! }))
        .sort((a, b) => b.rest - a.rest || a.i - b.i);
      for (const v of order) if (rest-- > 0) result[v.i]!++;
      return result;
    };
    const counts = allocate(Number(p.count));
    const bags = Object.fromEntries(
      Object.entries(p.lossCost)
        .filter(([, n]) => Number.isSafeInteger(n) && n >= 0)
        .map(([r, n]) => [r, allocate(n)]),
    );
    for (let i = 0; i < shares.length; i++) {
      const killer = human(state, owners, shares[i]![0]);
      if (!killer || killer === victim) continue;
      const killed = (next.players[killer] ??= combat()),
        lost = (next.players[victim] ??= combat());
      killed.destroyed += counts[i]!;
      lost.lost += counts[i]!;
      const cost = Object.fromEntries(Object.entries(bags).map(([r, values]) => [r, values[i]!]));
      addBag(killed.destroyedCost, cost);
      addBag(lost.lostCost, cost);
    }
  }
  return next;
}
export function settleCareer(
  ledger: CareerLedger,
  state: GameState,
  owners = ledger.owners,
): Array<{ accountId: string; career: PlayerCareer }> {
  if (state.match.status !== 'ended' || !state.match.rewards || !competitive(state)) return [];
  const seats = Object.keys(owners).flatMap((id) => {
    const accountId = human(state, owners, id);
    return accountId ? [{ id, accountId }] : [];
  });
  const ids = [
    ...new Set([...seats.map((s) => s.accountId), ...Object.keys(ledger.players)]),
  ].sort();
  return ids.map((accountId) => {
    const wins = seats.some(
      ({ id, accountId: account }) =>
        account === accountId && (state.match.winner === id || state.match.winners?.includes(id)),
    )
      ? 1
      : 0;
    const mode = ids.length < 2 ? 'versus-bots' : state.modeId ?? state.mapId!;
    return {
      accountId,
      career: {
        matches: 1,
        wins,
        since: ledger.since,
        pvp: ledger.players[accountId] ?? combat(),
        modes: { [mode]: { matches: 1, wins } },
      },
    };
  });
}
export function mergeCareer(old: PlayerCareer | null, row: PlayerCareer): PlayerCareer {
  if (!old) return structuredClone(row);
  const next = structuredClone(old);
  next.matches += row.matches;
  next.wins += row.wins;
  next.since = Math.min(next.since, row.since);
  next.pvp.destroyed += row.pvp.destroyed;
  next.pvp.lost += row.pvp.lost;
  addBag(next.pvp.destroyedCost, row.pvp.destroyedCost);
  addBag(next.pvp.lostCost, row.pvp.lostCost);
  for (const [mode, counts] of Object.entries(row.modes)) {
    const current = (next.modes[mode] ??= { matches: 0, wins: 0 });
    current.matches += counts.matches;
    current.wins += counts.wins;
  }
  return next;
}
