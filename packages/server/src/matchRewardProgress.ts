import {
  getStance,
  medalsOf,
  type DomainEvent,
  type GameData,
  type GameState,
  type UnitStack,
} from '@void/shared-core';
import type { CareerOwners } from './playerCareer';
import type { OwnOrder } from './metaEconomyActivity';
import type { MatchRewardPolicy } from './matchRewardPolicy';
import { meaningfulRewardOrders } from './matchRewardOrder';

export interface MatchRewardPlayer {
  accountId: string;
  claimedAt: number;
  startedAt: number;
  orders: number;
  lastOrderAt?: number;
  peakScore: number;
  kills: number;
  battles: string[];
  veteranPoints: number;
  endedAt?: number;
  eliminated?: boolean;
}
/** Server-only projection committed atomically with the world. One bounded row per tenure. */
export interface MatchRewardProgress {
  policy: MatchRewardPolicy;
  players: Record<string, MatchRewardPlayer>;
}
export const rewardPlayerKey = (player: string, claimedAt: number): string =>
  JSON.stringify([player, claimedAt]);
const own = <T>(values: Record<string, T>, key: string): T | undefined =>
  Object.hasOwn(values, key) ? values[key] : undefined;
const count = (n: unknown): number =>
  typeof n === 'number' && Number.isSafeInteger(n) && n >= 0 ? Math.min(n, 1_000_000_000) : 0;
const add = (a: number, b: number): number => Math.min(1_000_000_000, a + b);

/** Highest medal degree per surviving individual, including cargo and beachheads. */
export function survivingVeteranPoints(state: GameState, player: string, data: GameData): number {
  if (!data.medals) return 0;
  let total = 0;
  const credit = (stacks: readonly UnitStack[]): void => {
    for (const stack of stacks) {
      const grade = Math.max(0, ...medalsOf(stack, data).map((medal) => medal.grade));
      total = add(total, count(stack.count) * grade);
    }
  };
  for (const fleet of Object.values(state.fleets)) {
    if (fleet.owner === player) {
      credit(fleet.units);
      credit(fleet.landing ?? []);
    }
  }
  for (const planet of Object.values(state.planets)) {
    if (planet.owner === player) credit(planet.garrison);
    for (const beachhead of planet.beachheads ?? [])
      if (beachhead.owner === player) credit(beachhead.units);
  }
  return total;
}

/** Largest remainder: one casualty is allocated once even when several allies attack. */
function allocate(total: number, shares: [string, number][]): number[] {
  const sum = shares.reduce((n, [, value]) => n + value, 0);
  const exact = shares.map(([, value]) => (total * value) / sum);
  const result = exact.map(Math.floor);
  let remaining = total - result.reduce((a, b) => a + b, 0);
  for (const { i } of exact
    .map((n, i) => ({ i, rest: n - result[i]! }))
    .sort((a, b) => b.rest - a.rest || a.i - b.i)) {
    if (remaining-- > 0) result[i]!++;
  }
  return result;
}

export function foldMatchRewardProgress(
  previous: MatchRewardProgress | undefined,
  before: GameState,
  after: GameState,
  events: readonly DomainEvent[],
  owners: CareerOwners,
  data: GameData,
  order?: OwnOrder,
): MatchRewardProgress | undefined {
  if (!previous || before.match.status === 'ended') return previous;
  const next = structuredClone(previous);
  const rows = new Map<string, MatchRewardPlayer>();
  for (const [player, owner] of Object.entries(owners)) {
    const seat = own(before.players, player);
    if (!seat?.seated || seat.npc || seat.ai || (seat.claimedAt ?? null) !== owner.claimedAt)
      continue;
    const key = rewardPlayerKey(player, seat.claimedAt ?? 0);
    let row = own(next.players, key);
    if (!row) {
      // Joining an already eliminated seat never creates an eligible tenure.
      if (seat.status !== 'active') continue;
      row = next.players[key] = {
        accountId: owner.accountId,
        claimedAt: seat.claimedAt ?? 0,
        startedAt: Math.max(seat.claimedAt ?? 0, before.startedAt ?? 0),
        orders: 0,
        peakScore: 0,
        kills: 0,
        battles: [],
        veteranPoints: 0,
      };
    }
    if (row.accountId !== owner.accountId || row.endedAt !== undefined || seat.status !== 'active')
      continue;
    rows.set(player, row);
    row.peakScore = Math.max(
      row.peakScore,
      count(before.match.scores[player]?.total),
      count(after.match.scores[player]?.total),
    );
  }
  for (const event of events) {
    if (!event.payload || typeof event.payload !== 'object' || Array.isArray(event.payload))
      continue;
    const p = event.payload as Record<string, unknown>;
    if (
      event.type === 'combat.round' &&
      typeof p.battleId === 'string' &&
      p.battleId.length <= 256 &&
      Number.isSafeInteger(p.round) &&
      Number(p.round) > 0 &&
      [
        p.dmgToAttacker,
        p.dmgToDefender,
        ...(Array.isArray(p.sides)
          ? p.sides.map((side: { damage?: unknown }) => side?.damage)
          : []),
      ].some((damage) => typeof damage === 'number' && Number.isFinite(damage) && damage > 0)
    ) {
      const participants = Array.isArray(p.sides)
        ? p.sides.map((side: { owner?: unknown }) => side?.owner)
        : [];
      for (const player of [p.attacker, p.defender, ...participants]) {
        const row = typeof player === 'string' ? rows.get(player) : undefined;
        if (row && row.battles.length < 256 && !row.battles.includes(p.battleId))
          row.battles.push(p.battleId);
      }
    }
    if (event.type !== 'unit.died' && event.type !== 'career.casualty') continue;
    const victim = typeof p.owner === 'string' ? own(before.players, p.owner) : undefined;
    const unit = typeof p.unit === 'string' ? own(data.units, p.unit) : undefined;
    if (
      !victim ||
      victim.npc ||
      !unit ||
      !p.lossCost ||
      count(p.count) === 0 ||
      unit.traits?.some((trait) => trait === 'missile' || trait === 'mine')
    )
      continue;
    const raw = p.damageShares ?? (typeof p.killedBy === 'string' ? { [p.killedBy]: 1 } : {});
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) continue;
    const shares = Object.entries(raw).filter(
      (entry): entry is [string, number] =>
        typeof entry[1] === 'number' && Number.isFinite(entry[1]) && entry[1] > 0,
    );
    shares.sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
    if (!shares.length || !Number.isFinite(shares.reduce((n, [, v]) => n + v, 0))) continue;
    const counts = allocate(count(p.count), shares);
    shares.forEach(([player], i) => {
      const row = rows.get(player);
      if (row && getStance(before, player, victim.id) === 'war')
        row.kills = add(row.kills, counts[i]!);
    });
  }
  for (const [player, row] of rows) {
    const eliminated = events.some(
      (event) =>
        event.type === 'player.eliminated' &&
        (event.payload as { playerId?: string } | null)?.playerId === player,
    );
    // A catch-up may eliminate the player before the submitted order. Never count that order.
    if (
      !eliminated &&
      after.players[player]?.status === 'active' &&
      order?.playerId === player &&
      order.type &&
      meaningfulRewardOrders.has(order.type) &&
      order.meaningful !== false &&
      Number.isFinite(order.at)
    ) {
      row.orders = Math.min(1000, row.orders + 1);
      row.lastOrderAt = Math.max(row.lastOrderAt ?? 0, order.at);
    }
    if (after.match.status === 'ended')
      row.veteranPoints = survivingVeteranPoints(after, player, data);
    if (eliminated || after.players[player]?.status === 'defeated') {
      // Event batches lack individual timestamps. The last committed pre-defeat instant
      // is conservative: no time spent waiting for other players counts as abandonment.
      row.endedAt = Math.max(row.startedAt, before.time);
      row.eliminated = true;
      row.veteranPoints = 0;
    } else if (after.match.status === 'ended') row.endedAt = after.match.endedAt ?? after.time;
  }
  return next;
}
