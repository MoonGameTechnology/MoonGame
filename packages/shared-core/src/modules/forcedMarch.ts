/**
 * BOOST-1 форс-марш ("Ускорить") — +50% fleet speed at the cost of 5% max-hp wear
 * per game-hour IN TRANSIT. Port of the prototype's `forcedMarchModule`
 * (`prototype/src/forcedMarch.ts`, REFP-16).
 */
import type { GameModule } from '../kernel/module';
import { effectiveStats } from '../util/loadout';
import { timeScaleOf } from '../action/types';
import { ownFleet } from '../util/combat';

const HOUR = 3_600_000;

export const FORCED_MARCH_MULT = 1.5;
export const FORCED_MARCH_WEAR = 0.05; // share of max HP per game-hour

export const forcedMarchModule: GameModule = {
  id: 'forced-march',
  version: '1.0.0',
  setup(api) {
    api.onAction('fleet.forcemarch', (action, h) => {
      const p = action.payload as { fleetId?: unknown; on?: unknown };
      if (typeof p?.fleetId !== 'string' || typeof p?.on !== 'boolean') return h.reject('E_BAD_PAYLOAD');
      const f = ownFleet(h.state, p.fleetId);
      // Absent OR not-yours → one opaque code (A06 — no fleet-existence probing).
      if (!f || f.owner !== action.playerId) return h.reject('E_NO_FLEET');
      if (p.on) {
        (h.state.forcedMarch ??= {})[f.id] = true;
      } else if (h.state.forcedMarch) {
        delete h.state.forcedMarch[f.id];
        if (Object.keys(h.state.forcedMarch).length === 0) delete h.state.forcedMarch;
      }
    });
    // The speed pipeline contribution — same contract as retreat-haste / faction
    // passives: multiply and pass on (order commutes, invariant #6 intact).
    api.hook<number>('fleet.speed', (speed, args, h) => {
      const fleetId = (args as { fleetId?: string } | undefined)?.fleetId;
      return fleetId && h.state.forcedMarch?.[fleetId] ? speed * FORCED_MARCH_MULT : speed;
    });
    // Wear accrues over continuous time while the fleet is actually marching.
    api.on('time.advanced', (event, h) => {
      const { from, to } = event.payload as { from: number; to: number };
      const span = to - from;
      if (span <= 0 || !h.state.forcedMarch) return;
      const hours = (span / HOUR) * timeScaleOf(h.ctx);
      for (const fid of Object.keys(h.state.forcedMarch)) {
        const f = h.state.fleets[fid];
        if (!f) {
          delete h.state.forcedMarch[fid]; // dead fleet — sweep the flag with it
          continue;
        }
        if (!f.movement) continue; // parked = no wear (the march is the cost)
        for (const stack of f.units) {
          if (stack.count <= 0) continue;
          const def = h.ctx.data.units[stack.unit];
          if (!def) continue;
          const per = effectiveStats(def, stack, h.ctx.data).hp ?? 0;
          if (per <= 0) continue;
          const full = stack.count * per;
          const pool = Math.min(stack.hp ?? full, full);
          const minPool = (stack.count - 1) * per + 1; // last hull stays alive
          stack.hp = Math.max(Math.min(minPool, pool), pool - full * FORCED_MARCH_WEAR * hours);
        }
      }
      if (Object.keys(h.state.forcedMarch).length === 0) delete h.state.forcedMarch;
    });
    // One march per leg: reaching the destination drops the flag.
    api.on('fleet.arrived', (event, h) => {
      const fid = (event.payload as { fleetId?: string } | undefined)?.fleetId;
      if (typeof fid === 'string' && h.state.forcedMarch?.[fid]) {
        delete h.state.forcedMarch[fid];
        if (Object.keys(h.state.forcedMarch).length === 0) delete h.state.forcedMarch;
      }
    });
  },
};
