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
 *
 * ТОЧКА СБОРА (RALLY-1, заказ владельца 2026-10-14 «как во всяких RTS»): мир-верфи можно
 * назначить свой же мир (`rally.point`), и тогда каждый готовый заказ кораблей не ложится
 * в орбитальный флот, а сразу вылетает туда СВОИМ флотом. На месте его подхватывает
 * автослияние — подкрепления собираются во флот, который стоит у цели. Корабли, что уже
 * стояли на орбите, точка не трогает: она про новостройки, как в RTS. Курс прокладывает
 * модуль движения (возможность `fleet.course`, тот же маршрутизатор, что у приказа
 * «Курс»), поэтому правила пути общие: мир соседа по миру не пропустит. Курса нет (пути
 * нет, нет модуля движения) — заказ остаётся на орбите, как без точки. Боя в мире-верфи
 * здесь не проверяем: под боем верфь не выпускает заказ вовсе (`construction`, «узел не
 * работает»), так что осаждённый мир защитников не отсылает и так.
 */
import type { GameModule, HandlerContext } from '../kernel/module';
import type { Fleet, GameState, PlanetId, PlayerId } from '../state/gameState';
import type { FleetCourse } from './movement';
import { defHasTrait } from '../data/traits';
import { rallyPointOf } from '../state/rallyPoint';
import { nextFleetSeq } from '../util/fleet';
import { addUnits, findHealthyStack } from '../util/stacks';

/** Новый пустой флот сбора на орбите мира. */
function newRallyFleet(h: HandlerContext, owner: PlayerId, at: PlanetId): Fleet {
  const seq = nextFleetSeq(h.state);
  const fresh: Fleet = {
    id: `fleet:${owner}:${h.ctx.now}:${seq}`,
    owner,
    location: at,
    movement: null,
    units: [],
    landing: [],
    traits: ['rally'],
    battleId: null,
  };
  h.state.fleets[fresh.id] = fresh;
  return fresh;
}

/** Убирает точки сбора, которые потеряли смысл: мир сменил хозяина — его точка у
 *  прежнего хозяина больше не действует, и не действуют точки, указывавшие на него. */
function dropRallyPointsOf(state: GameState, planetId: PlanetId, keepOwner: PlayerId): void {
  const all = state.rallyPoints;
  if (!all) return;
  for (const owner of Object.keys(all)) {
    if (owner === keepOwner) continue;
    const mine = all[owner];
    if (!mine) continue;
    for (const from of Object.keys(mine)) {
      if (from === planetId || mine[from] === planetId) delete mine[from];
    }
    if (Object.keys(mine).length === 0) delete all[owner];
  }
  if (Object.keys(all).length === 0) delete state.rallyPoints;
}

export const autoRallyModule: GameModule = {
  id: 'auto-rally',
  version: '1.1.0', // RALLY-1: точка сбора (`rally.point`)
  setup(api) {
    // RALLY-1: поставить (`to` — свой другой мир) или снять (`to: null`) точку сбора.
    api.onAction('rally.point', (action, h) => {
      const p = action.payload as { planetId?: unknown; to?: unknown };
      if (typeof p?.planetId !== 'string' || (p.to !== null && typeof p.to !== 'string')) {
        return h.reject('E_BAD_PAYLOAD');
      }
      const planet = h.state.planets[p.planetId];
      if (!planet) return h.reject('E_NO_PLANET');
      if (planet.owner !== action.playerId) return h.reject('E_FORBIDDEN');
      if (p.to === null) {
        const all = h.state.rallyPoints;
        const mine = all?.[action.playerId];
        if (!all || !mine) return;
        delete mine[p.planetId];
        if (Object.keys(mine).length === 0) delete all[action.playerId];
        if (Object.keys(all).length === 0) delete h.state.rallyPoints;
        return;
      }
      if (p.to === p.planetId) return h.reject('E_SAME_LOCATION');
      const target = h.state.planets[p.to];
      if (!target) return h.reject('E_NO_PLANET');
      // Точка сбора — только СВОЙ мир (решение 2026-10-14): подкрепления собираются в
      // один флот у себя, а не летят в чужой мир по одному заказу.
      if (target.owner !== action.playerId) return h.reject('E_FORBIDDEN');
      ((h.state.rallyPoints ??= {})[action.playerId] ??= {})[p.planetId] = p.to;
    });

    api.on('planet.captured', (event, h) => {
      const p = event.payload as { planetId?: unknown; owner?: unknown };
      if (typeof p?.planetId !== 'string' || typeof p.owner !== 'string') return;
      dropRallyPointsOf(h.state, p.planetId, p.owner);
    });

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
      // Выслуга 0: новостройка легла в стек НОВИЧКОВ — ветераны того же корпуса стоят
      // отдельно (`serviceKey`), и увести надо построенное, а не их.
      const stack = findHealthyStack(planet.garrison, p.unit, mods, 0);
      if (!stack) return;
      const take = Math.min(want, stack.count);
      if (take <= 0) return;
      stack.count -= take;
      if (stack.count <= 0) planet.garrison.splice(planet.garrison.indexOf(stack), 1);
      // Точка сбора: заказ вылетает к ней своим флотом. Курс не дан — флот этого заказа
      // разбирается обратно, и корабли ложатся на орбиту, как без точки.
      const to = rallyPointOf(h.state, p.owner, planet.id);
      if (to !== null) {
        const wave = newRallyFleet(h, p.owner, planet.id);
        addUnits(wave.units, p.unit, take, mods, stack.moduleStars, stack.moduleRarity, stack);
        const course = h.capability<FleetCourse>('fleet.course');
        if (course?.({ fleetId: wave.id, playerId: p.owner, to }, h) === null) return;
        delete h.state.fleets[wave.id];
      }
      let rally = Object.values(h.state.fleets).find(
        (f) =>
          f.owner === p.owner &&
          f.location === planet.id &&
          !f.movement &&
          !f.battleId &&
          f.traits.includes('rally'),
      );
      rally ??= newRallyFleet(h, p.owner, planet.id);
      // Звёздность едет с тем же стеком, что и лоадаут (SZE-1.1) — иначе корабль
      // терял бы заточку ровно в тот момент, когда его поднимают с верфи во флот.
      //
      // ЗАСЛУГА едет по той же причине (PERK-3.2). Это ПЕРЕЕЗД юнитов, то есть сплит, а
      // сплит по правилу VET-2 копирует величины НА ЮНИТ. Раньше их тут не переносили, и
      // на новостройках это было незаметно — у них заслуги нет. С отметкой промоушена,
      // которая ставится ИМЕННО при постройке, дыра стала видимой: корабль терял её в ту
      // же секунду, как авто-сбор поднимал его во флот.
      addUnits(rally.units, p.unit, take, mods, stack.moduleStars, stack.moduleRarity, stack);
    });
  },
};
