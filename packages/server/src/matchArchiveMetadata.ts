import { playablePlayerIds } from '@void/shared-core';
import type { GameState } from '@void/shared-core';
import type { MatchSnapshot } from './store/types';

/** Small archive read-model. Never retains the world, fog, wallets or orders. */
export interface ArchiveMetadata {
  mapId: string;
  modeId?: string;
  gameTime: number;
  startedAt: number;
  timeScale: number;
  capacity: number;
}
export interface ArchiveSummaryMetadata extends ArchiveMetadata {
  matchId: string;
  createdAt: number;
  endedAt: number;
  seated: number;
}
export function archiveMetadataOf(snapshot: MatchSnapshot): ArchiveMetadata {
  return {
    mapId: snapshot.state.mapId ?? 'nexus',
    ...(snapshot.state.modeId !== undefined ? { modeId: snapshot.state.modeId } : {}),
    gameTime: snapshot.state.time,
    startedAt: snapshot.state.startedAt ?? 0,
    timeScale: snapshot.clock?.timeScale ?? 1,
    capacity: playablePlayerIds(snapshot.state).length,
  };
}
export function archiveStateBytes(state: GameState): number {
  return Buffer.byteLength(JSON.stringify(state), 'utf8');
}
