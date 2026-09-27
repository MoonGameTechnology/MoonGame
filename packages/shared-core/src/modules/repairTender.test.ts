/**
 * РЕМОНТНЫЙ ТЕНДЕР (SM-3.3, `ship-modules-roadmap.md` фаза 3).
 *
 * `repair_bay` чинит только свой стек. Тендер (стат `fleetHullRepair`) чинит вне боя
 * корпуса ВСЕХ стеков своего флота — там же и так же, как ангар. Складывается с доком и
 * с `hullRepair`; действует лучший тендер во флоте, а не сумма.
 */
import { describe, expect, it } from 'vitest';
import { createKernel } from '../kernel/kernel';
import { constructionModule } from './construction';
import {
  createInitialState,
  type Fleet,
  type GameState,
  type Player,
  type UnitStack,
} from '../state/gameState';
import { parseGameData, type GameData } from '../data/schemas';

const data: GameData = parseGameData({
  version: '0.1.0',
  resources: ['metal'],
  units: {
    cruiser: { faction: 'x', stats: { attack: 5, defense: 5, speed: 6, hp: 100 } },
    frigate: { faction: 'x', stats: { attack: 2, defense: 2, speed: 8, hp: 40 } },
  },
  factions: {},
  buildings: {},
  modules: {
    tender: {
      name: 'Tender',
      slot: 'defense',
      tag: 'horizontal',
      effects: { stats: { fleetHullRepair: 0.05 } },
    },
    tender_big: {
      name: 'Big Tender',
      slot: 'defense',
      tag: 'horizontal',
      effects: { stats: { fleetHullRepair: 0.1 } },
    },
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
const kernel = createKernel([constructionModule]);
const player = (id: string): Player => ({
  id,
  name: id,
  faction: 'x',
  status: 'active',
  resources: {},
});

/** Флот у ничейного мира: крейсер (корпус 50 из 100) и фрегат (20 из 40). */
function fleet(id: string, cruiserMods: string[] = [], over: Partial<Fleet> = {}): Fleet {
  const units: UnitStack[] = [
    { unit: 'cruiser', count: 1, hp: 50, ...(cruiserMods.length ? { modules: cruiserMods } : {}) },
    { unit: 'frigate', count: 1, hp: 20 },
  ];
  return { id, owner: 'p1', location: 'FAR', movement: null, traits: [], units, battleId: null, ...over };
}

function world(...fleets: Fleet[]): GameState {
  const s = createInitialState({ seed: 'sm33', version: { data: '0.1.0', manifest: '1' } });
  return {
    ...s,
    players: { p1: player('p1') },
    planets: {
      FAR: {
        id: 'FAR',
        owner: null,
        position: { x: 0, y: 0 },
        resources: {},
        buildings: [],
        garrison: [],
        traits: [],
      },
    },
    fleets: Object.fromEntries(fleets.map((f) => [f.id, f])),
    battles: {},
  };
}

function advance(state: GameState, hours: number): GameState {
  const r = kernel.advanceTo(state, { now: state.time + hours * HOUR, data });
  if (!r.ok) throw new Error(r.code);
  return r.state;
}
const hulls = (s: GameState, id = 'F'): Array<number | undefined> =>
  s.fleets[id]!.units.map((u) => u.hp);

describe('SM-3.3 — ремонтный тендер', () => {
  it('без тендера вдали от дока корпуса стоят, бит-в-бит как прежде', () => {
    expect(hulls(advance(world(fleet('F')), 4))).toEqual([50, 20]);
  });

  it('тендер чинит корпуса ВСЕХ стеков своего флота', () => {
    const [cr, fr] = hulls(advance(world(fleet('F', ['tender'])), 4));
    expect(cr).toBeCloseTo(70); // 5%/ч × 4 ч от 100
    expect(fr).toBeCloseTo(28); // 5%/ч × 4 ч от 40
  });

  it('складывается с собственным ремонтным ангаром стека', () => {
    const [cr, fr] = hulls(advance(world(fleet('F', ['tender', 'repair_bay'])), 2));
    expect(cr).toBeCloseTo(70); // (5% + 5%) × 2 ч от 100
    expect(fr).toBeCloseTo(24); // только тендер: 5% × 2 ч от 40
  });

  it('действует лучший тендер во флоте, а не сумма', () => {
    const f = fleet('F', ['tender']);
    f.units.push({ unit: 'cruiser', count: 1, hp: 50, modules: ['tender_big'] });
    const after = hulls(advance(world(f), 2));
    expect(after[1]).toBeCloseTo(28); // фрегат: 10% × 2 ч от 40
  });

  it('чужому флоту на том же узле тендер не помогает', () => {
    const after = advance(world(fleet('F', ['tender']), fleet('G')), 4);
    expect(hulls(after, 'G')).toEqual([50, 20]);
  });

  it('в бою ремонта нет', () => {
    expect(hulls(advance(world(fleet('F', ['tender'], { battleId: 'b:1' })), 4))).toEqual([50, 20]);
  });
});
