import { describe, it, expect, afterEach } from 'vitest';

import { advance, order, setMatchMode } from './game';
import { data } from './gameData';
import { initSoloDrivers } from './soloDrivers';
import { pveState, pveModeId } from '../../packages/client/src/gameData';
import type { Action, GameState } from '../../packages/shared-core/src/index';
import type { AiProfile } from './ai';

/**
 * PVR-1.6 — сквозной прогон ЗАБЕГА на шипнутой карте `pve-1`, через настоящие функции
 * хоста: `advance`/`order` плюс те же `soloDrivers`, что гоняет кадр прототипа. Копии
 * их политики здесь нет намеренно — подделаны только пути приказов.
 *
 * Зачем такой тест вообще. Модульные тесты волн были зелёными всё время, пока забег
 * был непроходим: волны исправно создавались и стояли в улье (PVR-1.5), состав был
 * слабее стартового флота игрока (PVR-1.3), матч кончался чужой победой по
 * доминированию на 30-м часу, а защищённый дом игрока нельзя было взять вовсе.
 * Каждая из этих поломок жила МЕЖДУ модулями — между картой, режимом, дипломатией,
 * победой и клиентскими драйверами, — и ловится только прогоном целиком.
 *
 * Игрок здесь ПАССИВЕН: ни одного своего приказа, авто-штурм не включён. Это нижняя
 * граница — «что карта делает сама». Она обязана кончаться вердиктом.
 */

const HOUR = 3_600_000;

interface RunOut {
  state: GameState;
  endedAtHour?: number;
  groundBattleAtHome?: number;
}

function runIdlePlayer(maxHours: number): RunOut {
  setMatchMode(pveModeId());
  let s: GameState = pveState(data);
  let groundBattleAtHome: number | undefined;
  let hour = 0;

  const apply = (a: Action): void => {
    const out = order(s, a, s.time);
    if (!out.error) {
      s = out.state;
      for (const e of out.events) {
        if (
          groundBattleAtHome === undefined &&
          e.type === 'battle.started' &&
          (e.payload as { location?: string; phase?: string }).location === 'home_a' &&
          (e.payload as { phase?: string }).phase === 'ground'
        ) {
          groundBattleAtHome = hour;
        }
      }
    }
  };

  const drivers = initSoloDrivers({
    state: () => s,
    me: () => 'p1',
    // Ровно то, что делает `startPvEMatch()`: бот садится на каждое место, кроме игрока.
    aiSeats: () =>
      new Map<string, AiProfile>(
        Object.keys(s.players)
          .filter((id) => id !== 'p1')
          .map((id) => [id, 'weak' as const]),
      ),
    applyLocal: apply,
    playerOrder: apply,
    autoAssault: () => false, // игрок пассивен: свой флот сам не штурмует
    patrols: () => new Map(),
    known: () => true,
  });

  for (hour = 1; hour <= maxHours; hour++) {
    s = advance(s, hour * HOUR).state;
    if (s.match.status === 'ended') return { state: s, endedAtHour: hour, groundBattleAtHome };
    drivers.runAI();
    drivers.autoEngage();
    drivers.checkFleetClashes();
  }
  return { state: s, groundBattleAtHome };
}

describe('забег на карте pve-1 доходит до вердикта (PVR-1.6)', () => {
  // Режим принадлежит МАТЧУ: следующий не должен унаследовать чужой.
  afterEach(() => setMatchMode(undefined));

  it('пассивный игрок ПРОИГРЫВАЕТ забег — и именно по-PvE-шному', () => {
    const { state, endedAtHour } = runIdlePlayer(400);
    expect({ ended: state.match.status, reason: state.match.reason }).toEqual({
      ended: 'ended',
      reason: 'pve-failed',
    });
    expect(state.match.winner).toBe('p3');
    // Верхняя граница, а не точное число: она ловит «забег не кончается никогда»,
    // не ломаясь от любой правки баланса. Замер на момент кирпича — 139-й час.
    expect(endedAtHour).toBeLessThan(300);
  });

  it('штурм доходит до дома игрока и высаживается — а не стоит на орбите', () => {
    // Раньше волна могла взять только ПУСТОЙ сектор (приходом). Дом с гарнизоном
    // требует второй фазы, и без десанта флот копился на орбите вечно.
    const { groundBattleAtHome } = runIdlePlayer(400);
    expect(groundBattleAtHome).toBeDefined();
  });

  it('волны идут по расписанию всё это время, а не глохнут на первой', () => {
    const { state } = runIdlePlayer(400);
    expect(state.pve?.waveNumber).toBeGreaterThanOrEqual(10);
  });
});
