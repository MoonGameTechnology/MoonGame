import { describe, expect, it } from 'vitest';
import { shippedGameData } from '../data/bundle';
import { pveState, PVE_MISSION_COUNT } from '../packages/client/src/gameData';
import type { GameState } from '../packages/shared-core/src/index';
import {
  emptySwarmCodex,
  learnSwarm,
  parseSwarmCodex,
  swarmCatalog,
  swarmCodexView,
} from './swarmCodex';

const data = shippedGameData();
const chapters = Array.from({ length: PVE_MISSION_COUNT }, (_, i) => pveState(data, i));
const catalog = swarmCatalog(data, chapters);

/** Забег, в котором игрок кое-что узнал о Рое. */
function run(over: Partial<GameState> = {}): GameState {
  return { ...pveState(data, 0), ...over } as GameState;
}

describe('каталог досье — из данных, а не из памяти', () => {
  it('формы волн и уникальные юниты Роя, их органы, постройки на мирах Роя', () => {
    expect(catalog.units).toEqual(
      expect.arrayContaining(['swarm_brood_mother', 'swarm_lander', 'frigate']),
    );
    // Органы — только явно отданные носителю выводка, а не всё, что встало бы на корпус.
    expect([...catalog.modules].sort()).toEqual(['swarm_brood_chamber', 'swarm_intercept_veil']);
    expect(catalog.buildings.length).toBeGreaterThan(0);
    expect(new Set(catalog.units).size).toBe(catalog.units.length);
  });
});

describe('память о Рое — только наблюдённое', () => {
  it('опознанный отряд учит форму: максимум в отряде и число забегов', () => {
    const s = run({
      swarmIntel: {
        p1: {
          a: { owner: 'swarm', location: 'x', at: 1, units: [{ unit: 'frigate', count: 3 }] },
          b: { owner: 'swarm', location: 'y', at: 2, units: [{ unit: 'frigate', count: 5 }] },
        },
      },
    });
    const once = learnSwarm(emptySwarmCodex(), s, 'p1', data);
    expect(once.units.frigate).toEqual({ max: 5, runs: 1 });
    const twice = learnSwarm(once, run({ swarmIntel: { p1: { c: { owner: 'swarm', location: 'x', at: 1, units: [{ unit: 'frigate', count: 2 }] } } } }), 'p1', data);
    expect(twice.units.frigate).toEqual({ max: 5, runs: 2 });
  });

  it('чужое знание (другого игрока) и пустой забег память не трогают', () => {
    const s = run({ swarmIntel: { p2: { a: { owner: 'swarm', location: 'x', at: 1, units: [{ unit: 'frigate', count: 3 }] } } } });
    expect(learnSwarm(emptySwarmCodex(), s, 'p1', data).units).toEqual({});
    const known = { ...emptySwarmCodex(), units: { frigate: { max: 4, runs: 2 } }, repels: 3 };
    expect(learnSwarm(known, run(), 'p1', data)).toEqual(known);
  });

  it('десант в отряде — признак выводковой камеры', () => {
    const s = run({ swarmIntel: { p1: { a: { owner: 'swarm', location: 'x', at: 1, units: [{ unit: 'swarm_lander', count: 2 }] } } } });
    expect(learnSwarm(emptySwarmCodex(), s, 'p1', data).broodSeen).toBe(true);
  });

  it('отражённые удары копятся, урон ПВО — максимум замеров', () => {
    const s = run({ swarmJournal: { p1: { firstAt: 0, lastAt: 1, sorties: 2, firstDamage: 6, lastDamage: 9 } } });
    const a = learnSwarm(emptySwarmCodex(), s, 'p1', data);
    expect([a.repels, a.veilDamage]).toEqual([2, 9]);
    expect(learnSwarm(a, s, 'p1', data).repels).toBe(4);
  });

  it('постройки — из памяти тумана и только стоящие на мирах Роя', () => {
    const snap = (owner: string, type: string, hp: number) => ({
      owner,
      garrison: [],
      buildings: [{ type, level: 1, hp }],
      at: 0,
    });
    const s = run({
      fog: { p1: { a: snap('swarm', 'swarm_hive', 50), b: snap('swarm', 'biomass_pit', 0), c: snap('p1', 'fort', 40) } },
    });
    expect(learnSwarm(emptySwarmCodex(), s, 'p1', data).buildings).toEqual(['swarm_hive']);
  });
});

describe('разбор и вид досье', () => {
  it('мусор и чужие id отбрасываются', () => {
    expect(parseSwarmCodex(null, data)).toEqual(emptySwarmCodex());
    const p = parseSwarmCodex(
      { units: { frigate: { max: 3, runs: 2 }, ghost: { max: 9, runs: 1 }, swarm_lander: { max: -1 } }, buildings: ['swarm_hive', 'nope', 7], repels: 2.5, broodSeen: 'yes' },
      data,
    );
    expect(p).toEqual({ units: { frigate: { max: 3, runs: 2 } }, buildings: ['swarm_hive'], repels: 0, veilDamage: 0, broodSeen: false });
  });

  it('служебные имена JavaScript за юнит и постройку каталога не выдать (AUD-30)', () => {
    const raw = JSON.parse(
      '{"units":{"__proto__":{"max":3},"constructor":{"max":3},"frigate":{"max":1}},"buildings":["constructor","toString","swarm_hive"]}',
    );
    const p = parseSwarmCodex(raw, data);
    expect(Object.keys(p.units)).toEqual(['frigate']);
    expect(Object.getPrototypeOf(p.units)).toBe(Object.prototype);
    expect(p.buildings).toEqual(['swarm_hive']);
  });

  it('пустая память — весь каталог «?»; органы открываются по действию', () => {
    const blank = swarmCodexView(emptySwarmCodex(), catalog, data);
    expect(blank.known).toBe(0);
    expect(blank.total).toBe(catalog.units.length + catalog.modules.length + catalog.buildings.length);
    const learned = swarmCodexView({ ...emptySwarmCodex(), repels: 3, broodSeen: true }, catalog, data);
    const veil = learned.modules.find((m) => m.id === 'swarm_intercept_veil')!;
    const chamber = learned.modules.find((m) => m.id === 'swarm_brood_chamber')!;
    expect(veil).toMatchObject({ known: true, evidence: 'intercept', n: 3 });
    expect(chamber).toMatchObject({ known: true, evidence: 'brood' });
  });
});
