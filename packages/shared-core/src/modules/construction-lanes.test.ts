import { describe, it, expect } from 'vitest';
import { createKernel } from '../kernel/kernel';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { constructionModule, unitBuildSiteBlocker } from './construction';
import { loadGameData } from '../data/loadGameData';
import {
  createInitialState,
  type BuildingInstance,
  type GameState,
  type Planet,
  type Player,
} from '../state/gameState';
import { parseGameData, type GameData } from '../data/schemas';
import type { Action, AdvanceResult, ApplyResult, Context } from '../action/types';
import { orderLane, unitLane } from '../state/buildLane';

// BLD-2.1 — своя очередь у каждой производственной постройки. Запрос владельца: «пехота
// с космическими кораблями не должна стоять в одной очереди». До BLD-2.1 у мира была
// одна полоса юнитов на всё, что он производит.
//
// cruiser: верфь, 10 metal, 2ч. trooper: казармы, 2 metal, 1ч. tank: завод, 5 metal, 3ч.
// lifter: челнок космопорта, 4 metal, 1ч.
const data: GameData = parseGameData({
  version: '0.1.0',
  resources: ['metal'],
  units: {
    cruiser: {
      faction: 'x',
      stats: { attack: 5, defense: 5, speed: 5, hp: 40 },
      cost: { metal: 10 },
      buildTimeHours: 2,
    },
    trooper: {
      faction: 'x',
      domain: 'ground',
      kind: 'infantry',
      stats: { attack: 1, defense: 1, speed: 1, hp: 5 },
      cost: { metal: 2 },
      buildTimeHours: 1,
    },
    tank: {
      faction: 'x',
      domain: 'ground',
      kind: 'vehicle',
      stats: { attack: 3, defense: 3, speed: 1, hp: 15 },
      cost: { metal: 5 },
      buildTimeHours: 3,
    },
    lifter: {
      faction: 'x',
      traits: ['shuttle'],
      stats: { attack: 1, defense: 1, speed: 50, hp: 5 },
      cost: { metal: 4 },
      buildTimeHours: 1,
    },
  },
  factions: {},
  buildings: {
    shipyard: {
      name: 'Shipyard',
      cost: { metal: 100 },
      buildTimeHours: 4,
      hp: 20,
      enablesShipConstruction: true,
    },
    barracks: {
      name: 'Barracks',
      cost: { metal: 50 },
      buildTimeHours: 2,
      hp: 20,
      enablesInfantryConstruction: true,
    },
    factory: {
      name: 'Factory',
      cost: { metal: 80 },
      buildTimeHours: 3,
      hp: 20,
      enablesVehicleConstruction: true,
    },
    spaceport: { name: 'Spaceport', cost: { metal: 90 }, buildTimeHours: 3, hp: 20, shuttleBay: 6 },
  },
  events: {},
});

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../..');
const real: GameData = loadGameData((name) =>
  JSON.parse(readFileSync(path.join(repoRoot, 'data', name), 'utf8')),
);

const HOUR = 3_600_000;
const ctx = (now: number): Context => ({ now, data });

const ALL_YARDS: BuildingInstance[] = [
  { uid: 'y1', type: 'shipyard', level: 1, hp: 20 },
  { uid: 'b1', type: 'barracks', level: 1, hp: 20 },
  { uid: 'f1', type: 'factory', level: 1, hp: 20 },
  { uid: 'p1', type: 'spaceport', level: 1, hp: 20 },
];

function player(id: string, resources: Record<string, number> = {}): Player {
  return { id, name: id, faction: 'x', status: 'active', resources };
}
function planet(
  id: string,
  owner: string | null,
  buildings: BuildingInstance[] = ALL_YARDS,
): Planet {
  return {
    id,
    owner,
    position: { x: 0, y: 0 },
    resources: {},
    buildings,
    garrison: [],
    traits: [],
  };
}
function stateWith(metal: number): GameState {
  const s = createInitialState({ seed: 'lanes', version: { data: '0.1.0', manifest: '1' } });
  return { ...s, players: { p1: player('p1', { metal }) }, planets: { A: planet('A', 'p1') } };
}
let n = 0;
function build(unit: string, count = 1): Action {
  return {
    id: `s:p1:b:${unit}:${count}:${n++}`,
    type: 'unit.build',
    playerId: 'p1',
    payload: { planetId: 'A', unit, count },
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
function activeUnits(s: GameState): string[] {
  return s.scheduled
    .filter((e) => e.type === 'construction.complete')
    .map((e) => (e.payload as { unit?: string }).unit ?? '?')
    .sort();
}

describe('BLD-2.1 — полоса юнита = его производственная постройка', () => {
  it('корабль, челнок, пехота и техника — четыре разные полосы, стройка — пятая', () => {
    expect(unitLane(data.units.cruiser)).toBe('ships');
    expect(unitLane(data.units.lifter)).toBe('shuttles');
    expect(unitLane(data.units.trooper)).toBe('infantry');
    expect(unitLane(data.units.tank)).toBe('vehicles');
    expect(orderLane(data, { kind: 'upgrade' })).toBe('buildings');
    // Снятый из данных юнит всё равно получает определённую полосу.
    expect(orderLane(data, { kind: 'unit', unit: 'gone' })).toBe('ships');
  });

  it('у каждого юнита шипнутых данных полоса — та постройка, которую требует ядро', () => {
    // Сторож «двух копий правила»: полоса и гейт заказа обязаны назвать одну постройку.
    const LANE_OF_BLOCKER = {
      E_NO_SHIPYARD: 'ships',
      E_NO_PORT: 'shuttles',
      E_NO_BARRACKS: 'infantry',
      E_NO_FACTORY: 'vehicles',
    } as const;
    const empty: Planet = { ...planet('N', 'p1', []) };
    for (const [id, def] of Object.entries(real.units)) {
      const blocker = unitBuildSiteBlocker(empty, def, real);
      expect([id, unitLane(def)]).toEqual([id, blocker ? LANE_OF_BLOCKER[blocker] : 'ships']);
    }
  });
});

describe('BLD-2.1 — пехота не ждёт корабль', () => {
  it('юниты разных построек строятся одновременно и оплачиваются сразу', () => {
    const kernel = createKernel([constructionModule]);
    let s = stateWith(100);
    for (const u of ['cruiser', 'trooper', 'tank', 'lifter'])
      s = okApply(kernel.applyAction(s, build(u), ctx(0))).state;
    expect(s.planets.A?.buildQueue).toBeUndefined();
    expect(activeUnits(s)).toEqual(['cruiser', 'lifter', 'tank', 'trooper']);
    expect(s.players.p1?.resources.metal).toBe(100 - 10 - 2 - 5 - 4);
  });

  it('второй пехотинец ждёт первого, а верфь тем временем свободна', () => {
    const kernel = createKernel([constructionModule]);
    let s = stateWith(100);
    s = okApply(kernel.applyAction(s, build('trooper'), ctx(0))).state;
    s = okApply(kernel.applyAction(s, build('trooper', 3), ctx(0))).state;
    expect(s.planets.A?.buildQueue?.map((q) => q.unit)).toEqual(['trooper']);
    s = okApply(kernel.applyAction(s, build('cruiser'), ctx(0))).state;
    expect(activeUnits(s)).toEqual(['cruiser', 'trooper']);

    // Через час первый пехотинец готов — с очереди снимается второй, корабль идёт своим ходом.
    const later = okAdvance(kernel.advanceTo(s, ctx(HOUR))).state;
    expect(later.planets.A?.buildQueue).toBeUndefined();
    expect(activeUnits(later)).toEqual(['cruiser', 'trooper']);
    expect(later.planets.A?.garrison.find((g) => g.unit === 'trooper')?.count).toBe(1);
  });

  it('потолок очереди считается на полосу: полная верфь не закрывает казармы', () => {
    const kernel = createKernel([constructionModule]);
    let s = stateWith(5000);
    for (let i = 0; i < 6; i++) s = okApply(kernel.applyAction(s, build('cruiser'), ctx(0))).state;
    expect(kernel.applyAction(s, build('cruiser'), ctx(0))).toMatchObject({
      ok: false,
      code: 'E_QUEUE_FULL',
    });
    s = okApply(kernel.applyAction(s, build('trooper'), ctx(0))).state;
    s = okApply(kernel.applyAction(s, build('trooper'), ctx(0))).state;
    expect(s.planets.A?.buildQueue?.filter((q) => q.unit === 'trooper')).toHaveLength(1);
  });

  it('возобновить приостановленный танк можно, пока строится корабль', () => {
    const kernel = createKernel([constructionModule]);
    let s = stateWith(100);
    s = okApply(kernel.applyAction(s, build('tank'), ctx(0))).state;
    const tankSeq = s.scheduled.find((e) => e.type === 'construction.complete')!.seq;
    s = okApply(
      kernel.applyAction(
        s,
        {
          id: 'x',
          type: 'construction.cancel',
          playerId: 'p1',
          payload: { planetId: 'A', seq: tankSeq },
          issuedAt: 0,
        },
        ctx(HOUR),
      ),
    ).state;
    s = okApply(kernel.applyAction(s, build('cruiser'), ctx(HOUR))).state;
    s = okApply(
      kernel.applyAction(
        s,
        {
          id: 'r',
          type: 'construction.resume',
          playerId: 'p1',
          payload: { planetId: 'A', id: tankSeq },
          issuedAt: 0,
        },
        ctx(HOUR),
      ),
    ).state;
    expect(activeUnits(s)).toEqual(['cruiser', 'tank']);
  });
});

describe('BLD-2.1 — сейв и живая партия времён одной полосы юнитов', () => {
  it('корабль, ждавший за пехотой в общей очереди, стартует, когда пехота готова', () => {
    // Состояние BLD-1: идёт пехотинец, за ним в общей полосе `units` ждёт крейсер.
    const kernel = createKernel([constructionModule]);
    const base = stateWith(100);
    const s: GameState = {
      ...base,
      scheduleSeq: 10,
      scheduled: [
        {
          id: 'evt:1',
          at: HOUR,
          seq: 1,
          type: 'construction.complete',
          payload: { kind: 'unit', planetId: 'A', playerId: 'p1', unit: 'trooper', count: 1 },
        },
      ],
      planets: {
        A: {
          ...planet('A', 'p1'),
          buildQueue: [{ id: 2, kind: 'unit', playerId: 'p1', unit: 'cruiser', count: 1 }],
        },
      },
    };
    const after = okAdvance(kernel.advanceTo(s, ctx(HOUR))).state;
    expect(after.planets.A?.buildQueue).toBeUndefined();
    expect(activeUnits(after)).toEqual(['cruiser']);
    expect(after.players.p1?.resources.metal).toBe(90);
  });

  it('повтор с прежней полосой `units` будит полосы юнитов', () => {
    const kernel = createKernel([constructionModule]);
    const base = stateWith(100);
    const s: GameState = {
      ...base,
      scheduleSeq: 10,
      scheduled: [
        {
          id: 'evt:1',
          at: HOUR,
          seq: 1,
          type: 'construction.queue.pump',
          payload: { planetId: 'A', lane: 'units' },
        },
      ],
      planets: {
        A: {
          ...planet('A', 'p1'),
          buildQueue: [{ id: 2, kind: 'unit', playerId: 'p1', unit: 'tank', count: 1 }],
        },
      },
    };
    const after = okAdvance(kernel.advanceTo(s, ctx(HOUR))).state;
    expect(after.planets.A?.buildQueue).toBeUndefined();
    expect(activeUnits(after)).toEqual(['tank']);
  });
});
