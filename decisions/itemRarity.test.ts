import { describe, expect, it } from 'vitest';
import { shippedGameData } from '../data/bundle';
import { RARITIES } from '../packages/shared-core/src/index';

import { moduleRarity, starRow } from './itemRarity';

const data = shippedGameData();

describe('PVR-6.4 — редкость и звёзды на карточке предмета', () => {
  it('лестница — решение владельца: простой · уникальный · мифический · легендарный', () => {
    expect([...RARITIES]).toEqual(['simple', 'unique', 'mythic', 'legendary']);
  });

  it('у каждого модуля игрока редкость задана ЯВНО', () => {
    // Модули Роя (`brood_host`) игроку не показываются, им разметка не нужна. Остальным —
    // обязательна: иначе новый модуль тихо стал бы «простым», хотя его никто так не решал.
    const unmarked = Object.entries(data.modules)
      .filter(([, def]) => !def.allowed?.traits?.includes('brood_host'))
      .filter(([, def]) => def.rarity === undefined)
      .map(([id]) => id);
    expect(unmarked).toEqual([]);
  });

  it('нет поля — «простой»', () => {
    expect(moduleRarity({})).toBe('simple');
    expect(moduleRarity(undefined)).toBe('simple');
    expect(moduleRarity(data.modules.void_shield_iii)).toBe('legendary');
  });

  it('ряд звёзд не ломается на мусоре', () => {
    expect(starRow(2, 5)).toEqual({ lit: 2, empty: 3 });
    expect(starRow(9, 5)).toEqual({ lit: 5, empty: 0 });
    expect(starRow(-1, 5)).toEqual({ lit: 0, empty: 5 });
    expect(starRow(Number.NaN, 3)).toEqual({ lit: 0, empty: 3 });
    expect(starRow(1, 0)).toEqual({ lit: 0, empty: 0 });
  });
});
