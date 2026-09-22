import type { GameState } from '../packages/shared-core/src/index';

/** Optional opening fight on the shipped Sector Zero map. All progress comes
 *  from the snapshot, so restoring a run neither repeats nor fabricates a win. */
export type PirateEncounter = {
  stage: 'approach' | 'travel' | 'battle' | 'occupy' | 'won' | 'cleared' | 'recover';
  sector: string;
  battleId?: string;
};

export function pirateEncounter(state: GameState, me: string): PirateEncounter | null {
  const sector = 'pirate_den';
  const base = state.planets[sector];
  if (!state.pve || state.match.status === 'ended' || !base || state.players.pirates?.npc !== 'pirate') return null;
  const battle = Object.values(state.battles).find((b) => b.location === sector &&
    b.sides.some((side) => side.owner === me) && b.sides.some((side) => side.owner === 'pirates'));
  if (battle) return { stage: 'battle', sector, battleId: battle.id };
  if (base.owner === me) return { stage: 'won', sector };
  const fleets = Object.values(state.fleets);
  if (base.owner !== 'pirates') {
    return { stage: 'cleared', sector };
  }
  const mine = fleets.filter((f) => f.owner === me && f.units.some((u) => u.count > 0));
  if (!mine.length) return { stage: 'recover', sector };
  if (mine.some((f) => (f.movement?.destination ?? f.movement?.to) === sector)) return { stage: 'travel', sector };
  if (!fleets.some((f) => f.owner === 'pirates' && f.units.some((u) => u.count > 0))) return { stage: 'occupy', sector };
  return { stage: 'approach', sector };
}
