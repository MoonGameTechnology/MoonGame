import { describe, expect, it } from 'vitest';
import { abandonPromise, fleetLostPrompt, shipCount } from './fleetLost';
import type { GameState } from '../packages/shared-core/src/index';

const world = (
  fleets: Record<string, { owner: string; units: Array<{ unit: string; count: number }> }>,
) => ({ fleets }) as unknown as GameState;

describe('«Флот потерян» (PVR-6.29, решение владельца 2026-09-25)', () => {
  it('кораблей — сумма стеков своих флотов; чужие и пустые не в счёт', () => {
    const s = world({
      a: {
        owner: 'p1',
        units: [
          { unit: 'cruiser', count: 2 },
          { unit: 'hero', count: 1 },
        ],
      },
      b: { owner: 'p1', units: [{ unit: 'frigate', count: 0 }] },
      c: { owner: 'p3', units: [{ unit: 'frigate', count: 9 }] },
    });
    expect(shipCount(s, 'p1')).toBe(3);
    expect(shipCount(world({}), 'p1')).toBe(0);
  });

  it('карточка встаёт на ПЕРЕХОДЕ к нулю, один раз — а не каждый кадр без флота', () => {
    expect(fleetLostPrompt(3, 0)).toBe(true);
    expect(fleetLostPrompt(0, 0)).toBe(false); // уже показали — не повторяем
    expect(fleetLostPrompt(null, 0)).toBe(false); // первый кадр забега: сравнивать не с чем
    expect(fleetLostPrompt(2, 1)).toBe(false);
    // Отстроился и снова потерял — снова спросим.
    expect(fleetLostPrompt(1, 0)).toBe(true);
  });

  it('карточка «Завершить» не обещает награду и ×2, когда забирать нечего (2026-09-28)', () => {
    expect(abandonPromise({ research: 0, warrants: 0 }, true)).toEqual({
      double: false,
      collect: false,
    });
    expect(abandonPromise({ research: 3, warrants: 15 }, true)).toEqual({
      double: true,
      collect: true,
    });
    expect(abandonPromise({ research: 3, warrants: 15 }, false)).toEqual({
      double: false,
      collect: true,
    });
    // Только уничтоженные: Варранты забрать можно, а ×2 итоги не предложат — данных нет.
    expect(abandonPromise({ research: 0, warrants: 4 }, true)).toEqual({
      double: false,
      collect: true,
    });
  });
});
