import { describe, expect, it } from 'vitest';
import { parseGameData, type GameData } from '../packages/shared-core/src/index';
import type { Squadron } from '../packages/shared-core/src/state/gameState';
import { planDrop } from './dropPlan';

const data: GameData = parseGameData({
  version: '0.1.0',
  resources: ['metal'],
  units: {
    militia: { faction: 'x', domain: 'ground', kind: 'infantry', stats: { attack: 4, defense: 8, hp: 14, speed: 44 } },
    tank: { faction: 'x', domain: 'ground', kind: 'vehicle', stats: { attack: 22, defense: 14, hp: 46, speed: 40 } },
    lander: {
      faction: 'x', domain: 'space', traits: ['shuttle'],
      stats: { attack: 0, defense: 1, hp: 24, speed: 60, strikeRange: 300, cargoCapacity: 3, fuel: 4 },
    },
    bomber: {
      faction: 'x', domain: 'space', traits: ['shuttle'],
      stats: { attack: 20, defense: 1, hp: 16, speed: 62, strikeRange: 300, fuel: 4 },
    },
  },
  factions: {},
  buildings: {},
  events: {},
});

const sq = (id: string, units: Array<[string, number]>): Squadron => ({
  id,
  units: units.map(([unit, count]) => ({ unit, count })),
});
const st = (unit: string, count: number) => ({ unit, count });

describe('план высадки', () => {
  it('БЕЗ ВОЙСК ПЛАНА НЕТ — пустой челнок долетит и просто погибнет', () => {
    expect(planDrop([sq('s1', [['lander', 4]])], [], [st('militia', 1)], data)).toBeNull();
  });

  it('БЕЗ ДЕСАНТНЫХ ЧЕЛНОКОВ ПЛАНА НЕТ — бомбардировщику возить нечем', () => {
    expect(planDrop([sq('s1', [['bomber', 6]])], [st('tank', 9)], [st('militia', 1)], data)).toBeNull();
  });

  it('НЕ ХВАТАЕТ СИЛ — плана нет, а не «попробуем»', () => {
    // Один челнок увезёт максимум три места; против роты тяжёлого гарнизона этого мало.
    expect(planDrop([sq('s1', [['lander', 1]])], [st('militia', 20)], [st('militia', 20)], data)).toBeNull();
  });

  it('ЭКОНОМИМ ЧЕЛНОКИ: берётся САМАЯ МАЛЕНЬКАЯ эскадра, которой хватит', () => {
    const plan = planDrop(
      [sq('big', [['lander', 8]]), sq('small', [['lander', 3]])],
      [st('tank', 9)],
      [st('militia', 2)],
      data,
    );
    expect(plan?.squadronId).toBe('small');
  });

  it('ВОЙСКА НЕ ЭКОНОМИМ: трюм набивается доверху и лучшими ударными', () => {
    const plan = planDrop(
      [sq('s1', [['lander', 2]])],
      [st('militia', 9), st('tank', 9)],
      [st('militia', 1)],
      data,
    );
    // Два борта — шесть мест; танк бьёт вчетверо сильнее ополченца, значит едут танки.
    expect(plan?.troops).toEqual([{ unit: 'tank', count: 6 }]);
  });

  it('ЧЕГО НЕТ В ИСТОЧНИКЕ — не грузится: трюм добивается тем, что осталось', () => {
    const plan = planDrop(
      [sq('s1', [['lander', 2]])],
      [st('tank', 2), st('militia', 9)],
      [st('militia', 1)],
      data,
    );
    expect(plan?.troops).toEqual([{ unit: 'tank', count: 2 }, { unit: 'militia', count: 4 }]);
  });

  it('ВЫБОР НЕ ЗАВИСИТ ОТ ПОРЯДКА СПИСКА — тай-брейк по id', () => {
    const a = planDrop([sq('b', [['lander', 3]]), sq('a', [['lander', 3]])], [st('tank', 9)], [st('militia', 1)], data);
    const b = planDrop([sq('a', [['lander', 3]]), sq('b', [['lander', 3]])], [st('tank', 9)], [st('militia', 1)], data);
    expect(a?.squadronId).toBe('a');
    expect(b?.squadronId).toBe('a');
  });
});
