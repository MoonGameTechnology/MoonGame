import { describe, expect, it } from 'vitest';
import { AD_PLACEMENTS, adRefusalKey } from './adPlacements';

describe('YAG-3.2 — места rewarded-рекламы', () => {
  it('мест ровно пять — резолюции владельца §0.6а и 2026-09-24, у каждого свой постоянный id', () => {
    // Двойная награда, Суверены, обновление витрины, покупка лота (§0.6а) и Суверены прямо
    // в забеге (2026-09-24). Новое место — решение владельца, а не строчка кода.
    expect([...AD_PLACEMENTS].sort()).toEqual([
      'run.double',
      'run.sovereigns',
      'shop.lot',
      'shop.refresh',
      'shop.sovereigns',
    ]);
  });

  it('«не досмотрел» и «рекламы нет» — разные сообщения', () => {
    // Раньше оба читались «Реклама не показана», хотя в первом случае её показали.
    expect(adRefusalKey('cancelled')).not.toBe(adRefusalKey('unavailable'));
  });

  it('оба сообщения говорят, что ничего не списано', () => {
    // Ключи, а не текст: сам текст живёт в /localization и проверяется гейтом i18n.
    expect(adRefusalKey('cancelled')).toBe('sector-zero.ad.cancelled');
    expect(adRefusalKey('unavailable')).toBe('sector-zero.ad.unavailable');
  });
});
