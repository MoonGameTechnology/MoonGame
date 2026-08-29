import { describe, expect, it } from 'vitest';
import { retreatOrders } from './aiRetreat';
import type { GameState } from '../../packages/shared-core/src/index';

/** Минимальное состояние: один бой, две стороны-флота. */
function battleState(opts: {
  mine: { unit: string; count: number }[];
  theirs: { unit: string; count: number }[];
  /** Моя сторона в бою: атакующая или обороняющаяся. */
  side?: 'attacker' | 'defender';
  /** Моя сторона — десант (высадка), а не корабли. */
  landing?: boolean;
  inBattle?: boolean;
}): GameState {
  const side = opts.side ?? 'attacker';
  const mineRef = opts.landing
    ? { kind: 'landing' as const, fleetId: 'F' }
    : { kind: 'fleet' as const, fleetId: 'F' };
  const theirRef = { kind: 'fleet' as const, fleetId: 'E' };
  const state = {
    time: 0,
    players: { p1: { id: 'p1' }, p2: { id: 'p2' } },
    planets: {},
    fleets: {
      F: {
        id: 'F',
        owner: 'p1',
        location: 'A',
        movement: null,
        units: opts.landing ? [{ unit: 'cruiser', count: 1 }] : opts.mine,
        landing: opts.landing ? opts.mine : [],
        traits: [],
        battleId: opts.inBattle === false ? null : 'b1',
      },
      E: {
        id: 'E',
        owner: 'p2',
        location: 'A',
        movement: null,
        units: opts.theirs,
        traits: [],
        battleId: 'b1',
      },
    },
    battles:
      opts.inBattle === false
        ? {}
        : {
            b1: {
              id: 'b1',
              location: 'A',
              phase: opts.landing ? 'ground' : 'orbital',
              attacker: {
                ref: side === 'attacker' ? mineRef : theirRef,
                owner: side === 'attacker' ? 'p1' : 'p2',
              },
              defender: {
                ref: side === 'attacker' ? theirRef : mineRef,
                owner: side === 'attacker' ? 'p2' : 'p1',
              },
              round: 3,
            },
          },
  } as unknown as GameState;
  return state;
}

const ids = (state: GameState): string[] =>
  retreatOrders(state, 'p1').map((a) => `${a.type}:${(a.payload as { fleetId: string }).fleetId}`);

describe('бот умеет выйти из проигранного боя (AI-BAL-7)', () => {
  it('ПРОИГРАННЫЙ ПРОГНОЗ — ОТСТУПАЕМ: иначе флот дерётся до нуля и размен всегда полный', () => {
    // Один разведчик против шести крейсеров: прогноз однозначен.
    const state = battleState({
      mine: [{ unit: 'scout', count: 1 }],
      theirs: [{ unit: 'cruiser', count: 6 }],
    });
    expect(ids(state)).toEqual(['fleet.retreat:F']);
  });

  it('ВЫИГРАННЫЙ ПРОГНОЗ — ДЕРЁМСЯ, даже если драка дорогая', () => {
    // Пошлина за выход — 40% ТЕКУЩЕГО корпуса, поэтому бежать от выигранной драки
    // убыточно: победа оставляет и флот, и убитого врага.
    const state = battleState({
      mine: [{ unit: 'cruiser', count: 6 }],
      theirs: [{ unit: 'scout', count: 1 }],
    });
    expect(ids(state)).toEqual([]);
  });

  it('решение одинаково с обеих сторон боя — роль в бою не меняет арифметику', () => {
    const asDefender = battleState({
      mine: [{ unit: 'scout', count: 1 }],
      theirs: [{ unit: 'cruiser', count: 6 }],
      side: 'defender',
    });
    expect(ids(asDefender)).toEqual(['fleet.retreat:F']);
  });

  it('ДЕСАНТ В РАЗГАРЕ ВЫСАДКИ НЕ ОТСТУПАЕТ — ядро это отклоняет (E_CANNOT_RETREAT)', () => {
    // Слать заведомо отклоняемое действие значит гнать мусор в редьюсер и портить
    // статистику реджектов, по которой читают здоровье прогона.
    const state = battleState({
      mine: [{ unit: 'militia', count: 1 }],
      theirs: [{ unit: 'tank', count: 8 }],
      landing: true,
    });
    expect(ids(state)).toEqual([]);
  });

  it('вне боя приказа нет — `fleet.retreat` там отклоняется (E_NOT_IN_BATTLE)', () => {
    const state = battleState({
      mine: [{ unit: 'scout', count: 1 }],
      theirs: [{ unit: 'cruiser', count: 6 }],
      inBattle: false,
    });
    expect(ids(state)).toEqual([]);
  });

  it('чужой бой — не наше дело', () => {
    const state = battleState({
      mine: [{ unit: 'scout', count: 1 }],
      theirs: [{ unit: 'cruiser', count: 6 }],
    });
    expect(retreatOrders(state, 'p2')).toEqual([]);
  });
});
