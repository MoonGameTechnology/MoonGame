import { describe, expect, it } from 'vitest';
import { shippedGameData } from '../data/bundle';
import { isSupportHull, splitSupport } from './supportShips';

const data = shippedGameData();

describe('supportShips — вкладка «Поддержка» по признаку из данных', () => {
  it('разведчик и шаттл-носитель — поддержка; крейсер и фрегат — линия', () => {
    // Фрегат переехал в «Корабли» решением владельца 2026-09-25 («Фрегат в корабли»).
    const { line, support } = splitSupport(
      ['cruiser', 'scout', 'frigate', 'shuttle_carrier'],
      data,
    );
    expect(support).toEqual(['scout', 'shuttle_carrier']);
    expect(line).toEqual(['cruiser', 'frigate']);
  });

  it('поддержка — только космические корпуса без боевого оружия', () => {
    for (const [id, def] of Object.entries(data.units)) {
      if (!isSupportHull(def)) continue;
      expect(def.domain, id).toBe('space');
      expect(def.slots.weapon ?? 0, id).toBe(0);
    }
  });

  it('челноки — своим рядом, как вкладка «Челноки» в Производстве', () => {
    const { line, shuttles } = splitSupport(['cruiser', 'interceptor', 'bomber'], data);
    expect(shuttles).toEqual(['interceptor', 'bomber']);
    expect(line).toEqual(['cruiser']);
  });

  it('неизвестный корпус остаётся в линии', () => {
    expect(splitSupport(['nope'], data)).toEqual({ line: ['nope'], support: [], shuttles: [] });
    expect(isSupportHull(undefined)).toBe(false);
  });
});
