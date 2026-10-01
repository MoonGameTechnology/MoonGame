import { describe, it, expect } from 'vitest';
import { data, newGame } from './game';
import { PLANET_TABS, buildRoster, garrisonByTab, tabCounts } from './planetTabs';
import type { Fleet, Planet, UnitStack } from '../../packages/shared-core/src/index';

const s = newGame();
const anyPlanet = Object.values(s.planets)[0]!;

const planet = (garrison: UnitStack[], buildings: Planet['buildings'] = []): Planet =>
  ({ ...anyPlanet, garrison, buildings }) as Planet;

const fleet = (id: string, units: UnitStack[] = []): Fleet =>
  ({ id, owner: 'p1', units }) as unknown as Fleet;

const ROSTER = [
  'cruiser',
  'scout',
  'siege',
  'shuttle_carrier',
  'interceptor',
  'militia',
  'tank',
];

describe('вкладка «Флот» не показывает гарнизон крепости кораблями (владелец 2026-09-26)', () => {
  it('гарнизон крепости и десант — на «Земле», во «Флоте» их нет', () => {
    const g = garrisonByTab(
      [
        { unit: 'garrison', count: 3 },
        { unit: 'drop_infantry', count: 2 },
      ],
      data,
    );
    expect(g.ground.map((st) => st.unit)).toEqual(['garrison', 'drop_infantry']);
    expect(g.ships).toEqual([]);
    expect(tabCounts(planet([{ unit: 'garrison', count: 3 }]), data, []).ships).toBe(0);
  });
});

describe('вкладки мира — разбор гарнизона', () => {
  const garrison: UnitStack[] = [
    { unit: 'tank', count: 2 },
    { unit: 'cruiser', count: 1 },
    { unit: 'interceptor', count: 3 },
    { unit: 'shuttle_carrier', count: 1 },
    { unit: 'militia', count: 4 },
  ];

  it('каждый стек попадает ровно в одну вкладку', () => {
    const g = garrisonByTab(garrison, data);
    expect(g.ground.map((st) => st.unit)).toEqual(['tank', 'militia']);
    // ROS-3.2: носитель — корабль, крылом остаются только сами машины.
    expect(g.ships.map((st) => st.unit)).toEqual(['cruiser', 'shuttle_carrier']);
    expect(g.wings.map((st) => st.unit)).toEqual(['interceptor']);
    expect(g.ground.length + g.ships.length + g.wings.length).toBe(garrison.length);
  });

  it('порядок стеков внутри вкладки — как в гарнизоне', () => {
    expect(garrisonByTab(garrison, data).ground.map((st) => st.unit)).toEqual(['tank', 'militia']);
  });

  it('пустой гарнизон даёт три пустых списка, а не отсутствие', () => {
    expect(garrisonByTab([], data)).toEqual({ ground: [], ships: [], wings: [] });
  });
});

describe('вкладки мира — счётчики', () => {
  it('ВКЛАДКА ФЛОТА СЧИТАЕТ И ОРБИТУ: построенное само уходит в космос', () => {
    const p = planet([{ unit: 'militia', count: 2 }]);
    const empty = tabCounts(p, data, []);
    const withOrbit = tabCounts(p, data, [
      fleet('f1', [{ unit: 'cruiser', count: 3 }]),
      fleet('f2', [{ unit: 'scout', count: 1 }]),
    ]);
    expect(empty.ships).toBe(0);
    expect(withOrbit.ships).toBe(4); // иначе над полной орбитой висел бы ноль
  });

  it('гарнизонные корабли складываются с кораблями флотов на орбите', () => {
    const p = planet([{ unit: 'cruiser', count: 1 }]);
    expect(tabCounts(p, data, [fleet('f1', [{ unit: 'cruiser', count: 2 }])]).ships).toBe(3);
  });

  // Переработка окна мира (2026-09-29): ряд фишек с юнитами над вкладками ушёл, и число
  // на вкладке — единственное число состава. Раньше вкладка считала стеки, а фишка над ней
  // — юниты, и «◆ 4» стояло над «Земля 2».
  it('счётчик считает ЮНИТЫ, а не стеки', () => {
    const p = planet([
      { unit: 'militia', count: 50 },
      { unit: 'tank', count: 2 },
    ]);
    expect(tabCounts(p, data, []).ground).toBe(52);
  });

  it('ЭСКАДРА СЧИТАЕТ АНГАР: челноки живут там, а не в гарнизоне (SHU-3.1)', () => {
    const p = {
      ...planet([]),
      hangar: [{ id: 'sq1', units: [{ unit: 'interceptor', count: 3 }] }],
    } as unknown as Planet;
    expect(tabCounts(p, data, []).shuttle).toBe(3);
  });

  it('постройки считаются своим числом', () => {
    const p = planet(
      [],
      [
        { type: 'mine', level: 1, hp: 100 },
        { type: 'radar', level: 1, hp: 100 },
      ],
    );
    expect(tabCounts(p, data, []).buildings).toBe(2);
  });

  it('крылья не попадают в счётчик кораблей', () => {
    const p = planet([{ unit: 'interceptor', count: 1 }]);
    const c = tabCounts(p, data, []);
    expect(c.shuttle).toBe(1);
    expect(c.ships).toBe(0);
  });

  it('А НОСИТЕЛЬ — НАОБОРОТ (ROS-3.2): он считается кораблём, а не крылом', () => {
    const c = tabCounts(planet([{ unit: 'shuttle_carrier', count: 1 }]), data, []);
    expect(c.ships).toBe(1);
    expect(c.shuttle).toBe(0);
  });

  it('у пустого мира счётчики нулевые по всем вкладкам', () => {
    const c = tabCounts(planet([]), data, []);
    for (const tab of PLANET_TABS) expect(c[tab]).toBe(0);
  });
});

describe('вкладки мира — ростер стройки', () => {
  it('вкладка предлагает строить ТО ЖЕ, что показывает', () => {
    expect(buildRoster('ground', ROSTER, data)).toEqual(['militia', 'tank']);
    expect(buildRoster('ships', ROSTER, data)).toEqual([
      'cruiser',
      'scout',
      'siege',
      'shuttle_carrier', // ROS-3.2: носитель заказывается среди кораблей
    ]);
    expect(buildRoster('shuttle', ROSTER, data)).toEqual(['interceptor']);
  });

  it('каждый юнит ростера попадает ровно в одну вкладку', () => {
    const seen = [
      ...buildRoster('ground', ROSTER, data),
      ...buildRoster('ships', ROSTER, data),
      ...buildRoster('shuttle', ROSTER, data),
    ];
    expect(seen.sort()).toEqual([...ROSTER].sort());
    expect(new Set(seen).size).toBe(ROSTER.length);
  });

  it('на вкладке построек юнитов не предлагают', () => {
    expect(buildRoster('buildings', ROSTER, data)).toEqual([]);
  });

  it('незнакомый юнит уходит к кораблям, а не теряется молча', () => {
    expect(buildRoster('ships', ['нет-такого'], data)).toEqual(['нет-такого']);
  });
});
