import { describe, expect, it } from 'vitest';
import { newGame, economySnapshot, netIncome, HOUR, advance } from './game';
import { completedUnitSpend } from './economy';
import { data } from './gameData';
import { createKernel, constructionModule } from '../../packages/shared-core/src/index';
import { buildShip } from '../../decisions/actions';

describe('completed-unit spending in the economy report', () => {
  it.each([
    { unit: 'cruiser', modules: ['targeting_array'], troop: undefined },
    { unit: 'landing_shuttle', modules: [], troop: 'heavy_infantry' },
  ])('matches actual payment for two $unit including fittings or troops', (order) => {
    const state = newGame();
    state.pricing = {
      cost: { metal: 1.5, credits: 3, microelectronics: 2 },
      shipCost: { metal: 2.5, credits: 2, microelectronics: 1.5 },
    };
    state.players.p1!.resources = { metal: 10000, credits: 10000, microelectronics: 10000 };
    const before = { ...state.players.p1!.resources };
    const home = Object.values(state.planets).find((p) => p.owner === 'p1')!;
    home.buildings.push(
      { type: 'spaceport', level: 1, hp: 25 },
      { type: 'barracks', level: 1, hp: 25 },
    );
    const kernel = createKernel([constructionModule]);
    const built = kernel.applyAction(
      state, buildShip('p1', home.id, order.unit, 2, order.modules, order.troop),
      { now: state.time, data },
    );
    if (!built.ok) throw new Error(built.code);
    const end = built.state.scheduled.find((e) => e.type === 'construction.complete')!.at;
    const completed = kernel.advanceTo(built.state, { now: end, data });
    if (!completed.ok) throw new Error(completed.code);
    const event = completed.events.find((e) => e.type === 'unit.built')!;
    const reported = completedUnitSpend(completed.state,
      event.payload as Parameters<typeof completedUnitSpend>[1]);
    for (const resource of Object.keys(before))
      expect(reported[resource] ?? 0).toBe(before[resource]! - built.state.players.p1!.resources[resource]!);
  });
});

// ECON-6: почасовой экономический срез — чистая функция состояния для пайплайна
// наблюдений хоста (netserver onWake). Кривые (казна/приток/arrears) едут в
// JSONL, headline-счётчики — в MetricsAggregator (тест в packages/server).

describe('economySnapshot — срез экономики для метрик', () => {
  it('несёт казну (копией), netPerHour и arrears каждого игрока на state.time', () => {
    let s = newGame();
    s = advance(s, 5 * HOUR).state; // накопить производство
    const snap = economySnapshot(s);
    expect(snap.kind).toBe('economy');
    expect(snap.atTime).toBe(s.time);
    for (const pid of Object.keys(s.players)) {
      const row = snap.players[pid]!;
      expect(row.resources).toEqual(s.players[pid]!.resources);
      expect(row.netPerHour).toEqual(netIncome(s, pid));
      expect(row.arrears).toEqual(s.players[pid]!.arrears ?? []);
    }
    // копия, не ссылка: мутация среза не трогает состояние
    snap.players.p1!.resources.credits = -1;
    expect(s.players.p1!.resources.credits).not.toBe(-1);
  });

  it('отражает arrears игрока в недоимке', () => {
    const s = newGame();
    (s.players.p1! as { arrears?: string[] }).arrears = ['food', 'energy'];
    expect(economySnapshot(s).players.p1!.arrears).toEqual(['food', 'energy']);
  });
});

// Прогноз дохода — зеркало ядра: десант на плацдарме (MSB-9) платит содержание своему
// владельцу, как в `economy.upkeepByOwner` (замечание Codex на #1392).
describe('прогноз дохода видит десант на плацдарме', () => {
  it('войска на чужой земле снижают доход своего владельца', () => {
    const s = newGame();
    const enemy = Object.values(s.planets).find((p) => p.owner !== null && p.owner !== 'p1')!;
    const before = netIncome(s, 'p1').credits ?? 0;
    const landed = structuredClone(s);
    landed.planets[enemy.id]!.beachheads = [{ owner: 'p1', units: [{ unit: 'heavy_infantry', count: 4 }] }];
    expect(netIncome(landed, 'p1').credits ?? 0).toBeLessThan(before);
    expect(netIncome(landed, enemy.owner!)).toEqual(netIncome(s, enemy.owner!));
  });
});
