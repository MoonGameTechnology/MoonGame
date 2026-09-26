// SHU-5.6 — сильный бот и фаза 5 шаттлов (docs/shuttles-roadmap.md, §0.6).
//
// Четыре действия, каждое — до ответа ЯДРА, а не только до намерения бота:
//   • шаттл грузится в трюм корабля (SHU-5.1), а не только авианосца;
//   • десантный челнок заказывается с бойцом внутри (SHU-5.2);
//   • тяжёлый страйкер строится и поднимается в удар (§0.5);
//   • крейсер сходит со стапеля с ремонтным ангаром (SHU-5.4).
// Замер тех же четырёх действий на живых матчах — строка «фаза 5» в `pnpm run selfplay`.
import { describe, expect, it } from 'vitest';
import { newGame, aiOrders, START_CANDIDATES, kernel, ctx } from './game';
import { data } from './gameData';
import type { Action, GameState, Planet } from '../../packages/shared-core/src/index';

function game2(): GameState {
  return newGame({
    seats: [
      { id: 'p1', name: 'A', faction: 'azure', start: START_CANDIDATES[0]!, ai: true },
      { id: 'p2', name: 'B', faction: 'crimson', start: START_CANDIDATES[1]!, ai: true },
    ],
  });
}

/** Война, богатая казна, построенные порт и казармы у дома p2. */
function staged(opts: { war?: boolean; tech?: string[] } = {}): { s: GameState; home: Planet } {
  const g = game2();
  const s: GameState = {
    ...g,
    ...(opts.war !== false ? { diplomacy: { ...(g.diplomacy ?? {}), 'p1|p2': 'war' } } : {}),
    players: {
      ...g.players,
      p2: {
        ...g.players.p2!,
        resources: { credits: 6000, metal: 9000, food: 800, energy: 800, microelectronics: 400 },
        ...(opts.tech ? { technologies: { completed: opts.tech, active: [] } } : {}),
      },
    },
  };
  const home = Object.values(s.planets).find((p) => p.owner === 'p2')!;
  home.buildings = [
    ...home.buildings,
    { type: 'spaceport', level: 1, hp: data.buildings.spaceport!.hp },
    { type: 'barracks', level: 1, hp: data.buildings.barracks!.hp },
  ];
  return { s, home };
}

const only = (actions: Action[], type: string): Action[] => actions.filter((a) => a.type === type);
const builds = (s: GameState): Array<{ unit: string; modules?: string[]; troop?: string }> =>
  only(aiOrders(s, 'p2', 'expand', 'strong'), 'unit.build').map(
    (a) => a.payload as { unit: string; modules?: string[]; troop?: string },
  );
const passes = (s: GameState, a: Action): void => {
  const r = kernel.applyAction(s, a, ctx(s.time));
  expect(r.ok, r.ok ? '' : r.code).toBe(true);
};

/** Свой флот, стоящий у мира `at`. */
function fleetAt(
  s: GameState,
  id: string,
  at: string,
  units: Array<{ unit: string; count: number; modules?: string[] }>,
): void {
  s.fleets[id] = {
    id,
    owner: 'p2',
    location: at,
    movement: null,
    units,
    traits: [],
    battleId: null,
  } as GameState['fleets'][string];
}

describe('SHU-5.6 — шаттлы в трюме корабля', () => {
  it('авианосца нет — эскадра грузится в трюм КРЕЙСЕРА, и ядро это принимает', () => {
    const { s, home } = staged();
    home.hangar = [{ id: 'sq:b', units: [{ unit: 'bomber', count: 2 }] }];
    // Посеянный флот героя тоже несёт трюм — убираем его, чтобы спросить именно крейсер.
    for (const f of Object.values(s.fleets)) if (f.owner === 'p2') delete s.fleets[f.id];
    fleetAt(s, 'p2_line', home.id, [{ unit: 'cruiser', count: 1 }]);
    const loads = only(aiOrders(s, 'p2', 'expand', 'strong'), 'shuttle.load');
    expect(loads.map((a) => a.payload)).toEqual([{ fleetId: 'p2_line', squadronId: 'sq:b' }]);
    passes(s, loads[0]!);
  });

  it('из двух транспортов выбирается флот с РЕМОНТНЫМ АНГАРОМ, а не просторный трюм', () => {
    const { s, home } = staged();
    home.hangar = [{ id: 'sq:b', units: [{ unit: 'bomber', count: 2 }] }];
    fleetAt(s, 'p2_a', home.id, [{ unit: 'strike_carrier', count: 1 }]); // трюм 16
    fleetAt(s, 'p2_b', home.id, [{ unit: 'cruiser', count: 1, modules: ['repair_bay'] }]);
    const loads = only(aiOrders(s, 'p2', 'expand', 'strong'), 'shuttle.load');
    expect((loads[0]?.payload as { fleetId: string }).fleetId).toBe('p2_b');
    passes(s, loads[0]!);
  });

  it('флот, в чей трюм эскадра не влезает, не останавливает погрузку в соседний', () => {
    const { s, home } = staged();
    home.hangar = [{ id: 'sq:h', units: [{ unit: 'heavy_striker', count: 2 }] }]; // 4 места
    // Ремонтный крейсер впереди по рангу, но его 5 мест заняты десантом.
    fleetAt(s, 'p2_full', home.id, [{ unit: 'cruiser', count: 1, modules: ['repair_bay'] }]);
    s.fleets.p2_full!.landing = [{ unit: 'militia', count: 4 }];
    fleetAt(s, 'p2_roomy', home.id, [{ unit: 'strike_carrier', count: 1 }]);
    const loads = only(aiOrders(s, 'p2', 'expand', 'strong'), 'shuttle.load');
    expect((loads[0]?.payload as { fleetId: string }).fleetId).toBe('p2_roomy');
    passes(s, loads[0]!);
  });
});

describe('SHU-5.6 — десантный челнок с бойцом', () => {
  it('заказ челнока несёт бойца, и ядро его принимает', () => {
    const { s } = staged();
    const order = only(aiOrders(s, 'p2', 'expand', 'strong'), 'unit.build').find(
      (a) => (a.payload as { unit: string }).unit === 'landing_shuttle',
    );
    expect((order?.payload as { troop?: string }).troop).toBeTruthy();
    passes(s, order!);
  });
});

describe('SHU-5.6 — тяжёлый страйкер', () => {
  const TECH = ['flight_decks', 'strike_vectors'];

  it('«Ударные векторы» изучены — бот заказывает тяжёлого страйкера, и ядро принимает', () => {
    const { s } = staged({ tech: TECH });
    const order = only(aiOrders(s, 'p2', 'expand', 'strong'), 'unit.build').find(
      (a) => (a.payload as { unit: string }).unit === 'heavy_striker',
    );
    expect(order).toBeDefined();
    passes(s, order!);
  });

  it('технология не изучена — заказа нет, а не отказ ядра каждый тик', () => {
    expect(builds(staged().s).map((b) => b.unit)).not.toContain('heavy_striker');
  });

  it('в мирное время не строится — как и остальные ударные шаттлы', () => {
    expect(builds(staged({ war: false, tech: TECH }).s).map((b) => b.unit)).not.toContain(
      'heavy_striker',
    );
  });

  /** Чужой мир на расстоянии между радиусами ударного (150) и тяжёлого (260). */
  function farFoe(s: GameState, home: Planet): Planet {
    const dist = (p: Planet): number =>
      Math.hypot(p.position.x - home.position.x, p.position.y - home.position.y);
    const reachB = data.units.bomber!.stats.strikeRange!;
    const reachH = data.units.heavy_striker!.stats.strikeRange!;
    for (const p of Object.values(s.planets))
      if (p.owner === null && dist(p) <= reachB) p.owner = 'p2';
    const foe = Object.values(s.planets)
      .filter((p) => p.owner === null && dist(p) > reachB && dist(p) <= reachH)
      .sort((a, b) => dist(a) - dist(b) || (a.id < b.id ? -1 : 1))[0]!;
    foe.owner = 'p1';
    return foe;
  }

  it('цель дальше ударного, но в радиусе тяжёлого — удар уходит ТЯЖЁЛЫМ', () => {
    const { s, home } = staged();
    home.hangar = [
      { id: 'sq:b', units: [{ unit: 'bomber', count: 2 }] },
      { id: 'sq:h', units: [{ unit: 'heavy_striker', count: 1 }] },
    ];
    const foe = farFoe(s, home);
    const strikes = only(aiOrders(s, 'p2', 'expand', 'strong'), 'shuttle.strike');
    expect(strikes).toHaveLength(1);
    expect(strikes[0]!.payload).toMatchObject({ squadronId: 'sq:h', targetPlanetId: foe.id });
    passes(s, strikes[0]!);
  });

  it('тяжёлого нет — ударный не летит за пределы своего радиуса', () => {
    const { s, home } = staged();
    home.hangar = [{ id: 'sq:b', units: [{ unit: 'bomber', count: 2 }] }];
    farFoe(s, home);
    expect(only(aiOrders(s, 'p2', 'expand', 'strong'), 'shuttle.strike')).toEqual([]);
  });
});

describe('SHU-5.6 — ремонтный ангар', () => {
  const withBay = (b: { unit: string; modules?: string[] }): boolean =>
    b.unit === 'cruiser' && !!b.modules?.includes('repair_bay');

  it('на войне бот строит крейсер с ремонтным ангаром, и ядро принимает', () => {
    const { s } = staged();
    const order = only(aiOrders(s, 'p2', 'expand', 'strong'), 'unit.build').find((a) =>
      withBay(a.payload as { unit: string; modules?: string[] }),
    );
    expect(order).toBeDefined();
    passes(s, order!);
  });

  it('в мирное время — нет: вылетов нет, чинить в походе нечего', () => {
    expect(builds(staged({ war: false }).s).filter(withBay)).toEqual([]);
  });

  it('предел — два таких крейсера на империю', () => {
    const { s, home } = staged();
    fleetAt(s, 'p2_rb', home.id, [{ unit: 'cruiser', count: 2, modules: ['repair_bay'] }]);
    expect(builds(s).filter(withBay)).toEqual([]);
  });

  it('ИГРОВОЙ (слабый) бот ремонтный ангар не ставит', () => {
    const { s } = staged();
    const weak = only(aiOrders(s, 'p2', 'expand'), 'unit.build').map(
      (a) => a.payload as { unit: string; modules?: string[] },
    );
    expect(weak.filter(withBay)).toEqual([]);
  });
});
