// ХОД СЛАБОГО БОТА НУЖНОГО ВИДА — подставка для тестов.
//
// Слабый бот знает то же, что сильный (заказ владельца 2026-09-28), но в части двухчасовых
// окон молчит, а в части играет простым ботом (2026-10-01, `WEAK_HANDICAP` в `ai.ts`). Тест
// «слабый умеет X» поэтому спрашивает его в окне, где он ходит в полную силу, а тест
// «слабый молчит» — в окне пропуска: иначе он проверял бы жребий окна, а не правило.
import type { GameState } from '../../packages/shared-core/src/index';
import { weakTurn } from './ai';

/** Тот же мир в ближайшем окне, где ход слабого бота `seat` выпал видом `turn`: сдвигаются
 *  только часы мира. */
export function atWeakTurn(
  state: GameState,
  turn: ReturnType<typeof weakTurn>,
  seat = 'p2',
): GameState {
  for (let k = 0; k < 24; k++) {
    const s = { ...state, time: state.time + k * 2 * 3_600_000 };
    if (weakTurn(s, seat) === turn) return s;
  }
  throw new Error(`no ${turn} turn for ${seat} within 48 h`);
}
