/** A catalog comparison, not a battle prediction: no loadout or technology effects. */
import type { GameData } from '../packages/shared-core/src/index';

export function unitComparison(data: GameData, left: string, right: string) {
  const a = data.units[left];
  const b = data.units[right];
  if (!a || !b) return [];
  const fields = [
    ['hp', 'loadout.stat.hp'],
    ['shield', 'loadout.stat.shield'],
    ['attack', 'loadout.stat.attack'],
    ['defense', 'loadout.stat.defense'],
    ['speed', 'loadout.stat.speed'],
    ['cargoCapacity', 'loadout.stat.cargo'],
    ['pointDefense', 'data.area-defense-array'],
  ] as const;
  return [
    ...fields.map(([field, label]) => ({ label, left: a.stats[field], right: b.stats[field] })),
    { label: 'loadout.stat.radar', left: a.radarRange, right: b.radarRange },
  ];
}
