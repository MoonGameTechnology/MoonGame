import { describe, it, expect } from 'vitest';
import { SCORE_LIMIT } from './game';

// Порог победы по очкам — конфиг матча прототипа (`protoKernel.ts`), а не механика
// ядра: `victoryModule` читает его из `ctx.config.victory.scoreLimit`. Проверка жила
// в `tax.test.ts` и переехала сюда вместе со сведением налога в ядро (CONV-3) —
// налоговых тестов у прототипа больше нет, а этот к налогу и не относился.

describe('victory score limit', () => {
  it('sits below the ~60% domination line so the score race can resolve first', () => {
    expect(SCORE_LIMIT).toBe(1100);
    expect(SCORE_LIMIT).toBeLessThan(0.6 * 2410); // 2410 = board base points
  });
});
