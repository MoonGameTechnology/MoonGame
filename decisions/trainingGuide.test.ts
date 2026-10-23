import { describe, expect, it } from 'vitest';
import { shippedGameData } from '../data/bundle';
import { trainingState } from '../packages/client/src/gameData';
import { freshSectorZeroProgress, prepareSectorZeroRun } from './sectorZeroProgress';
import {
  trainingCourse,
  trainingFleet,
  trainingFlagshipMerge,
  trainingGridDone,
  trainingRecruits,
  trainingTroopsReady,
} from './trainingGuide';

const data = shippedGameData();
const fresh = () =>
  structuredClone(prepareSectorZeroRun(trainingState(data), freshSectorZeroProgress(data), data));

describe('адресаты и результаты упражнений полигона', () => {
  it('готовит героя только с десантной группой, сохраняя второй флот и носитель', () => {
    const s = fresh();
    const merge = trainingFlagshipMerge(s, 'p1')!;
    expect(merge.into).toBe('p1_1');
    expect(merge.from).toBe(trainingFleet(s, 'p1', 'hero')!.id);
    expect(trainingFlagshipMerge(s, 'p2')).toBeNull();
    s.fleets.p1_1!.owner = 'p2';
    expect(trainingFlagshipMerge(s, 'p1')).toBeNull();
  });
  it('отличает героя, второй боевой флот и носитель', () => {
    const s = fresh();
    const hero = trainingFleet(s, 'p1', 'hero')!;
    expect(Object.values(s.heroes ?? {}).some((h) => h.fleetId === hero.id)).toBe(true);
    expect(trainingFleet(s, 'p1', 'support')?.id).toBe('p1_2');
    expect(trainingFleet(s, 'p1', 'carrier')?.id).toBe('p1_carrier');
    expect(trainingFleet(s, 'absent', 'hero')).toBeNull();
  });

  it('находит героя и ангар после автоматического слияния с другим флотом', () => {
    const s = fresh();
    const hero = Object.values(s.heroes ?? {}).find((h) => h.owner === 'p1')!;
    hero.fleetId = 'p1_2';
    s.fleets.p1_2!.hangar = s.fleets.p1_carrier!.hangar;
    delete s.fleets.p1_carrier;
    expect(trainingFleet(s, 'p1', 'hero')?.id).toBe('p1_2');
    expect(trainingFleet(s, 'p1', 'carrier')?.id).toBe('p1_2');
  });

  it('любая другая технология не подменяет сеть, нужную для ПКО', () => {
    const s = fresh();
    s.players.p1!.technologies = { completed: ['frigate_design'], active: [] };
    expect(trainingGridDone(s, 'p1')).toBe(false);
    s.players.p1!.technologies.completed.push('orbital_defense_grid');
    expect(trainingGridDone(s, 'p1')).toBe(true);
  });

  it('проверяет конечную цель маршрута, а не промежуточный узел', () => {
    const f = fresh().fleets.p1_2!;
    expect(trainingCourse(f, 'base')).toBe(true);
    f.movement = {
      from: 'base',
      to: 'neutral',
      destination: 'station',
      departedAt: 0,
      arrivesAt: 100,
    } as typeof f.movement;
    expect(trainingCourse(f, 'neutral')).toBe(false);
    expect(trainingCourse(f, 'station')).toBe(true);
    expect(trainingCourse(undefined, 'station')).toBe(false);
  });

  it('приказ погрузки не подменяет готовые войска в трюме', () => {
    const f = fresh().fleets.p1_1!;
    expect(trainingTroopsReady(f, 2)).toBe(false);
    f.landing = [{ unit: 'heavy_infantry', count: 2 }];
    expect(trainingTroopsReady(f, 2)).toBe(true);
    expect(trainingTroopsReady(f, 8)).toBe(false);
  });

  it('останавливает набор на восьми с учётом очереди, не считая чужие или другие заказы', () => {
    const s = fresh();
    expect(trainingRecruits(s, 'p1')).toBe(2);
    s.planets.base!.buildQueue = [
      { id: -1, kind: 'unit', playerId: 'p1', unit: 'heavy_infantry', count: 5 },
      { id: -2, kind: 'unit', playerId: 'p1', unit: 'militia', count: 10 },
    ];
    s.scheduled.push({
      id: 'training-test:recruit',
      at: 100,
      seq: 500,
      type: 'construction.complete',
      payload: { planetId: 'base', playerId: 'p1', kind: 'unit', unit: 'heavy_infantry', count: 1 },
    });
    expect(trainingRecruits(s, 'p1')).toBe(8);
    expect(trainingRecruits(s, 'p2')).toBe(0);
  });
});
