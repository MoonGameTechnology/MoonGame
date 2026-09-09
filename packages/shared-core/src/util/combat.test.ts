import { describe, expect, it } from 'vitest';
import { parseGameData, type GameData } from '../data/schemas';
import type { Fleet, UnitStack } from '../state/gameState';
import { damageUnits, laneOccupancy, lineShares, posAt, unitTier } from './combat';

// Every line present takes a slice of the same volley (GDD §7.2). cruiser: 40 hp,
// shielded frigate: 20 hp + 10 shield/ship, picket sits mid, healer in the rear.
const data: GameData = parseGameData({
  version: '0.1.0',
  resources: ['metal'],
  units: {
    cruiser: { faction: 'x', stats: { attack: 10, defense: 8, speed: 6, hp: 40 }, line: 'front' },
    frigate: {
      faction: 'x',
      stats: { attack: 5, defense: 5, speed: 8, hp: 20, shield: 10 },
      line: 'front',
    },
    picket: { faction: 'x', stats: { attack: 3, defense: 3, speed: 7, hp: 30 }, line: 'mid' },
    healer: { faction: 'x', stats: { attack: 0, defense: 2, speed: 5, hp: 10 }, line: 'rear' },
    // ROS-2.1: артиллерия — обычный ТЫЛОВОЙ корпус (своей линии у неё больше нет),
    // а трейт `artillery` означает теперь ровно одно: по ней не проходит ответный
    // огонь, когда атакует её сторона.
    gun: {
      faction: 'x',
      stats: { attack: 12, defense: 1, speed: 4, hp: 20 },
      line: 'rear',
      traits: ['artillery'],
    },
    // A ground unit that ASKS for the rear — lines are a ship formation, so the
    // request must be ignored and the trooper must stand in the front line.
    trooper: {
      faction: 'x',
      stats: { attack: 6, defense: 6, speed: 3, hp: 24 },
      domain: 'ground',
      line: 'rear',
    },
    ghost: { faction: 'x', stats: { attack: 1, defense: 1, speed: 1, hp: 0 }, line: 'front' },
  },
  factions: {},
  buildings: {},
  events: {},
});

const stack = (unit: string, count: number, extra: Partial<UnitStack> = {}): UnitStack => ({
  unit,
  count,
  ...extra,
});

describe('lineShares — how a volley splits across the lines', () => {
  // ROS-2.1: линий ТРИ. Прежняя четвёртая (артиллерийская) снята вместе со своей
  // долей: 40/30/20/10 сходились в 100 только вместе с ней.
  it('все три линии в бою — 50/30/20', () => {
    expect(lineShares(['front', 'mid', 'rear'])).toEqual({ front: 50, mid: 30, rear: 20 });
  });

  it('одна линия забирает весь залп', () => {
    expect(lineShares(['front']).front).toBe(100);
    expect(lineShares(['rear']).rear).toBe(100);
  });

  it('доля ОТСУТСТВУЮЩЕЙ линии делится поровну между присутствующими', () => {
    // тыла нет: его 20 делятся 10/10.
    expect(lineShares(['front', 'mid'])).toEqual({ front: 60, mid: 40, rear: 0 });
    // средней нет: её 30 делятся 15/15.
    expect(lineShares(['front', 'rear'])).toEqual({ front: 65, mid: 0, rear: 35 });
  });

  it('нечётный процент уходит вперёд по строю (нос округляется вверх)', () => {
    // фронта нет: его 50 на двоих — по 25, делится нацело.
    expect(lineShares(['mid', 'rear'])).toEqual({ front: 0, mid: 55, rear: 45 });
  });

  it('результат не зависит от порядка аргументов и всегда сходится в 100', () => {
    const combos: Array<Parameters<typeof lineShares>[0]> = [
      ['front'],
      ['mid', 'front'],
      ['rear', 'front'],
      ['rear', 'mid', 'front'],
    ];
    for (const combo of combos) {
      const shares = lineShares(combo);
      expect(Object.values(shares).reduce((a, b) => a + b, 0)).toBe(100);
      expect(lineShares([...combo].reverse())).toEqual(shares);
    }
  });

  it('пустой бой — нули', () => {
    expect(lineShares([])).toEqual({ front: 0, mid: 0, rear: 0 });
  });
});

describe('damageUnits — the pure damage model', () => {
  it('kills whole ships as the pool drops and keeps the last damaged ship alive', () => {
    // 3 cruisers = 120 hp pool; 95 damage leaves 25 → ceil(25/40) = 1 ship at 25 hp.
    const { survivors, deaths } = damageUnits([stack('cruiser', 3)], 95, data);
    expect(survivors).toEqual([{ unit: 'cruiser', count: 1, hp: 25 }]);
    expect(deaths).toEqual([{ unit: 'cruiser', count: 2 }]);
  });

  it('partial damage persists in the pool without killing anyone', () => {
    const { survivors, deaths } = damageUnits([stack('cruiser', 2)], 30, data);
    expect(survivors).toEqual([{ unit: 'cruiser', count: 2, hp: 50 }]);
    expect(deaths).toEqual([]);
  });

  it('a wiped stack disappears from the survivors', () => {
    const { survivors, deaths } = damageUnits([stack('cruiser', 2)], 80, data);
    expect(survivors).toEqual([]);
    expect(deaths).toEqual([{ unit: 'cruiser', count: 2 }]);
  });

  it('hits EVERY present line in the same volley, by share', () => {
    // front (cruiser) + rear (healer): отсутствующая средняя линия отдаёт свои 30
    // поровну, поэтому 100 урона идут 65 во фронт и 35 в тыл (ROS-2.1).
    const units = [stack('healer', 4), stack('cruiser', 2)];
    const { survivors, deaths } = damageUnits(units, 100, data);
    expect(deaths).toEqual([{ unit: 'cruiser', count: 1 }, { unit: 'healer', count: 3 }]);
    expect(survivors).toEqual([
      { unit: 'healer', count: 1, hp: 5 }, // тыл: 40 − 35
      { unit: 'cruiser', count: 1, hp: 15 }, // фронт: 80 − 65
    ]);
  });

  it('делит залп по ТРЁМ линиям 50/30/20 и тратит его без остатка (ROS-2.1)', () => {
    const units = [
      stack('cruiser', 4), // фронт, 160 hp
      stack('picket', 4), // средняя, 120 hp
      stack('healer', 8), // тыл, 80 hp
      stack('gun', 3), // тоже ТЫЛ: своей линии у артиллерии больше нет
    ];
    damageUnits(units, 100, data);
    expect(units.find((u) => u.unit === 'cruiser')?.hp).toBe(110); // 160 − 50
    expect(units.find((u) => u.unit === 'picket')?.hp).toBe(90); // 120 − 30
    // Тыловые 20 делятся ВНУТРИ линии по id (`gun` < `healer`): пушки принимают
    // залп первыми и держат его целиком.
    expect(units.find((u) => u.unit === 'gun')?.hp).toBe(40); // 60 − 20
    // Незадетый стек так и остаётся без пула hp: он появляется только при попадании.
    expect(units.find((u) => u.unit === 'healer')?.hp).toBeUndefined();
  });

  it('re-splits what a dying line could not absorb — no damage is wasted', () => {
    // front 60 / rear 40. The rear holds only 10 hp, so 30 of its 40 spill back
    // onto the front, which is the only line left: 60 + 30 = 90 of the 100.
    const units = [stack('healer', 1), stack('cruiser', 4)];
    damageUnits(units, 100, data);
    expect(units.find((u) => u.unit === 'healer')?.count).toBe(0);
    expect(units.find((u) => u.unit === 'cruiser')?.hp).toBe(70); // 160 − 90
  });

  it('sorts by unit id INSIDE a line, so stack order cannot change the outcome', () => {
    const a = [stack('cruiser', 1), stack('frigate', 1)]; // both front
    const b = [stack('frigate', 1), stack('cruiser', 1)];
    damageUnits(a, 30, data);
    damageUnits(b, 30, data);
    expect(a).toEqual(b.slice().reverse());
  });

  it('keeps ground units in ONE line — a ground `line` field is ignored', () => {
    // `trooper` asks for the rear but is ground: it must take the whole volley,
    // not 40% of it, so an army is never carved into lines.
    expect(unitTier(data.units.trooper!)).toBe('front');
    const units = [stack('trooper', 4)]; // 96 hp
    damageUnits(units, 24, data);
    expect(units[0]?.hp).toBe(72); // all 24 landed
  });

  // ROS-2.1. Артиллерия бьёт безнаказанно: ответный огонь по ней НЕ проходит и
  // перераспределяется на остальные корпуса её стороны. Это не бессмертие — под чужой
  // атакой она стоит в тылу и получает свою долю, как всякий тыловой корабль.
  it('ОТВЕТНЫЙ залп обходит артиллерию, пока на её стороне есть кто-то ещё', () => {
    const units = [stack('cruiser', 1), stack('gun', 1)]; // 40 hp фронта + 20 hp пушки
    damageUnits(units, 20, data, { sparesArtillery: true });
    expect(units.find((u) => u.unit === 'gun')?.hp).toBeUndefined(); // цела, по ней не попадали
    expect(units.find((u) => u.unit === 'cruiser')?.hp).toBe(20); // весь залп ушёл в крейсер
  });

  it('а ОБЫЧНЫЙ залп (по обороняющейся стороне) артиллерию задевает — она в тылу', () => {
    const units = [stack('cruiser', 1), stack('gun', 1)];
    damageUnits(units, 20, data);
    // Две линии из трёх: фронт 65%, тыл 35% — пушка получила свою долю.
    expect(units.find((u) => u.unit === 'gun')?.hp).toBe(13);
    expect(units.find((u) => u.unit === 'cruiser')?.hp).toBe(27);
  });

  it('когда КРОМЕ артиллерии никого не осталось — залп приходит по ней', () => {
    // Иначе флот из одних пушек был бы неубиваем: владелец решил, что артиллерия
    // не бессмертна, поэтому щадящее правило действует только пока есть кого щадить.
    const units = [stack('gun', 2)]; // 40 hp
    damageUnits(units, 15, data, { sparesArtillery: true });
    expect(units[0]?.hp).toBe(25);
  });

  it('shields absorb first and never kill; dead ships take their shields along', () => {
    // 2 frigates: 20 shield + 40 hull. 25 damage: shield soaks 20, hull takes 5.
    const soaked = damageUnits([stack('frigate', 2)], 25, data);
    expect(soaked.survivors).toEqual([{ unit: 'frigate', count: 2, hp: 35, shieldHp: 0 }]);
    expect(soaked.deaths).toEqual([]);
    // 45 damage: 20 shield + 25 hull → one frigate dies; the shield pool is capped
    // at the survivor's capacity (here it is already 0).
    const killed = damageUnits([stack('frigate', 2)], 45, data);
    expect(killed.survivors).toEqual([{ unit: 'frigate', count: 1, hp: 15, shieldHp: 0 }]);
    expect(killed.deaths).toEqual([{ unit: 'frigate', count: 1 }]);
  });

  it('an hp=0 unit def falls back to a 1-hp ship instead of dividing by zero', () => {
    const { survivors, deaths } = damageUnits([stack('ghost', 3)], 2, data);
    expect(deaths).toEqual([{ unit: 'ghost', count: 2 }]);
    expect(survivors).toEqual([{ unit: 'ghost', count: 1, hp: 1 }]);
  });

  it('a stack whose unit is missing from the data is skipped untouched', () => {
    const { survivors, deaths } = damageUnits([stack('unknown', 5)], 100, data);
    expect(survivors).toEqual([{ unit: 'unknown', count: 5 }]);
    expect(deaths).toEqual([]);
  });
});

describe('laneOccupancy / posAt — the lane geometry', () => {
  const moving = (from: string, to: string, extra: Partial<NonNullable<Fleet['movement']>> = {}): Fleet => ({
    id: 'F',
    owner: 'p1',
    location: null,
    movement: { from, to, departedAt: 0, arrivesAt: 100, ...extra },
    units: [stack('cruiser', 1)],
    traits: [],
  });

  it('normalizes an opposite-direction leg onto the canonical lo→hi axis', () => {
    // B→A travels the same lane as A→B, mirrored: s runs 1→0.
    const occ = laneOccupancy(moving('B', 'A'))!;
    expect(occ).toMatchObject({ lo: 'A', hi: 'B', s0: 1, s1: 0, t0: 0, t1: 100, moving: true });
    expect(posAt(occ, 0)).toBe(1);
    expect(posAt(occ, 50)).toBe(0.5);
    expect(posAt(occ, 100)).toBe(0);
  });

  it('honors a leg confined to a [startT, endT] sub-segment', () => {
    const occ = laneOccupancy(moving('A', 'B', { startT: 0.25, endT: 0.75 }))!;
    expect(posAt(occ, 0)).toBe(0.25);
    expect(posAt(occ, 100)).toBe(0.75);
  });

  it('a degenerate zero-length leg yields no segment', () => {
    expect(laneOccupancy(moving('A', 'B', { arrivesAt: 0 }))).toBeNull();
  });

  it('a parked fleet occupies one constant point over an unbounded window', () => {
    const parked: Fleet = {
      id: 'F',
      owner: 'p1',
      location: null,
      movement: null,
      edge: { from: 'B', to: 'A', t: 0.3 }, // reversed → canonical s = 0.7
      units: [stack('cruiser', 1)],
      traits: [],
    };
    const occ = laneOccupancy(parked)!;
    expect(occ).toMatchObject({ lo: 'A', hi: 'B', s0: 0.7, s1: 0.7, moving: false });
    expect(posAt(occ, -1e9)).toBe(0.7);
    expect(posAt(occ, 1e9)).toBe(0.7);
  });

  it('a fleet at a node (or gone) is not on any lane', () => {
    const atNode: Fleet = {
      id: 'F',
      owner: 'p1',
      location: 'A',
      movement: null,
      units: [],
      traits: [],
    };
    expect(laneOccupancy(atNode)).toBeNull();
  });
});
