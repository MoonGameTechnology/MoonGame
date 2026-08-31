/**
 * Fleet formation — `fleet.launch` (scramble a planet's garrison into a mobile
 * fleet), `fleet.merge` (fuse two co-located idle fleets), `fleet.split` (peel
 * a chosen set of ships off a fleet into a fresh one), and `fleet.engage`
 * (deliberately open fire on a co-located hostile fleet — arrival already
 * auto-resolves a collision via combatModule's own `fleet.arrived` handling;
 * this is the player-issued path for two fleets that are ALREADY sharing a
 * node without having fought, e.g. one arrived in peacetime and war was
 * declared after). The core already builds ships into a planet's garrison
 * (constructionModule) and lets a fleet carry ground troops as cargo
 * (armyModule), but nothing moved a built ship OUT of the garrison — this
 * module closes that gap, the one missing link between "built" and
 * "playable". Was a port of the prototype's proven `fleetLaunchModule`
 * (REFP-10); since CONV-8 that copy is gone and this is the only implementation —
 * the prototype loads this module. Auto-rally (`unit.built` → a built ship joins
 * the world's RALLY fleet, BF-29) stayed behind at CONV-8 because it was a gap in
 * the canon rather than a duplicate; CONV-10 brought it in as its own module
 * (`autoRally.ts`), so a ship now reaches orbit either way. Adapted for the
 * multiplayer server: fleet
 * lookups from untrusted payload use `ownFleet` (own-key, A06/A08 — a poisoned
 * id like `__proto__` reads as no-fleet); `fleet.engage`'s battle creation is
 * self-contained here rather than reusing `combat.ts`'s private `startBattle`
 * (modules don't import each other — invariant #3); the prototype's
 * division-carrier re-pointing on merge is dropped — the canonical core has
 * no division/army-carrier concept (that's prototype-only state,
 * `docs/backlog.md` REFP-13). Hero re-pointing on merge IS kept: heroes are
 * core state (`state.heroes`, `heroModule`).
 */
import type { GameModule } from '../kernel/module';
import type { Battle, UnitStack } from '../state/gameState';
import { hoursToMs } from '../action/types';
import { defHasTrait } from '../data/traits';
import { isHostile, ownFleet } from '../util/combat';
import { garrisonUnderAssault, nextFleetSeq } from '../util/fleet';
import { sumUnitStat, takeFromStacks, mergeStacks } from '../util/stacks';

export const fleetOpsModule: GameModule = {
  id: 'fleet-ops',
  version: '1.0.0',
  setup(api) {
    // Scramble a planet's garrison into a mobile fleet: ships → fleet.units,
    // liftable ground troops → fleet.landing (bounded by the ships' summed
    // cargoCapacity, the same bound army.load enforces). Immobile emplacements
    // (e.g. orbital AA) can't be lifted — they stay in the garrison.
    api.onAction('fleet.launch', (action, h) => {
      const payload = action.payload as { planetId?: string };
      if (typeof payload?.planetId !== 'string') {
        return h.reject('E_BAD_PAYLOAD');
      }
      const planet = h.state.planets[payload.planetId];
      if (!planet) {
        return h.reject('E_NO_PLANET');
      }
      if (planet.owner !== action.playerId) {
        return h.reject('E_FORBIDDEN');
      }
      if (planet.garrison.length === 0) {
        return h.reject('E_EMPTY_GARRISON');
      }
      // No mid-assault evacuation: while a battle holds this garrison, scrambling
      // it onto ships would dodge the resolve — same lock as army.load.
      if (garrisonUnderAssault(h.state, planet.id)) {
        return h.reject('E_UNDER_ASSAULT');
      }
      const units = planet.garrison.filter(
        (s) => h.ctx.data.units[s.unit]?.domain !== 'ground',
      );
      const liftable = planet.garrison.filter(
        (s) =>
          h.ctx.data.units[s.unit]?.domain === 'ground' &&
          !defHasTrait(h.ctx.data.units[s.unit], 'immobile'),
      );
      if (units.length === 0) {
        return h.reject('E_NO_SHIPS'); // need at least one ship to form a fleet
      }
      let free = sumUnitStat(units, h.ctx.data, 'cargoCapacity');
      const landing: UnitStack[] = [];
      const stayBehind: UnitStack[] = [];
      for (const s of liftable) {
        const size = h.ctx.data.units[s.unit]?.stats.cargoSize ?? 1;
        const take = size > 0 ? Math.min(s.count, Math.floor(free / size)) : s.count;
        if (take > 0) {
          landing.push({ unit: s.unit, count: take });
          free -= take * size;
        }
        if (take < s.count) stayBehind.push({ unit: s.unit, count: s.count - take });
      }
      const seq = nextFleetSeq(h.state);
      const id = `fleet:${action.playerId}:${h.ctx.now}:${seq}`;
      h.state.fleets[id] = {
        id,
        owner: action.playerId,
        location: planet.id,
        movement: null,
        units: units.map((s) => ({ ...s })),
        landing,
        traits: [],
        battleId: null,
      };
      planet.garrison = planet.garrison
        .filter((s) => h.ctx.data.units[s.unit]?.traits.includes('immobile'))
        .concat(stayBehind);
      h.emit('fleet.launched', { fleetId: id, planetId: planet.id, owner: action.playerId });
    });

    // Fuse `from` into `into` when both are docked, idle and share a location.
    // Bringing the fleets together (flying one to the other) is the caller's
    // job; by the time this runs the two must already be co-located.
    api.onAction('fleet.merge', (action, h) => {
      const payload = action.payload as { from?: string; into?: string };
      if (typeof payload?.from !== 'string' || typeof payload?.into !== 'string') {
        return h.reject('E_BAD_PAYLOAD');
      }
      if (payload.from === payload.into) {
        return h.reject('E_SAME_FLEET');
      }
      const from = ownFleet(h.state, payload.from);
      const into = ownFleet(h.state, payload.into);
      if (!from || !into) {
        return h.reject('E_NO_FLEET');
      }
      if (from.owner !== action.playerId || into.owner !== action.playerId) {
        return h.reject('E_FORBIDDEN');
      }
      if (from.battleId || into.battleId) {
        return h.reject('E_IN_BATTLE');
      }
      if (from.movement || into.movement || !from.location || from.location !== into.location) {
        return h.reject('E_NOT_COLOCATED');
      }
      into.units = mergeStacks(into.units, from.units);
      into.landing = mergeStacks(into.landing ?? [], from.landing ?? []);
      // Heroes are bound by fleetId: the hero UNIT rides into the merged fleet, so
      // the hero ENTITY must follow — a stale fleetId would orphan it (and
      // hero.spawn could then mint a duplicate free flagship).
      for (const hr of Object.values(h.state.heroes ?? {})) {
        if (hr.fleetId === payload.from) hr.fleetId = into.id;
      }
      delete h.state.fleets[payload.from];
      h.emit('fleet.merged', {
        from: payload.from,
        into: payload.into,
        owner: action.playerId,
        at: into.location,
      });
    });

    // Peel a chosen set of ships off a docked, idle fleet into a fresh fleet in
    // the same sector (same orbit). Must keep ≥1 ship behind and move ≥1 out;
    // carried ground troops stay with the original.
    api.onAction('fleet.split', (action, h) => {
      const payload = action.payload as {
        fleetId?: string;
        take?: Array<{ unit?: string; count?: number }>;
      };
      if (typeof payload?.fleetId !== 'string' || !Array.isArray(payload.take)) {
        return h.reject('E_BAD_PAYLOAD');
      }
      const fleet = ownFleet(h.state, payload.fleetId);
      if (!fleet) {
        return h.reject('E_NO_FLEET');
      }
      if (fleet.owner !== action.playerId) {
        return h.reject('E_FORBIDDEN');
      }
      if (fleet.battleId) {
        return h.reject('E_IN_BATTLE');
      }
      if (fleet.movement || !fleet.location) {
        return h.reject('E_IN_TRANSIT');
      }
      const want = new Map<string, number>();
      for (const t of payload.take) {
        if (typeof t?.unit !== 'string' || typeof t?.count !== 'number' || t.count <= 0) {
          return h.reject('E_BAD_PAYLOAD');
        }
        // The hero flagship can't be peeled off by a split: the hero ENTITY is
        // bound to the source fleet by fleetId, and moving its UNIT without the
        // entity would orphan the binding.
        if (h.ctx.data.units[t.unit]?.traits.includes('hero')) {
          return h.reject('E_HERO_UNIT');
        }
        want.set(t.unit, (want.get(t.unit) ?? 0) + Math.floor(t.count));
      }
      const have = (unit: string) =>
        fleet.units.filter((st) => st.unit === unit).reduce((a, st) => a + st.count, 0);
      let takeTotal = 0;
      for (const [unit, n] of want) {
        if (n > have(unit)) return h.reject('E_NOT_ENOUGH');
        takeTotal += n;
      }
      const shipsTotal = fleet.units.reduce((a, st) => a + st.count, 0);
      if (takeTotal <= 0) {
        return h.reject('E_SPLIT_EMPTY');
      }
      if (takeTotal >= shipsTotal) {
        return h.reject('E_SPLIT_ALL'); // must leave at least one ship behind
      }
      let taken: UnitStack[] = [];
      for (const [unit, n] of want) taken = taken.concat(takeFromStacks(fleet.units, unit, n));
      fleet.units = fleet.units.filter((st) => st.count > 0);
      const seq = nextFleetSeq(h.state);
      const id = `fleet:${action.playerId}:${h.ctx.now}:${seq}`;
      h.state.fleets[id] = {
        id,
        owner: action.playerId,
        location: fleet.location,
        movement: null,
        units: taken,
        landing: [],
        traits: [],
        battleId: null,
        ...(fleet.orbit ? { orbit: fleet.orbit } : {}),
      };
      h.emit('fleet.split', {
        from: payload.fleetId,
        to: id,
        owner: action.playerId,
        at: fleet.location,
      });
    });

    // Deliberately open fire on a co-located hostile fleet.
    api.onAction('fleet.engage', (action, h) => {
      const payload = action.payload as { fleetId?: string; targetId?: string };
      if (typeof payload?.fleetId !== 'string' || typeof payload?.targetId !== 'string') {
        return h.reject('E_BAD_PAYLOAD');
      }
      if (payload.fleetId === payload.targetId) {
        return h.reject('E_SAME_FLEET');
      }
      const f = ownFleet(h.state, payload.fleetId);
      const target = ownFleet(h.state, payload.targetId);
      if (!f || !target) {
        return h.reject('E_NO_FLEET');
      }
      if (f.owner !== action.playerId) {
        return h.reject('E_FORBIDDEN');
      }
      if (!isHostile(h, f.owner, target.owner)) {
        return h.reject('E_NOT_HOSTILE');
      }
      if (!f.units.some((s) => s.count > 0) || !target.units.some((s) => s.count > 0)) {
        return h.reject('E_NO_FLEET'); // ghosts can't fight — no empty-side battles
      }
      if (f.battleId || target.battleId) {
        return h.reject('E_IN_BATTLE');
      }
      if (!f.location || f.movement || target.movement || f.location !== target.location) {
        return h.reject('E_NOT_COLOCATED');
      }
      const battleId = `battle:${h.state.battleSeq++}`;
      // Round cadence mirrors combatModule's own: one round per GAME hour
      // (÷timeScale on the wall clock), with nextRoundAt stamped for the HUD timer.
      const roundAt = h.ctx.now + hoursToMs(h.ctx, 1);
      const battle: Battle = {
        id: battleId,
        location: f.location,
        phase: 'orbital',
        attacker: { ref: { kind: 'fleet', fleetId: f.id }, owner: f.owner },
        defender: { ref: { kind: 'fleet', fleetId: target.id }, owner: target.owner },
        round: 0,
        nextRoundAt: roundAt,
      };
      h.state.battles[battleId] = battle;
      f.battleId = battleId;
      f.movement = null;
      target.battleId = battleId;
      target.movement = null;
      h.schedule(roundAt, 'combat.tick', { battleId });
      h.emit('battle.started', {
        battleId,
        location: f.location,
        phase: 'orbital',
        attacker: f.owner,
        defender: target.owner,
      });
    });
  },
};
