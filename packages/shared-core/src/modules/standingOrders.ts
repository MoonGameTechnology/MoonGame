/**
 * Standing orders — CC-2 auto-storm (`order.auto`), CC-4 дежурный вылет
 * (`order.scramble`) и CC-1 order chains (`order.chain` + the server-only
 * `chain.stamp`). Port of the prototype's `standingOrdersModule` (REFP-15); since
 * CONV-7 that copy is gone and this is the only implementation — the prototype loads
 * this module and keeps only its DRIVERS.
 *
 * This module only stores/validates the player's INTENT and garbage-collects it for
 * dead fleets and lost worlds (`time.advanced`). The actual driver — scrambling a
 * base's duty squadron at a spotted hostile, or consuming a chain's head step when the
 * fleet goes idle — is a server-side orchestration loop that repeatedly calls
 * `applyAction` from outside a single action/event pass
 * (`packages/server/src/standingOrderDriver.ts`, and the prototype's `soloDrivers.ts`).
 *
 * **CC-4 ПЕРЕЕХАЛ НА БАЗУ (SHU-2.2).** Раньше дежурство армилось на ФЛОТ челноков и
 * держало собственные центр, радиус и запас топлива — модель «крыло как флот». Такого
 * флота с SHU-1.1 не бывает, поэтому `order.scramble` теперь армит БАЗУ (мир с портом
 * или носитель), а хранится один флаг: центр и радиус живые, топливо принадлежит базе и
 * тратится обычным `shuttle.strike`. Вместе с моделью ушёл и `patrol.stamp` — серверный
 * штамп «потратил топливо / перезарядился»: тратить и перезаряжать теперь некому, кроме
 * самого ядра.
 *
 * `chain.stamp` has no gate schema (`actions/payloadSchemas.ts` documents it as
 * deliberately server-driver-only, gate-exempt) — a client cannot reach it; only
 * trusted server code may ever issue it.
 */
import type { GameModule } from '../kernel/module';
import type { Fleet, Planet } from '../state/gameState';
import { validateChainSteps } from '../state/chain';
import { hangarMachines, shuttleBayAt } from '../state/shuttle';
import { ownFleet } from '../util/combat';

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

    /**
     * CC-4: включить/выключить ДЕЖУРНЫЙ ВЫЛЕТ у базы (SHU-2.2 — раньше у флота).
     *
     * База — мир с космопортом ИЛИ флот-носитель, ровно одна из двух (та же форма, что
     * у `shuttle.strike`). Гейт спрашивает ровно одно: есть ли у базы ангар и стоит ли
     * в нём хоть одна машина. Ни топлива, ни перезарядки, ни дальности здесь не
     * проверяем НАМЕРЕННО — всё это проверит сам `shuttle.strike` в момент вылета, а
     * вторая копия его условий разъехалась бы с ним на первой правке: дежурство
     * выключалось бы там, где удар ещё проходит, и наоборот.
     */
    api.onAction('order.scramble', (action, h) => {
      const p = action.payload as { planetId?: unknown; fleetId?: unknown; on?: unknown };
      if (typeof p?.on !== 'boolean') return h.reject('E_BAD_PAYLOAD');
      const named = [p.planetId, p.fleetId].filter((v) => v !== undefined);
      if (named.length !== 1) return h.reject('E_BAD_PAYLOAD'); // ровно одна база
      const kind: 'planet' | 'fleet' = p.planetId !== undefined ? 'planet' : 'fleet';
      const rawId = kind === 'planet' ? p.planetId : p.fleetId;
      if (typeof rawId !== 'string') return h.reject('E_BAD_PAYLOAD');

      let baseId: string;
      if (kind === 'planet') {
        const planet: Planet | undefined = Object.prototype.hasOwnProperty.call(
          h.state.planets,
          rawId,
        )
          ? h.state.planets[rawId]
          : undefined;
        if (!planet) return h.reject('E_NO_TARGET');
        if (planet.owner !== action.playerId) return h.reject('E_FORBIDDEN');
        baseId = planet.id;
        if (p.on && shuttleBayAt(planet, h.ctx.data) <= 0) return h.reject('E_NO_PORT');
        if (p.on && hangarMachines(planet).length === 0) return h.reject('E_NO_SQUADRON');
      } else {
        const f: Fleet | undefined = ownedFleet(h.state, action.playerId, rawId);
        if (!f) return h.reject('E_NO_FLEET');
        baseId = f.id;
        if (p.on && hangarMachines(f).length === 0) return h.reject('E_NO_SQUADRON');
      }

      if (!p.on) {
        if (h.state.patrols) {
          delete h.state.patrols[baseId];
          if (Object.keys(h.state.patrols).length === 0) delete h.state.patrols;
        }
        return;
      }
      (h.state.patrols ??= {})[baseId] = { kind };
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
      for (const key of ['autoAssault', 'orders'] as const) {
        const map = h.state[key];
        if (!map) continue;
        for (const fid of Object.keys(map)) {
          if (!Object.prototype.hasOwnProperty.call(h.state.fleets, fid)) {
            delete (map as Record<string, unknown>)[fid];
          }
        }
        if (Object.keys(map).length === 0) delete h.state[key];
      }
      // Дежурство армится на БАЗУ (SHU-2.2), поэтому подчищается по СВОЕМУ виду: флот
      // мог погибнуть, мир — уйти к другому хозяину. Чужой мир с включённым дежурством
      // поднимал бы эскадру за бывшего владельца.
      const patrols = h.state.patrols;
      if (patrols) {
        for (const [baseId, ref] of Object.entries(patrols)) {
          const alive =
            ref.kind === 'fleet'
              ? Object.prototype.hasOwnProperty.call(h.state.fleets, baseId)
              : Object.prototype.hasOwnProperty.call(h.state.planets, baseId);
          if (!alive) delete patrols[baseId];
        }
        if (Object.keys(patrols).length === 0) delete h.state.patrols;
      }
    });
  },
};
