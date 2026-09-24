import { describe, it, expect } from 'vitest';

import {
  DEFAULT_RUN_DIFFICULTY,
  RUN_DIFFICULTIES,
  nextRunDifficulty,
  parseRunDifficulty,
  runDifficultyAboutKey,
  runDifficultyKey,
  type RunDifficulty,
} from './runDifficulty';

describe('сложность забега (PVR-2.1)', () => {
  it('круг из двух значений замыкается', () => {
    expect(nextRunDifficulty('weak')).toBe('strong');
    expect(nextRunDifficulty('strong')).toBe('weak');
  });

  it('первый забег — обычный Рой', () => {
    expect(DEFAULT_RUN_DIFFICULTY).toBe('weak');
  });

  it('у каждого значения есть ключ, и ключи разные', () => {
    const keys = RUN_DIFFICULTIES.map(runDifficultyKey);
    expect(new Set(keys).size).toBe(keys.length);
    expect(keys).toEqual(['setup.pve.difficulty.weak', 'setup.pve.difficulty.strong']);
  });

  it('мусор из хранилища сводится к дефолту, а не уезжает в aiOrders как есть', () => {
    // localStorage — внешний вход: чужая версия, ручная правка, повреждение. Строка
    // «strongest» не должна доехать до бота и стать профилем, которого нет.
    for (const raw of [null, undefined, '', 'STRONG', 'strongest', '{}', 'weakish']) {
      expect([raw, parseRunDifficulty(raw)]).toEqual([raw, 'weak']);
    }
  });

  it('но своё же сохранённое значение переживает перезапуск', () => {
    for (const value of RUN_DIFFICULTIES) {
      expect(parseRunDifficulty(value as RunDifficulty)).toBe(value);
    }
  });
});

describe('пояснение уровня (заказ владельца 2026-09-23)', () => {
  it('у каждого уровня своё пояснение', () => {
    const keys = RUN_DIFFICULTIES.map(runDifficultyAboutKey);
    expect(keys).toEqual(['sector-zero.difficulty.about.weak', 'sector-zero.difficulty.about.strong']);
  });
});
