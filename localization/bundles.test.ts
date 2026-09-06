import { describe, it, expect } from 'vitest';
import { LOCALE_SOURCES, bakeMessages, bakedLocale } from './bundles';
import { LOCALE_IDS, DEFAULT_LOCALE } from './index';
import { ru } from './ru';
import { en } from './en';

// LOC-6: клиент качает РОВНО ОДНУ локаль, поэтому фолбэк на язык-источник больше
// нельзя оставлять на рантайм — он затянул бы русский в загрузку каждого игрока.
// Фолбэк запекается в локаль на сборке; эти тесты держат оба свойства такой сборки:
// список локалей не разъезжается с файлами, а запечённая карта самодостаточна.

describe('локали — список', () => {
  it('LOCALE_SOURCES описывает ровно те языки, что и LOCALE_IDS', () => {
    // Разъезд означает язык, который где-то числится, но не загружается (или
    // наоборот) — игрок увидит голые ключи.
    expect(Object.keys(LOCALE_SOURCES).sort()).toEqual([...LOCALE_IDS].sort());
  });
});

describe('запекание фолбэка', () => {
  it('локаль побеждает фолбэк, а недостающее берётся из него', () => {
    expect(bakeMessages({ a: 'локаль' }, { a: 'фолбэк', b: 'только фолбэк' })).toEqual({
      a: 'локаль',
      b: 'только фолбэк',
    });
  });

  it('запечённая локаль самодостаточна — в ней есть все ключи источника', () => {
    const baked = bakedLocale('en');
    expect(Object.keys(ru).filter((k) => !(k in baked))).toEqual([]);
  });

  it('запечённая локаль отдаёт СВОЙ перевод, а не текст источника', () => {
    expect(bakedLocale('en')['welcome.title']).toBe(en['welcome.title']);
    expect(bakedLocale('en')['welcome.new']).toBe(en['welcome.new']);
  });

  it('язык-источник запекается сам в себя без изменений', () => {
    expect(bakedLocale(DEFAULT_LOCALE)).toEqual(LOCALE_SOURCES[DEFAULT_LOCALE]);
  });
});
