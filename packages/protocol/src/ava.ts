/**
 * The id a corporations battle is hosted under (AVA-7): one per matchup, so a re-raise lands
 * on the same room and snapshot. The server names the room by it, and both hosts and the
 * client tell a battle from an ordinary match by it: since CORP-8 a battle is played on the
 * ordinary team maps, so the map no longer tells.
 */
export const avaMatchId = (matchupId: string): string => `ava-${matchupId}`;
export const isAvaMatchId = (matchId: string): boolean => matchId.startsWith('ava-');
