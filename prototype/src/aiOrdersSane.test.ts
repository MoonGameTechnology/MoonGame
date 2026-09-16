/**
 * СТОРОЖ КЛАССА ДЕФЕКТА: бот не должен отдавать приказы, которые ядро не понимает.
 *
 * Повод — живой случай. Механику дальнего огня убрали целиком (модуль `artillery` вышел
 * из графа, манифест 14), корпус `artillery` исчез из `data/*.json`, а ПРАВИЛО ПОСТРОЙКИ
 * в боте осталось и заказывало его каждый тик. Ядро отбивало `E_UNKNOWN_UNIT`, харнес
 * молча пропускал неудачное действие — 2493 отказа за 8 матчей замера, и ни одной
 * красной строки: отказ бота ничего не роняет.
 *
 * Поэтому проверяется не «нет ли в коде слова artillery» (это бы устарело на первом же
 * переименовании), а СЛЕДСТВИЕ: каждый заказ юнита и постройки называет то, что в
 * шипнутых данных есть.
 */
import { describe, expect, it } from 'vitest';
import { newGame, aiOrders, START_CANDIDATES } from './game';
import { data } from './gameData';
import type { GameState } from '../../packages/shared-core/src/index';

/** Богатая партия на войне: бедный бот не дошёл бы до половины своих правил. */
function richWar(): GameState {
  const s = newGame({
    seats: [
      { id: 'p1', name: 'A', faction: 'azure', start: START_CANDIDATES[0]!, ai: true },
      { id: 'p2', name: 'B', faction: 'crimson', start: START_CANDIDATES[1]!, ai: true },
    ],
  });
  return {
    ...s,
    diplomacy: { ...(s.diplomacy ?? {}), 'p1|p2': 'war' },
    players: {
      ...s.players,
      p2: {
        ...s.players.p2!,
        resources: { credits: 9000, metal: 9000, food: 900, energy: 900, microelectronics: 600 },
      },
    },
  };
}

describe('приказы бота называют существующий контент', () => {
  it('ЗАКАЗАННЫЙ ЮНИТ ЕСТЬ В ДАННЫХ — иначе правило живёт дольше своего контента', () => {
    const orders = aiOrders(richWar(), 'p2', 'expand', 'strong');
    const unknown = orders
      .filter((a) => a.type === 'unit.build')
      .map((a) => (a.payload as { unit: string }).unit)
      .filter((unit) => data.units[unit] === undefined);
    expect(unknown).toEqual([]);
  });

  it('ЗАКАЗАННАЯ ПОСТРОЙКА ЕСТЬ В ДАННЫХ', () => {
    const orders = aiOrders(richWar(), 'p2', 'expand', 'strong');
    const unknown = orders
      .filter((a) => a.type === 'building.construct')
      .map((a) => (a.payload as { building: string }).building)
      .filter((building) => data.buildings[building] === undefined);
    expect(unknown).toEqual([]);
  });
});
