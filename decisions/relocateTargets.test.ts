/**
 * ПЕРЕЛЁТ В ИНТЕРФЕЙСЕ (SHU-6.5) — какие базы прицел перелёта предлагает.
 *
 * Приёмка кирпича: «перелёт ставится кнопками, недоступные базы не предлагаются». Вторая
 * половина проверяется дважды: случаями (каждое условие ядра — своим тестом) и СТОРОЖЕМ
 * ЗЕРКАЛА в конце — каждая своя база разыгрывается настоящим `shuttle.relocate`, и ответ
 * решения обязан совпасть с ответом кернела.
 */
import { describe, expect, it } from 'vitest';
import {
  createInitialState,
  createKernel,
  fleetPositionAt,
  parseGameData,
  shuttleModule,
  type Fleet,
  type GameData,
  type GameState,
  type Planet,
  type Squadron,
  type StrikeBase,
} from '../packages/shared-core/src/index';
import { relocateTargets } from './relocateTargets';

const shuttle = (stats: Record<string, number>) => ({ faction: 'x', traits: ['shuttle'], stats });

const data: GameData = parseGameData({
  version: '0.1.0',
  resources: ['metal'],
  units: {
    // Носитель: трюм на 4 места.
    carrier: {
      faction: 'x',
      stats: { attack: 0, defense: 9, speed: 30, hp: 40, cargoCapacity: 4 },
    },
    frigate: { faction: 'x', stats: { attack: 5, defense: 5, speed: 30, hp: 40 } },
    // Радиус удара 180 — перелёт 360.
    interceptor: shuttle({ attack: 4, defense: 3, speed: 100, hp: 10, strikeRange: 180, fuel: 3 }),
    // Тяжёлый: два места на борт.
    heavy: shuttle({
      attack: 9,
      defense: 6,
      speed: 80,
      hp: 30,
      strikeRange: 180,
      fuel: 2,
      cargoSize: 2,
    }),
    // Короткая рука: радиус 120 — перелёт 240.
    lander: shuttle({ attack: 0, defense: 2, speed: 100, hp: 24, strikeRange: 120, fuel: 2 }),
  },
  factions: {},
  buildings: {
    spaceport: { name: 'Spaceport', cost: {}, buildTimeHours: 0, hp: 30, shuttleBay: 6 },
  },
  events: {},
});

const kernel = createKernel([shuttleModule]);

const planet = (id: string, owner: string | null, x: number, port = false): Planet => ({
  id,
  owner,
  position: { x, y: 0 },
  resources: {},
  buildings: port ? [{ type: 'spaceport', level: 1, hp: 30 }] : [],
  garrison: [],
  traits: [],
});

const ship = (id: string, location: string, over: Partial<Fleet> = {}): Fleet => ({
  id,
  owner: 'p1',
  location,
  movement: null,
  units: [{ unit: 'carrier', count: 1 }],
  traits: [],
  battleId: null,
  ...over,
});

const wing = (id: string, unit: string, count: number): Squadron => ({
  id,
  units: [{ unit, count }],
});

/**
 * Прямая y = 0. Свой порт A(0) — дом эскадры; свои порты B(300) в дальности перелёта и
 * C(1000) вне её; свой мир без порта D(150) с кораблями у него; чужой порт E(200) с чужим
 * носителем; пустой узел G(250) со своим кораблём без трюма.
 */
function world(home: Squadron[] = [wing('sq:i', 'interceptor', 2)]): GameState {
  const s = createInitialState({ seed: 'shu65', version: { data: '0.1.0', manifest: '1' } });
  const A = planet('A', 'p1', 0, true);
  A.hangar = home;
  return {
    ...s,
    players: {
      p1: { id: 'p1', name: 'p1', faction: 'x', status: 'active', resources: {} },
      p2: { id: 'p2', name: 'p2', faction: 'x', status: 'active', resources: {} },
    },
    planets: {
      A,
      B: planet('B', 'p1', 300, true),
      C: planet('C', 'p1', 1000, true),
      D: planet('D', 'p1', 150),
      E: planet('E', 'p2', 200, true),
      G: planet('G', null, 250),
    },
    fleets: {
      F: ship('F', 'D'),
      // Полный трюм: четыре места заняты своей эскадрой.
      FULL: ship('FULL', 'D', { hangar: [wing('sq:f', 'interceptor', 4)] }),
      FOE: ship('FOE', 'E', { owner: 'p2' }),
      BARE: ship('BARE', 'G', { units: [{ unit: 'frigate', count: 1 }] }),
    },
    heroes: {},
    battles: {},
  };
}

/** Позиции — те же, по которым меряет ядро. */
const posIn =
  (s: GameState) =>
  (b: StrikeBase): { x: number; y: number } | null => {
    if (b.kind === 'planet') return s.planets[b.id]?.position ?? null;
    const f = s.fleets[b.id];
    return f ? fleetPositionAt(s, f, s.time) : null;
  };

const targets = (s: GameState, from: StrikeBase, squadron: Squadron) =>
  relocateTargets(s, { me: 'p1', from, squadron, data, pos: posIn(s) });

const ids = (list: ReturnType<typeof targets>): string[] =>
  list.map((t) => `${t.base.kind}:${t.base.id}`);

const HOME: StrikeBase = { kind: 'planet', id: 'A' };
const IX = wing('sq:i', 'interceptor', 2);

describe('SHU-6.5 — куда эскадру можно перебазировать', () => {
  it('СВОИ БАЗЫ ОБЕИХ ФОРМ В ДАЛЬНОСТИ ПЕРЕЛЁТА — и порт, и корабль; ближе — раньше', () => {
    const list = targets(world(), HOME, IX);
    expect(ids(list)).toEqual(['fleet:F', 'planet:B']);
    expect(list[0]).toEqual({
      base: { kind: 'fleet', id: 'F' },
      at: { x: 150, y: 0 },
      distance: 150,
    });
  });

  it('БАЗА, ГДЕ ЭСКАДРА СТОИТ, НЕ ПРЕДЛАГАЕТСЯ — с корабля предлагается порт, с которого он пришёл', () => {
    const s = world([]);
    s.fleets.F = ship('F', 'D', { hangar: [IX] });
    expect(ids(targets(s, { kind: 'fleet', id: 'F' }, IX))).toEqual(['planet:A', 'planet:B']);
  });

  it('ЗА ДАЛЬНОСТЬЮ ПЕРЕЛЁТА БАЗЫ НЕТ — граница два радиуса удара, сама граница ещё в дальности', () => {
    const s = world();
    s.planets.C = planet('C', 'p1', 360, true);
    expect(ids(targets(s, HOME, IX))).toEqual(['fleet:F', 'planet:B', 'planet:C']);
    s.planets.C = planet('C', 'p1', 361, true);
    expect(ids(targets(s, HOME, IX))).toEqual(['fleet:F', 'planet:B']);
  });

  it('ДАЛЬНОСТЬ — ПО САМОЙ КОРОТКОЙ РУКЕ: десантный челнок в звене не дотянет до порта за 240', () => {
    const mixed: Squadron = {
      id: 'sq:m',
      units: [
        { unit: 'interceptor', count: 1 },
        { unit: 'lander', count: 1 },
      ],
    };
    expect(ids(targets(world([mixed]), HOME, mixed))).toEqual(['fleet:F']);
  });

  it('ЧУЖОЕ НЕ БАЗА: ни чужой порт, ни чужой носитель — сажать машины к сопернику нельзя', () => {
    const list = ids(targets(world(), HOME, IX));
    expect(list).not.toContain('planet:E');
    expect(list).not.toContain('fleet:FOE');
  });

  it('МИР БЕЗ ПОРТА, СНЕСЁННЫЙ ПОРТ И КОРАБЛЬ БЕЗ ТРЮМА — не базы', () => {
    const s = world();
    s.planets.B = { ...s.planets.B!, buildings: [{ type: 'spaceport', level: 1, hp: 0 }] };
    const list = ids(targets(s, HOME, IX));
    expect(list).not.toContain('planet:D');
    expect(list).not.toContain('planet:B');
    expect(list).not.toContain('fleet:BARE');
  });

  it('В КОРАБЛЬ — ТОЛЬКО ЦЕЛИКОМ: полный трюм и места, которые держат летящие к нему, заняты', () => {
    const s = world();
    expect(ids(targets(s, HOME, IX))).not.toContain('fleet:FULL');
    // Три места из четырёх держит эскадра, которая летит к F: двойке не хватает места.
    s.strikes = [
      {
        id: 'st:x',
        owner: 'p1',
        base: { kind: 'fleet', id: 'F' },
        squadronId: 'sq:x',
        units: [{ unit: 'interceptor', count: 3 }],
        target: { kind: 'base' },
        to: { x: 0, y: 0 },
        departedAt: 0,
        arrivesAt: 1000,
        leg: 'back',
      },
    ];
    expect(ids(targets(s, HOME, IX))).toEqual(['planet:B']);
  });

  it('МЕСТО МЕРЯЕТСЯ МЕСТАМИ, А НЕ БОРТАМИ: три тяжёлых — шесть мест, в трюм на четыре не влезут', () => {
    const heavy = wing('sq:h', 'heavy', 3);
    expect(ids(targets(world([heavy]), HOME, heavy))).toEqual(['planet:B']);
  });

  it('ПОРТ ДЕРЖИТ СКОЛЬКО УГОДНО — полный ангар у порта не помеха', () => {
    const s = world();
    s.planets.B = { ...s.planets.B!, hangar: [wing('sq:b', 'heavy', 20)] };
    expect(ids(targets(s, HOME, IX))).toContain('planet:B');
  });

  it('ПОЗИЦИЯ КОРАБЛЯ ЖИВАЯ — её даёт рисующий: ушёл за дальность, базой больше не предлагается', () => {
    const s = world();
    const far = (b: StrikeBase) =>
      b.kind === 'fleet' && b.id === 'F' ? { x: 500, y: 0 } : posIn(s)(b);
    expect(ids(relocateTargets(s, { me: 'p1', from: HOME, squadron: IX, data, pos: far }))).toEqual(
      ['planet:B'],
    );
  });

  it('РАВНАЯ ДИСТАНЦИЯ: мир раньше корабля, как у запасной посадки ядра', () => {
    const s = world();
    s.fleets.F = ship('F', 'B');
    expect(ids(targets(s, HOME, IX))).toEqual(['planet:B', 'fleet:F']);
  });

  it('БАЗА ПРОПАЛА ИЛИ ЗВЕНО НЕ ЛЕТАЕТ — СПИСОК ПУСТ, кнопке нечего предлагать', () => {
    const s = world();
    expect(targets(s, { kind: 'fleet', id: 'GONE' }, IX)).toEqual([]);
    expect(targets(s, HOME, { id: 'sq:z', units: [] })).toEqual([]);
  });
});

describe('SHU-6.5 — сторож зеркала: предложено ⇔ ядро примет', () => {
  /** Каждая своя база, кроме дома, — настоящим приказом через кернел. */
  function mirror(s: GameState, from: StrikeBase, squadron: Squadron): void {
    const offered = new Set(ids(targets(s, from, squadron)));
    const bases: StrikeBase[] = [
      ...Object.values(s.planets)
        .filter((p) => p.owner === 'p1')
        .map((p): StrikeBase => ({ kind: 'planet', id: p.id })),
      ...Object.values(s.fleets)
        .filter((f) => f.owner === 'p1')
        .map((f): StrikeBase => ({ kind: 'fleet', id: f.id })),
    ].filter((b) => !(b.kind === from.kind && b.id === from.id));
    expect(bases.length).toBeGreaterThan(3);
    for (const b of bases) {
      const r = kernel.applyAction(
        s,
        {
          id: `a:${b.id}`,
          type: 'shuttle.relocate',
          playerId: 'p1',
          payload: {
            ...(from.kind === 'planet' ? { planetId: from.id } : { fleetId: from.id }),
            squadronId: squadron.id,
            ...(b.kind === 'planet' ? { toPlanetId: b.id } : { toFleetId: b.id }),
          },
          issuedAt: 0,
        },
        { now: s.time, data },
      );
      const key = `${b.kind}:${b.id}`;
      expect(r.ok, `${key}: ядро ${r.ok ? 'приняло' : `отбило ${r.code}`}`).toBe(offered.has(key));
    }
  }

  it('С ПОРТА: двойка перехватчиков', () => {
    mirror(world(), HOME, IX);
  });

  it('С ПОРТА: тяжёлая тройка и звено с короткой рукой', () => {
    mirror(world([wing('sq:h', 'heavy', 3)]), HOME, wing('sq:h', 'heavy', 3));
    const mixed: Squadron = {
      id: 'sq:m',
      units: [
        { unit: 'interceptor', count: 1 },
        { unit: 'lander', count: 1 },
      ],
    };
    mirror(world([mixed]), HOME, mixed);
  });

  it('С КОРАБЛЯ: звено в трюме носителя', () => {
    const s = world([]);
    s.fleets.F = ship('F', 'D', { hangar: [IX] });
    mirror(s, { kind: 'fleet', id: 'F' }, IX);
  });
});
