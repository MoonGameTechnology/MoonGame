import { describe, expect, it } from 'vitest';
import { moduleAllowed } from '../packages/shared-core/src/index';
import { shippedGameData } from '../data/bundle';
import { moduleGroups } from './moduleGroups';

const data = shippedGameData();
// Крейсер в Sector Zero: каталог даёт системы, оружие, защиту и снова оружие вперемешку.
const cruiser = [
  'cargo_bay',
  'repair_bay',
  'ion_engine',
  'targeting_array',
  'ablative_plating',
  'shield_booster',
  'point_defense_array',
  'siege_platform',
];

describe('moduleGroups — модули группами по типу слота', () => {
  it('группы в порядке слотов корабля: оружие, защита, система', () => {
    expect(moduleGroups(cruiser, data).map((g) => g.slot)).toEqual(['weapon', 'defense', 'utility']);
  });

  it('в группе только модули своего слота, ни один не потерян', () => {
    const groups = moduleGroups(cruiser, data);
    for (const g of groups) for (const id of g.ids) expect(data.modules[id]!.slot, id).toBe(g.slot);
    expect(groups.flatMap((g) => g.ids).sort()).toEqual([...cruiser].sort());
  });

  it('внутри группы выше редкость — выше карточка, равные в порядке каталога', () => {
    const defense = moduleGroups(cruiser, data).find((g) => g.slot === 'defense')!;
    // Усилитель щита — уникальный, броня и ПРО — простые и стоят как в каталоге.
    expect(defense.ids).toEqual(['shield_booster', 'ablative_plating', 'point_defense_array']);
  });

  it('поднятая в профиле редкость поднимает карточку в группе', () => {
    const raised = moduleGroups(cruiser, data, {
      rarity: (id) => (id === 'point_defense_array' ? 'mythic' : (data.modules[id]?.rarity ?? 'simple')),
    });
    expect(raised.find((g) => g.slot === 'defense')!.ids[0]).toBe('point_defense_array');
  });

  it('то, что на корпус не встаёт, уходит в конец группы даже при высокой редкости', () => {
    // Верфь показывает весь каталог: щиты пустоты (только пушки крепости) — легендарные и
    // мифические, но на крейсер не встают и не должны заслонять броню и щит.
    const cruiserDef = data.units.cruiser!;
    const all = Object.keys(data.modules);
    const defense = moduleGroups(all, data, {
      fits: (id) => moduleAllowed('cruiser', cruiserDef, data.modules[id]!),
    }).find((g) => g.slot === 'defense')!;
    const firstLocked = defense.ids.findIndex((id) => !moduleAllowed('cruiser', cruiserDef, data.modules[id]!));
    expect(firstLocked).toBeGreaterThan(0);
    for (const id of defense.ids.slice(firstLocked))
      expect(moduleAllowed('cruiser', cruiserDef, data.modules[id]!), id).toBe(false);
    expect(defense.ids.indexOf('void_shield_iii')).toBeLessThan(defense.ids.indexOf('void_shield_i'));
  });

  it('пустые группы не возвращаются, неизвестный id выпадает', () => {
    expect(moduleGroups(['cargo_bay', 'nope'], data)).toEqual([{ slot: 'utility', ids: ['cargo_bay'] }]);
    expect(moduleGroups([], data)).toEqual([]);
  });
});
