import { isForkSite, type GameState, type UnitStack } from '@void/shared-core';
import type { EconomyObservation } from './store/types';

export const economyObservationKey = (player: string, claimedAt: number): string =>
  JSON.stringify([player, claimedAt]);

export function economyObservation(state: GameState, player: string): EconomyObservation {
  const worlds = Object.values(state.planets).filter((p) => p.owner === player && !isForkSite(p));
  const stacks: UnitStack[] = worlds.flatMap((p) => p.garrison);
  for (const fleet of Object.values(state.fleets)) {
    if (fleet.owner === player) stacks.push(...fleet.units, ...(fleet.landing ?? []));
  }
  return {
    known: Object.keys(state.fog?.[player] ?? {}).filter(
      (id) => state.planets[id] && !isForkSite(state.planets[id]),
    ),
    buildings: worlds.flatMap((p) => {
      const counts = new Map<string, number>();
      return p.buildings.map((b) => {
        const key = `${p.id}:${b.uid ?? b.type}:${b.level}`;
        const occurrence = counts.get(key) ?? 0;
        counts.set(key, occurrence + 1);
        return `${key}:${occurrence}`;
      });
    }),
    evacuated: state.missionFacts?.evacuated?.[player] ?? 0,
    rescued: state.missionFacts?.recruited?.[player]?.length ?? 0,
    battles: stacks.reduce((n, stack) => Math.max(n, stack.battles ?? 0), 0),
  };
}

/** Capture without contacting Meta. The match store atomically keeps the first
 * accepted snapshot's observation when later saves supply the same tenure key. */
export function captureEconomyObservations(state: GameState): Record<string, EconomyObservation> {
  const candidates: Record<string, EconomyObservation> = {};
  if (state.modeId === 'sector-zero' || state.modeId === 'sector_zero') return candidates;
  for (const [playerId, player] of Object.entries(state.players)) {
    if (!player.seated || player.npc || player.ai) continue;
    candidates[economyObservationKey(playerId, player.claimedAt ?? 0)] = economyObservation(
      state,
      playerId,
    );
  }
  return candidates;
}
