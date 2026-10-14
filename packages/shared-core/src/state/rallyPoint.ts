/**
 * Точка сбора мира (RALLY-1): куда сами летят корабли, построенные в этом мире.
 *
 * Запись живёт в `state.rallyPoints` (игрок → мир → цель); ставит её `autoRallyModule`,
 * а ЧИТАЮТ и модуль, и клиент — отсюда, чтобы правило «действует ли точка» было одно.
 * Точка действует, пока оба мира — источник и цель — принадлежат игроку: потерянный мир
 * не шлёт подкреплений захватчику и не принимает их от хозяина.
 */
import type { GameState, PlanetId, PlayerId } from './gameState';

/** Цель точки сбора мира `planetId` у игрока `owner`, или `null`, если точки нет или она
 *  перестала действовать (мир или цель больше не его). */
export function rallyPointOf(
  state: Pick<GameState, 'rallyPoints' | 'planets'>,
  owner: PlayerId,
  planetId: PlanetId,
): PlanetId | null {
  const to = state.rallyPoints?.[owner]?.[planetId];
  if (to === undefined || to === planetId) return null;
  if (state.planets[planetId]?.owner !== owner) return null;
  if (state.planets[to]?.owner !== owner) return null;
  return to;
}
