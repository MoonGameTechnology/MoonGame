/**
 * КРЕПКИЙ СТАРТ ИГРОКА В ГЛАВАХ (PVR-2.4, решение владельца 2026-09-23).
 *
 * После темпа перемещения ×5 (`PVR-2.3`) Рой доходит до дома в 2,3–4,5 раза раньше, и
 * дом падал на первом же наземном штурме во всех главах. Владелец выбрал рычаг «крепче
 * старт игрока» — оборону дома в данных карт, только в Sector Zero (волны общие с
 * онлайн-PvE и не трогаются).
 *
 * Величина — не на глаз: оборона примерно на ту сумму, что игрок заработал бы за часы,
 * отнятые ранним штурмом (≈640 металла из ~780–860, `sector-zero-roadmap.md` PVR-2.4).
 *
 * Здесь закреплён СОСТАВ, а поведение — «дом переживает первый штурм» — держит прогон
 * забега (`prototype/src/pveRun.test.ts`).
 */
import { describe, expect, it } from 'vitest';
import { buildingLevel } from '../packages/shared-core/src/index';
import { pveState, PVE_MISSION_COUNT } from '../packages/client/src/gameData';
import { shippedGameData } from './bundle';

const data = shippedGameData();
const chapters = Array.from({ length: PVE_MISSION_COUNT }, (_, i) => i);

describe('PVR-2.4 — стартовая оборона дома в каждой главе', () => {
  for (const mission of chapters) {
    it(`глава ${mission + 1}: форт второго уровня со своим гарнизоном, тяжёлая пехота, стража дома`, () => {
      const s = pveState(data, mission);
      const home = Object.values(s.planets).find((p) => p.owner === 'p1' && p.kind === 'planet')!;
      const fort = home.buildings.find((b) => b.type === 'fort');
      expect(fort?.level).toBe(2);
      // Форт на стартовой карте не строился, поэтому выданный им гарнизон стоит в данных
      // явно — ровно столько, сколько объявляет его уровень.
      const issued = buildingLevel(data.buildings.fort!, 2).issuesGarrison;
      expect(home.garrison.find((g) => g.unit === 'garrison')?.count).toBe(issued);
      expect(home.garrison.find((g) => g.unit === 'heavy_infantry')?.count).toBe(4);
      const guard = Object.values(s.fleets).filter(
        (f) => f.owner === 'p1' && f.location === home.id && f.id !== 'p1_1',
      );
      expect(guard.map((f) => f.units)).toEqual([[{ unit: 'cruiser', count: 2 }]]);
    });

    it(`глава ${mission + 1}: учебный флот не тронут — на нём откалиброван бой с пиратами`, () => {
      const f = pveState(data, mission).fleets.p1_1!;
      expect(f.units).toEqual([
        { unit: 'cruiser', count: 2 },
        { unit: 'scout_drone', count: 1 },
      ]);
      expect(f.landing).toEqual([{ unit: 'militia', count: 1 }]);
    });
  }
});
