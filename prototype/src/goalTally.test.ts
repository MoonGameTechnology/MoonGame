import { describe, it, expect } from 'vitest';
import {
  fleetCount,
  goalBaseline,
  grew,
  mineLevels,
  worldCount,
  type TallyFleet,
  type TallyWorld,
} from './goalTally';

const мир = (owner: string | null, ...mines: number[]): TallyWorld => ({
  owner,
  buildings: mines.map((level) => ({ type: 'mine', level })),
});

describe('цели — шахты', () => {
  it('СЧИТАЮТСЯ УРОВНИ, А НЕ ЗДАНИЯ: апгрейд домашней шахты и есть прогресс', () => {
    expect(mineLevels([мир('p1', 3)], 'p1')).toBe(3);
  });

  it('вторая шахта на захваченном мире просто складывается', () => {
    expect(mineLevels([мир('p1', 2), мир('p1', 1)], 'p1')).toBe(3);
  });

  it('ЧУЖИЕ ШАХТЫ НЕ СЧИТАЮТСЯ', () => {
    expect(mineLevels([мир('p2', 5), мир(null, 9)], 'p1')).toBe(0);
  });

  it('здания другого типа шахтами не считаются', () => {
    const w: TallyWorld = { owner: 'p1', buildings: [{ type: 'fort', level: 4 }] };
    expect(mineLevels([w], 'p1')).toBe(0);
  });

  it('мир без построек даёт ноль', () => {
    expect(mineLevels([мир('p1')], 'p1')).toBe(0);
  });
});

describe('цели — счётчики владения', () => {
  it('миры считаются только свои', () => {
    expect(worldCount([мир('p1'), мир('p2'), мир(null)], 'p1')).toBe(1);
  });

  it('флоты считаются только свои', () => {
    const флоты: TallyFleet[] = [{ owner: 'p1' }, { owner: 'p2' }, { owner: null }];
    expect(fleetCount(флоты, 'p1')).toBe(1);
  });
});

describe('цели — база и прогресс', () => {
  it('база снимается по текущему состоянию', () => {
    const b = goalBaseline([мир('p1', 1), мир('p2', 4)], [{ owner: 'p1' }], 'p1');
    expect(b).toEqual({ worlds: 1, mineLevel: 1, fleets: 1 });
  });

  it('ПРОГРЕСС ОТ БАЗЫ, А НЕ АБСОЛЮТОМ: стартовая шахта цель не закрывает', () => {
    const миры = [мир('p1', 1)];
    const b = goalBaseline(миры, [], 'p1');
    expect(grew(mineLevels(миры, 'p1'), b.mineLevel)).toBe(false);
  });

  it('поднятый уровень стартовой шахты цель закрывает', () => {
    const b = goalBaseline([мир('p1', 1)], [], 'p1');
    expect(grew(mineLevels([мир('p1', 2)], 'p1'), b.mineLevel)).toBe(true);
  });

  it('НУЖНО СТРОГО БОЛЬШЕ: равенство — это не прогресс', () => {
    expect(grew(3, 3)).toBe(false);
    expect(grew(4, 3)).toBe(true);
  });

  it('потеря мира прогрессом не становится', () => {
    expect(grew(0, 1)).toBe(false);
  });
});
