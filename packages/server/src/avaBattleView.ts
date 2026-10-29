import type { CorpWarView } from '@void/protocol';
import { z } from 'zod';
import {
  getStance,
  isCapturable,
  isForkSite,
  type GameData,
  type GameState,
  type VictoryRules,
} from '@void/shared-core';
import type { AvaBattleReport, AvaSeatReport, AvaSession, AvaSide } from './store';

/**
 * CORP-9 — what a corporation sees of its battle outside the match: the war in progress for
 * its own side (`avaWarView`) and, once the battle is over, the breakdown of both sides
 * (`avaBattleReport`, recorded with the result). Pure: both read a match state the host hands
 * them and count the way the victory module does — a province is a capturable sector that is
 * not a fork site, a side's goal is the score limit × its seats × the coalition factor.
 *
 * The hub shows no more about the rival than the match itself (`corporation-wars.md` §8):
 * before the war only how many signed up, at war also who they are and who is out, never
 * their score or land. Both sides' score is in the breakdown once the battle is over.
 */

/** How the battle ended, as the breakdown keeps it: the four ways an AvA match ends. */
const REASONS = ['domination', 'elimination', 'score', 'timeout'] as const;

/** Seats a breakdown may list: 10 на 10 is the largest format, with room to spare. */
const MAX_SEATS = 40;

/** One seat of a battle, read off the match state. */
interface SeatFacts {
  playerId: string;
  side: AvaSide;
  score: number;
  provinces: number;
  out: boolean;
}

/** The two teams of an AvA state, challenger first: the seats' teams sorted, the rule the
 *  seating used (`seatAvaRoster`). Null when the state is not a two-sided battle. */
function teamsOf(state: GameState): Record<AvaSide, string> | null {
  const teams = new Set<string>();
  for (const player of Object.values(state.players)) {
    if (player.team !== undefined) teams.add(player.team);
  }
  const [challenger, target, extra] = [...teams].sort();
  return challenger !== undefined && target !== undefined && extra === undefined
    ? { challenger, target }
    : null;
}

/** Every seat of the battle (the map's inhabitants have no side) and the provinces of the
 *  map. Null when the state is not a two-sided battle. */
function seatsOf(
  state: GameState,
  data: GameData,
): { seats: SeatFacts[]; capturable: number } | null {
  const teams = teamsOf(state);
  if (!teams) return null;
  let capturable = 0;
  const owned = new Map<string, number>();
  for (const planet of Object.values(state.planets)) {
    if (!isCapturable(data, planet) || isForkSite(planet)) continue;
    capturable += 1;
    if (planet.owner !== null) owned.set(planet.owner, (owned.get(planet.owner) ?? 0) + 1);
  }
  const seats: SeatFacts[] = [];
  for (const playerId of Object.keys(state.players).sort()) {
    const player = state.players[playerId]!;
    const side: AvaSide | null =
      player.team === teams.challenger
        ? 'challenger'
        : player.team === teams.target
          ? 'target'
          : null;
    if (side === null) continue;
    seats.push({
      playerId,
      side,
      score: Math.round(state.match.scores[playerId]?.total ?? 0),
      provinces: owned.get(playerId) ?? 0,
      out: player.status === 'defeated',
    });
  }
  return { seats, capturable };
}

/** When the battle's war opened, wall clock: the war sweep's stamp. The sweep also stamps a
 *  battle that ended before its war, only to drop it from its queue, so an ended battle's
 *  war opened only if its sides are at war: some pair of seats across them holds `war`. */
export function warOpenedAt(
  session: Pick<AvaSession, 'warDeclaredAt'>,
  state: GameState,
): number | undefined {
  if (state.match.status !== 'ended') return session.warDeclaredAt;
  const seats = Object.entries(state.players).filter(([, player]) => player.team !== undefined);
  const atWar = seats.some(([a, one], i) =>
    seats
      .slice(i + 1)
      .some(([b, other]) => one.team !== other.team && getStance(state, a, b) === 'war'),
  );
  return atWar ? session.warDeclaredAt : undefined;
}

/** playerId → the account seated there (`AvaSession.seats` is accountId → playerId). A seat
 *  with no account is a bot's. */
function accountsBySeat(seats: Readonly<Record<string, string>>): Map<string, string> {
  return new Map(Object.entries(seats).map(([accountId, playerId]) => [playerId, accountId]));
}

/**
 * The breakdown of a finished battle, from its ended state: how it ended, both sides' score
 * and provinces, and every seat. `seats` is the session's seating, `logins` the seated
 * accounts' logins, taken now like the corp names in the feed, so the breakdown reads on its
 * own later. Null when the state is not a two-sided battle: the result is then recorded
 * without one.
 */
export function avaBattleReport(
  state: GameState,
  data: GameData,
  seats: Readonly<Record<string, string>>,
  logins: Readonly<Record<string, string>>,
  warAt?: number,
): AvaBattleReport | null {
  const facts = seatsOf(state, data);
  if (!facts) return null;
  const accountOf = accountsBySeat(seats);
  const sides: AvaBattleReport['sides'] = {
    challenger: { score: 0, provinces: 0 },
    target: { score: 0, provinces: 0 },
  };
  const rows = facts.seats.map((seat): AvaSeatReport => {
    sides[seat.side].score += seat.score;
    sides[seat.side].provinces += seat.provinces;
    const accountId = accountOf.get(seat.playerId) ?? null;
    return {
      side: seat.side,
      accountId,
      login: accountId === null ? null : (logins[accountId] ?? null),
      score: seat.score,
      provinces: seat.provinces,
      out: seat.out,
    };
  });
  return {
    reason: REASONS.find((reason) => reason === state.match.reason) ?? null,
    ...(warAt === undefined ? {} : { warAt }),
    provinces: facts.capturable,
    sides,
    seats: rows,
  };
}

const count = z.number().int().min(0).max(1_000_000);
const points = z.number().min(-1_000_000_000).max(1_000_000_000);
const sideTotals = z.object({ score: points, provinces: count });
const reportSchema = z.object({
  reason: z.enum(REASONS).nullable(),
  warAt: z.number().int().min(0).optional(),
  provinces: count,
  sides: z.object({ challenger: sideTotals, target: sideTotals }),
  seats: z
    .array(
      z.object({
        side: z.enum(['challenger', 'target']),
        accountId: z.string().min(1).max(128).nullable(),
        login: z.string().min(1).max(96).nullable(),
        score: points,
        provinces: count,
        out: z.boolean(),
      }),
    )
    .max(MAX_SEATS),
});

/** A breakdown as the corporations authority accepts it with a settlement: the exact shape,
 *  bounded, unknown fields dropped. Anything else is no breakdown — the settlement itself
 *  goes ahead (fail-secure: a bad breakdown never blocks the result or the reward). */
export function parseAvaBattleReport(raw: unknown): AvaBattleReport | null {
  const parsed = reportSchema.safeParse(raw);
  return parsed.success ? parsed.data : null;
}

export type AvaWarView = CorpWarView;
export type AvaWarSeat = CorpWarView['mine'][number];
export type AvaRivalSeat = NonNullable<CorpWarView['rivals']['seats']>[number];

/**
 * The war view of one side (pure): its score against the side's goal, its provinces against
 * the domination share, its seats, and of the rival only what the match shows — the count of
 * players before the war, plus who they are and who is out once it is on. `logins` names the
 * seated accounts the view may name. Null when the state is not a two-sided battle.
 */
export function avaWarView(input: {
  matchupId: string;
  side: AvaSide;
  session: Pick<AvaSession, 'seats' | 'warAt' | 'warDeclaredAt'>;
  state: GameState;
  rules: Pick<VictoryRules, 'scoreLimit' | 'coalitionFactor' | 'dominationPercent'>;
  data: GameData;
  logins: Readonly<Record<string, string>>;
}): AvaWarView | null {
  const { side, session, state, rules, logins } = input;
  const facts = seatsOf(state, input.data);
  if (!facts) return null;
  const accountOf = accountsBySeat(session.seats);
  const opened = warOpenedAt(session, state);
  const phase = state.match.status === 'ended' ? 'ended' : opened !== undefined ? 'war' : 'peace';
  const warAt = phase === 'peace' ? session.warAt : opened;
  const loginOf = (accountId: string | null): string | null =>
    accountId === null ? null : (logins[accountId] ?? null);
  const own = facts.seats.filter((seat) => seat.side === side);
  const rival = facts.seats.filter((seat) => seat.side !== side);
  const mine = own.map((seat): AvaWarSeat => {
    const accountId = accountOf.get(seat.playerId) ?? null;
    return {
      accountId,
      login: loginOf(accountId),
      score: seat.score,
      provinces: seat.provinces,
      out: seat.out,
    };
  });
  // The victory module's side threshold: the side races as one unit of all its seats,
  // the eliminated ones included (`fixedVictoryUnits`).
  const goal =
    own.length === 1 ? rules.scoreLimit : rules.scoreLimit * own.length * rules.coalitionFactor;
  const signedUp = rival.filter((seat) => accountOf.has(seat.playerId)).length;
  return {
    matchupId: input.matchupId,
    side,
    phase,
    ...(warAt === undefined ? {} : { warAt }),
    score: mine.reduce((sum, seat) => sum + seat.score, 0),
    scoreGoal: Math.round(goal),
    provinces: mine.reduce((sum, seat) => sum + seat.provinces, 0),
    capturable: facts.capturable,
    dominationPercent: rules.dominationPercent,
    mine,
    rivals:
      phase === 'peace'
        ? { count: signedUp }
        : {
            count: signedUp,
            seats: rival.map((seat): AvaRivalSeat => {
              const accountId = accountOf.get(seat.playerId) ?? null;
              return { bot: accountId === null, login: loginOf(accountId), out: seat.out };
            }),
          },
  };
}
