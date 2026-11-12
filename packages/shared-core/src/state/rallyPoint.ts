/**
 * Точка сбора мира (RALLY-1): куда сами летят корабли, построенные в этом мире.
 *
 * Запись живёт в `state.rallyPoints` (игрок → мир → цель); ставит её `autoRallyModule`,
 * а ЧИТАЮТ и модуль, и клиент — отсюда, чтобы правило «действует ли точка» было одно.
 * Точка действует, пока мир-источник принадлежит игроку: потерянный мир не шлёт
 * подкреплений захватчику. Цель — любой мир (RALLY-2, 2026-11-12), и смена её хозяина
 * точку не снимает: закрытую территорию на пути разбирает модуль движения.
 */
import type { GameState, PlanetId, PlayerId } from './gameState';

/** Цель точки сбора мира `planetId` у игрока `owner`, или `null`, если точки нет или она
 *  перестала действовать (мир больше не его, цели нет на карте). */
export function rallyPointOf(
  state: Pick<GameState, 'rallyPoints' | 'planets'>,
  owner: PlayerId,
  planetId: PlanetId,
): PlanetId | null {
  const to = state.rallyPoints?.[owner]?.[planetId];
  if (to === undefined || to === planetId) return null;
  if (state.planets[planetId]?.owner !== owner) return null;
  if (!state.planets[to]) return null;
  return to;
}
