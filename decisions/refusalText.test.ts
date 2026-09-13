import { describe, expect, it } from 'vitest';
import { refusalKeyOf, refusalText } from './refusalText';
import { registerMessages, setLocale } from '../localization/core';

describe('имя отказа', () => {
  it('ключ выводится из кода, а не берётся из таблицы', () => {
    // Новый код не требует правки НИ ОДНОГО списка — только текста в локали.
    expect(refusalKeyOf('E_NO_CAPACITY')).toBe('err.no-capacity');
    expect(refusalKeyOf('E_INSUFFICIENT')).toBe('err.insufficient');
    // Код без префикса тоже разбирается: `E_` — соглашение, а не обязанность вызывающего.
    expect(refusalKeyOf('TIME_GAP')).toBe('err.time-gap');
  });

  it('перевод есть — показываем его', () => {
    registerMessages('ru', { 'err.no-capacity': 'трюм полон' });
    setLocale('ru');
    expect(refusalText('E_NO_CAPACITY')).toBe('трюм полон');
  });

  it('перевода нет — показываем САМ КОД словами, а не ключ', () => {
    // `err.totally-unknown` на экране выглядел бы поломкой; «totally unknown» — правдой.
    expect(refusalText('E_TOTALLY_UNKNOWN')).toBe('totally unknown');
  });
});
