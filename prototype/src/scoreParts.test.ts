import { describe, expect, it } from 'vitest';
import { advance, data, newGame, scoreParts, START_CANDIDATES, DAY } from './game';
import type { SetupConfig } from './game';

const duel: SetupConfig = {
  seats: [
    { id: 'p1', name: 'A', faction: 'azure', start: START_CANDIDATES[0]!, ai: false },
    { id: 'p2', name: 'B', faction: 'crimson', start: START_CANDIDATES[1]!, ai: true },
  ],
};

describe('слагаемые счёта (BAL-5)', () => {
  it('РАЗЛОЖЕНИЕ СХОДИТСЯ СО СЧЁТОМ ЯДРА — иначе это вторая формула, и она разъедется', () => {
    // Ровно тот класс, которым проект уже наелся (блок CONV): считать одно и то же
    // двумя способами. Здесь сверка на ЖИВОМ матче, а не на синтетике.
    let state = newGame(duel);
    state = advance(state, 3 * DAY).state;
    const parts = scoreParts(state, data);
    const scores = state.match.scores ?? {};
    expect(Object.keys(parts).sort()).toEqual(['p1', 'p2']);
    for (const seat of ['p1', 'p2'] as const) {
      expect([seat, parts[seat]!.total]).toEqual([seat, scores[seat]?.total ?? 0]);
    }
  });

  it('счётчики провинций/флотов/юнитов совпадают с ядром', () => {
    let state = newGame(duel);
    state = advance(state, 2 * DAY).state;
    const parts = scoreParts(state, data);
    const scores = state.match.scores ?? {};
    for (const seat of ['p1', 'p2'] as const) {
      expect(parts[seat]!.planets).toBe(scores[seat]?.controlledPlanets ?? 0);
      expect(parts[seat]!.fleets).toBe(scores[seat]?.fleets ?? 0);
      expect(parts[seat]!.units).toBe(scores[seat]?.units ?? 0);
    }
  });

  it('ФЛОТ В СЧЁТ НЕ ВХОДИТ — это ответ кирпича, данный кодом, а не прогоном', () => {
    // «military never scores» (GDD §8.1): у места есть флоты и юниты, но `total`
    // складывается только из территории и построек.
    let state = newGame(duel);
    state = advance(state, 1 * DAY).state;
    const parts = scoreParts(state, data)['p1']!;
    expect(parts.fleets).toBeGreaterThan(0);
    expect(parts.units).toBeGreaterThan(0);
    expect(parts.total).toBe(parts.territory + parts.buildings);
  });

  it('на старте счёт — это территория; постройки приходят позже', () => {
    const parts = scoreParts(newGame(duel), data)['p1']!;
    expect(parts.territory).toBeGreaterThan(0);
    expect(parts.planets).toBeGreaterThan(0);
  });

  it('место без владений не даёт очков', () => {
    const state = newGame(duel);
    for (const planet of Object.values(state.planets)) {
      if (planet.owner === 'p2') planet.owner = null;
    }
    const parts = scoreParts(state, data)['p2']!;
    expect([parts.planets, parts.territory, parts.buildings, parts.total]).toEqual([0, 0, 0, 0]);
  });
});
