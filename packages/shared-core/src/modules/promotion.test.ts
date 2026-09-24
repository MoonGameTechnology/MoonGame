import { describe, expect, it } from 'vitest';
import { createKernel } from '../kernel/kernel';
import type { GameModule } from '../kernel/module';
import {
  createInitialState,
  type Battle,
  type Fleet,
  type GameState,
  type Planet,
  type UnitStack,
} from '../state/gameState';
import { parseGameData, type GameData } from '../data/schemas';
import type { Action, Context } from '../action/types';
import { hookedDamage } from '../util/combat';
import { promotionModule } from './promotion';

/**
 * PERK-3.2 — СЛУЧАЙНЫЙ ПРОМОУШЕН.
 *
 * Три обещания кирпича, и тесты держат именно их: бросок идёт через seeded `rng`
 * (никакого `Math.random`), отметка живёт на стеке по арифметике сплита/слияния VET-2, а
 * прибавка попадает в ПОСЛЕДОВАТЕЛЬНУЮ группу — то есть множится поверх массовых
 * процентов, а не тонет в их сумме.
 */

const BONUS = 0.25;

function dataWith(chance: number, damageBonus = BONUS): GameData {
  return parseGameData({
    version: '0.1.0',
    resources: ['metal'],
    units: { cruiser: { faction: 'x', stats: { attack: 10, defense: 4, speed: 6, hp: 10 } } },
    factions: {},
    buildings: {},
    events: {},
    promotion: { chance, damageBonus },
  });
}

const stack = (count: number, promoted?: number): UnitStack => ({
  unit: 'cruiser',
  count,
  ...(promoted === undefined ? {} : { promoted }),
});

const planetAt = (garrison: UnitStack[]): Planet => ({
  id: 'A',
  owner: 'p1',
  position: { x: 0, y: 0 },
  resources: {},
  buildings: [],
  garrison,
  traits: [],
});

const fleetOf = (units: UnitStack[]): Fleet => ({
  id: 'f1',
  owner: 'p1',
  location: 'A',
  movement: null,
  traits: [],
  units,
});

/** Кладёт в ядро пробник, который эмитит `unit.built` действием игрока. */
function buildProbe(): GameModule {
  return {
    id: 'build-probe',
    version: '1.0.0',
    setup(api) {
      api.onAction('build', (a, h) => {
        const p = a.payload as { count: number };
        h.emit('unit.built', { planetId: 'A', unit: 'cruiser', count: p.count, owner: 'p1' });
      });
    },
  };
}

/** Прогоняет постройку `count` кораблей на сид `seed` и отдаёт отметку стека. */
function built(seed: string, count: number, chance: number, before?: UnitStack): number {
  const kernel = createKernel([buildProbe(), promotionModule]);
  const state = createInitialState({ seed, version: { data: '0.1.0', manifest: '1' } });
  state.planets.A = planetAt([before ?? stack(0)]);
  const first = state.planets.A.garrison[0]!;
  first.count += count; // постройка уже влита в стек, как это делает `addUnits`
  const action: Action = {
    id: 's:p1:1',
    type: 'build',
    playerId: 'p1',
    payload: { count },
    issuedAt: 0,
  };
  const r = kernel.applyAction(state, action, { now: 0, data: dataWith(chance) });
  if (!r.ok) throw new Error(`apply failed: ${r.code}`);
  return r.state.planets.A?.garrison[0]?.promoted ?? 0;
}

/** Кладёт очки в ПАРАЛЛЕЛЬНУЮ группу — они сложатся с чужими, а не умножатся. */
function parallelBonus(id: string, points: number): GameModule {
  return {
    id,
    version: '1.0.0',
    setup(api) {
      api.hook<number>('combat.damage.parallel', (sum) => sum + points);
    },
  };
}

/** Прогоняет 100 урона через ВЕСЬ конвейер для заданной сцены. */
function fire(
  scene: (s: GameState) => void,
  args: Record<string, unknown>,
  mods: GameModule[] = [],
): number {
  const probe: GameModule = {
    id: 'fire-probe',
    version: '1.0.0',
    setup(api) {
      api.onAction('fire', (_a, h) => {
        h.emit('probe.dealt', {
          dealt: hookedDamage(h, 100, {
            phase: 'orbital',
            location: 'A',
            attacker: 'p1',
            defender: 'p2',
            ...args,
          }),
        });
      });
    },
  };
  const kernel = createKernel([probe, promotionModule, ...mods]);
  const state = createInitialState({ seed: 'fire', version: { data: '0.1.0', manifest: '1' } });
  scene(state);
  const action: Action = { id: 's:p1:1', type: 'fire', playerId: 'p1', payload: {}, issuedAt: 0 };
  const ctx: Context = { now: 0, data: dataWith(0) }; // бросок не нужен, нужен только хук
  const r = kernel.applyAction(state, action, ctx);
  if (!r.ok) throw new Error(`apply failed: ${r.code}`);
  return (r.events.find((e) => e.type === 'probe.dealt')?.payload as { dealt: number }).dealt;
}

/** Сцена «бой флотов»: свои стеки у атакующего. */
const battleScene =
  (mine: UnitStack[]) =>
  (s: GameState): void => {
    s.fleets.f1 = fleetOf(mine);
    s.fleets.f2 = { ...fleetOf([stack(1)]), id: 'f2', owner: 'p2' };
    const battle: Battle = {
      id: 'b1',
      location: 'A',
      phase: 'orbital',
      round: 0,
      sides: [
        { ref: { kind: 'fleet', fleetId: 'f1' }, owner: 'p1', role: 'attacker' },
        { ref: { kind: 'fleet', fleetId: 'f2' }, owner: 'p2', role: 'defender' },
      ],
    };
    s.battles.b1 = battle;
  };

describe('промоушен — бросок при постройке (PERK-3.2)', () => {
  it('бросок идёт через SEEDED rng: один сид — один и тот же исход', () => {
    // Инвариант №1. Повторяемость и есть то, что делает реплей воспроизводимым.
    for (const seed of ['a', 'b', 'c']) {
      expect(built(seed, 4, 0.5)).toBe(built(seed, 4, 0.5));
    }
  });

  it('разные сиды дают разные исходы — бросок настоящий, а не константа', () => {
    const seeds = ['s1', 's2', 's3', 's4', 's5', 's6', 's7', 's8'];
    const marks = seeds.map((s) => built(s, 4, 0.5));
    expect(new Set(marks).size).toBeGreaterThan(1);
  });

  it('вероятность 0 — отметки нет никогда; 1 — всегда', () => {
    for (const seed of ['x', 'y', 'z']) {
      expect(built(seed, 3, 0)).toBe(0);
      expect(built(seed, 3, 1)).toBe(1);
    }
  });

  it('заказ, влитый в необстрелянный стек, отмечает ТОЛЬКО свою часть', () => {
    // Два корабля уже стояли, построили два — отмечена половина, а не весь стек.
    expect(built('mix', 2, 1, stack(2))).toBeCloseTo(0.5, 9);
  });

  it('заказ в УЖЕ отмеченный стек считается по весу', () => {
    // 2 отмеченных + 2 новых отмеченных = все четыре.
    expect(built('mix', 2, 1, stack(2, 1))).toBeCloseTo(1, 9);
    // Обратный случай — «долив НЕотмеченных разбавляет» — здесь НЕ проверяется, и это
    // не пропуск: разбавление делает `addUnits`/`mergeMerit`, а не этот модуль. Первая
    // версия теста проверяла его на подделанном харнессе (тот просто увеличивал `count`)
    // и поэтому меряла собственную фикстуру. Настоящее правило живёт в `stacks.test.ts`.
  });
});

describe('промоушен — прибавка в ПОСЛЕДОВАТЕЛЬНОЙ группе (PERK-3.2)', () => {
  it('отмеченный стек бьёт сильнее, обычный — как раньше', () => {
    expect(fire(battleScene([stack(10)]), { battleId: 'b1' })).toBe(100);
    expect(fire(battleScene([stack(10, 1)]), { battleId: 'b1' })).toBeCloseTo(125, 9);
  });

  it('прибавка идёт ДОЛЕЙ отмеченных, а не «есть/нет»', () => {
    // Половина стороны отмечена — половина прибавки.
    expect(fire(battleScene([stack(5, 1), stack(5)]), { battleId: 'b1' })).toBeCloseTo(112.5, 9);
  });

  it('МНОЖИТСЯ с массовыми процентами, а не складывается с ними', () => {
    // Главное обещание кирпича: 100 × 1.25 × 1.5 = 187.5. Попади прибавка в массовую
    // корзину — вышло бы 100 × (1 + 0.25 + 0.5) = 175, то есть «копейки» из заказа.
    const mixed = fire(battleScene([stack(10, 1)]), { battleId: 'b1' }, [parallelBonus('p', 0.5)]);
    expect(mixed).toBeCloseTo(187.5, 9);
    expect(mixed).not.toBeCloseTo(175, 6);
  });

  it('работает и ВНЕ боя — по флоту, который стреляет', () => {
    // Обстрел с орбиты, перехват, удар челноков: боя нет, флот есть. Отметка принадлежит
    // кораблю, а не бою, и пропадать на этих каналах она не имеет права.
    const scene = (s: GameState): void => {
      s.fleets.f1 = fleetOf([stack(4, 1)]);
    };
    expect(fire(scene, { battleId: undefined, phase: 'bombard', attackerFleet: 'f1' })).toBeCloseTo(
      125,
      9,
    );
  });

  it('чужая отметка атакующему не достаётся', () => {
    const scene = (s: GameState): void => {
      battleScene([stack(10)])(s);
      s.fleets.f2!.units = [stack(10, 1)];
    };
    expect(fire(scene, { battleId: 'b1' })).toBe(100);
  });

  it('ноль в данных выключает механику, пропавший бой не роняет выстрел', () => {
    expect(fire(battleScene([stack(10, 1)]), { battleId: 'gone' })).toBe(100);
    expect(fire(battleScene([stack(10, 1)]), { attacker: null })).toBe(100);
  });
});
