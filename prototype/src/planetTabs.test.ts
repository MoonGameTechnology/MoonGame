import { describe, it, expect } from 'vitest';
import { data, newGame } from './game';
import { PLANET_TABS, buildRoster, garrisonByTab, tabCounts } from './planetTabs';
import type { Fleet, Planet, UnitStack } from '../../packages/shared-core/src/index';

const s = newGame();
const anyPlanet = Object.values(s.planets)[0]!;

const planet = (garrison: UnitStack[], buildings: Planet['buildings'] = []): Planet =>
  ({ ...anyPlanet, garrison, buildings }) as Planet;

const fleet = (id: string): Fleet => ({ id, owner: 'p1', units: [] }) as unknown as Fleet;

const ROSTER = [
  'cruiser',
  'scout',
  'siege',
  'strike_carrier',
  'fighter_squadron',
  'militia',
  'tank',
];

describe('вкладки мира — разбор гарнизона', () => {
  const garrison: UnitStack[] = [
    { unit: 'tank', count: 2 },
    { unit: 'cruiser', count: 1 },
    { unit: 'fighter_squadron', count: 3 },
    { unit: 'strike_carrier', count: 1 },
    { unit: 'militia', count: 4 },
  ];

  it('каждый стек попадает ровно в одну вкладку', () => {
    const g = garrisonByTab(garrison, data);
    expect(g.ground.map((st) => st.unit)).toEqual(['tank', 'militia']);
    expect(g.ships.map((st) => st.unit)).toEqual(['cruiser']);
    expect(g.wings.map((st) => st.unit)).toEqual(['fighter_squadron', 'strike_carrier']);
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
    const withOrbit = tabCounts(p, data, [fleet('f1'), fleet('f2')]);
    expect(empty.ships).toBe(0);
    expect(withOrbit.ships).toBe(2); // иначе над полной орбитой висел бы ноль
  });

  it('гарнизонные корабли складываются с флотами на орбите', () => {
    const p = planet([{ unit: 'cruiser', count: 1 }]);
    expect(tabCounts(p, data, [fleet('f1')]).ships).toBe(2);
  });

  it('счётчик считает СТЕКИ, а не головы — вкладка показывает строки', () => {
    const p = planet([{ unit: 'militia', count: 50 }]);
    expect(tabCounts(p, data, []).ground).toBe(1);
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
    const p = planet([{ unit: 'strike_carrier', count: 1 }]);
    const c = tabCounts(p, data, []);
    expect(c.squadron).toBe(1);
    expect(c.ships).toBe(0);
  });

  it('у пустого мира счётчики нулевые по всем вкладкам', () => {
    const c = tabCounts(planet([]), data, []);
    for (const tab of PLANET_TABS) expect(c[tab]).toBe(0);
  });
});

describe('вкладки мира — ростер стройки', () => {
  it('вкладка предлагает строить ТО ЖЕ, что показывает', () => {
    expect(buildRoster('ground', ROSTER, data)).toEqual(['militia', 'tank']);
    expect(buildRoster('ships', ROSTER, data)).toEqual(['cruiser', 'scout', 'siege']);
    expect(buildRoster('squadron', ROSTER, data)).toEqual(['strike_carrier', 'fighter_squadron']);
  });

  it('каждый юнит ростера попадает ровно в одну вкладку', () => {
    const seen = [
      ...buildRoster('ground', ROSTER, data),
      ...buildRoster('ships', ROSTER, data),
      ...buildRoster('squadron', ROSTER, data),
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
