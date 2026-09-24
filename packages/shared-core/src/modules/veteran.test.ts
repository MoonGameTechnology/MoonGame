import { describe, expect, it } from 'vitest';
import { createKernel } from '../kernel/kernel';
import type { GameModule } from '../kernel/module';
import {
  createInitialState,
  type Battle,
  type Fleet,
  type GameState,
  type UnitStack,
} from '../state/gameState';
import { parseGameData, type GameData } from '../data/schemas';
import type { Action, Context } from '../action/types';
import { hookedDamage } from '../util/combat';
import { veteranModule } from './veteran';

/**
 * PERK-3.1 — надбавка за ПЕРЕЖИТЫЕ БОИ (триггер выбран владельцем 2026-09-23).
 *
 * Два обещания кирпича, и тесты держат именно их: множитель привязан к счётчику боёв и
 * попадает в ПОСЛЕДОВАТЕЛЬНУЮ группу, а не в параллельную. Второе проверяется не чтением
 * кода, а поведением — смесью с заведомо параллельным вкладом: сложись они в одну группу,
 * итог был бы суммой, а не произведением.
 */

const RATE = 0.04;

function dataWith(rate: number): GameData {
  return parseGameData({
    version: '0.1.0',
    resources: ['metal'],
    units: {},
    factions: {},
    buildings: {},
    events: {},
    veteran: { damagePerBattle: rate },
  });
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

const stack = (count: number, battles?: number): UnitStack => ({
  unit: 'u',
  count,
  ...(battles === undefined ? {} : { battles }),
});

/** Бой «флот p1 против флота p2» с заданным составом нападающего. */
function stateWith(attackerUnits: UnitStack[]): GameState {
  const state = createInitialState({ seed: 'vet', version: { data: '0.1.0', manifest: '1' } });
  const fleet = (id: string, owner: string, units: UnitStack[]): Fleet => ({
    id,
    owner,
    location: 'x',
    movement: null,
    traits: [],
    units,
  });
  state.fleets.f1 = fleet('f1', 'p1', attackerUnits);
  state.fleets.f2 = fleet('f2', 'p2', [stack(1)]);
  const battle: Battle = {
    id: 'b1',
    location: 'x',
    phase: 'orbital',
    round: 0,
    sides: [
      { ref: { kind: 'fleet', fleetId: 'f1' }, owner: 'p1', role: 'attacker' },
      { ref: { kind: 'fleet', fleetId: 'f2' }, owner: 'p2', role: 'defender' },
    ],
  };
  state.battles.b1 = battle;
  return state;
}

/** Прогоняет 100 урона через ВЕСЬ конвейер `hookedDamage` на настоящем ядре. */
function fire(
  state: GameState,
  mods: GameModule[] = [],
  args: Record<string, unknown> = {},
  rate = RATE,
): number {
  const probe: GameModule = {
    id: 'vet-probe',
    version: '1.0.0',
    setup(api) {
      api.onAction('fire', (_a, h) => {
        h.emit('probe.dealt', {
          dealt: hookedDamage(h, 100, {
            battleId: 'b1',
            phase: 'orbital',
            location: 'x',
            attacker: 'p1',
            defender: 'p2',
            ...args,
          }),
        });
      });
    },
  };
  const kernel = createKernel([probe, veteranModule, ...mods]);
  const action: Action = { id: 's:p1:1', type: 'fire', playerId: 'p1', payload: {}, issuedAt: 0 };
  const ctx: Context = { now: 0, data: dataWith(rate) };
  const r = kernel.applyAction(state, action, ctx);
  if (!r.ok) throw new Error(`apply failed: ${r.code}`);
  return (r.events.find((e) => e.type === 'probe.dealt')?.payload as { dealt: number }).dealt;
}

describe('надбавка ветерана — привязка к пережитым боям (PERK-3.1)', () => {
  it('необстрелянная сторона бьёт ровно как раньше', () => {
    // Поля `battles` нет вовсе — это матч без единого боя, и надбавке взяться неоткуда.
    expect(fire(stateWith([stack(10)]))).toBe(100);
    // Поле есть, но ноль — тот же ответ, и это не одно и то же для читателя состояния.
    expect(fire(stateWith([stack(10, 0)]))).toBe(100);
  });

  it('каждый пережитый бой прибавляет свою ставку', () => {
    for (const battles of [1, 2, 3, 4]) {
      expect(fire(stateWith([stack(10, battles)])), `${battles} боёв`).toBeCloseTo(
        100 * (1 + RATE * battles),
        9,
      );
    }
  });

  it('ставка живёт в ДАННЫХ: ноль выключает механику целиком', () => {
    // Снять надбавку = поправить `data/veteran.json`, а не искать флаг в коде.
    expect(fire(stateWith([stack(10, 4)]), [], {}, 0)).toBe(100);
  });
});

describe('надбавка ветерана — как складываются разные стеки (PERK-3.1)', () => {
  it('считается СРЕДНЕЕ НА ЮНИТ, а не на стек', () => {
    // 10 необстрелянных + 10 с четырьмя боями = 2 боя на юнит, а не 2 «на стек».
    expect(fire(stateWith([stack(10, 0), stack(10, 4)]))).toBeCloseTo(100 * (1 + RATE * 2), 9);
  });

  it('развеска ПО ГОЛОВАМ: долив свежих разбавляет надбавку', () => {
    // Цена удобства, уже записанная в правиле слияния стеков VET-2. Тот же заслуженный
    // стек, но рядом втрое больше новобранцев — среднее падает вчетверо.
    const veterans = fire(stateWith([stack(10, 4)]));
    const diluted = fire(stateWith([stack(10, 4), stack(30, 0)]));
    expect(veterans).toBeCloseTo(100 * (1 + RATE * 4), 9);
    expect(diluted).toBeCloseTo(100 * (1 + RATE * 1), 9);
    expect(diluted).toBeLessThan(veterans);
  });

  it('убыль уменьшает надбавку ровно на своих', () => {
    // Здесь стоял тест «стек с count: 0 в среднее не входит». ПОРЧА его не уронила:
    // взвешивание по `count` обнуляет вклад пустого стека само, то есть и проверка в
    // модуле, и тест под неё были мёртвыми (та же находка, что в VET-4). Переписан на
    // ЧАСТИЧНЫЕ потери — вот их порча уже ловит.
    const full = fire(stateWith([stack(10, 4), stack(6, 0)])); // 40/16 = 2.5 боя на юнит
    const mauled = fire(stateWith([stack(4, 4), stack(6, 0)])); // 16/10 = 1.6
    expect(full).toBeCloseTo(100 * (1 + RATE * 2.5), 9);
    expect(mauled).toBeCloseTo(100 * (1 + RATE * 1.6), 9);
    expect(mauled).toBeLessThan(full);
  });

  it('заслуга ЧУЖОЙ стороны нападающему не достаётся', () => {
    const state = stateWith([stack(10)]);
    state.fleets.f2!.units = [stack(10, 4)];
    expect(fire(state)).toBe(100);
  });
});

describe('надбавка ветерана — ПОСЛЕДОВАТЕЛЬНАЯ группа (PERK-3.1)', () => {
  it('множится с параллельным вкладом, а не складывается с ним', () => {
    // Главное обещание кирпича. Ветеран даёт +16%, параллельный вклад +50%.
    // Последовательная группа: 100 × 1.16 × 1.50 = 174.
    // Сложись они в одну корзину, вышло бы 100 × (1 + 0.16 + 0.50) = 166.
    const mixed = fire(stateWith([stack(10, 4)]), [parallelBonus('p', 0.5)]);
    expect(mixed).toBeCloseTo(100 * 1.16 * 1.5, 9);
    expect(mixed).not.toBeCloseTo(100 * (1 + 0.16 + 0.5), 6);
  });

  it('не теряет относительной величины от чужих процентов — в этом смысл группы', () => {
    // Редкий класс тем и ценен, что не обесценивается массовым: и без параллельного
    // вклада, и поверх него ветеран прибавляет одни и те же 16% относительно.
    const rel = (withVet: number, without: number) => (withVet - without) / without;
    const alone = rel(fire(stateWith([stack(10, 4)])), fire(stateWith([stack(10, 0)])));
    const onTop = rel(
      fire(stateWith([stack(10, 4)]), [parallelBonus('p', 2)]),
      fire(stateWith([stack(10, 0)]), [parallelBonus('p', 2)]),
    );
    expect(alone).toBeCloseTo(0.16, 9);
    expect(onTop).toBeCloseTo(0.16, 9);
  });
});

describe('надбавка ветерана — деградация без падения (PERK-3.1)', () => {
  it('канал без боя надбавки не даёт', () => {
    // Обстрел с орбиты, перехват и вылет эскадрильи `battleId` не несут — и боями не
    // считаются: `creditBattle` их не начисляет, значит и платить по ним не за что.
    const state = stateWith([stack(10, 4)]);
    expect(fire(state, [], { battleId: undefined, phase: 'bombard' })).toBe(100);
  });

  it('пропавший бой и безымянный нападающий — база, а не исключение', () => {
    const state = stateWith([stack(10, 4)]);
    expect(fire(state, [], { battleId: 'gone' })).toBe(100);
    expect(fire(state, [], { attacker: null })).toBe(100);
  });

  it('состояние не мутируется: хук только читает', () => {
    const state = stateWith([stack(10, 4)]);
    const before = JSON.stringify(state);
    fire(state, [parallelBonus('p', 0.5)]);
    expect(JSON.stringify(state)).toBe(before);
  });
});
