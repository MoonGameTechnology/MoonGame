import { describe, expect, it } from 'vitest';
import { newGame, economySnapshot, netIncome, HOUR, advance } from './game';

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
