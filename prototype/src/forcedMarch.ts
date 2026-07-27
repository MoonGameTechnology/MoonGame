/**
 * BOOST-1 форс-марш («Ускорить») — +50% to fleet speed at the cost of 5% max-HP
 * wear per hour IN TRANSIT. Extracted from `game.ts` (REFP-16): depends on
 * `DivState` (forcedMarch flag), `effectiveStats`, `timeScaleOf`, `HOUR`.
 * `game.ts` imports `forcedMarchModule` for `MODULES` and re-exports constants.
 */
import type { GameModule, GameData, Fleet } from '../../packages/shared-core/src/index';
import { effectiveStats, timeScaleOf } from '../../packages/shared-core/src/index';

const HOUR = 3_600_000;

/** State extension: the forced-march flag set (fleetId → true). */
interface ForcedMarchState {
  forcedMarch?: Record<string, true>;
}

export const FORCED_MARCH_MULT = 1.5;
export const FORCED_MARCH_WEAR = 0.05; // share of max HP per game-hour
export const forcedMarchModule: GameModule = {
  id: 'forced-march',
  version: '0.1.0',
  setup(api) {
    api.onAction('fleet.forcemarch', (action, h) => {
      const p = action.payload as { fleetId?: unknown; on?: unknown };
      if (typeof p?.fleetId !== 'string' || typeof p?.on !== 'boolean') {
        return h.reject('E_BAD_PAYLOAD');
      }
      const f = h.state.fleets[p.fleetId];
      // Absent OR not-yours → one opaque code (A06 — no fleet-existence probing).
      if (!f || f.owner !== action.playerId) return h.reject('E_NO_FLEET');
      const st = h.state as unknown as ForcedMarchState;
      if (p.on) {
        (st.forcedMarch ??= {})[f.id] = true;
      } else if (st.forcedMarch) {
        delete st.forcedMarch[f.id];
        if (Object.keys(st.forcedMarch).length === 0) delete st.forcedMarch;
      }
    });
    // The speed pipeline contribution — same contract as retreat-haste / faction
    // passives: multiply and pass on (order commutes, invariant #6 intact).
    api.hook<number>('fleet.speed', (speed, args, h) => {
      const fleetId = (args as { fleetId?: string }).fleetId;
      return fleetId && (h.state as unknown as ForcedMarchState).forcedMarch?.[fleetId]
        ? speed * FORCED_MARCH_MULT
        : speed;
    });
    // Wear accrues over continuous time while the fleet is actually marching.
    api.on('time.advanced', (event, h) => {
      const { from, to } = event.payload as { from: number; to: number };
      const span = to - from;
      if (span <= 0) return;
      const st = h.state as unknown as ForcedMarchState;
      if (!st.forcedMarch) return;
      const hours = (span / HOUR) * timeScaleOf(h.ctx);
      for (const fid of Object.keys(st.forcedMarch)) {
        const f = h.state.fleets[fid];
        if (!f) {
          delete st.forcedMarch[fid]; // dead fleet — sweep the flag with it
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
      if (Object.keys(st.forcedMarch).length === 0) delete st.forcedMarch;
    });
    // One march per arm: reaching the destination drops the flag.
    api.on('fleet.arrived', (event, h) => {
      const fid = (event.payload as { fleetId?: string })?.fleetId;
      const st = h.state as unknown as ForcedMarchState;
      if (typeof fid === 'string' && st.forcedMarch?.[fid]) {
        delete st.forcedMarch[fid];
        if (Object.keys(st.forcedMarch).length === 0) delete st.forcedMarch;
      }
    });
  },
};