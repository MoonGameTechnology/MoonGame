import { describe, expect, it } from 'vitest';
import { createKernel } from '../kernel/kernel';
import type { GameModule } from '../kernel/module';
import { createInitialState, type GameState } from '../state/gameState';
import { parseGameData, type GameData } from '../data/schemas';
import type { Action, ApplyResult, Context } from '../action/types';
import { hookedDamage, MITIGATION_CAP } from '../util/combat';

/**
 * PERK-2.1 — снижение урона идёт ОДНИМ пулом, одной формой, с одним капом.
 *
 * Раньше каждый источник делил урон сам: форт, счёт стоящих зданий, тип планеты и
 * проходимость сектора — четыре независимых деления, то есть скрытый компаунд в защите.
 * Замедление прироста работало ВНУТРИ источника и не работало МЕЖДУ источниками, а формы
 * были разные (два деления, одно умножение на линейную долю с собственным капом 90%).
 *
 * Теперь источники складывают ОЧКИ в хук `combat.mitigation`, а производитель урона
 * применяет их один раз: `урон / (1 + R)`, не ниже `1 - MITIGATION_CAP` от базы.
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

/** Контрибьютор очков снижения — столько же, сколько положил бы реальный источник. */
function mitigator(id: string, points: number): GameModule {
  return {
    id,
    version: '1.0.0',
    setup(api) {
      api.hook<number>('combat.mitigation', (sum) => sum + points);
    },
  };
}

/** Прогоняет 100 единиц урона через производителя и отдаёт, сколько осталось. */
const probe: GameModule = {
  id: 'mitigation-probe',
  version: '1.0.0',
  setup(api) {
    api.onAction('fire', (a, h) => {
      const base = (a.payload as { base: number }).base;
      h.emit('probe.dealt', {
        dealt: hookedDamage(h, base, {
          phase: 'ground',
          location: 'P',
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
    seed: 'mit',
    version: { data: '0.1.0', manifest: '1' },
  });
  const action: Action = {
    id: 's:p1:1',
    type: 'fire',
    playerId: 'p1',
    payload: { base },
    issuedAt: 0,
  };
  const r: ApplyResult = kernel.applyAction(state, action, ctx());
  if (!r.ok) throw new Error(`apply failed: ${r.code}`);
  const event = r.events.find((e) => e.type === 'probe.dealt');
  return (event?.payload as { dealt: number }).dealt;
}

describe('снижение урона — один пул (PERK-2.1)', () => {
  it('без источников урон проходит нетронутым', () => {
    expect(fire([])).toBe(100);
  });

  it('два источника СКЛАДЫВАЮТ очки, а не делят по очереди', () => {
    // Пул: 100 / (1 + 0.5 + 0.5) = 50. Прежний компаунд дал бы
    // 100 / 1.5 / 1.5 = 44.4 — то есть защита была сильнее, чем сумма её частей.
    expect(fire([mitigator('a', 0.5), mitigator('b', 0.5)])).toBeCloseTo(50, 9);
    expect(fire([mitigator('a', 1.0)])).toBeCloseTo(50, 9);
  });

  it('прирост снижения замедляется по мере роста пула', () => {
    const at = (r: number) => 1 - fire([mitigator('a', r)]) / 100;
    const step1 = at(1) - at(0); // первая единица очков
    const step2 = at(2) - at(1); // вторая
    const step3 = at(3) - at(2); // третья
    expect(step1).toBeGreaterThan(step2);
    expect(step2).toBeGreaterThan(step3);
  });

  it('снижение не достигает 100% ни при каком пуле и упирается в кап', () => {
    const huge = fire([mitigator('a', 1e6)]);
    expect(huge).toBeGreaterThan(0); // мир не становится неуязвимым
    expect(huge).toBeCloseTo(100 * (1 - MITIGATION_CAP), 9);
  });

  it('отрицательные очки УСИЛИВАЮТ урон — враждебный мир не защищает', () => {
    // Тип планеты с defenseBonus -0.25 сегодня умножает урон на 1/0.75.
    expect(fire([mitigator('hostile', -0.25)])).toBeCloseTo(100 / 0.75, 9);
  });

  it('пул ≤ -1 не делит на ноль и не переворачивает знак (fail-secure)', () => {
    expect(fire([mitigator('a', -1)])).toBe(100);
    expect(fire([mitigator('a', -5)])).toBe(100);
  });
});
