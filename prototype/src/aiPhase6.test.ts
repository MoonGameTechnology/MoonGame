// SHU-6.8 — сильный бот и фаза 6 шаттлов (docs/shuttles-roadmap.md, §0.7).
//
// Два правила, каждое — до ответа ЯДРА, а не только до намерения бота:
//   • перелёт к фронту: ударная эскадра, которой со своей базы бить некого, перелетает на
//     свою базу ближе к чужим мирам — с порта на корабль и с корабля на порт;
//   • патруль над базой, пока рядом враг: база поднимает удерживаемый патруль
//     перехватчиков, а когда врага не стало, удержание снимается.
// Плюс предел челноков: он считает машины и в трюмах, и в воздухе.
// Замер тех же действий на живых матчах — строка «фаза 6» в `pnpm run selfplay`.
import { describe, expect, it } from 'vitest';
import { newGame, aiOrders, START_CANDIDATES, kernel, ctx } from './game';
import { data } from './gameData';
import type {
  Action,
  GameState,
  Planet,
  ShuttleStrike,
  Squadron,
} from '../../packages/shared-core/src/index';

/**
 * Карта двух мест: дом p1 — C0R1, дом p2 — C1R1 (366 друг от друга). C1R4 — в 128 от дома
 * p2 и в 248 от дома p1: ближе к фронту на 118, а это больше шага перелёта (половина
 * радиуса удара ударного страйкера, 75), и в дальности его перелёта (300).
 */
const FRONT_NODE = 'C1R4';

/** Война, богатая казна, построенный порт у дома p2. Флоты p2 убраны: их трюм у дома
 *  забирал бы эскадры правилом погрузки, а здесь спрашивается перелёт. */
function staged(): { s: GameState; home: Planet } {
  const g = newGame({
    seats: [
      { id: 'p1', name: 'A', faction: 'azure', start: START_CANDIDATES[0]!, ai: true },
      { id: 'p2', name: 'B', faction: 'crimson', start: START_CANDIDATES[1]!, ai: true },
    ],
  });
  const s: GameState = {
    ...g,
    diplomacy: { ...(g.diplomacy ?? {}), 'p1|p2': 'war' },
    players: {
      ...g.players,
      p2: {
        ...g.players.p2!,
        resources: { credits: 6000, metal: 9000, food: 800, energy: 800, microelectronics: 400 },
      },
    },
  };
  const home = Object.values(s.planets).find((p) => p.owner === 'p2')!;
  home.buildings = [...home.buildings, { type: 'spaceport', level: 1, hp: data.buildings.spaceport!.hp }];
  for (const f of Object.values(s.fleets)) if (f.owner === 'p2') delete s.fleets[f.id];
  return { s, home };
}

const only = (actions: Action[], type: string): Action[] => actions.filter((a) => a.type === type);
const orders = (s: GameState, posture: 'expand' | 'defend' = 'expand'): Action[] =>
  aiOrders(s, 'p2', posture, 'strong');
const passes = (s: GameState, a: Action): void => {
  const r = kernel.applyAction(s, a, ctx(s.time));
  expect(r.ok, r.ok ? '' : r.code).toBe(true);
};

/** Флот у мира `at`: два крейсера — трюм на 10 мест. */
function fleetAt(s: GameState, id: string, owner: string, at: string, hangar?: Squadron[]): void {
  s.fleets[id] = {
    id,
    owner,
    location: at,
    movement: null,
    units: [{ unit: 'cruiser', count: 2 }],
    traits: [],
    battleId: null,
    ...(hangar ? { hangar } : {}),
  } as GameState['fleets'][string];
}

const BOMBERS: Squadron = { id: 'sq:b', units: [{ unit: 'bomber', count: 2 }] };
const WING: Squadron = { id: 'sq:i', units: [{ unit: 'interceptor', count: 3 }] };

/** Патруль p2 в воздухе над точкой `to`. */
function patrolAloft(home: Planet, over: Partial<ShuttleStrike> = {}): ShuttleStrike {
  return {
    id: 'strike:p2:0:1',
    owner: 'p2',
    base: { kind: 'planet', id: home.id },
    squadronId: WING.id,
    units: [{ unit: 'interceptor', count: 3 }],
    target: { kind: 'point' },
    to: { ...home.position },
    departedAt: 0,
    arrivesAt: 4 * 3_600_000,
    leg: 'patrol',
    patrol: { hours: 4, radius: 60, hold: true },
    ...over,
  };
}

describe('SHU-6.8 — перелёт к фронту', () => {
  it('эскадра в тыловом порту перелетает на свой корабль ближе к фронту, и ядро это принимает', () => {
    const { s, home } = staged();
    home.hangar = [BOMBERS];
    fleetAt(s, 'p2_front', 'p2', FRONT_NODE);
    const moves = only(orders(s), 'shuttle.relocate');
    expect(moves.map((a) => a.payload)).toEqual([
      { planetId: home.id, squadronId: BOMBERS.id, toFleetId: 'p2_front' },
    ]);
    passes(s, moves[0]!);
  });

  it('с корабля в тылу — на свой порт у фронта: базы обеих форм', () => {
    const { s, home } = staged();
    fleetAt(s, 'p2_rear', 'p2', home.id, [BOMBERS]);
    const port = s.planets[FRONT_NODE]!;
    port.owner = 'p2';
    port.buildings = [{ type: 'spaceport', level: 1, hp: data.buildings.spaceport!.hp }];
    const moves = only(orders(s), 'shuttle.relocate');
    expect(moves.map((a) => a.payload)).toEqual([
      { fleetId: 'p2_rear', squadronId: BOMBERS.id, toPlanetId: FRONT_NODE },
    ]);
    passes(s, moves[0]!);
  });

  it('есть по кому бить с базы — эскадра бьёт, а не улетает', () => {
    const { s, home } = staged();
    home.hangar = [BOMBERS];
    fleetAt(s, 'p2_front', 'p2', FRONT_NODE);
    s.planets[FRONT_NODE]!.owner = 'p1'; // чужой мир в 128 — в радиусе удара (150)
    const out = orders(s);
    expect(only(out, 'shuttle.relocate')).toEqual([]);
    expect(only(out, 'shuttle.strike').map((a) => a.payload)).toEqual([
      { planetId: home.id, squadronId: BOMBERS.id, targetPlanetId: FRONT_NODE },
    ]);
  });

  it('перехватчики к фронту не перелетают: их дело — патруль над своей базой', () => {
    const { s, home } = staged();
    home.hangar = [WING];
    fleetAt(s, 'p2_front', 'p2', FRONT_NODE);
    expect(only(orders(s), 'shuttle.relocate')).toEqual([]);
  });

  it('«Оборона» Хранителя к фронту не летит', () => {
    const { s, home } = staged();
    home.hangar = [BOMBERS];
    fleetAt(s, 'p2_front', 'p2', FRONT_NODE);
    expect(only(orders(s, 'defend'), 'shuttle.relocate')).toEqual([]);
  });
});

describe('SHU-6.8 — удар поднимается с любой своей базы', () => {
  /** Чужой мир в 115 от C1R4 и в 176 от дома p2: радиус удара 150 достаёт только с C1R4. */
  const NEAR_FRONT = 'C1R9';

  it('эскадра, перелетевшая на свой порт у фронта, бьёт оттуда', () => {
    const { s } = staged();
    const port = s.planets[FRONT_NODE]!;
    port.owner = 'p2';
    port.buildings = [{ type: 'spaceport', level: 1, hp: data.buildings.spaceport!.hp }];
    port.hangar = [BOMBERS];
    s.planets[NEAR_FRONT]!.owner = 'p1';
    const strikes = only(orders(s), 'shuttle.strike');
    expect(strikes.map((a) => a.payload)).toEqual([
      { planetId: FRONT_NODE, squadronId: BOMBERS.id, targetPlanetId: NEAR_FRONT },
    ]);
    passes(s, strikes[0]!);
  });

  it('эскадру, которую в этот тик грузят в трюм, удар не поднимает: второй приказ ядро отбило бы', () => {
    const { s, home } = staged();
    home.hangar = [BOMBERS];
    fleetAt(s, 'p2_home', 'p2', home.id); // стоит у своего порта с трюмом — правило погрузки
    s.planets['C1R8']!.owner = 'p1'; // в 89 от дома — в радиусе удара
    const out = orders(s);
    expect(only(out, 'shuttle.load').map((a) => a.payload)).toEqual([
      { fleetId: 'p2_home', squadronId: BOMBERS.id },
    ]);
    expect(only(out, 'shuttle.strike')).toEqual([]);
  });

  it('ударные в тылу без цели не держат удар с корабля у фронта', () => {
    const { s, home } = staged();
    home.hangar = [{ id: 'sq:h', units: [{ unit: 'bomber', count: 1 }] }];
    fleetAt(s, 'p2_front', 'p2', FRONT_NODE, [BOMBERS]);
    s.planets[NEAR_FRONT]!.owner = 'p1';
    const strikes = only(orders(s), 'shuttle.strike');
    expect(strikes.map((a) => a.payload)).toEqual([
      { fleetId: 'p2_front', squadronId: BOMBERS.id, targetPlanetId: NEAR_FRONT },
    ]);
    passes(s, strikes[0]!);
  });
});

describe('SHU-6.8 — патруль над базой, пока рядом враг', () => {
  it('чужой флот в радиусе перехватчиков — база поднимает удерживаемый патруль над собой', () => {
    const { s, home } = staged();
    home.hangar = [WING];
    fleetAt(s, 'p1_raid', 'p1', FRONT_NODE); // 128 от дома, радиус перехватчика 180
    const patrols = only(orders(s), 'shuttle.patrol');
    expect(patrols.map((a) => a.payload)).toEqual([
      { planetId: home.id, squadronId: WING.id, at: home.position, hold: true },
    ]);
    passes(s, patrols[0]!);
  });

  it('врага рядом нет — патруля нет: перехватчики встречают вылеты из ангара', () => {
    const { s, home } = staged();
    home.hangar = [WING];
    expect(only(orders(s), 'shuttle.patrol')).toEqual([]); // флот p1 у своего дома, в 366
  });

  it('корабль с перехватчиками в трюме держит патруль над собой', () => {
    const { s, home } = staged();
    fleetAt(s, 'p2_front', 'p2', FRONT_NODE, [WING]);
    fleetAt(s, 'p1_raid', 'p1', home.id); // 128 от корабля
    const at = s.planets[FRONT_NODE]!.position;
    const patrols = only(orders(s), 'shuttle.patrol');
    expect(patrols.map((a) => a.payload)).toEqual([
      { fleetId: 'p2_front', squadronId: WING.id, at, hold: true },
    ]);
    passes(s, patrols[0]!);
  });

  it('с базы, откуда в этот тик ушёл удар, патруль ждёт следующего тика: топливо общее', () => {
    const { s, home } = staged();
    home.hangar = [BOMBERS, WING];
    s.planets[FRONT_NODE]!.owner = 'p1';
    fleetAt(s, 'p1_raid', 'p1', FRONT_NODE);
    const out = orders(s);
    expect(only(out, 'shuttle.strike')).toHaveLength(1);
    expect(only(out, 'shuttle.patrol')).toEqual([]);
  });

  it('врага не стало — удержание снимается у патруля в воздухе, и ядро это принимает', () => {
    const { s, home } = staged();
    s.strikes = [patrolAloft(home)];
    const holds = only(orders(s), 'shuttle.hold');
    expect(holds.map((a) => a.payload)).toEqual([{ strikeId: 'strike:p2:0:1', on: false }]);
    passes(s, holds[0]!);
  });

  it('…и у эскадры, ждущей дома перезарядки', () => {
    const { s, home } = staged();
    home.hangar = [{ ...WING, hold: { at: { ...home.position } } }];
    const holds = only(orders(s), 'shuttle.hold');
    expect(holds.map((a) => a.payload)).toEqual([
      { planetId: home.id, squadronId: WING.id, on: false },
    ]);
    passes(s, holds[0]!);
  });

  it('враг рядом — удержание остаётся; вернулся к висящему патрулю — ставится обратно', () => {
    const { s, home } = staged();
    fleetAt(s, 'p1_raid', 'p1', FRONT_NODE);
    s.strikes = [patrolAloft(home)];
    expect(only(orders(s), 'shuttle.hold')).toEqual([]);
    s.strikes = [patrolAloft(home, { patrol: { hours: 4, radius: 60 } })];
    const holds = only(orders(s), 'shuttle.hold');
    expect(holds.map((a) => a.payload)).toEqual([{ strikeId: 'strike:p2:0:1', on: true }]);
    passes(s, holds[0]!);
  });

  it('патруль над другой точкой бот не снимает — его ставил не он', () => {
    const { s, home } = staged();
    s.strikes = [patrolAloft(home, { to: { x: home.position.x + 100, y: home.position.y } })];
    expect(only(orders(s), 'shuttle.hold')).toEqual([]);
  });
});

describe('SHU-6.8 — предел челноков считает трюмы и воздух', () => {
  const built = (s: GameState): string[] =>
    only(orders(s), 'unit.build').map((a) => (a.payload as { unit: string }).unit);

  it('перехватчики в патруле — новых порт не заказывает', () => {
    const { s, home } = staged();
    expect(built(s)).toContain('interceptor'); // пустой ангар — заказ есть
    s.strikes = [patrolAloft(home)];
    expect(built(s)).not.toContain('interceptor');
  });

  it('ударные в трюме корабля — новых порт не заказывает', () => {
    const { s, home } = staged();
    expect(built(s)).toContain('bomber');
    fleetAt(s, 'p2_front', 'p2', FRONT_NODE, [{ id: 'sq:b', units: [{ unit: 'bomber', count: 3 }] }]);
    expect(home.hangar ?? []).toEqual([]);
    expect(built(s)).not.toContain('bomber');
  });
});
