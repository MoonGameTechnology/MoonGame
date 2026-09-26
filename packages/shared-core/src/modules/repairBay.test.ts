/**
 * РЕМОНТНЫЙ АНГАР (SHU-5.4, резолюция владельца 2026-09-26, shuttles-roadmap §0.6).
 *
 * Корпус даром не чинится (shields-roadmap SH-2.1) — плата за ремонт в походе это слот:
 *
 * 1. **Корабль с модулем `repair_bay`** (стат `hullRepair`, 5%/ч) чинит свой корпус ВЕЗДЕ
 *    вне боя; без модуля вдали от дока корпус стоит.
 * 2. **У дока — сверх темпа дока**: темпы складываются.
 * 3. **В бою ремонта нет.**
 * 4. **Эскадры в ангаре такого флота** чинятся тем же темпом и в походе.
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { createKernel } from '../kernel/kernel';
import { shuttleModule } from './shuttle';
import { constructionModule } from './construction';
import {
  createInitialState,
  type Fleet,
  type GameState,
  type Planet,
  type Player,
} from '../state/gameState';
import { parseGameData, type GameData } from '../data/schemas';

const data: GameData = parseGameData({
  version: '0.1.0',
  resources: ['metal'],
  units: {
    cruiser: {
      faction: 'x',
      domain: 'space',
      stats: { attack: 5, defense: 5, speed: 6, hp: 100, cargoCapacity: 4 },
    },
    striker: {
      faction: 'x',
      domain: 'space',
      traits: ['shuttle'],
      stats: {
        attack: 12,
        defense: 3,
        speed: 100,
        hp: 10,
        strikeRange: 180,
        fuel: 4,
        rearmRounds: 2,
        cargoSize: 1,
      },
    },
  },
  factions: {},
  buildings: {
    // Док: 10% полного корпуса в час.
    dock: { name: 'Dock', cost: {}, buildTimeHours: 0, hp: 30, shipRepair: 0.1 },
  },
  modules: {
    repair_bay: {
      name: 'Repair Bay',
      slot: 'utility',
      tag: 'horizontal',
      effects: { stats: { hullRepair: 0.05 } },
    },
  },
  events: {},
});

const HOUR = 3_600_000;
const kernel = createKernel([constructionModule, shuttleModule]);
const player = (id: string): Player => ({
  id,
  name: id,
  faction: 'x',
  status: 'active',
  resources: {},
});

function planet(id: string, owner: string | null, x: number, buildings: string[] = []): Planet {
  return {
    id,
    owner,
    position: { x, y: 0 },
    resources: {},
    buildings: buildings.map((type) => ({ type, level: 1, hp: data.buildings[type]!.hp })),
    garrison: [],
    traits: [],
  };
}

/** Крейсер с корпусом 50 из 100 — с модулем или без — у мира `at`. */
function cruiser(at: string, bay: boolean, over: Partial<Fleet> = {}): Fleet {
  return {
    id: 'CR',
    owner: 'p1',
    location: at,
    movement: null,
    units: [{ unit: 'cruiser', count: 1, hp: 50, ...(bay ? { modules: ['repair_bay'] } : {}) }],
    traits: [],
    battleId: null,
    ...over,
  };
}

function world(fleet: Fleet): GameState {
  const s = createInitialState({ seed: 'shu54', version: { data: '0.1.0', manifest: '1' } });
  return {
    ...s,
    players: { p1: player('p1') },
    planets: { A: planet('A', 'p1', 0, ['dock']), FAR: planet('FAR', null, 400) },
    fleets: { CR: fleet },
    heroes: {},
    battles: {},
  };
}

function advance(state: GameState, hours: number): GameState {
  const r = kernel.advanceTo(state, { now: state.time + hours * HOUR, data });
  if (!r.ok) throw new Error(r.code);
  return r.state;
}
const hull = (s: GameState): number | undefined => s.fleets.CR?.units[0]?.hp;

describe('SHU-5.4 — ремонтный ангар', () => {
  it('ГОТОВО: флот с модулем в походе восстанавливает корпус, без модуля — нет', () => {
    expect(hull(advance(world(cruiser('FAR', true)), 4))).toBeCloseTo(70); // 5%/ч × 4 ч от 100
    expect(hull(advance(world(cruiser('FAR', false)), 4))).toBe(50);
  });

  it('чинит и на ходу, между мирами', () => {
    const moving = cruiser('A', true, {
      location: null,
      movement: { from: 'A', to: 'FAR', departedAt: 0, arrivesAt: 100 * HOUR },
    });
    expect(hull(advance(world(moving), 2))).toBeCloseTo(60);
  });

  it('у дока модуль работает СВЕРХ темпа дока', () => {
    expect(hull(advance(world(cruiser('A', false)), 2))).toBeCloseTo(70); // док 10%/ч
    expect(hull(advance(world(cruiser('A', true)), 2))).toBeCloseTo(80); // + модуль 5%/ч
  });

  it('ГОТОВО: в бою ремонта нет', () => {
    expect(hull(advance(world(cruiser('FAR', true, { battleId: 'b:1' })), 4))).toBe(50);
  });

  it('эскадры в ангаре флота с модулем чинятся и вдали от дока', () => {
    const hurt = (bay: boolean): Fleet => ({
      ...cruiser('FAR', bay),
      hangar: [{ id: 'sq:1', units: [{ unit: 'striker', count: 1 }], damage: 5 }],
    });
    expect(advance(world(hurt(true)), 4).fleets.CR?.hangar?.[0]?.damage).toBeCloseTo(3); // 5%/ч × 4 от 10
    expect(advance(world(hurt(false)), 4).fleets.CR?.hangar?.[0]?.damage).toBe(5);
  });

  it('в данных игры модуль стоит во вспомогательном слоте и чинит 5%/ч', () => {
    const shipped = JSON.parse(
      readFileSync(new URL('../../../../data/modules.json', import.meta.url), 'utf8'),
    );
    expect(shipped.repair_bay.slot).toBe('utility');
    expect(shipped.repair_bay.effects.stats.hullRepair).toBe(0.05);
  });
});
