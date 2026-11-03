import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { lastRunWarrants, own, WARRANTS_PER_REWARD } from './sectorZeroRules';
import type { SectorZeroProgress } from './sectorZeroProgress';
import * as progress from './sectorZeroProgress';
import * as rules from './sectorZeroRules';

/** Импорты ЗНАЧЕНИЙ файла (без `import type`): только они дают круг при загрузке. */
function valueImports(file: string): string[] {
  const src = readFileSync(new URL(file, import.meta.url), 'utf8');
  return [...src.matchAll(/^import\s+(?!type\b)[^;]*?from\s+'([^']+)'/gms)].map((m) => m[1]!);
}

describe('sectorZeroRules — лист, который рвёт круг импорта профиля (SLIM-7)', () => {
  it('витрина, жетоны и найм не тянут значения из профиля обратно', () => {
    for (const file of ['./sectorZeroShop.ts', './heroTokens.ts', './heroRecruits.ts']) {
      expect(valueImports(file), file).not.toContain('./sectorZeroProgress');
    }
  });

  it('сам лист не импортирует значений из соседей по папке', () => {
    expect(valueImports('./sectorZeroRules.ts').filter((p) => p.startsWith('./'))).toEqual([]);
  });

  it('профиль реэкспортирует те же правила, а не свою копию', () => {
    expect(progress.newSectorHero).toBe(rules.newSectorHero);
    expect(progress.lastRunWarrants).toBe(rules.lastRunWarrants);
    expect(progress.sectorSkillLegal).toBe(rules.sectorSkillLegal);
    expect(progress.WARRANTS_PER_REWARD).toBe(rules.WARRANTS_PER_REWARD);
  });

  it('own берёт только собственный ключ таблицы (AUD-30)', () => {
    const table: Record<string, number> = { a: 1 };
    expect(own(table, 'a')).toBe(1);
    expect(own(table, 'constructor')).toBeUndefined();
    expect(own(table, 7)).toBeUndefined();
  });

  it('итог без разбивки считается по курсу награды', () => {
    const p = { lastReward: 3, lastRun: null, settledThrough: 2 } as unknown as SectorZeroProgress;
    expect(lastRunWarrants(p)).toBe(3 * WARRANTS_PER_REWARD);
  });
});
