import { missileVisible } from '../packages/shared-core/src/state/visibility';
import type { SightCircle } from '../packages/shared-core/src/state/visibility';
import type { Fleet, GameState } from '../packages/shared-core/src/state/gameState';
import type { GameData } from '../packages/shared-core/src/data/schemas';

/** Как клиент смотрит на мир этого кадра. */
export interface MissileLook {
  /** Сетевой матч: мир клиента — проекция сервера (`visibleState`). */
  net: boolean;
  /** Туман выключен (песочница соло). */
  fogOff: boolean;
  /** Круги зрения зрителя с его блоком. Лениво: в сети и без тумана они не нужны. */
  circles: () => readonly SightCircle[];
}

/**
 * Видна ли ракета (SM-3.7b) на карте клиента: рисовать ли её и давать ли выбрать.
 *
 * В сети мир клиента — уже проекция сервера, и чужая ракета в ней есть, только если сервер
 * счёл её видимой. Судит он по ПОЛНОМУ миру, кругами, которых проекция зрителю не отдаёт:
 * ракетная мина союзника видна лишь вблизи (`mineFleetVisible`), а её глаз в блоке зрения
 * считается. Пересчёт по проекции такую ракету терял — её нельзя было ни увидеть, ни выбрать
 * (замечание Codex на #1503). Поэтому в сети ответ — само присутствие в мире.
 *
 * Соло видит полный мир и решает сам, правилом ядра (`missileVisible`): своя ракета или
 * глаза блока зрения по её позиции. Выключенный туман открывает её, как любой флот.
 */
export function missileOnMap(
  world: GameState,
  missile: Fleet,
  viewer: string,
  data: GameData,
  look: MissileLook,
): boolean {
  if (look.net || look.fogOff) return true;
  return missileVisible(world, missile, viewer, data, look.circles());
}
