import { describe, expect, it } from 'vitest';
import { MAX_GLIDE_MS, seenSortieMarks } from './seenSortieMarks';
import type { SeenSortie } from '../packages/shared-core/src/index';

const MIN = 60_000;
const flying: SeenSortie = {
  owner: 'p2',
  at: { x: 100, y: 0 },
  velocity: { x: -2, y: 0 },
  leg: 'out',
  units: [{ unit: 'interceptor', count: 2 }, { unit: 'bomber', count: 3 }],
};

describe('значок чужой эскадры в полёте', () => {
  it('идёт от точки снимка по скорости и считает машины', () => {
    const [m] = seenSortieMarks([flying], 1000, 1000 + 10 * MIN);
    expect(m).toMatchObject({ owner: 'p2', at: { x: 80, y: 0 }, leg: 'out', machines: 5 });
    expect(m!.heading).toBeCloseTo(Math.PI);
  });

  it('без нового снимка дальше предела не уходит, а кадр до снимка не тянет назад', () => {
    expect(seenSortieMarks([flying], 0, 10 * MAX_GLIDE_MS)[0]!.at.x).toBe(100 - 2 * (MAX_GLIDE_MS / MIN));
    expect(seenSortieMarks([flying], 5000, 0)[0]!.at).toEqual({ x: 100, y: 0 });
  });

  it('стоящая эскадра смотрит вверх; нет снимка — нет значков', () => {
    const still = seenSortieMarks([{ ...flying, velocity: { x: 0, y: 0 } }], 0, MIN)[0]!;
    expect(still.heading).toBeCloseTo(-Math.PI / 2);
    expect(seenSortieMarks(undefined, 0, 0)).toEqual([]);
  });
});
