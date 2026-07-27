/**
 * fleet.launch / fleet.merge / fleet.split / fleet.engage — form and consolidate
 * mobile fleets out of a planet's garrison, plus the monotonic fleet-id counter
 * they share (mirrors battleSeq/divisionSeq). Extracted from `game.ts` (REFP-10):
 * the core builds units into a planet's garrison; this module lets a player
 * scramble those into a new fleet (ships → units, ground troops → landing) so
 * production feeds offense, fuse/split co-located fleets, and open a battle.
 * `game.ts` imports `fleetLaunchModule` for `MODULES`; `divisionsOf` stays
 * imported FROM `game.ts` (division state isn't extracted yet, REFP-13) —
 * the reverse edge is safe because it's only read inside a handler body, never
 * at module-init time.
 */
import {
  type GameModule,
  type GameState,
  type UnitStack,
  getStance,
  hoursToMs,
  type Battle,
} from '../../packages/shared-core/src/index';
import { sumUnitStat } from '../../packages/shared-core/src/util/stacks';
import { garrisonUnderAssault } from '../../packages/shared-core/src/util/fleet';
import { loadoutKey, takeFromStacks, mergeStacks } from './fleetStacks';
import { divisionsOf } from './game';

/** Minimal view of the prototype's state extension this module needs. */
interface FleetSeqState extends GameState {
  fleetSeq?: number;
}

/** Monotonic fleet-id counter (mirrors battleSeq/divisionSeq). The old
 *  `Object.keys(fleets).length` recycled freed numbers: a delete + re-mint in the
 *  same ms regenerated a LIVE id and silently overwrote that fleet (BF-25).
 *  Seeds from the current count so pre-counter saves keep minting unique ids. */
function nextFleetSeq(state: GameState): number {
  const s = state as FleetSeqState;
  const seq = (s.fleetSeq ?? Object.keys(state.fleets).length) + 1;
  s.fleetSeq = seq;
  return seq;
}

export const fleetLaunchModule: GameModule = {
  id: 'fleet-ops',
  version: '0.1.0',
  setup(api) {
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
      // No mid-assault evacuation (BF-27): while a battle holds this garrison,
      // scrambling it onto ships would dodge the resolve — same lock as army.load.
      if (garrisonUnderAssault(h.state, planet.id)) {
        return h.reject('E_UNDER_ASSAULT');
      }
      // A fleet can't sit where one is already stationed-and-idle? Allow stacking.
      const units = planet.garrison.filter(
        (s) => !h.ctx.data.units[s.unit]?.traits.includes('ground'),
      );
      // Immobile emplacements (e.g. orbital AA, traits ['ground','immobile']) are
      // fixed installations: they can't be lifted onto a fleet — the same rule the
      // core army.load enforces with E_IMMOBILE. They are neither ships nor liftable
      // cargo, so they stay behind in the garrison (see the garrison reset below).
      const liftable = planet.garrison.filter(
        (s) =>
          h.ctx.data.units[s.unit]?.traits.includes('ground') &&
          !h.ctx.data.units[s.unit]?.traits.includes('immobile'),
      );
      if (units.length === 0) {
        return h.reject('E_NO_SHIPS'); // need at least one ship to form a fleet
      }
      // Cargo cap (BF-28): the new fleet lifts ground troops only up to its ships'
      // summed cargoCapacity — the same bound army.load enforces — in garrison
      // order; whatever doesn't fit stays planetside.
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
        units: units.map((s) => ({ unit: s.unit, count: s.count })),
        landing,
        traits: [],
        battleId: null,
      };
      // Keep immobile emplacements + the over-cap troops behind; ships and the
      // lifted cargo are aboard now.
      planet.garrison = planet.garrison
        .filter((s) => h.ctx.data.units[s.unit]?.traits.includes('immobile'))
        .concat(stayBehind);
      h.emit('fleet.launched', { fleetId: id, planetId: planet.id, owner: action.playerId });
    });

    // Auto-rally: a freshly-built SHIP doesn't sit in the garrison waiting to be
    // launched — it flies straight to orbit and joins the world's RALLY fleet (the
    // construction output). Ships ordered in one queue thus pool into a single fleet.
    // The rally fleet is tagged 'rally'; pre-existing fleets the player already had on
    // orbit lack the tag, so a new build never silently merges into them. Ground units
    // (and immobile emplacements) stay in the garrison as before.
    api.on('unit.built', (event, h) => {
      const p = event.payload as {
        planetId?: string;
        unit?: string;
        count?: number;
        owner?: string;
        modules?: unknown;
      };
      if (
        typeof p?.planetId !== 'string' ||
        typeof p?.unit !== 'string' ||
        typeof p?.owner !== 'string'
      ) {
        return;
      }
      const def = h.ctx.data.units[p.unit];
      if (!def || def.traits.includes('ground')) return; // ground army stays planetside
      const planet = h.state.planets[p.planetId];
      if (!planet || planet.owner !== p.owner) return;
      const want = p.count ?? 0;
      // The build's paid loadout rides along (BF-29): pull the EXACT fitted stack
      // out of the garrison (loadout-keyed, like fleet.split) and re-stamp the
      // modules on the rally stack — auto-rally must not strip «Оснащение».
      const mods = Array.isArray(p.modules)
        ? p.modules.filter((m): m is string => typeof m === 'string')
        : undefined;
      const key = loadoutKey(mods);
      const gi = planet.garrison.findIndex(
        (st) => st.unit === p.unit && loadoutKey(st.modules) === key,
      );
      if (want <= 0 || gi < 0) return;
      const take = Math.min(want, planet.garrison[gi].count);
      if (take <= 0) return;
      // pull the just-built ships out of the garrison the core added them to
      planet.garrison[gi].count -= take;
      if (planet.garrison[gi].count <= 0) planet.garrison.splice(gi, 1);
      let rally = Object.values(h.state.fleets).find(
        (f) =>
          f.owner === p.owner &&
          f.location === planet.id &&
          !f.movement &&
          !f.battleId &&
          f.traits.includes('rally'),
      );
      if (!rally) {
        const seq = nextFleetSeq(h.state);
        rally = {
          id: `fleet:${p.owner}:${h.ctx.now}:${seq}`,
          owner: p.owner,
          location: planet.id,
          movement: null,
          units: [],
          landing: [],
          traits: ['rally'],
          battleId: null,
        };
        h.state.fleets[rally.id] = rally;
      }
      const si = rally.units.findIndex(
        (st) => st.unit === p.unit && loadoutKey(st.modules) === key,
      );
      if (si >= 0) rally.units[si].count += take;
      else {
        rally.units.push({
          unit: p.unit,
          count: take,
          ...(mods && mods.length > 0 ? { modules: [...mods] } : {}),
        });
      }
    });

    // Fuse `from` into `into` when both are docked, idle and in the same sector.
    // Bringing the fleets together (flying one to the other) is the caller's job;
    // by the time this action runs the two must already share a location.
    api.onAction('fleet.merge', (action, h) => {
      const payload = action.payload as { from?: string; into?: string };
      if (typeof payload?.from !== 'string' || typeof payload?.into !== 'string') {
        return h.reject('E_BAD_PAYLOAD');
      }
      if (payload.from === payload.into) {
        return h.reject('E_SAME_FLEET');
      }
      const from = h.state.fleets[payload.from];
      const into = h.state.fleets[payload.into];
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
      // Carried divisions ride `from` — re-point them to `into` BEFORE deleting `from`,
      // or the carrier-destroyed reaper (time.advanced) would mistake them for cargo lost
      // with a sunk ship and delete them. Merge is the one fleet-removal that isn't a death.
      for (const d of Object.values(divisionsOf(h.state))) {
        if (d.carriedBy === payload.from) d.carriedBy = into.id;
      }
      // Heroes are bound by fleetId the same way (BF-3): the hero UNIT rides into the
      // merged fleet, so the hero ENTITY must follow — a stale fleetId left the hero
      // orphaned, and hero.spawn could then mint a duplicate free flagship.
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

    // Peel a chosen set of ships off a docked, idle fleet into a fresh fleet that
    // spawns in the same sector (same orbit). The split must keep ≥1 ship behind
    // and move ≥1 out; carried ground troops stay with the original.
    api.onAction('fleet.split', (action, h) => {
      const payload = action.payload as {
        fleetId?: string;
        take?: Array<{ unit?: string; count?: number }>;
      };
      if (typeof payload?.fleetId !== 'string' || !Array.isArray(payload.take)) {
        return h.reject('E_BAD_PAYLOAD');
      }
      const fleet = h.state.fleets[payload.fleetId];
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
        // The hero flagship can't be peeled off by a split (BF-3): the hero ENTITY is
        // bound to the source fleet by fleetId, and moving its UNIT without the entity
        // would orphan the binding (wrong-fleet aura, wrong-hero death attribution).
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
        return h.reject('E_SPLIT_ALL'); // must leave at least one ship in the original
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

    api.onAction('fleet.engage', (action, h) => {
      const payload = action.payload as { fleetId?: string; targetId?: string };
      if (typeof payload?.fleetId !== 'string' || typeof payload?.targetId !== 'string') {
        return h.reject('E_BAD_PAYLOAD');
      }
      if (payload.fleetId === payload.targetId) return h.reject('E_SAME_FLEET');
      const f = h.state.fleets[payload.fleetId];
      const target = h.state.fleets[payload.targetId];
      if (!f || !target) return h.reject('E_NO_FLEET');
      if (f.owner !== action.playerId) return h.reject('E_FORBIDDEN');
      if (f.owner === target.owner) return h.reject('E_FORBIDDEN');
      // Combat needs a DECLARED war (BF-охота MAJOR): engage was the one attack path
      // without a stance gate — a hand-crafted client action could open fire on a
      // player at peace/pact/alliance, bypassing diplomacy entirely in multiplayer.
      if (getStance(h.state, f.owner, target.owner) !== 'war') return h.reject('E_NOT_HOSTILE');
      if (!f.units.some((s) => s.count > 0) || !target.units.some((s) => s.count > 0)) {
        return h.reject('E_NO_FLEET'); // ghosts can't fight — no empty-side battles
      }
      if (f.battleId || target.battleId) return h.reject('E_IN_BATTLE');
      if (!f.location || f.movement || target.movement || f.location !== target.location) {
        return h.reject('E_NOT_COLOCATED');
      }
      const battleId = `battle:${h.state.battleSeq++}`;
      // Round cadence mirrors the core combat module: one round per GAME hour
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
