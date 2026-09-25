import { describe, expect, it } from 'vitest';
import { LOCALE_IDS } from '../localization/index';
import { localeChanges, localeOptions } from './localeMenu';

describe('список языков', () => {
  it('все языки в порядке LOCALE_IDS, от текущего порядок не зависит', () => {
    for (const current of LOCALE_IDS)
      expect(localeOptions(current).map((o) => o.id)).toEqual(LOCALE_IDS);
  });

  it('текущий язык отмечен ровно один раз', () => {
    for (const current of LOCALE_IDS) {
      const marked = localeOptions(current).filter((o) => o.current);
      expect(marked.map((o) => o.id)).toEqual([current]);
    }
  });

  it('подпись — на самом языке', () => {
    expect(localeOptions('ru').find((o) => o.id === 'en')?.label).toBe('ENGLISH');
  });

  it('выбор текущего языка не перезагружает страницу', () => {
    expect(localeChanges('ru', 'ru')).toBe(false);
    expect(localeChanges('ru', 'en')).toBe(true);
  });
});
