import { describe, expect, it } from 'vitest';
import { SWARM_LORE_KEYS, swarmLoreKnown } from './swarmLore';
import { en } from '../localization/en';
import { ru } from '../localization/ru';

describe('раздел «О Рое» — рассказ учёного после первой главы', () => {
  it('в первой главе забега раздела нет, после первой победы — есть', () => {
    expect(swarmLoreKnown({ chaptersWon: [] }, true)).toBe(false);
    expect(swarmLoreKnown({ chaptersWon: ['pve-1'] }, true)).toBe(true);
  });

  it('вне забега рассказчика нет — раздел виден всегда', () => {
    expect(swarmLoreKnown({ chaptersWon: [] }, false)).toBe(true);
  });

  it('реплики учёного есть в обеих локалях', () => {
    for (const key of SWARM_LORE_KEYS) {
      expect(ru[key], key).toBeTruthy();
      expect(en[key], key).toBeTruthy();
    }
  });
});
