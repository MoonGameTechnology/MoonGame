import type { GameModule, HandlerContext } from '../kernel/module';
import type { Fleet } from '../state/gameState';
import { hoursToMs } from '../action/types';
import { moduleAllowed } from '../util/loadout';
import { addUnits, sumUnitStat } from '../util/stacks';

const CYCLE = 'fleet.brood.cycle';
interface Cycle {
  fleetId: string;
  owner: string;
  moduleId: string;
  hulls: number;
}

/** Only living, correctly fitted hulls of the owner's faction can grow its forms. */
function producers(fleet: Fleet, moduleId: string, h: HandlerContext): number {
  const module = h.ctx.data.modules[moduleId];
  const player = h.state.players[fleet.owner];
  if (player?.status !== 'active') return 0;
  const faction = player.faction;
  if (!module?.brood || h.ctx.data.units[module.brood.unit]?.faction !== faction) return 0;
  return fleet.units.reduce((n, stack) => {
    const hull = h.ctx.data.units[stack.unit];
    return (
      n +
      (hull &&
      stack.count > 0 &&
      hull.domain === 'space' &&
      hull.faction === faction &&
      stack.modules?.includes(moduleId) &&
      moduleAllowed(stack.unit, hull, module)
        ? stack.count
        : 0)
    );
  }, 0);
}

function arm(fleet: Fleet, moduleId: string, h: HandlerContext): void {
  const brood = h.ctx.data.modules[moduleId]?.brood;
  const hulls = producers(fleet, moduleId, h);
  if (!brood || hulls <= 0) return;
  h.schedule(h.ctx.now + hoursToMs(h.ctx, brood.intervalHours), CYCLE, {
    fleetId: fleet.id,
    owner: fleet.owner,
    moduleId,
    hulls,
  } satisfies Cycle);
}

/** Seed restored/starting/newly split fleets; the schedule itself is the clock.
 * No per-frame resource creation and no mutable client-owned incubation timer. */
function seed(h: HandlerContext): void {
  const pending = new Set(
    h.state.scheduled
      .filter((e) => e.type === CYCLE)
      .map((e) => {
        const p = e.payload as Cycle;
        return JSON.stringify([p.fleetId, p.moduleId]);
      }),
  );
  for (const fleetId of Object.keys(h.state.fleets).sort()) {
    const fleet = h.state.fleets[fleetId]!;
    const modules = [...new Set(fleet.units.flatMap((s) => s.modules ?? []))].sort();
    for (const moduleId of modules) {
      if (!pending.has(JSON.stringify([fleetId, moduleId]))) arm(fleet, moduleId, h);
    }
  }
}

/** Data-driven growth organs: `brood.count` organisms per fitted hull and cycle (one for
 * the Brood Mother's chamber, a litter for the Leviathan's brood — PVR-4.7). A completed
 * cycle consumes the real treasury; empty resources, combat or a full hold yield no
 * organisms and no charge. The next cycle takes its full duration, so splitting/merging
 * cannot speed growth. */
export const fleetBroodModule: GameModule = {
  id: 'fleetBrood',
  version: '1.1.0', // PVR-4.7: `brood.count` — organisms per hull and cycle
  setup(api) {
    api.on('time.advanced', (_event, h) => seed(h));
    api.on('pve.wave.spawned', (_event, h) => seed(h));
    api.on('fleet.launched', (_event, h) => seed(h));
    api.on(CYCLE, (event, h) => {
      const p = event.payload as Cycle;
      const fleet = h.state.fleets[p.fleetId];
      const brood = h.ctx.data.modules[p.moduleId]?.brood;
      if (!fleet || fleet.owner !== p.owner || !brood) return;
      const hulls = Math.min(p.hulls, producers(fleet, p.moduleId, h));
      const unit = h.ctx.data.units[brood.unit];
      const player = h.state.players[fleet.owner];
      if (hulls <= 0 || !unit || unit.domain !== 'ground' || !player) return;
      if (!fleet.battleId && player.status === 'active') {
        const reserved = (fleet.loading ?? []).reduce(
          (n, claim) => n + claim.count * (h.ctx.data.units[claim.unit]?.stats.cargoSize ?? 1),
          0,
        );
        const free =
          sumUnitStat(fleet.units, h.ctx.data, 'cargoCapacity') -
          sumUnitStat(fleet.landing ?? [], h.ctx.data, 'cargoSize') -
          reserved;
        let count = Math.max(
          0,
          Math.min(hulls * brood.count, Math.floor(free / Math.max(1, unit.stats.cargoSize ?? 1))),
        );
        for (const [resource, amount] of Object.entries(unit.cost)) {
          if (amount < 0 || !Number.isFinite(amount)) {
            count = 0;
            break;
          }
          if (amount > 0)
            count = Math.min(
              count,
              Math.max(0, Math.floor((player.resources[resource] ?? 0) / amount)),
            );
        }
        if (count > 0) {
          for (const [resource, amount] of Object.entries(unit.cost)) {
            if (amount > 0)
              player.resources[resource] = (player.resources[resource] ?? 0) - amount * count;
          }
          addUnits((fleet.landing ??= []), brood.unit, count);
          h.emit('fleet.brood.grown', {
            fleetId: fleet.id,
            owner: fleet.owner,
            ...(fleet.location ? { location: fleet.location } : {}),
            unit: brood.unit,
            count,
          });
        }
      }
      arm(fleet, p.moduleId, h);
    });
  },
};
