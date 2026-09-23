import { describe, expect, it } from 'vitest';
import { PVE_MISSION_COUNT } from '../packages/client/src/gameData';
import { CHAPTER_KEYS, chapterRoute, ROUTE_LENGTH, romanChapter } from './chapterRoute';

describe('chapterRoute — путь от края сектора к эпицентру', () => {
  it('у каждой играбельной главы есть тексты — иначе на пути безымянная кнопка', () => {
    expect(PVE_MISSION_COUNT).toBeLessThanOrEqual(CHAPTER_KEYS.length);
    expect(chapterRoute(PVE_MISSION_COUNT).filter((n) => n.playable)).toHaveLength(
      PVE_MISSION_COUNT,
    );
  });

  it('путь всегда во всю кампанию; играбельные — с края, эпицентр — последним', () => {
    const route = chapterRoute(2);
    expect(route).toHaveLength(ROUTE_LENGTH);
    expect(route.map((n) => n.playable)).toEqual([true, true, false, false, false, false]);
    expect(route.map((n) => n.core)).toEqual([false, false, false, false, false, true]);
  });

  it('глава без текстов играбельной не считается; мусор — путь без открытых глав', () => {
    expect(chapterRoute(99).filter((n) => n.playable)).toHaveLength(CHAPTER_KEYS.length);
    for (const bad of [-1, Number.NaN, Number.POSITIVE_INFINITY])
      expect(chapterRoute(bad).some((n) => n.playable)).toBe(false);
  });

  it('римские номера узлов', () => {
    expect([0, 1, 3, 5, 8, 9, 13].map(romanChapter)).toEqual([
      'I',
      'II',
      'IV',
      'VI',
      'IX',
      'X',
      'XIV',
    ]);
  });
});
