import { describe, it, expect } from 'vitest';
import { createKernel } from '../kernel/kernel';
import { autoRallyModule } from './autoRally';
import { autoMergeModule } from './autoMerge';
import { constructionModule } from './construction';
import { movementModule } from './movement';
import type { GameModule } from '../kernel/module';
import { rallyPointOf } from '../state/rallyPoint';
import {
  createInitialState,
  type Fleet,
  type GameState,
  type Planet,
  type Player,
} from '../state/gameState';
import { parseGameData, type GameData } from '../data/schemas';
import type { Action, AdvanceResult, ApplyResult, Context } from '../action/types';
import { deepFreeze } from '../util/clone';

// auto-rally (CONV-10) — the port of the prototype's BF-29 behaviour into the
// canon: a built SHIP joins the world's RALLY fleet instead of waiting in the
// garrison for a manual `fleet.launch`. Tested THROUGH constructionModule (the
// producer of `unit.built`) rather than by hand-emitting the event: the payload
// contract between the two modules is exactly what a port can get wrong.
//
// Both canon-vocabulary fixes are pinned here: "ground" is `domain` (the copy
// read a `ground` TRAIT that shipped data never sets) and an `immobile`
// emplacement stays planetside (the copy promised it in a comment only).

const data: GameData = parseGameData({
  version: '0.1.0',
  resources: ['metal'],
  units: {
    cruiser: {
      faction: 'x',
      domain: 'space',
      slots: { weapon: 0, defense: 1, utility: 0 },
      stats: { attack: 5, defense: 5, speed: 5, hp: 40 },
      cost: { metal: 10 },
      buildTimeHours: 0, // instant: the completion fires inside the same advance
    },
    // Ground by DOMAIN and by nothing else — exactly the shipped catalogue's
    // shape (`data/units.json` has no `ground` trait at all).
    militia: {
      faction: 'x',
      domain: 'ground',
      stats: { attack: 1, defense: 2, speed: 0, hp: 8 },
      cost: { metal: 5 },
      buildTimeHours: 0,
    },
    // A space-domain emplacement: it is not ground, but it does not fly either.
    orbital_aa: {
      faction: 'x',
      domain: 'space',
      traits: ['immobile'],
      stats: { attack: 4, defense: 14, speed: 0, hp: 30 },
      cost: { metal: 8 },
      buildTimeHours: 0,
    },
  },
  factions: {},
  buildings: {
    shipyard: {
      name: 'Shipyard',
      cost: { metal: 100 },
      buildTimeHours: 4,
      enablesShipConstruction: true,
    },
    barracks: {
      name: 'Barracks',
      cost: { metal: 70 },
      buildTimeHours: 3,
      enablesInfantryConstruction: true,
    },
  },
  events: {},
  modules: {
    plating: {
      name: 'P',
      slot: 'defense',
      tag: 'vertical',
      effects: { stats: { hp: 12 } },
      cost: { metal: 5 },
    },
  },
});

const HOUR = 3_600_000;
const ctx = (now: number): Context => ({ now, data });
const kernel = createKernel([constructionModule, autoRallyModule]);
/** The same world WITHOUT the module — the delta this brick closes. */
const bare = createKernel([constructionModule]);

function player(id: string, metal = 1000): Player {
  return { id, name: id, faction: 'x', status: 'active', resources: { metal } };
}
function planet(id: string, owner: string | null): Planet {
  return {
    id,
    owner,
    position: { x: 0, y: 0 },
    resources: {},
    buildings: [
      { type: 'shipyard', level: 1, hp: 100 },
      { type: 'barracks', level: 1, hp: 100 },
    ],
    garrison: [],
    traits: [],
  };
}
function stateWith(fleets: Fleet[] = []): GameState {
  const s = createInitialState({ seed: 'rally', version: { data: '0.1.0', manifest: '1' } });
  const byId: Record<string, Fleet> = {};
  for (const f of fleets) byId[f.id] = f;
  return {
    ...s,
    players: { p1: player('p1'), p2: player('p2') },
    planets: { A: planet('A', 'p1') },
    fleets: byId,
  };
}
function build(unit: string, count = 1, modules?: string[], playerId = 'p1'): Action {
  return {
    id: `a:${playerId}:${unit}:${count}`,
    type: 'unit.build',
    playerId,
    payload: { planetId: 'A', unit, count, ...(modules ? { modules } : {}) },
    issuedAt: 0,
  };
}
function okApply(r: ApplyResult) {
  if (!r.ok) throw new Error(`apply failed: ${r.code}`);
  return r;
}
function okAdvance(r: AdvanceResult) {
  if (!r.ok) throw new Error(`advance failed: ${r.code}`);
  return r;
}
/** Order `unit` at the world's current time and run the clock past the
 *  (instant) completion, so calls chain onto an already-advanced state. */
function built(state: GameState, unit: string, count = 1, modules?: string[]): GameState {
  const now = state.time;
  const ordered = okApply(kernel.applyAction(state, build(unit, count, modules), ctx(now)));
  return okAdvance(kernel.advanceTo(ordered.state, ctx(now + HOUR))).state;
}
const rallyFleets = (s: GameState): Fleet[] =>
  Object.values(s.fleets).filter((f) => f.traits.includes('rally'));

describe('autoRally module', () => {
  it('sends a freshly built ship to orbit as a rally fleet', () => {
    const s = built(stateWith(), 'cruiser', 2);
    expect(s.planets.A?.garrison).toEqual([]); // it did not stay planetside
    const rally = rallyFleets(s);
    expect(rally).toHaveLength(1);
    expect(rally[0]?.owner).toBe('p1');
    expect(rally[0]?.location).toBe('A');
    expect(rally[0]?.units).toEqual([{ unit: 'cruiser', count: 2 }]);
  });

  it('переезд во флот ПРИНОСИТ заслугу юнитов с собой (PERK-3.2)', () => {
    // Авто-сбор — это СПЛИТ, а сплит по правилу VET-2 копирует величины НА ЮНИТ.
    // Раньше их тут не переносили, и на новостройках это было незаметно: у них заслуги
    // нет. С отметкой промоушена, которая ставится ИМЕННО при постройке, дыра стала
    // видимой — корабль терял её в ту же секунду, как его поднимали с верфи.
    const seeded = stateWith();
    seeded.planets.A!.garrison = [{ unit: 'cruiser', count: 2, promoted: 1 }];
    const s = built(seeded, 'cruiser', 2);
    const rally = rallyFleets(s);
    expect(rally).toHaveLength(1);
    // Уносится РОВНО построенное количество, а не весь стек, — остальные остаются.
    const moved = rally[0]?.units[0];
    expect(moved?.count).toBe(2);
    // Постройка сперва разбавила стек (2 отмеченных + 2 новобранца той же выслуги), и
    // уехавшие юниты несут уже разбавленную величину на юнит — а не ноль, как было до правки.
    expect(moved?.promoted).toBeCloseTo(0.5, 9);
    expect(s.planets.A?.garrison[0]?.promoted).toBeCloseTo(0.5, 9); // у оставшихся то же
  });

  it('новостройка к ВЕТЕРАНАМ не доливается и уезжает одна (решение владельца 2026-09-25)', () => {
    const seeded = stateWith();
    seeded.planets.A!.garrison = [{ unit: 'cruiser', count: 2, battles: 3 }];
    const s = built(seeded, 'cruiser', 2);
    expect(rallyFleets(s)[0]?.units).toEqual([{ unit: 'cruiser', count: 2 }]);
    expect(s.planets.A?.garrison).toEqual([{ unit: 'cruiser', count: 2, battles: 3 }]);
  });

  it('leaves the ship in the garrison when the module is absent (the gap it closes)', () => {
    const ordered = okApply(bare.applyAction(stateWith(), build('cruiser', 2), ctx(0)));
    const s = okAdvance(bare.advanceTo(ordered.state, ctx(HOUR))).state;
    expect(s.planets.A?.garrison).toEqual([{ unit: 'cruiser', count: 2 }]);
    expect(Object.keys(s.fleets)).toEqual([]);
  });

  it('pools ships from separate orders into ONE rally fleet', () => {
    const s = built(built(stateWith(), 'cruiser', 1), 'cruiser', 3);
    const rally = rallyFleets(s);
    expect(rally).toHaveLength(1);
    expect(rally[0]?.units).toEqual([{ unit: 'cruiser', count: 4 }]);
  });

  it('never merges into an untagged fleet the player already had on the node', () => {
    const existing: Fleet = {
      id: 'F',
      owner: 'p1',
      location: 'A',
      movement: null,
      units: [{ unit: 'cruiser', count: 5 }],
      traits: [],
    };
    const s = built(stateWith([existing]), 'cruiser', 1);
    expect(s.fleets.F?.units).toEqual([{ unit: 'cruiser', count: 5 }]); // untouched
    const rally = rallyFleets(s);
    expect(rally).toHaveLength(1);
    expect(rally[0]?.id).not.toBe('F');
    expect(rally[0]?.units).toEqual([{ unit: 'cruiser', count: 1 }]);
  });

  it('keeps ground troops planetside — by domain, with no `ground` trait in the data', () => {
    const s = built(stateWith(), 'militia', 3);
    expect(data.units.militia?.traits).toEqual([]); // the shape the copy misread
    expect(s.planets.A?.garrison).toEqual([{ unit: 'militia', count: 3 }]);
    expect(rallyFleets(s)).toEqual([]);
  });

  it('keeps an immobile emplacement planetside even though it is space-domain', () => {
    const s = built(stateWith(), 'orbital_aa', 1);
    expect(s.planets.A?.garrison).toEqual([{ unit: 'orbital_aa', count: 1 }]);
    expect(rallyFleets(s)).toEqual([]);
  });

  it('carries the paid loadout onto the rally stack and leaves other stacks alone', () => {
    const withBare = built(stateWith(), 'cruiser', 1); // one bare cruiser rallies first
    const s = built(withBare, 'cruiser', 2, ['plating']);
    const rally = rallyFleets(s);
    expect(rally).toHaveLength(1);
    expect(rally[0]?.units).toEqual([
      { unit: 'cruiser', count: 1 },
      { unit: 'cruiser', count: 2, modules: ['plating'] }, // fitted stack stays separate
    ]);
    expect(s.planets.A?.garrison).toEqual([]);
  });

  it('is pure: the input state is never mutated', () => {
    const before = stateWith();
    const ordered = okApply(kernel.applyAction(before, build('cruiser', 1), ctx(0)));
    deepFreeze(ordered.state);
    expect(() => okAdvance(kernel.advanceTo(ordered.state, ctx(HOUR)))).not.toThrow();
  });
});

// RALLY-1 (заказ владельца 2026-10-14, «как во всяких RTS»): у мира-верфи есть точка
// сбора — свой другой мир, куда каждый готовый заказ кораблей вылетает сам.
describe('autoRally — точка сбора (RALLY-1)', () => {
  /** Захват по тестовому приказу: модуль боя здесь не нужен, нужно только событие. */
  const capturer: GameModule = {
    id: 'test-capture',
    version: '1.0.0',
    setup(api) {
      api.onAction('test.capture', (action, h) => {
        const { planetId } = action.payload as { planetId: string };
        const planet = h.state.planets[planetId]!;
        const from = planet.owner;
        planet.owner = action.playerId;
        h.emit('planet.captured', { planetId, owner: action.playerId, from, via: 'occupy' });
      });
    },
  };
  const full = createKernel([
    constructionModule,
    movementModule,
    autoRallyModule,
    capturer,
    autoMergeModule,
  ]);

  /** A (верфь) — B (свой мир) по дороге, C — чужой мир, D — свой, но без дороги. */
  function front(): GameState {
    const s = stateWith();
    const at = (id: string, owner: string | null, x: number, links: string[]): Planet => ({
      ...planet(id, owner),
      position: { x, y: 0 },
      links,
    });
    s.planets = {
      A: at('A', 'p1', 0, ['B', 'C']),
      B: at('B', 'p1', 100, ['A']),
      C: at('C', 'p2', -100, ['A']),
      D: at('D', 'p1', 500, []),
    };
    return s;
  }
  function rally(planetId: string, to: string | null, playerId = 'p1'): Action {
    return {
      id: `r:${playerId}:${planetId}:${to}`,
      type: 'rally.point',
      playerId,
      payload: { planetId, to },
      issuedAt: 0,
    };
  }
  const apply = (s: GameState, a: Action) => full.applyAction(s, a, ctx(s.time));
  const pointed = (to: string, s = front()) => okApply(apply(s, rally('A', to))).state;
  /** Заказ и выпуск в тот же миг: часы НЕ уходят вперёд, флот ещё в пути. */
  function launched(s: GameState, unit = 'cruiser', count = 1): GameState {
    const ordered = okApply(full.applyAction(s, build(unit, count), ctx(s.time)));
    return okAdvance(full.advanceTo(ordered.state, ctx(s.time + 1))).state;
  }
  const flying = (s: GameState) => Object.values(s.fleets).filter((f) => f.movement);
  const idleAt = (s: GameState, at: string) =>
    Object.values(s.fleets).filter((f) => f.location === at && !f.movement);

  it('построенный заказ сам вылетает к точке своим флотом', () => {
    const s = launched(pointed('B'), 'cruiser', 2);
    expect(s.planets.A?.garrison).toEqual([]);
    expect(idleAt(s, 'A')).toEqual([]); // на орбите верфи ничего не осталось
    const [wave] = flying(s);
    expect(wave?.units).toEqual([{ unit: 'cruiser', count: 2 }]);
    expect(wave?.movement?.destination).toBe('B');
    expect(wave?.traits).toEqual(['rally']);
  });

  it('на месте подкрепление вливается во флот, который стоит у цели', () => {
    const s0 = pointed('B');
    s0.fleets.G = {
      id: 'G',
      owner: 'p1',
      location: 'B',
      movement: null,
      units: [{ unit: 'cruiser', count: 5 }],
      traits: [],
    };
    const s = okAdvance(full.advanceTo(launched(s0), ctx(s0.time + 100 * HOUR))).state;
    expect(flying(s)).toEqual([]);
    expect(Object.keys(s.fleets)).toEqual(['G']);
    expect(s.fleets.G?.units).toEqual([{ unit: 'cruiser', count: 6 }]);
  });

  it('корабли, уже стоявшие на орбите верфи, точка не трогает', () => {
    const before = built(front(), 'cruiser', 3); // сборный флот на орбите A
    const [orbit] = rallyFleets(before);
    const s = launched(pointed('B', before));
    expect(s.fleets[orbit!.id]?.location).toBe('A');
    expect(s.fleets[orbit!.id]?.units).toEqual([{ unit: 'cruiser', count: 3 }]);
    expect(flying(s)).toHaveLength(1);
  });

  it('наземные войска и орудия остаются дома, как без точки', () => {
    const s = launched(launched(pointed('B'), 'militia', 2), 'orbital_aa', 1);
    expect(s.planets.A?.garrison).toEqual([
      { unit: 'militia', count: 2 },
      { unit: 'orbital_aa', count: 1 },
    ]);
    expect(flying(s)).toEqual([]);
  });

  it('нет пути к цели — заказ ложится на орбиту, лишнего флота не остаётся', () => {
    const s = launched(pointed('D'));
    expect(flying(s)).toEqual([]);
    expect(Object.values(s.fleets)).toHaveLength(1);
    expect(rallyFleets(s)[0]?.units).toEqual([{ unit: 'cruiser', count: 1 }]);
  });

  it('без модуля движения точка молчит: корабли на орбите, как раньше', () => {
    const s0 = okApply(kernel.applyAction(front(), rally('A', 'B'), ctx(0))).state;
    const s = built(s0, 'cruiser', 1);
    expect(rallyFleets(s).map((f) => f.location)).toEqual(['A']);
  });

  it('ставится только со своего мира на свой другой мир', () => {
    expect(apply(front(), rally('A', 'C'))).toMatchObject({ ok: false, code: 'E_FORBIDDEN' });
    expect(apply(front(), rally('C', 'A'))).toMatchObject({ ok: false, code: 'E_FORBIDDEN' });
    expect(apply(front(), rally('A', 'A'))).toMatchObject({ ok: false, code: 'E_SAME_LOCATION' });
    expect(apply(front(), rally('A', 'Z'))).toMatchObject({ ok: false, code: 'E_NO_PLANET' });
    expect(pointed('B').rallyPoints).toEqual({ p1: { A: 'B' } });
  });

  it('снятие точки убирает запись целиком', () => {
    const s = okApply(apply(pointed('B'), rally('A', null))).state;
    expect(s.rallyPoints).toBeUndefined();
    expect(okApply(apply(front(), rally('A', null))).state.rallyPoints).toBeUndefined();
  });

  it('потеря мира-верфи или цели снимает точку', () => {
    const capture = (planetId: string): Action => ({
      id: `cap:${planetId}`,
      type: 'test.capture',
      playerId: 'p2',
      payload: { planetId },
      issuedAt: 0,
    });
    const lostTarget = okApply(apply(pointed('B'), capture('B'))).state;
    expect(lostTarget.rallyPoints).toBeUndefined();
    const lostSource = okApply(apply(pointed('B'), capture('A'))).state;
    expect(lostSource.rallyPoints).toBeUndefined();
    // Захватчик не наследует чужую точку и не получает подкреплений.
    expect(rallyPointOf(lostSource, 'p2', 'A')).toBeNull();
  });

  it('rallyPointOf не верит записи, ставшей чужой', () => {
    const s = pointed('B');
    expect(rallyPointOf(s, 'p1', 'A')).toBe('B');
    s.planets.B!.owner = 'p2'; // мир ушёл мимо события захвата
    expect(rallyPointOf(s, 'p1', 'A')).toBeNull();
  });
});
