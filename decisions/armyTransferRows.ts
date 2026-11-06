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

export interface ArmyGroupDetails {
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

/** Separate rows keep the chosen formation, its wounds and its service visible. */
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
    return stacks.flatMap((stack, index) => {
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
          battles: Math.floor(stack.battles ?? 0),
          hp: stack.hp ?? maximum,
          maxHp: maximum,
          health: Math.max(0, Math.min(100, Math.round(((stack.hp ?? maximum) / maximum) * 1000) / 10)),
        },
      ];
    });
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
