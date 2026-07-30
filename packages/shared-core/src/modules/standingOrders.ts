/**
 * Standing orders — CC-2 auto-storm (`order.auto`) and CC-4 дежурный вылет
 * (`order.scramble` + the server-only `patrol.stamp`), plus CC-1 order chains
 * (`order.chain` + the server-only `chain.stamp`). Port of the prototype's
 * `standingOrdersModule` (`prototype/src/standingOrders.ts`, REFP-15).
 *
 * This module only stores/validates the player's INTENT and garbage-collects it
 * for dead fleets (`time.advanced`). The actual driver — scrambling a patrol wing
 * at a spotted hostile, or consuming a chain's head step when the fleet goes idle
 * — is a server-side orchestration loop that repeatedly calls `applyAction` from
 * outside a single action/event pass (see the prototype's `serverChainActions`/
 * `serverPatrolActions` in `game.ts`); that driver is out of scope for this pass,
 * same as it not depending on any AI/bot decision loop for its own behaviour —
 * this module's four client actions are pure state CRUD with no simulated agent.
 *
 * `patrol.stamp`/`chain.stamp` have no gate schema (`actions/payloadSchemas.ts`
 * documents them as deliberately server-driver-only, gate-exempt) — a client
 * cannot reach them; only trusted server code may ever issue them.
 */
import type { GameModule } from '../kernel/module';
import type { Fleet, PatrolEntry } from '../state/gameState';
import { fleetIdle, validateChainSteps } from '../state/chain';
import { fleetHasSquadron, sortieSpec, squadronStrikeRange, freshSortie } from '../state/squadron';
import { ownFleet } from '../util/combat';

const HOUR = 3_600_000;

export const standingOrdersModule: GameModule = {
  id: 'standing-orders',
  version: '1.0.0',
  setup(api) {
    function ownedFleet(state: Parameters<typeof ownFleet>[0], playerId: string, id: unknown) {
      if (typeof id !== 'string') return undefined;
      const f = ownFleet(state, id);
      if (!f || f.owner !== playerId) return undefined;
      return f;
    }

    api.onAction('order.auto', (action, h) => {
      const p = action.payload as { fleetId?: unknown; on?: unknown };
      if (typeof p?.on !== 'boolean') return h.reject('E_BAD_PAYLOAD');
      const f: Fleet | undefined = ownedFleet(h.state, action.playerId, p.fleetId);
      if (!f) return h.reject('E_NO_FLEET');
      if (p.on) {
        (h.state.autoAssault ??= {})[f.id] = true;
      } else if (h.state.autoAssault) {
        delete h.state.autoAssault[f.id];
        if (Object.keys(h.state.autoAssault).length === 0) delete h.state.autoAssault;
      }
    });

    api.onAction('order.scramble', (action, h) => {
      const p = action.payload as { fleetId?: unknown; on?: unknown };
      if (typeof p?.on !== 'boolean') return h.reject('E_BAD_PAYLOAD');
      const f: Fleet | undefined = ownedFleet(h.state, action.playerId, p.fleetId);
      if (!f) return h.reject('E_NO_FLEET');
      if (!p.on) {
        const patrol = h.state.patrols?.[f.id];
        if (patrol) {
          (h.state.wingSorties ??= {})[f.id] = patrol.sortie;
          delete h.state.patrols![f.id];
          if (Object.keys(h.state.patrols!).length === 0) delete h.state.patrols;
        }
        return;
      }
      if (!fleetHasSquadron(f, h.ctx.data)) return h.reject('E_NO_SHIPS');
      const pos = f.location !== null ? h.state.planets[f.location]?.position : undefined;
      if (!pos || !fleetIdle(f)) return h.reject('E_CONDITIONS_UNMET');
      const spec = sortieSpec(f, h.ctx.data);
      const stashed = h.state.wingSorties?.[f.id];
      const entry: PatrolEntry = {
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
      (h.state.patrols ??= {})[f.id] = entry;
      if (h.state.wingSorties) {
        delete h.state.wingSorties[f.id];
        if (Object.keys(h.state.wingSorties).length === 0) delete h.state.wingSorties;
      }
    });

    // Server-driver-only (no client gate schema): the runtime stamp that spends/
    // rearms a patrol wing's sortie budget as it scrambles.
    api.onAction('patrol.stamp', (action, h) => {
      const p = action.payload as { fleetId?: unknown; sortie?: unknown; rearmAt?: unknown };
      const f: Fleet | undefined = ownedFleet(h.state, action.playerId, p?.fleetId);
      if (!f) return h.reject('E_NO_FLEET');
      const patrol = h.state.patrols?.[f.id];
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
      const f: Fleet | undefined = ownedFleet(h.state, action.playerId, p?.fleetId);
      if (!f) return h.reject('E_NO_FLEET');
      const steps = validateChainSteps(p?.steps, h.state, h.ctx.data.heroAbilities);
      if (steps === null) return h.reject('E_BAD_PAYLOAD');
      if (steps.length === 0) {
        if (h.state.orders) {
          delete h.state.orders[f.id];
          if (Object.keys(h.state.orders).length === 0) delete h.state.orders;
        }
        return;
      }
      (h.state.orders ??= {})[f.id] = { steps };
    });

    // Server-driver-only (no client gate schema): the runtime stamp that advances a
    // fleet's chain (consumed head step / armed wait deadline) as it runs.
    api.onAction('chain.stamp', (action, h) => {
      const p = action.payload as { fleetId?: unknown; steps?: unknown; waitUntil?: unknown };
      const f: Fleet | undefined = ownedFleet(h.state, action.playerId, p?.fleetId);
      if (!f) return h.reject('E_NO_FLEET');
      if (!h.state.orders?.[f.id]) return h.reject('E_NO_TARGET');
      const steps = validateChainSteps(p?.steps, h.state, h.ctx.data.heroAbilities);
      if (steps === null) return h.reject('E_BAD_PAYLOAD');
      const w = p?.waitUntil;
      if (w !== undefined && (typeof w !== 'number' || !Number.isFinite(w) || w < 0)) {
        return h.reject('E_BAD_PAYLOAD');
      }
      if (steps.length === 0) {
        delete h.state.orders[f.id];
        if (Object.keys(h.state.orders).length === 0) delete h.state.orders;
        return;
      }
      h.state.orders[f.id] = w === undefined ? { steps } : { steps, waitUntil: w };
    });

    api.on('time.advanced', (_ev, h) => {
      for (const key of ['autoAssault', 'patrols', 'wingSorties', 'orders'] as const) {
        const map = h.state[key];
        if (!map) continue;
        for (const fid of Object.keys(map)) {
          if (!Object.prototype.hasOwnProperty.call(h.state.fleets, fid)) {
            delete (map as Record<string, unknown>)[fid];
          }
        }
        if (Object.keys(map).length === 0) delete h.state[key];
      }
    });
  },
};
