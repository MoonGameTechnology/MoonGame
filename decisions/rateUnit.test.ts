import { describe, expect, it } from 'vitest';

import { ru } from '../localization/ru';
import { en } from '../localization/en';
import {
  DEFAULT_RATE_UNIT,
  RATE_SUFFIX_KEY,
  RATE_UNITS,
  RATE_WORD_KEY,
  parseRateUnit,
  rateIn,
  shownRate,
} from './rateUnit';
import { runPerMinute } from './runClock';

describe('единица скорости ресурса (настройка «в час / в сутки»)', () => {
  it('по умолчанию — в час, как было до настройки', () => {
    expect(DEFAULT_RATE_UNIT).toBe('hour');
    expect(RATE_UNITS).toEqual(['hour', 'day']);
  });

  it('из хранилища читается только «day»; ключа нет или мусор — в час', () => {
    expect(parseRateUnit('day')).toBe('day');
    expect(parseRateUnit('hour')).toBe('hour');
    expect(parseRateUnit(null)).toBe('hour');
    expect(parseRateUnit(undefined)).toBe('hour');
    expect(parseRateUnit('DAY')).toBe('hour');
    expect(parseRateUnit('24')).toBe('hour');
  });

  it('выработка за час показывается за сутки в 24 раза больше', () => {
    expect(rateIn(12, 'hour', 'day')).toBe(288);
    expect(rateIn(12, 'hour', 'hour')).toBe(12);
  });

  it('суточное содержание в часовом показе — доля суток, а не то же число', () => {
    // Ровно эта ошибка жила в стройке и досье: «−40/ч» у здания, которое платит 40 в сутки.
    expect(rateIn(48, 'day', 'hour')).toBe(2);
    expect(rateIn(16, 'day', 'day')).toBe(16);
  });

  it('в забеге скорость за реальную минуту, что бы ни выбрал игрок', () => {
    expect(shownRate('day', true)).toBe('minute');
    expect(shownRate('hour', true)).toBe('minute');
    expect(shownRate('day', false)).toBe('day');
    expect(rateIn(12, 'hour', 'minute')).toBe(runPerMinute(12));
    expect(rateIn(48, 'day', 'minute')).toBe(runPerMinute(2));
  });

  it('у каждой единицы показа есть суффикс и слово в обеих локалях', () => {
    for (const key of [...Object.values(RATE_SUFFIX_KEY), ...Object.values(RATE_WORD_KEY)]) {
      expect(ru[key], key).toBeTruthy();
      expect(en[key], key).toBeTruthy();
    }
  });
});
