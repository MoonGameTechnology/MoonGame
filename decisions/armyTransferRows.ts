import {
  effectiveStats,
  medalsOf,
  type Fleet,
  type GameData,
  type GameState,
  type UnitStack,
} from '../packages/shared-core/src/index';
import {
  armyFreeGroups,
  groundClaims,
  type ArmySelection,
} from '../packages/shared-core/src/util/armySelection';

import { moduleValueKey, serviceKey } from '../packages/shared-core/src/util/stacks';

export interface ArmyTransferSource { group: string; count: number }

export interface ArmyGroupDetails {
  transferSources?: ArmyTransferSource[];
  key: string;
  group?: string;
  side: 'garrison' | 'hold';
  prepared: boolean;
  grade: number;
  battles: number;
  health: number;
  hp: number;
  maxHp: number;
}

/** Compatible formations share a display row, never a combat HP pool.
 * The source identities and wounds remain authoritative and unchanged. */
export function armyTransferRows(state: GameState, fleet: Fleet, mine: boolean, data: GameData) {
  const location = fleet.location;
  if (!location) return [];
  const planet = state.planets[location];
  const rows = (
    stacks: readonly UnitStack[],
    side: 'garrison' | 'hold',
    claims: ArmySelection[],
  ) => {
    const free = armyFreeGroups(stacks, claims);
    const sourceRows = stacks.flatMap((stack, index) => {
      const def = data.units[stack.unit];
      if (
        !def ||
        def.domain !== 'ground' ||
        stack.count <= 0 ||
        (side === 'garrison' && def.traits.includes('immobile'))
      )
        return [];
      const available = stack.armyGroup ? (free.get(stack.armyGroup) ?? 0) : stack.count;
      const ownClaims = side === 'garrison' ? (fleet.loading ?? []) : (fleet.unloading ?? []);
      const queued = ownClaims.reduce(
        (n, c) =>
          n +
          (c.sources
            ?.filter((s) => s.group === stack.armyGroup)
            .reduce((sum, s) => sum + s.count, 0) ?? 0),
        0,
      );
      const maximum = stack.count * Math.max(1, effectiveStats(def, stack, data).hp ?? 1);
      return [
        {
          mergeKey: JSON.stringify([stack.unit, moduleValueKey(stack), serviceKey(stack.battles), stack.stationScale ?? null]),
          transferSources: stack.armyGroup ? [{ group: stack.armyGroup, count: available }] : [],
          key: `${side}:${stack.armyGroup ?? `pending:${index}`}`,
          group: stack.armyGroup,
          side,
          prepared: !!stack.armyGroup,
          unit: stack.unit,
          garrison: side === 'garrison' ? stack.count : 0,
          garrisonAll: side === 'garrison' ? stack.count : 0,
          hold: side === 'hold' ? available : 0,
          holdAll: side === 'hold' ? stack.count : 0,
          reserved: side === 'garrison' ? stack.count - available : 0,
          queued,
          cargoSize: def.stats.cargoSize ?? 1,
          grade: medalsOf(stack, data).find((m) => m.line === 'service')?.grade ?? 0,
          battles: stack.battles ?? 0,
          hp: stack.hp ?? maximum,
          maxHp: maximum,
          health: Math.max(0, Math.min(100, Math.round(((stack.hp ?? maximum) / maximum) * 1000) / 10)),
        },
      ];
    });
    const combined: typeof sourceRows = [];
    for (const row of sourceRows) {
      const existing = combined.find((other) => other.mergeKey === row.mergeKey);
      if (!existing) { combined.push(row); continue; }
      const before = existing.garrisonAll + existing.holdAll;
      const added = row.garrisonAll + row.holdAll;
      existing.battles = (existing.battles * before + row.battles * added) / (before + added);
      for (const field of ['garrison', 'garrisonAll', 'hold', 'holdAll', 'reserved', 'queued', 'hp', 'maxHp'] as const)
        existing[field] += row[field];
      existing.prepared &&= row.prepared;
      existing.transferSources.push(...row.transferSources);
      existing.health = Math.max(0, Math.min(100, Math.round(1000 * existing.hp / existing.maxHp) / 10));
    }
    return combined.map((row) => ({ ...row, battles: Math.floor(row.battles) }));
  };
  return [
    ...rows(mine ? (planet?.garrison ?? []) : [], 'garrison', groundClaims(state, location)),
    ...rows(fleet.landing ?? [], 'hold', fleet.unloading ?? []),
  ];
}

/** Tutorial readiness follows the same current formation rows as the transfer menu. */
export function hasPlannedArmyLoad(
  state: GameState,
  selection: { fleetId: string; plan: Record<string, number> } | null | undefined,
  unit: string,
  data: GameData,
): boolean {
  const fleet = selection && state.fleets[selection.fleetId];
  if (!selection || !fleet?.location) return false;
  return armyTransferRows(state, fleet, state.planets[fleet.location]?.owner === fleet.owner, data)
    .some((row) => row.side === 'garrison' && row.unit === unit && row.prepared &&
      row.garrison > row.reserved && (selection.plan[row.key] ?? 0) > 0);
}


/** Integer, proportional selection across original formations. Largest remainders
 * get the remaining seats; ties retain source order. No HP is rewritten. */
export function splitArmyTransferSources(sources: readonly ArmyTransferSource[], requested: number): ArmyTransferSource[] {
  const available = sources.reduce((n, source) => n + source.count, 0);
  if (!Number.isFinite(requested) || available <= 0) return [];
  const count = Math.max(0, Math.min(available, Math.floor(requested)));
  const allocations = sources.map((source, index) => {
    const exact = count * source.count / available;
    return { group: source.group, count: Math.floor(exact), fraction: exact - Math.floor(exact), index };
  });
  const extra = count - allocations.reduce((n, source) => n + source.count, 0);
  const ranked = [...allocations].sort((a, b) => b.fraction - a.fraction || a.index - b.index);
  for (let i = 0; i < extra; i++) ranked[i]!.count++;
  return allocations.filter((source) => source.count > 0).map(({ group, count }) => ({ group, count }));
}
