import { describe, expect, it } from 'vitest';
import { SOLO_MIGRATIONS } from './soloSaveMigrationPairs';

/** Данные цепочки миграций сами по себе: логику чтения проверяет `soloSaveMigration.test.ts`. */
describe('пары релизов соло-сохранения', () => {
  it('каждая пара начинается там, где кончилась предыдущая', () => {
    SOLO_MIGRATIONS.slice(1).forEach((pair, i) => {
      const before = SOLO_MIGRATIONS[i]!;
      expect([pair.fromRules, pair.fromData, pair.fromDataHash]).toEqual([
        before.toRules,
        before.toData,
        before.toDataHash,
      ]);
    });
  });

  it('правила каждой пары — свой 14-символьный отпечаток, без повторов', () => {
    const rules = SOLO_MIGRATIONS.map((pair) => pair.toRules);
    for (const r of rules) expect(r).toMatch(/^[0-9a-f]{14}$/);
    expect(new Set(rules).size).toBe(rules.length);
  });
});
