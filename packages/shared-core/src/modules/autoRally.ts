/**
 * Auto-rally (BF-29) — a freshly built SHIP does not sit in the garrison waiting
 * to be scrambled: it flies straight to orbit and joins the world's RALLY fleet,
 * so ships ordered in one queue pool into a single fleet. Ground troops (and
 * immobile emplacements) stay planetside as before.
 *
 * Was the last mechanic the playable prototype held alone (`prototype/src/
 * autoRally.ts`, CONV-8 left it there because the block only merged mechanics
 * implemented TWICE). This is the port to the canon (CONV-10): without it a
 * player moving from the prototype host to `packages/server` would silently lose
 * the behaviour and have to raise every hull by hand with `fleet.launch`.
 *
 * Two rules changed on the way in, both to match the canon's own vocabulary:
 *
 * 1. "Ground" is `domain`, not a trait. The copy read `def.traits.includes('ground')`,
 *    which is never true in the SHIPPED `data/units.json` (militia/tank/infantry
 *    carry `domain: 'ground'` and no traits) — on canon data the copy would have
 *    flown infantry into orbit. Same reading as `fleet.launch` (CONV-8 finding).
 * 2. An `immobile` emplacement never rallies, exactly as it never launches or
 *    loads. The copy's own comment promised this; its code did not check it.
 *
 * The rally fleet is tagged `rally`; fleets the player already had on orbit lack
 * the tag, so a build never silently merges into one of them. The stack is pulled
 * loadout-keyed (BF-29) so paid modules ride along instead of being stripped.
 */
import type { GameModule } from '../kernel/module';
import type { Fleet } from '../state/gameState';
import { defHasTrait } from '../data/traits';
import { nextFleetSeq } from '../util/fleet';
import { addUnits, findHealthyStack } from '../util/stacks';

export const autoRallyModule: GameModule = {
  id: 'auto-rally',
  version: '1.0.0',
  setup(api) {
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
      if (!def || def.domain === 'ground' || defHasTrait(def, 'immobile')) {
        return; // ground army and fixed emplacements stay planetside
      }
      const planet = h.state.planets[p.planetId];
      if (!planet || planet.owner !== p.owner) return;
      const want = p.count ?? 0;
      if (want <= 0) return;
      // The build's paid loadout rides along (BF-29): pull the EXACT fitted stack
      // the construction module just filled (loadout-keyed, like `fleet.split`)
      // and re-stamp the modules on the rally stack.
      const mods = Array.isArray(p.modules)
        ? p.modules.filter((m): m is string => typeof m === 'string')
        : undefined;
      const stack = findHealthyStack(planet.garrison, p.unit, mods);
      if (!stack) return;
      const take = Math.min(want, stack.count);
      if (take <= 0) return;
      stack.count -= take;
      if (stack.count <= 0) planet.garrison.splice(planet.garrison.indexOf(stack), 1);
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
        const fresh: Fleet = {
          id: `fleet:${p.owner}:${h.ctx.now}:${seq}`,
          owner: p.owner,
          location: planet.id,
          movement: null,
          units: [],
          landing: [],
          traits: ['rally'],
          battleId: null,
        };
        h.state.fleets[fresh.id] = fresh;
        rally = fresh;
      }
      addUnits(rally.units, p.unit, take, mods);
    });
  },
};
