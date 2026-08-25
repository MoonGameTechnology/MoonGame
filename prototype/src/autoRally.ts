/**
 * Авто-сбор построенного (BF-29) — механика ПРОТОТИПА, которой в ядре нет.
 *
 * Осталась здесь при сведении CONV-8 сознательно: правило блока — «механика,
 * реализованная ДВАЖДЫ, сводится к одной», а эта реализована один раз. Четыре действия
 * флота (`fleet.launch`/`merge`/`split`/`engage`) были копией и уехали в
 * `fleetOpsModule` ядра; этот обработчик — нет.
 *
 * Следствие, которое нужно знать: на каноническом сервере (`packages/server`) авто-сбора
 * НЕТ. Игрок, переехавший с прототипного хоста, обнаружит, что построенные корабли
 * снова копятся в гарнизоне и их надо поднимать вручную. Заведено отдельным кирпичом —
 * это пробел канона, а не дубль.
 *
 * Счётчик идентификаторов флотов берётся из ядра (`nextFleetSeq`): своя копия правила
 * засева и есть тот самый BF-25, из-за которого счётчик вообще появился.
 */
import { type GameModule, nextFleetSeq } from '../../packages/shared-core/src/index';
import { loadoutKey } from '../../packages/shared-core/src/index';

export const autoRallyModule: GameModule = {
  id: 'auto-rally',
  version: '1.0.0',
  setup(api) {
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
      const stack = gi >= 0 ? planet.garrison[gi] : undefined;
      if (want <= 0 || !stack) return;
      const take = Math.min(want, stack.count);
      if (take <= 0) return;
      // pull the just-built ships out of the garrison the core added them to
      stack.count -= take;
      if (stack.count <= 0) planet.garrison.splice(gi, 1);
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
      const slot = si >= 0 ? rally.units[si] : undefined;
      if (slot) slot.count += take;
      else {
        rally.units.push({
          unit: p.unit,
          count: take,
          ...(mods && mods.length > 0 ? { modules: [...mods] } : {}),
        });
      }
    });
  },
};
