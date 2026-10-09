// Ведущий не строит войска в долг и вкладывает лишний металл в доход; отстающий строит
// до последнего (решение владельца 2026-10-08).
//
// Что здесь закрепляется. Бот переводил лишний металл в ополчение и разведчиков, их
// содержание съедало кредиты, и на длинной партии место жило в долгах треть времени
// (`econplaytest 30 4 3`: медиана 274 ч из ~721). Теперь место, которое не отстаёт по
// очкам провинций, не заказывает войск, пока кредиты в долге или казны не хватит на
// `CREDIT_RUNWAY_HOURS` минуса, а лишний металл ведёт в переработку, налоговую и
// фабрикатор. Отстающему надо защищаться — для него ни то, ни другое не действует.
import { describe, expect, it } from 'vitest';
import { newGame, aiOrders, START_CANDIDATES } from './game';
import { netIncome } from './economy';
import type { GameState } from '../../packages/shared-core/src/index';

const RICH = { credits: 5000, metal: 5000, food: 5000, energy: 5000, microelectronics: 500 };

function base(): GameState {
  return newGame({
    seats: [
      { id: 'p1', name: 'A', faction: 'azure', start: START_CANDIDATES[0]!, ai: true },
      { id: 'p2', name: 'B', faction: 'crimson', start: START_CANDIDATES[1]!, ai: true },
    ],
  });
}

const homeOf = (s: GameState, who: string): string =>
  Object.values(s.planets).find((p) => p.owner === who && p.buildings.length > 0)!.id;

interface Seat {
  resources?: Record<string, number>;
  arrears?: string[];
  /** Ополченцев в гарнизоне дома: их содержание (8 кредитов в день) уводит поток в минус. */
  militia?: number;
  /** Отдать сопернику столько ничьих планет — место p2 начинает отставать по очкам. */
  rivalGains?: number;
  /** Переработка дома, уровень 1. */
  refinery?: boolean;
}

function seat(o: Seat = {}): GameState {
  const s = base();
  const home = homeOf(s, 'p2');
  const planets = { ...s.planets };
  const h = planets[home]!;
  planets[home] = {
    ...h,
    garrison: o.militia ? [...h.garrison, { unit: 'militia', count: o.militia }] : h.garrison,
    buildings: o.refinery ? [...h.buildings, { type: 'refinery', level: 1, hp: 20 }] : h.buildings,
  };
  const neutrals = Object.values(planets)
    .filter((p) => p.owner === null && p.kind === 'planet')
    .sort((a, b) => (a.id < b.id ? -1 : 1))
    .slice(0, o.rivalGains ?? 0);
  for (const p of neutrals) planets[p.id] = { ...p, owner: 'p1', garrison: [] };
  return {
    ...s,
    planets,
    players: {
      ...s.players,
      p2: {
        ...s.players.p2!,
        resources: o.resources ?? RICH,
        ...(o.arrears ? { arrears: o.arrears } : {}),
      },
    },
  };
}

const orders = (s: GameState) => aiOrders(s, 'p2', 'expand', 'strong');
const ofType = (s: GameState, type: string) => orders(s).filter((a) => a.type === type);

describe('ведущий не строит войска в долг, отстающий строит', () => {
  it('казна полна и поток не в минусе — войска заказывает', () => {
    expect(ofType(seat(), 'unit.build').length).toBeGreaterThan(0);
  });

  it('ведущий с кредитами в долге — ни одного заказа войск, постройки остаются', () => {
    const s = seat({ arrears: ['credits'] });
    expect(ofType(s, 'unit.build')).toEqual([]);
    expect(ofType(s, 'building.construct').length).toBeGreaterThan(0);
  });

  it('отстающий с кредитами в долге — войска заказывает', () => {
    expect(
      ofType(seat({ arrears: ['credits'], rivalGains: 6 }), 'unit.build').length,
    ).toBeGreaterThan(0);
  });

  it('поток в минусе: казны меньше чем на 48 часов — не заказывает, больше — заказывает', () => {
    const flow = netIncome(seat({ militia: 3000 }), 'p2').credits ?? 0;
    expect(flow).toBeLessThan(0);
    const withCredits = (credits: number) =>
      seat({ militia: 3000, resources: { ...RICH, credits } });
    expect(ofType(withCredits(Math.floor(-flow * 47)), 'unit.build')).toEqual([]);
    expect(ofType(withCredits(Math.ceil(-flow * 49)), 'unit.build').length).toBeGreaterThan(0);
  });
});

describe('ведущий вкладывает лишний металл в доход', () => {
  // Верфь поднимает правило Носителя (стапель 3-го уровня, `aiAir.test.ts`), а не доход.
  const upgrades = (s: GameState) =>
    ofType(s, 'building.upgrade')
      .map((a) => a.payload as { planetId: string; building: string })
      .filter((u) => u.building !== 'shipyard');

  it('металла с избытком — улучшает переработку дома', () => {
    const s = seat({ refinery: true });
    expect(upgrades(s)).toEqual([{ planetId: homeOf(s, 'p2'), building: 'refinery' }]);
  });

  it('металла меньше порога — не улучшает', () => {
    expect(upgrades(seat({ refinery: true, resources: { ...RICH, metal: 500 } }))).toEqual([]);
  });

  it('отстающий металл в доход не ведёт', () => {
    expect(upgrades(seat({ refinery: true, rivalGains: 6 }))).toEqual([]);
  });
});
