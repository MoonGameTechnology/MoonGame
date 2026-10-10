// Армия под ветку (решение владельца 2026-10-08).
//
// Что здесь закрепляется. Доктрина места — ветка учёного его совета (`botDoctrine.ts`).
// Бот ведёт эту ветку вперёд цены, копит на её узел, когда доход закроет нехватку, и
// строит то, что ветка усиливает, ВМЕСТО крейсера: космос — тяжёлый крейсер на улучшенной
// верфи, на войне шаттлы — ударный челнок, земля — танк, пока их меньше, чем крейсеров;
// ракеты — минёр у каждого героя.
import { describe, expect, it } from 'vitest';
import { newGame, aiOrders, START_CANDIDATES } from './game';
import { data } from './gameData';
import type { Action, GameState, Planet } from '../../packages/shared-core/src/index';

const RICH = { credits: 4000, metal: 6000, food: 900, energy: 900, microelectronics: 400 };

/** Два бота; у p2 совет из одного учёного и казна `res`. Ворота дней сняты, чтобы
 *  узлы второго тира были открыты с первой минуты. */
function game2(scientist: string, res: Record<string, number> = RICH): GameState {
  const s = newGame({
    seats: [
      { id: 'p1', name: 'A', faction: 'azure', start: START_CANDIDATES[0]!, ai: true },
      { id: 'p2', name: 'B', faction: 'crimson', start: START_CANDIDATES[1]!, ai: true },
    ],
  });
  return {
    ...s,
    techRules: { dayGates: false, exclude: [] },
    players: {
      ...s.players,
      p2: { ...s.players.p2!, scientists: [{ id: scientist, level: 1 }], resources: { ...res } },
    },
  };
}

const orders = (s: GameState): Action[] => aiOrders(s, 'p2', 'expand', 'strong');
const only = (actions: Action[], type: string): Action[] => actions.filter((a) => a.type === type);
const researched = (s: GameState): string[] =>
  only(orders(s), 'technology.research').map(
    (a) => (a.payload as { technology: string }).technology,
  );
const home = (s: GameState): Planet =>
  Object.values(s.planets).find(
    (p) => p.owner === 'p2' && p.buildings.some((b) => b.type === 'shipyard'),
  )!;

/** Дом p2 с готовой цепочкой дохода, наземными цехами и верфью уровня `yard`. */
function developed(s: GameState, yard: number): GameState {
  const base = home(s);
  const extra = ['refinery', 'spaceport', 'tax_office', 'fabricator', 'barracks', 'factory'].map(
    (type) => ({
      type,
      level: 1,
      hp: data.buildings[type]!.hp,
    }),
  );
  const buildings = [
    ...base.buildings.map((b) => (b.type === 'shipyard' ? { ...b, level: yard } : b)),
    ...extra,
  ];
  return { ...s, planets: { ...s.planets, [base.id]: { ...base, buildings } } };
}

const done = (s: GameState, ...ids: string[]): GameState => ({
  ...s,
  players: { ...s.players, p2: { ...s.players.p2!, technologies: { completed: ids } } },
});

describe('исследования по доктрине', () => {
  it('узел своей ветки идёт вперёд более дешёвого чужого', () => {
    expect(researched(game2('wing_commodore'))).toEqual(['flight_decks']);
    // Генералист без ветки — прежний порядок по цене.
    expect(researched(game2('polymath'))).toEqual(['industrial_automation']);
  });

  it('на узел ветки, который доход закроет за 4 часа, бот копит: ни чужих узлов, ни войск', () => {
    // «Ударные векторы» стоят 280 кредитов, 220 металла и 30 микроэлектроники; с запасом
    // заказа металла недостаёт 30, а шахта дома даёт его каждый час.
    const s = done(game2('wing_commodore', { ...RICH, metal: 250 }), 'flight_decks');
    const acts = orders(s);
    expect(only(acts, 'technology.research')).toEqual([]);
    const metalUnits = only(acts, 'unit.build').filter(
      (a) => (data.units[(a.payload as { unit: string }).unit]?.cost.metal ?? 0) > 0,
    );
    expect(metalUnits).toEqual([]);
    // Металл набран — узел исследуется.
    expect(researched(done(game2('wing_commodore'), 'flight_decks'))).toEqual(['strike_vectors']);
  });

  it('копить не на что — бот берёт то, что по карману', () => {
    // Микроэлектроники нет и фабрикатора дома нет: нехватку доход не закроет никогда.
    const s = done(game2('wing_commodore', { ...RICH, microelectronics: 0 }), 'flight_decks');
    const picks = researched(s);
    expect(picks).toHaveLength(1);
    expect(data.technologies[picks[0]!]?.cost.microelectronics ?? 0).toBe(0);
  });
});

describe('армия под ветку', () => {
  it('космос улучшает верфь дома после цепочки дохода, ракеты — нет', () => {
    // Оба Носителя уже в гарнизоне: верфь под них поднимает своё правило (#1553), а здесь
    // проверяется только стапель ветки.
    const withCarriers = (s: GameState): GameState => {
      const base = home(s);
      const garrison = [...base.garrison, { unit: 'shuttle_carrier', count: 2 }];
      return { ...s, planets: { ...s.planets, [base.id]: { ...base, garrison } } };
    };
    const upgrades = (sci: string) =>
      only(orders(withCarriers(developed(game2(sci), 2))), 'building.upgrade').map(
        (a) => (a.payload as { building: string }).building,
      );
    expect(upgrades('void_admiral')).toContain('shipyard');
    expect(upgrades('ordnance_savant')).not.toContain('shipyard');
  });

  it('на верфи третьего уровня космос строит тяжёлый крейсер, прочие — крейсер', () => {
    const line = (sci: string) =>
      only(orders(developed(game2(sci), 3)), 'unit.build')
        .map((a) => (a.payload as { unit: string }).unit)
        .filter((u) => u === 'cruiser' || u === 'heavy_cruiser');
    expect(line('void_admiral')[0]).toBe('heavy_cruiser');
    expect(line('ordnance_savant')[0]).toBe('cruiser');
  });

  it('корпусов ветки не больше, чем крейсеров: дальше слот снова у крейсера', () => {
    const s = developed(game2('void_admiral'), 3);
    const count = (unit: string): number =>
      [
        ...Object.values(s.fleets)
          .filter((f) => f.owner === 'p2')
          .flatMap((f) => [...f.units, ...(f.landing ?? [])]),
        ...Object.values(s.planets)
          .filter((p) => p.owner === 'p2')
          .flatMap((p) => p.garrison),
      ].reduce((n, st) => n + (st.unit === unit ? st.count : 0), 0);
    const cruisers = count('cruiser');
    expect(cruisers).toBeGreaterThan(0);
    const fleet = Object.values(s.fleets).find((f) => f.owner === 'p2')!;
    const evened: GameState = {
      ...s,
      fleets: {
        ...s.fleets,
        [fleet.id]: {
          ...fleet,
          units: [...fleet.units, { unit: 'heavy_cruiser', count: cruisers }],
        },
      },
    };
    const line = only(orders(evened), 'unit.build')
      .map((a) => (a.payload as { unit: string }).unit)
      .filter((u) => u === 'cruiser' || u === 'heavy_cruiser');
    expect(line[0]).toBe('cruiser');
  });

  it('на войне слот крейсера получает ударный челнок у шаттлов и танк у земли', () => {
    const line = (sci: string) => {
      const s = developed(game2(sci), 2);
      const atWar: GameState = { ...s, diplomacy: { ...(s.diplomacy ?? {}), 'p1|p2': 'war' } };
      return only(orders(atWar), 'unit.build').map((a) => (a.payload as { unit: string }).unit)[0];
    };
    // Тяжёлый страйкер заперт «Ударными векторами» — слот берёт ударный.
    expect(line('wing_commodore')).toBe('bomber');
    expect(line('bastion_marshal')).toBe('tank');
    expect(line('ordnance_savant')).toBe('cruiser');
  });

  it('ракеты: минёра получает и следующий герой, а не только первый', () => {
    const miner = (sci: string): string[] => {
      const s = game2(sci);
      const first = only(orders(s), 'hero.install')[0]!.payload as { heroId: string };
      // Первый герой с минёром ушёл в поле: переоснастить его нельзя, очередь — за следующим.
      const staged: GameState = {
        ...s,
        heroes: {
          ...s.heroes,
          [first.heroId]: {
            ...s.heroes![first.heroId]!,
            modules: ['rocket_mine_layer'],
            fleetId: 'p2-1',
          },
        },
      };
      return only(orders(staged), 'hero.install').map(
        (a) => (a.payload as { moduleId: string }).moduleId,
      );
    };
    expect(miner('ordnance_savant')).toEqual(['rocket_mine_layer']);
    expect(miner('void_admiral')).not.toContain('rocket_mine_layer');
  });
});
