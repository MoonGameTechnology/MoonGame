import { describe, it, expect } from 'vitest';
import { newGame, capitalOf, START_CANDIDATES } from './game';

// Сам МОДУЛЬ столицы живёт в ядре и там же проверяется (CONV-4 снял копию
// прототипа) — назначение, перенаведение героев и отказы покрыты
// `packages/shared-core/src/modules/capital.test.ts`.
// Здесь остаётся то, что к модулю не относится и живёт только у прототипа:
// РАССТАНОВКА при старте партии (`newGame`/`matchSetup` засевает `state.capital`).

const HOME = START_CANDIDATES[0]!; // p1 homeworld
const ENEMY = START_CANDIDATES[1]!; // p2 homeworld

describe('capital — расстановка при старте партии', () => {
  it('по умолчанию столица — родной мир игрока', () => {
    expect(capitalOf(newGame(), 'p1')).toBe(HOME);
    expect(capitalOf(newGame(), 'p2')).toBe(ENEMY);
  });
});
