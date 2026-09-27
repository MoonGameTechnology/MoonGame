import type { GameState } from '@void/shared-core';
import type { ProfileProgress } from '@void/protocol';
import type { SeatAccounts } from './commanderCredit';
import type { ProfileStore } from './profileStore';

/** Only terminal authoritative snapshots count. Holdings are explicitly end-of-match
 *  holdings, never presented as construction/capture events we do not have a ledger for. */
export function matchProfileProgress(state: GameState, player: string): ProfileProgress {
  const won = state.match.winners?.includes(player) || state.match.winner === player;
  const worlds = Object.values(state.planets).filter((p) => p.owner === player);
  const fallen = state.missionFacts?.fallen?.[player]?.length ?? 0;
  const pirates = Object.values(state.players).filter((p) => p.npc === 'pirate');
  return {
    matches: 1,
    wins: won ? 1 : 0,
    teamWins: won && (state.match.winners?.length ?? 0) > 1 ? 1 : 0,
    explored: Object.keys(state.fog?.[player] ?? {}).length,
    rescued: state.missionFacts?.recruited?.[player]?.length ?? 0,
    worlds: worlds.length,
    buildings: worlds.reduce((n, p) => n + p.buildings.length, 0),
    defended: won ? worlds.length : 0,
    intactWins: won && state.missionFacts !== undefined && fallen === 0 ? 1 : 0,
    pirateWins: won && pirates.length > 0 && pirates.every((p) => p.status === 'defeated') ? 1 : 0,
  };
}

export async function creditProfileMatch(
  profiles: ProfileStore,
  seats: SeatAccounts,
  matchId: string,
  state: GameState,
): Promise<void> {
  if (state.match.status !== 'ended' || !state.match.rewards) return;
  const accounts = await seats();
  const rows = Object.entries(accounts).flatMap(([player, accountId]) =>
    state.match.rewards?.[player] && state.players[player]?.seated
      ? [{ accountId, progress: matchProfileProgress(state, player) }]
      : [],
  );
  if (rows.length) await profiles.credit(matchId, rows);
}
