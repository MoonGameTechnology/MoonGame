/**
 * НОСИТЕЛЬ КАК МОБИЛЬНЫЙ КОСМОПОРТ (SHU-2.1, заказ владельца).
 *
 * Резолюция владельца (`shuttles-roadmap.md` §0.1): носитель — не корпус с красивым
 * именем, а ВТОРАЯ БАЗА челноков. Всё, что делает космопорт — вмещает, держит топливо,
 * выпускает и принимает обратно, — он делает тоже, только едет вместе с флотом. Отсюда
 * правила, которые здесь и проверяются:
 *
 * 1. **Вместимость даёт КОРПУС** (`shuttleBay` юнита), и ноль читается как «не база» —
 *    ровно как у порта: корабль, вмещающий ноль челноков, ничем не отличается от того,
 *    который их не носит вовсе, поэтому отдельного флага «носитель» нет.
 * 2. **Челнок попадает на борт перегрузкой в своём порту** (`shuttle.load`), потому что
 *    строится он всё так же в космопорте (SHU-1.1). Обе стороны — свои.
 * 3. **Вылет с носителя — вдали от своих миров.** Радиус считается от НОСИТЕЛЯ, и это
 *    вся суть кирпича: флот бьёт челноками там, куда его порт не достаёт.
 * 4. **Возврат — на носитель**, и позиция берётся текущая: носитель мог сдвинуться.
 * 5. **Ангар не переживает свои корпуса.** Погибли носители — вместимость упала, лишние
 *    челноки списываются тем же правилом, что и у потерянного порта.
 */
import { describe, expect, it } from 'vitest';
import { createKernel } from '../kernel/kernel';
import { shuttleModule } from './shuttle';
import {
  createInitialState,
  type Fleet,
  type GameState,
  type Planet,
  type Player,
} from '../state/gameState';
import { parseGameData, type GameData } from '../data/schemas';
import type { Action, Context } from '../action/types';

const data: GameData = parseGameData({
  version: '0.1.0',
  resources: ['metal'],
  units: {
    cruiser: { faction: 'x', stats: { attack: 5, defense: 5, speed: 6, hp: 100 } },
    // Носитель: два места ангара на корпус, 40 hp — чтобы одна потеря корпуса роняла
    // вместимость ровно вдвое и правило 5 было видно числом.
    carrier: { faction: 'x', stats: { attack: 3, defense: 9, speed: 30, hp: 40, shuttleBay: 2 } },
    interceptor: {
      faction: 'x',
      traits: ['shuttle'],
      // speed 100 единиц карты в час, радиус 180.
      stats: { attack: 12, defense: 3, speed: 100, hp: 10, strikeRange: 180, fuel: 2, rearmRounds: 2 },
    },
  },
  factions: {},
  buildings: { spaceport: { name: 'Spaceport', cost: {}, buildTimeHours: 0, hp: 30, shuttleBay: 6 } },
  events: {},
});

const kernel = createKernel([shuttleModule]);
const at = (s: GameState): Context => ({ now: s.time, data });
const player = (id: string): Player => ({
  id,
  name: id,
  faction: 'x',
  status: 'active',
  resources: {},
});

const planet = (id: string, owner: string | null, x: number, port = false): Planet => ({
  id,
  owner,
  position: { x, y: 0 },
  resources: {},
  buildings: port ? [{ type: 'spaceport', level: 1, hp: 30 }] : [],
  garrison: [],
  traits: [],
});

const fleetAt = (id: string, owner: string, location: string, units: Fleet['units']): Fleet => ({
  id,
  owner,
  location,
  movement: null,
  units,
  traits: [],
  battleId: null,
});

/**
 * Карта: свой порт HOME(0) с челноками; нейтральный FWD(900) — плацдарм за тысячу единиц
 * от дома, куда порт не достаёт ничем; чужой флот у FOE(1000) — в 100 от плацдарма, то
 * есть в радиусе челнока ТОЛЬКО с носителя.
 */
function world(): GameState {
  const s = createInitialState({ seed: 'shu21', version: { data: '0.1.0', manifest: '1' } });
  const home = planet('HOME', 'p1', 0, true);
  // SHU-4.2: ангар — список ЭСКАДР, и перегрузка возит соединение ЦЕЛИКОМ. Три
  // отдельных звена по машине дают тестам ту же зернистость, что раньше давал `count`.
  home.hangar = [1, 2, 3].map((n) => ({ id: `sq:${n}`, units: [{ unit: 'interceptor', count: 1 }] }));
  return {
    ...s,
    players: { p1: player('p1'), p2: player('p2') },
    planets: {
      HOME: home,
      FWD: planet('FWD', null, 900),
      FOE: planet('FOE', 'p2', 1000),
    },
    fleets: {
      CV: fleetAt('CV', 'p1', 'HOME', [{ unit: 'carrier', count: 2 }]),
      LINE: fleetAt('LINE', 'p1', 'HOME', [{ unit: 'cruiser', count: 1 }]),
      E1: fleetAt('E1', 'p2', 'FOE', [{ unit: 'cruiser', count: 1 }]),
    },
    heroes: {},
    battles: {},
  };
}

let seq = 0;
const act = (type: string, payload: Record<string, unknown>): Action => ({
  id: `a:${seq++}`,
  type,
  playerId: 'p1',
  payload,
  issuedAt: 0,
});
const loadOne = (squadronId = 'sq:1', fleetId = 'CV'): Action =>
  act('shuttle.load', { fleetId, squadronId });
const unloadOne = (squadronId = 'sq:1', fleetId = 'CV'): Action =>
  act('shuttle.unload', { fleetId, squadronId });

function apply(state: GameState, action: Action): GameState {
  const r = kernel.applyAction(state, action, at(state));
  if (!r.ok) throw new Error(r.code);
  return r.state;
}
function code(state: GameState, action: Action): string | null {
  const r = kernel.applyAction(state, action, at(state));
  return r.ok ? null : r.code;
}
function advance(state: GameState, hours: number): GameState {
  const r = kernel.advanceTo(state, { now: state.time + hours * 3_600_000, data });
  if (!r.ok) throw new Error(r.code);
  return r.state;
}
const machines = (hangar: { units: Array<{ count: number }> }[] | undefined): number =>
  (hangar ?? []).reduce((n, sq) => n + sq.units.reduce((m, st) => m + st.count, 0), 0);
const aboard = (s: GameState, id = 'CV'): number => machines(s.fleets[id]?.hangar);
const ashore = (s: GameState, id = 'HOME'): number => machines(s.planets[id]?.hangar);

/** Поднять на борт `n` первых звеньев порта — «часть машин» в терминах эскадр. */
function load(state: GameState, n: number, fleetId = 'CV'): GameState {
  let s = state;
  for (let i = 1; i <= n; i++) s = apply(s, loadOne(`sq:${i}`, fleetId));
  return s;
}

/** Перегнать носитель на плацдарм — «вдали от своих миров», как просит кирпич. */
function deploy(s: GameState): GameState {
  const cv = s.fleets.CV!;
  return { ...s, fleets: { ...s.fleets, CV: { ...cv, location: 'FWD' } } };
}

describe('носитель — перегрузка челноков (правила 1–2)', () => {
  it('челноки переходят из порта на борт и обратно', () => {
    let s = load(world(), 2);
    expect(aboard(s)).toBe(2);
    expect(ashore(s)).toBe(1);
    s = apply(s, unloadOne('sq:1'));
    expect(aboard(s)).toBe(1);
    expect(ashore(s)).toBe(2);
  });

  it('сверх вместимости корпусов не грузится — E_NO_CAPACITY', () => {
    const s = world(); // два корпуса × 2 места = 4, но в порту всего 3
    expect(ashore(load(s, 3))).toBe(0); // все три звена уехали
    expect(code(load(s, 3), loadOne('sq:1'))).toBe('E_NO_SQUADRON'); // порт опустел
    const packed = {
      ...s,
      planets: {
        ...s.planets,
        HOME: { ...s.planets.HOME!, hangar: [{ id: 'sq:big', units: [{ unit: 'interceptor', count: 9 }] }] },
      },
    };
    // Эскадра переезжает ЦЕЛИКОМ, поэтому девятка не влезает в четыре места — и не
    // «частично грузится», а честно отбивается.
    expect(code(packed, loadOne('sq:big'))).toBe('E_NO_CAPACITY');
  });

  it('корабль без мест ангара не носитель — E_NO_CAPACITY', () => {
    expect(code(world(), loadOne('sq:1', 'LINE'))).toBe('E_NO_CAPACITY');
  });

  it('перегрузка — только СВОЯ эскадра и только в своём мире', () => {
    // Проверки «а челнок ли это» здесь больше нет и быть не может: ездит ЭСКАДРА, а в
    // ангаре не бывает ничего, кроме челноков (SHU-4.2). Её место занял отказ по
    // несуществующему соединению — та же граница, выраженная в новой форме.
    const s = world();
    expect(code(s, act('shuttle.load', { fleetId: 'CV', squadronId: 'нет-такой' }))).toBe(
      'E_NO_SQUADRON',
    );
    const away = { ...s, fleets: { ...s.fleets, CV: { ...s.fleets.CV!, location: 'FOE' } } };
    expect(code(away, loadOne('sq:1'))).toBe('E_FORBIDDEN');
  });
});

describe('носитель — вылет и возврат (правила 3–4)', () => {
  it('ГОТОВНОСТЬ КИРПИЧА: флот с носителем бьёт челноками там, куда порт не достаёт', () => {
    let s = load(world(), 2);
    s = deploy(s);
    // Из дома цель недосягаема — тысяча единиц против радиуса 180.
    expect(code(s, act('shuttle.strike', { planetId: 'HOME', squadronId: 'sq:3', targetFleetId: 'E1' }))).toBe(
      'E_OUT_OF_RANGE',
    );
    // С носителя — сто единиц, попадает. Летят обе эскадры, поднятые на борт.
    s = apply(s, act('shuttle.strike', { fleetId: 'CV', squadronId: 'sq:1', targetFleetId: 'E1' }));
    s = apply(s, act('shuttle.strike', { fleetId: 'CV', squadronId: 'sq:2', targetFleetId: 'E1' }));
    expect(aboard(s)).toBe(0); // ушли с борта
    expect(s.strikes?.[0]?.base).toEqual({ kind: 'fleet', id: 'CV' });

    s = advance(s, 1); // долетели и ударили
    expect(s.fleets.E1?.units[0]?.hp).toBeLessThan(100);
    expect(s.fleets.E1?.battleId ?? null).toBe(null); // удар односторонний, боя нет

    s = advance(s, 2); // вернулись на борт
    expect(s.strikes ?? []).toHaveLength(0);
    expect(aboard(s)).toBe(2);
  });

  it('топливо и перезарядка живут у НОСИТЕЛЯ, как у порта', () => {
    // Грузим три: два уходят в вылеты, третий остаётся на борту — иначе пустой ангар
    // отобьёт третий приказ раньше топлива (`E_NOT_ENOUGH`), и проверять было бы нечего.
    let s = deploy(load(world(), 3));
    const strike = (n: number): Action =>
      act('shuttle.strike', { fleetId: 'CV', squadronId: `sq:${n}`, targetFleetId: 'E1' });
    s = apply(s, strike(1));
    expect(s.fleets.CV?.sortie?.fuel).toBe(1);
    s = apply(s, strike(2));
    expect(s.fleets.CV?.sortie).toEqual({ fuel: 0, rearming: 2 });
    expect(code(s, strike(3))).toBe('E_NO_FUEL');
    s = advance(s, 4); // вылеты вернулись, перезарядка отсчиталась
    expect(s.fleets.CV?.sortie?.fuel).toBe(2);
    expect(code(s, strike(3))).toBe(null);
  });

  it('носитель погиб, пока челноки летели — садиться некуда', () => {
    let s = deploy(load(world(), 2));
    s = apply(s, act('shuttle.strike', { fleetId: 'CV', squadronId: 'sq:1', targetFleetId: 'E1' }));
    const { CV: _gone, ...rest } = s.fleets;
    s = { ...s, fleets: rest };
    s = advance(s, 4);
    expect(s.strikes ?? []).toHaveLength(0); // вылет снят, а не завис в состоянии
    expect(s.fleets.CV).toBeUndefined();
  });

  it('ровно одна база: обе или ни одной — отказ', () => {
    const s = load(world(), 1);
    expect(code(s, act('shuttle.strike', { squadronId: 'sq:1', targetFleetId: 'E1' }))).toBe(
      'E_BAD_PAYLOAD',
    );
    expect(
      code(s, act('shuttle.strike', { planetId: 'HOME', fleetId: 'CV', squadronId: 'sq:1', targetFleetId: 'E1' })),
    ).toBe('E_BAD_PAYLOAD');
  });

  it('обычный флот базой не является — E_NO_PORT', () => {
    const s = world();
    expect(
      code(s, act('shuttle.strike', { fleetId: 'LINE', squadronId: 'sq:1', targetFleetId: 'E1' })),
    ).toBe('E_NO_PORT');
  });
});

describe('носитель — ангар не переживает свои корпуса (правило 5)', () => {
  it('погиб корпус — лишние челноки списываются', () => {
    let s = load(world(), 3);
    expect(aboard(s)).toBe(3);
    // Один из двух носителей сбит: мест осталось 2, третий челнок падает вместе с ним.
    const cv = s.fleets.CV!;
    s = { ...s, fleets: { ...s.fleets, CV: { ...cv, units: [{ unit: 'carrier', count: 1 }] } } };
    s = advance(s, 1);
    expect(aboard(s)).toBe(2);
  });

  it('носителей не осталось — ангар пуст', () => {
    let s = load(world(), 2);
    const cv = s.fleets.CV!;
    s = { ...s, fleets: { ...s.fleets, CV: { ...cv, units: [{ unit: 'cruiser', count: 1 }] } } };
    s = advance(s, 1);
    expect(aboard(s)).toBe(0);
  });
});
