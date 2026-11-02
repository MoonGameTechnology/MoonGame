import { describe, expect, it } from 'vitest';

import { compactMatchNumberText, matchNumberText, parseMatchNumber } from './matchNumber';

describe('номер партии', () => {
  it('groups numeric numbers and abbreviates UUIDs only for display', () => {
    expect(compactMatchNumberText('48219370')).toBe('№ 48 219 370');
    const id = 'ava-12345678-1234-4abc-a123-12345678abcd';
    expect(compactMatchNumberText(id)).toBe('№ ava-12345678…abcd');
    expect(parseMatchNumber(id)).toBe(id);
    expect(compactMatchNumberText('proto')).toBe('№ proto');
  });
  it('правила 1–2: показываем номер, у старой партии — её id', () => {
    expect(matchNumberText('48219370')).toBe('№ 48219370');
    expect(matchNumberText('proto')).toBe('№ proto');
  });

  it('правило 3: поле прощает знак номера, пробелы и вставленный адрес', () => {
    expect(parseMatchNumber('48219370')).toBe('48219370');
    expect(parseMatchNumber('  № 48 219 370 ')).toBe('48219370');
    expect(parseMatchNumber('#48219370')).toBe('48219370');
    expect(parseMatchNumber('https://moon.example/game/48219370')).toBe('48219370');
    expect(parseMatchNumber('https://moon.example/dev/game/m-1a2b?slot=p2')).toBe('m-1a2b');
    expect(parseMatchNumber('proto')).toBe('proto');
  });

  it('правило 3: мусор — не номер', () => {
    expect(parseMatchNumber('')).toBeNull();
    expect(parseMatchNumber('   ')).toBeNull();
    expect(parseMatchNumber('48 21x 370')).toBeNull();
    expect(parseMatchNumber('../admin')).toBeNull();
    expect(parseMatchNumber('https://moon.example/game/%E0%A4%A')).toBeNull();
    expect(parseMatchNumber('9'.repeat(65))).toBeNull();
  });
});
