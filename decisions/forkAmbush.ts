import { forkAt } from '../packages/shared-core/src/state/roads';
import type { Fleet, GameState } from '../packages/shared-core/src/state/gameState';

/**
 * Стоит ли флот в засаде (ROADS-4): на какой развилке он стоит и какие дороги сторожит.
 *
 * Засада — не отдельный приказ и не поле в состоянии: это стоянка РОВНО на развилке, и
 * встречу на ней назначает ядро (ROADS-3, `intercept`). Поэтому ответ берётся у ядра
 * (`forkAt` — тот же допуск на округление, по которому ловит перехват), а не пересчитывается
 * здесь: прочти клиент развилку иначе, чем ядро, — и подпись «в засаде» висела бы над
 * флотом, который никого не ловит.
 *
 * Идущий флот, стоящий у планеты и дерущийся — не в засаде: первый ещё не встал, второй
 * стоит не на дороге, третий уже поймал.
 */
export function ambushOf(
  state: GameState,
  fleet: Pick<Fleet, 'location' | 'movement' | 'edge' | 'battleId'>,
): { province: string; exits: string[] } | null {
  const e = fleet.edge;
  if (fleet.location || fleet.movement || fleet.battleId || !e) return null;
  return forkAt(state, e.from, e.to, e.t);
}
