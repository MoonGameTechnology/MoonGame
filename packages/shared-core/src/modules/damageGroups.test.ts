import { describe, expect, it } from 'vitest';
import { createKernel } from '../kernel/kernel';
import type { GameModule } from '../kernel/module';
import { createInitialState, type GameState } from '../state/gameState';
import { parseGameData, type GameData } from '../data/schemas';
import type { Action, Context } from '../action/types';
import { hookedDamage } from '../util/combat';

/**
 * PERK-1.1 — у бонусов урона ДВА способа складываться, и группа решает какой.
 *
 * Формула владельца (PERK-0.1): `база × (1 + Σ параллельных) × Π(последовательных)`.
 * Параллельные — массовый класс, складываются между собой, поэтому каждый следующий
 * обесценивается сам: одиннадцатый «+10%» добавляет десятую долю базы к уже набранным
 * двум сотням процентов. Последовательные — редкий класс, множатся отдельно и своей
 * относительной величины не теряют никогда.
 *
 * Механизм вводится ПУСТЫМ: ни один каталог пока не переведён, поэтому поведение
 * обязано совпасть с прежним до бита (перенос и замер — PERK-1.2). Тест «пустая
 * параллельная группа ничего не меняет» держит это обещание.
 */

const data: GameData = parseGameData({
  version: '0.1.0',
  resources: ['metal'],
  units: {},
  factions: {},
  buildings: {},
  events: {},
});

const ctx = (): Context => ({ now: 0, data });

/** Кладёт очки в ПАРАЛЛЕЛЬНУЮ группу — они сложатся с чужими. */
function parallelBonus(id: string, points: number): GameModule {
  return {
    id,
    version: '1.0.0',
    setup(api) {
      api.hook<number>('combat.damage.parallel', (sum) => sum + points);
    },
  };
}

/** Множит в ПОСЛЕДОВАТЕЛЬНОЙ группе — умножение поверх всего, что уже набрано. */
function sequentialBonus(id: string, factor: number): GameModule {
  return {
    id,
    version: '1.0.0',
    setup(api) {
      api.hook<number>('combat.damage', (dmg) => dmg * factor);
    },
  };
}

const probe: GameModule = {
  id: 'groups-probe',
  version: '1.0.0',
  setup(api) {
    api.onAction('fire', (a, h) => {
      h.emit('probe.dealt', {
        dealt: hookedDamage(h, (a.payload as { base: number }).base, {
          phase: 'orbital',
          location: '',
          attacker: 'p1',
          defender: 'p2',
        }),
      });
    });
  },
};

function fire(mods: GameModule[], base = 100): number {
  const kernel = createKernel([probe, ...mods]);
  const state: GameState = createInitialState({
    seed: 'grp',
    version: { data: '0.1.0', manifest: '1' },
  });
  const action: Action = {
    id: 's:p1:1',
    type: 'fire',
    playerId: 'p1',
    payload: { base },
    issuedAt: 0,
  };
  const r = kernel.applyAction(state, action, ctx());
  if (!r.ok) throw new Error(`apply failed: ${r.code}`);
  return (r.events.find((e) => e.type === 'probe.dealt')?.payload as { dealt: number }).dealt;
}

describe('группы бонусов урона (PERK-1.1)', () => {
  it('пустая параллельная группа ничего не меняет — механизм вводится инертным', () => {
    expect(fire([])).toBe(100);
    expect(fire([sequentialBonus('a', 1.5)])).toBeCloseTo(150, 9);
  });

  it('параллельные СКЛАДЫВАЮТСЯ между собой', () => {
    // +50% и +50% дают ×2.0, а не ×2.25: массовый класс не компаундится.
    expect(fire([parallelBonus('a', 0.5), parallelBonus('b', 0.5)])).toBeCloseTo(200, 9);
  });

  it('последовательные ПЕРЕМНОЖАЮТСЯ — в этом их ценность', () => {
    expect(fire([sequentialBonus('a', 1.5), sequentialBonus('b', 1.5)])).toBeCloseTo(225, 9);
  });

  it('следующий параллельный обесценивается, следующий последовательный — нет', () => {
    const relGain = (before: number, after: number) => (after - before) / before;
    const par1 = fire([parallelBonus('a', 1.0)]);
    const par2 = fire([parallelBonus('a', 1.0), parallelBonus('b', 1.0)]);
    const seq1 = fire([sequentialBonus('a', 2)]);
    const seq2 = fire([sequentialBonus('a', 2), sequentialBonus('b', 2)]);
    // Второй параллельный «+100%» прибавил к итогу меньше, чем первый (0.5 против 1.0);
    // второй последовательный ×2 прибавил ровно столько же (1.0).
    expect(relGain(par1, par2)).toBeCloseTo(0.5, 9);
    expect(relGain(seq1, seq2)).toBeCloseTo(1.0, 9);
  });

  it('порядок модулей не влияет на результат при смеси групп', () => {
    const mods = [
      parallelBonus('p1', 0.2),
      sequentialBonus('s1', 1.3),
      parallelBonus('p2', 0.45),
      sequentialBonus('s2', 1.1),
    ];
    const straight = fire(mods);
    const reversed = fire([...mods].reverse());
    const shuffled = fire([mods[2]!, mods[0]!, mods[3]!, mods[1]!]);
    // 100 × (1 + 0.65) × 1.3 × 1.1
    expect(straight).toBeCloseTo(100 * 1.65 * 1.3 * 1.1, 9);
    expect(reversed).toBeCloseTo(straight, 9);
    expect(shuffled).toBeCloseTo(straight, 9);
  });
});
