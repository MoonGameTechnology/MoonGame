/**
 * CC-server standing orders (CC-2 auto-storm / CC-4 дежурный вылет) —
 * AUTHORITATIVE state so the server drives them. Extracted from `game.ts`
 * (REFP-15): depends on `fleetHasSquadron`/`sortieSpec`/`squadronStrikeRange`/
 * `freshSortie` (ядро, `state/squadron.ts` — CONV-5), `fleetIdle`/`validateChainSteps`
 * (chain.ts).
 */
import type { Fleet, GameData, GameModule } from '../../packages/shared-core/src/index';
import {
  fleetHasSquadron,
  sortieSpec,
  squadronStrikeRange,
  freshSortie,
  type SortieState,
} from '../../packages/shared-core/src/index';
import { fleetIdle, validateChainSteps, type FleetChain } from './chain';

const HOUR = 3_600_000;

/** Handler context shape (avoids importing the kernel module directly — the
 *  prototype's esbuild bundle doesn't resolve it, only shared-core's index). */
interface HCtx {
  state: { fleets: Record<string, Fleet>; planets: Record<string, { position: { x: number; y: number } }> };
  ctx: { now: number; data: GameData };
  reject(code: string): never;
}

/** State extension for standing orders. */
interface StandingOrdersState {
  autoAssault?: Record<string, true>;
  patrols?: Record<string, PatrolEntry>;
  wingSorties?: Record<string, SortieState>;
  orders?: Record<string, FleetChain>;
}

interface PatrolEntry {
  center: { x: number; y: number };
  radius: number;
  sortie: SortieState;
  rearmAt?: number;
}

export const standingOrdersModule: GameModule = {
  id: 'standing-orders',
  version: '0.1.0',
  setup(api) {
    const ownedFleet = (h: HCtx, playerId: string, fleetId: unknown): Fleet | string => {
      if (typeof fleetId !== 'string') return 'E_BAD_PAYLOAD';
      const f = h.state.fleets[fleetId];
      if (!f) return 'E_NO_FLEET';
      if (f.owner !== playerId) return 'E_FORBIDDEN';
      return f;
    };
    api.onAction('order.auto', (action, h) => {
      const p = action.payload as { fleetId?: unknown; on?: unknown };
      const f = ownedFleet(h, action.playerId, p?.fleetId);
      if (typeof f === 'string') return h.reject(f);
      if (typeof p.on !== 'boolean') return h.reject('E_BAD_PAYLOAD');
      const st = h.state as unknown as StandingOrdersState;
      if (p.on) (st.autoAssault ??= {})[f.id] = true;
      else if (st.autoAssault) {
        delete st.autoAssault[f.id];
        if (Object.keys(st.autoAssault).length === 0) delete st.autoAssault;
      }
    });
    api.onAction('order.scramble', (action, h) => {
      const p = action.payload as { fleetId?: unknown; on?: unknown };
      const f = ownedFleet(h, action.playerId, p?.fleetId);
      if (typeof f === 'string') return h.reject(f);
      if (typeof p.on !== 'boolean') return h.reject('E_BAD_PAYLOAD');
      const st = h.state as unknown as StandingOrdersState;
      if (!p.on) {
        if (st.patrols?.[f.id]) {
          (st.wingSorties ??= {})[f.id] = st.patrols[f.id]!.sortie;
          delete st.patrols[f.id];
          if (Object.keys(st.patrols).length === 0) delete st.patrols;
        }
        return;
      }
      if (!fleetHasSquadron(f, h.ctx.data)) return h.reject('E_NO_SHIPS');
      const pos = f.location !== null ? h.state.planets[f.location]?.position : undefined;
      if (!pos || !fleetIdle(f)) return h.reject('E_CONDITIONS_UNMET');
      const spec = sortieSpec(f, h.ctx.data);
      const stashed = st.wingSorties?.[f.id];
      (st.patrols ??= {})[f.id] = {
        center: { x: pos.x, y: pos.y },
        radius: squadronStrikeRange(f, h.ctx.data),
        sortie: stashed
          ? {
              fuel: Math.min(stashed.fuel, spec.maxFuel),
              rearming: Math.min(stashed.rearming, spec.rearmRounds),
            }
          : freshSortie(spec.maxFuel),
        rearmAt: h.ctx.now + HOUR,
      };
      if (st.wingSorties) {
        delete st.wingSorties[f.id];
        if (Object.keys(st.wingSorties).length === 0) delete st.wingSorties;
      }
    });
    api.onAction('patrol.stamp', (action, h) => {
      const p = action.payload as { fleetId?: unknown; sortie?: unknown; rearmAt?: unknown };
      const f = ownedFleet(h, action.playerId, p?.fleetId);
      if (typeof f === 'string') return h.reject(f);
      const patrol = (h.state as unknown as StandingOrdersState).patrols?.[f.id];
      if (!patrol) return h.reject('E_NO_TARGET');
      const s = p.sortie as { fuel?: unknown; rearming?: unknown } | undefined;
      const spec = sortieSpec(f, h.ctx.data);
      if (
        typeof s?.fuel !== 'number' ||
        !Number.isInteger(s.fuel) ||
        s.fuel < 0 ||
        s.fuel > spec.maxFuel ||
        typeof s.rearming !== 'number' ||
        !Number.isInteger(s.rearming) ||
        s.rearming < 0 ||
        s.rearming > spec.rearmRounds
      ) {
        return h.reject('E_BAD_PAYLOAD');
      }
      if (
        p.rearmAt !== undefined &&
        (typeof p.rearmAt !== 'number' || !Number.isFinite(p.rearmAt) || p.rearmAt < 0)
      ) {
        return h.reject('E_BAD_PAYLOAD');
      }
      patrol.sortie = { fuel: s.fuel, rearming: s.rearming };
      if (p.rearmAt !== undefined) patrol.rearmAt = p.rearmAt;
    });
    api.onAction('order.chain', (action, h) => {
      const p = action.payload as { fleetId?: unknown; steps?: unknown };
      const f = ownedFleet(h, action.playerId, p?.fleetId);
      if (typeof f === 'string') return h.reject(f);
      const steps = validateChainSteps(p?.steps, h.state);
      if (steps === null) return h.reject('E_BAD_PAYLOAD');
      const st = h.state as unknown as StandingOrdersState;
      if (steps.length === 0) {
        if (st.orders) {
          delete st.orders[f.id];
          if (Object.keys(st.orders).length === 0) delete st.orders;
        }
        return;
      }
      (st.orders ??= {})[f.id] = { steps };
    });
    api.onAction('chain.stamp', (action, h) => {
      const p = action.payload as { fleetId?: unknown; steps?: unknown; waitUntil?: unknown };
      const f = ownedFleet(h, action.playerId, p?.fleetId);
      if (typeof f === 'string') return h.reject(f);
      const st = h.state as unknown as StandingOrdersState;
      if (!st.orders?.[f.id]) return h.reject('E_NO_TARGET');
      const steps = validateChainSteps(p?.steps, h.state);
      if (steps === null) return h.reject('E_BAD_PAYLOAD');
      const w = p?.waitUntil;
      if (w !== undefined && (typeof w !== 'number' || !Number.isFinite(w) || w < 0)) {
        return h.reject('E_BAD_PAYLOAD');
      }
      if (steps.length === 0) {
        delete st.orders[f.id];
        if (Object.keys(st.orders).length === 0) delete st.orders;
        return;
      }
      st.orders[f.id] = w === undefined ? { steps } : { steps, waitUntil: w };
    });
    api.on('time.advanced', (_ev, h) => {
      const st = h.state as unknown as StandingOrdersState;
      for (const key of ['autoAssault', 'patrols', 'wingSorties', 'orders'] as const) {
        const map = st[key];
        if (!map) continue;
        for (const fid of Object.keys(map)) if (!h.state.fleets[fid]) delete (map as Record<string, unknown>)[fid];
        if (Object.keys(map).length === 0) delete st[key];
      }
    });
  },
};