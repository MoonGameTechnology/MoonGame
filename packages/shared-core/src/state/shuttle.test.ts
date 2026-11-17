import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { loadGameData } from '../data/loadGameData';
import type { GameData } from '../data/schemas';
import type { Fleet } from './gameState';
import {
  shuttleTake,
  fleetHasShuttle,
  shuttleStrikeRange,
  withinRange,
  shuttleReaches,
  squadronRefueling,
  squadronRefuelMinutes,
} from './shuttle';

// SQ-1.1/SQ-2.1/SQ-3.1 (shuttles-roadmap.md): 1:1 port of the prototype's
// `shuttle.ts` pure math onto the real shipped bundle (`interceptor`
// already ships with strikeRange — canon just lacked this
// module). Not wired into a `fleet.launch` action yet — pure math only.

const dataDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../../data');
const readJson = (name: string): unknown =>
  JSON.parse(readFileSync(path.join(dataDir, name), 'utf8'));
const data: GameData = loadGameData(readJson);

function fleet(units: Array<{ unit: string; count: number }>): Fleet {
  return { id: 'f1', owner: 'p1', location: 'p1', movement: null, units, traits: [] };
}

let squadronSeq = 0;
const squadron = (units: Array<{ unit: string; count: number }>) => ({
  id: `sq:${++squadronSeq}`,
  units,
});

const shuttleUnit = Object.keys(data.units).find((u) =>
  data.units[u]!.traits.includes('shuttle'),
)!;
const nonShuttleUnit = Object.keys(data.units).find(
  (u) => !data.units[u]!.traits.includes('shuttle'),
)!;

describe('shuttleTake (SQ-1.1, real shipped data)', () => {
  it('picks out only the shuttle-trait stacks aboard a fleet', () => {
    const f = fleet([
      { unit: shuttleUnit, count: 2 },
      { unit: nonShuttleUnit, count: 3 },
    ]);
    expect(shuttleTake(f, data)).toEqual([{ unit: shuttleUnit, count: 2 }]);
  });

  it('is empty for a fleet with no shuttle aboard', () => {
    expect(shuttleTake(fleet([{ unit: nonShuttleUnit, count: 3 }]), data)).toEqual([]);
  });

  it('ignores a zero-count stack', () => {
    expect(shuttleTake(fleet([{ unit: shuttleUnit, count: 0 }]), data)).toEqual([]);
  });
});

describe('fleetHasShuttle (real shipped data)', () => {
  it('true when the fleet carries a live shuttle stack', () => {
    expect(fleetHasShuttle(fleet([{ unit: shuttleUnit, count: 1 }]), data)).toBe(true);
  });

  it('false for undefined, empty, or shuttle-free fleets', () => {
    expect(fleetHasShuttle(undefined, data)).toBe(false);
    expect(fleetHasShuttle(fleet([]), data)).toBe(false);
    expect(fleetHasShuttle(fleet([{ unit: nonShuttleUnit, count: 3 }]), data)).toBe(false);
  });
});

// Топливо базы читается из ЕЁ АНГАРА, а не из состава корабля. Так было не всегда:
// функция пережила модель, для которой писалась. В старом «крыле» (снято в SHU-2.2)
// челноки летали КАК ФЛОТ и лежали в `fleet.units` — оттуда она их и брала. С SHU-1.1
// челнок живёт в `hangar` базы, а в `units` носителя стоит его КОРПУС, у которого
// никакого `fuel` нет. Читая старое место, функция отвечала «топлива 0» на любой
// носитель, и панель показывала полный ангар как сухой.
describe('заправка эскадры (решение владельца 2026-11-17)', () => {
  it('эскадра ждёт САМУЮ ДОЛГУЮ заправку своих живых машин', () => {
    const slow = {
      ...data,
      units: {
        ...data.units,
        [shuttleUnit]: {
          ...data.units[shuttleUnit]!,
          stats: { ...data.units[shuttleUnit]!.stats, refuelMinutes: 45 },
        },
      },
    } as GameData;
    expect(
      squadronRefuelMinutes(
        [
          { unit: shuttleUnit, count: 2 },
          { unit: nonShuttleUnit, count: 1 },
        ],
        slow,
      ),
    ).toBe(45);
    expect(squadronRefuelMinutes([{ unit: shuttleUnit, count: 0 }], slow)).toBe(0);
  });

  it('челноки в данных заправляются, ракеты и корабли — нет', () => {
    expect(squadronRefuelMinutes([{ unit: 'interceptor', count: 1 }], data)).toBeGreaterThan(0);
    expect(squadronRefuelMinutes([{ unit: nonShuttleUnit, count: 1 }], data)).toBe(0);
  });

  it('заправляется, пока срок впереди; без срока или в прошлом — готова', () => {
    expect(squadronRefueling({ readyAt: 100 }, 99)).toBe(true);
    expect(squadronRefueling({ readyAt: 100 }, 100)).toBe(false);
    expect(squadronRefueling({}, 0)).toBe(false);
  });
});

describe('shuttle strike radius (SQ-3.1, SHU-6.1, real shipped data)', () => {
  const range = data.units[shuttleUnit]!.stats.strikeRange;
  /** База с эскадрой в АНГАРЕ — там шаттл живёт с SHU-1.1, у мира и у флота одинаково. */
  const based = (units: Array<{ unit: string; count: number }>) => ({
    ...fleet([{ unit: nonShuttleUnit, count: 1 }]),
    hangar: [squadron(units)],
  });

  it('reads the longest strikeRange among live machines in the hangar', () => {
    expect(shuttleStrikeRange(based([{ unit: shuttleUnit, count: 2 }]), data)).toBe(range);
    expect(range).toBeGreaterThan(0);
  });

  it('SHU-6.1: shuttles in fleet.units are not a wing — that place is dead since SHU-1.1', () => {
    // Раньше радиус искался в `fleet.units`, куда шаттл не попадает ниоткуда, поэтому
    // кольцо вокруг носителя не рисовалось ни разу. Сторож держит новое место чтения.
    expect(shuttleStrikeRange(fleet([{ unit: shuttleUnit, count: 2 }]), data)).toBe(0);
  });

  it('a world hangar has the same radius as a carrier hangar (one host shape)', () => {
    const world = { hangar: [squadron([{ unit: shuttleUnit, count: 1 }])] };
    expect(shuttleStrikeRange(world, data)).toBe(range);
  });

  it('the base radius is the LONGEST arm across squadrons, dead stacks ignored', () => {
    const arms = Object.keys(data.units)
      .filter((u) => data.units[u]!.traits.includes('shuttle'))
      .map((u) => ({ u, r: data.units[u]!.stats.strikeRange }))
      .sort((a, b) => a.r - b.r);
    const short = arms[0]!;
    const long = arms[arms.length - 1]!;
    expect(long.r).toBeGreaterThan(short.r);
    const host = {
      hangar: [squadron([{ unit: short.u, count: 1 }]), squadron([{ unit: long.u, count: 0 }])],
    };
    expect(shuttleStrikeRange(host, data)).toBe(short.r); // мёртвый стек руки не даёт
    host.hangar.push(squadron([{ unit: long.u, count: 1 }]));
    expect(shuttleStrikeRange(host, data)).toBe(long.r);
  });

  it('a base without shuttles has no strike radius', () => {
    expect(shuttleStrikeRange(fleet([{ unit: nonShuttleUnit, count: 3 }]), data)).toBe(0);
    expect(shuttleStrikeRange({ hangar: [] }, data)).toBe(0);
  });

  it('withinRange is boundary-inclusive (exactly on the edge reaches)', () => {
    expect(withinRange({ x: 0, y: 0 }, { x: 180, y: 0 }, 180)).toBe(true); // on the edge
    expect(withinRange({ x: 0, y: 0 }, { x: 181, y: 0 }, 180)).toBe(false); // just beyond
    expect(withinRange({ x: 0, y: 0 }, { x: 100, y: 100 }, 180)).toBe(true); // hypot ≈ 141 < 180
  });

  it('the wing strikes inside its radius and not beyond it (boundary)', () => {
    const wing = based([{ unit: shuttleUnit, count: 2 }]);
    const from = { x: 500, y: 500 };
    expect(shuttleReaches(wing, data, from, { x: 500 + range, y: 500 })).toBe(true); // edge
    expect(shuttleReaches(wing, data, from, { x: 500 + range + 1, y: 500 })).toBe(false); // out
  });

  it('a non-strike base never reaches (range 0)', () => {
    const nonWing = fleet([{ unit: nonShuttleUnit, count: 3 }]);
    expect(shuttleReaches(nonWing, data, { x: 0, y: 0 }, { x: 0, y: 0 })).toBe(false);
  });
});
