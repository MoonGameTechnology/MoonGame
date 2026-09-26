/**
 * ОБЩИЙ ТРЮМ (SHU-5.1, резолюция владельца 2026-09-26, shuttles-roadmap §0.6).
 *
 * Шаттлы едут в трюме ЛЮБОГО корабля вместе с десантом, и место меряется одним числом —
 * `cargoSize` машины или бойца (перехватчик и ударный страйкер 1, тяжёлый страйкер и
 * десантный челнок 2, пехота 1, техника 2). Правила, за которыми следят тесты:
 *
 * 1. **Крейсер (трюм 5) везёт двух ударных страйкеров и пехоту**, пускает их на ходу и
 *    принимает обратно.
 * 2. **Место улетевшего держится** до его возврата: погрузка на него отбивается
 *    `E_NO_CAPACITY` — и десанта, и другой эскадры.
 * 3. **Размер машины — это места**, а не штуки: тяжёлый страйкер занимает два.
 * 4. **Корабли гибнут — трюм падает**, лишние машины списываются с хвоста.
 */
import { describe, expect, it } from 'vitest';
import { createKernel } from '../kernel/kernel';
import { shuttleModule } from './shuttle';
import { armyModule } from './army';
import { fleetOpsModule } from './fleetOps';
import {
  createInitialState,
  type Fleet,
  type GameState,
  type Planet,
  type Player,
} from '../state/gameState';
import { parseGameData, type GameData } from '../data/schemas';
import type { Action, Context } from '../action/types';
import { fleetHoldFree, hangarSize } from '../state/shuttle';

const data: GameData = parseGameData({
  version: '0.1.0',
  resources: ['metal'],
  units: {
    cruiser: { faction: 'x', stats: { attack: 5, defense: 5, speed: 6, hp: 100, cargoCapacity: 5 } },
    bomber: {
      faction: 'x',
      traits: ['shuttle'],
      stats: { attack: 12, defense: 3, speed: 100, hp: 10, strikeRange: 180, fuel: 2, rearmRounds: 2, cargoSize: 1 },
    },
    heavy_striker: {
      faction: 'x',
      traits: ['shuttle'],
      stats: { attack: 20, defense: 3, speed: 100, hp: 20, strikeRange: 180, fuel: 2, rearmRounds: 2, cargoSize: 2 },
    },
    infantry: { faction: 'x', domain: 'ground', stats: { attack: 1, defense: 1, speed: 1, hp: 10, cargoSize: 1 } },
  },
  factions: {},
  buildings: { spaceport: { name: 'Spaceport', cost: {}, buildTimeHours: 0, hp: 30, shuttleBay: 6 } },
  events: {},
});

const kernel = createKernel([armyModule, fleetOpsModule, shuttleModule]);
const at = (s: GameState): Context => ({ now: s.time, data });
const player = (id: string): Player => ({ id, name: id, faction: 'x', status: 'active', resources: {} });
const planet = (id: string, owner: string | null, x: number, over: Partial<Planet> = {}): Planet => ({
  id,
  owner,
  position: { x, y: 0 },
  resources: {},
  buildings: [],
  garrison: [],
  traits: [],
  ...over,
});
const fleetAt = (id: string, owner: string, location: string, over: Partial<Fleet> = {}): Fleet => ({
  id,
  owner,
  location,
  movement: null,
  units: [{ unit: 'cruiser', count: 1 }],
  traits: [],
  battleId: null,
  ...over,
});

/** Крейсер у своего мира: два ударных страйкера двумя эскадрами и пехотинец на борту —
 *  три места из пяти. В гарнизоне ещё пехота, а в порту — запасная эскадра. */
function world(): GameState {
  const s = createInitialState({ seed: 'shu51', version: { data: '0.1.0', manifest: '1' } });
  return {
    ...s,
    players: { p1: player('p1'), p2: player('p2') },
    planets: {
      HOME: planet('HOME', 'p1', 0, {
        buildings: [{ type: 'spaceport', level: 1, hp: 30 }],
        garrison: [{ unit: 'infantry', count: 5 }],
        hangar: [{ id: 'sq:9', units: [{ unit: 'bomber', count: 1 }] }],
      }),
      FAR: planet('FAR', null, 400),
      FOE: planet('FOE', 'p2', 100),
    },
    fleets: {
      CR: fleetAt('CR', 'p1', 'HOME', {
        landing: [{ unit: 'infantry', count: 1 }],
        hangar: [
          { id: 'sq:1', units: [{ unit: 'bomber', count: 1 }] },
          { id: 'sq:2', units: [{ unit: 'bomber', count: 1 }] },
        ],
      }),
      E1: fleetAt('E1', 'p2', 'FOE'),
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
/** Флот идёт по линии HOME → FAR — «на ходу», как в SHU-2.3. */
function underway(s: GameState): GameState {
  const cr = s.fleets.CR!;
  return {
    ...s,
    fleets: {
      ...s.fleets,
      CR: { ...cr, movement: { from: 'HOME', to: 'FAR', departedAt: s.time, arrivesAt: s.time + 400 * 3_600_000 } },
    },
  };
}
const strike = (squadronId: string): Action =>
  act('shuttle.strike', { fleetId: 'CR', squadronId, targetFleetId: 'E1' });
const loadTroops = (count = 1): Action => act('army.load', { fleetId: 'CR', unit: 'infantry', count });
const loadSquad = (squadronId: string): Action => act('shuttle.load', { fleetId: 'CR', squadronId });
const aboard = (s: GameState): string[] => (s.fleets.CR?.hangar ?? []).map((q) => q.id).sort();

describe('SHU-5.1 — общий трюм', () => {
  it('ГОТОВНОСТЬ: крейсер везёт двух страйкеров и пехоту, пускает на ходу и принимает обратно', () => {
    let s = world();
    expect(hangarSize(s.fleets.CR!, data)).toBe(2);
    expect(fleetHoldFree(s, s.fleets.CR!, data)).toBe(2); // 5 − 1 пехота − 2 страйкера
    s = underway(s);
    s = apply(s, strike('sq:1'));
    s = apply(s, strike('sq:2'));
    expect(aboard(s)).toEqual([]);
    expect(s.strikes).toHaveLength(2);
    // Места улетевших держатся: свободно по-прежнему два.
    expect(fleetHoldFree(s, s.fleets.CR!, data)).toBe(2);
    s = advance(s, 3); // долетели, ударили, вернулись на идущий крейсер
    expect(s.strikes ?? []).toHaveLength(0);
    expect(aboard(s)).toEqual(['sq:1', 'sq:2']);
    expect(s.fleets.CR?.landing).toEqual([{ unit: 'infantry', count: 1 }]);
  });

  it('ПОГРУЗКА НА МЕСТО УЛЕТЕВШЕГО отбивается E_NO_CAPACITY — и десанта, и эскадры', () => {
    let s = world();
    // Добиваем трюм десантом до отказа: 1 + 2 страйкера + 2 пехоты = 5.
    s = apply(s, loadTroops(2));
    expect(code(s, loadTroops(1))).toBe('E_NO_CAPACITY');
    s = advance(s, 1); // погрузка созрела
    expect(s.fleets.CR?.landing).toEqual([{ unit: 'infantry', count: 3 }]);
    // Страйкер улетел — его место всё равно занято.
    s = apply(s, strike('sq:1'));
    expect(code(s, loadTroops(1))).toBe('E_NO_CAPACITY');
    expect(code(s, loadSquad('sq:9'))).toBe('E_NO_CAPACITY');
  });

  it('место меряется `cargoSize`: тяжёлый страйкер занимает два', () => {
    const s = world();
    s.planets.HOME!.hangar = [{ id: 'sq:h', units: [{ unit: 'heavy_striker', count: 1 }] }];
    // Свободно 2 — тяжёлый влезает ровно.
    const loaded = apply(s, loadSquad('sq:h'));
    expect(hangarSize(loaded.fleets.CR!, data)).toBe(4);
    expect(fleetHoldFree(loaded, loaded.fleets.CR!, data)).toBe(0);
    // С пехотой на лишнем месте (свободно 1) — уже нет.
    const tight = world();
    tight.planets.HOME!.hangar = [{ id: 'sq:h', units: [{ unit: 'heavy_striker', count: 1 }] }];
    tight.fleets.CR!.landing = [{ unit: 'infantry', count: 2 }];
    expect(code(tight, loadSquad('sq:h'))).toBe('E_NO_CAPACITY');
  });

  it('КОРАБЛИ ГИБНУТ — трюм падает, лишние машины списываются с хвоста', () => {
    let s = world();
    // Два крейсера везли четыре пехоты и двух страйкеров; один крейсер погиб — трюм
    // сжался до 5, пехота держит 4, и шаттлам осталось одно место: второй гибнет.
    s.fleets.CR!.units = [{ unit: 'cruiser', count: 1 }];
    s.fleets.CR!.landing = [{ unit: 'infantry', count: 4 }];
    s = advance(s, 1);
    expect(aboard(s)).toEqual(['sq:1']);
  });

  it('флот делится, только если трюм оставшейся половины вмещает её шаттлы', () => {
    const s = world();
    s.fleets.CR!.units = [{ unit: 'cruiser', count: 2 }];
    // Уводим крейсер вместе с пехотой: оставшемуся хватает мест на две эскадры.
    const ok = apply(
      s,
      act('fleet.split', { fleetId: 'CR', take: [{ unit: 'cruiser', count: 1 }], takeLanding: [{ unit: 'infantry', count: 1 }] }),
    );
    expect(aboard(ok)).toEqual(['sq:1', 'sq:2']);
    // А разделить так, чтобы шаттлам не осталось трюма, нельзя: шесть страйкеров в
    // одном крейсере (5 мест) не помещаются.
    s.fleets.CR!.landing = [];
    s.fleets.CR!.hangar = [{ id: 'sq:1', units: [{ unit: 'bomber', count: 6 }] }];
    expect(code(s, act('fleet.split', { fleetId: 'CR', take: [{ unit: 'cruiser', count: 1 }] }))).toBe(
      'E_NO_CAPACITY',
    );
  });

  it('флоты сливаются — шаттлы переезжают вместе с кораблями, а не пропадают', () => {
    const s = world();
    s.fleets.CR2 = fleetAt('CR2', 'p1', 'HOME', {
      hangar: [{ id: 'sq:7', units: [{ unit: 'bomber', count: 1 }] }],
    });
    const merged = apply(s, act('fleet.merge', { from: 'CR2', into: 'CR' }));
    expect(merged.fleets.CR2).toBeUndefined();
    expect(aboard(merged)).toEqual(['sq:1', 'sq:2', 'sq:7']);
  });
});
