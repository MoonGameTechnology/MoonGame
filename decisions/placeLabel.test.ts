import { describe, expect, it } from 'vitest';
import { readdirSync, readFileSync } from 'node:fs';
import { placeKey, placeLabel, placeName } from './placeLabel';
import { setLocale } from '../localization/runtime';
import { ru } from '../localization/ru';
import { en } from '../localization/en';

// SZ-map-ids: карта забега подписывала места сырыми id данных (`home_a`, `pirate_den`),
// одинаково на обоих языках. Имя места — ключ локали, выведенный из id.

describe('имя места на карте', () => {
  it('ключ выводится из id сектора: подчёркивание → дефис', () => {
    expect(placeKey('home_a')).toBe('place.home-a');
    expect(placeKey('salvage_pocket')).toBe('place.salvage-pocket');
    expect(placeKey('hive')).toBe('place.hive');
  });

  it('у названного места — имя на языке игрока', () => {
    setLocale('ru');
    expect(placeLabel('home_a')).toBe(ru['place.home-a']);
    expect(placeName('pirate_den')).toBe(ru['place.pirate-den']);
    setLocale('en');
    expect(placeLabel('home_a')).toBe(en['place.home-a']);
    setLocale('ru');
  });

  it('координата основной игры — обозначение, а не имя: показывается как есть', () => {
    // Карты Фронтира нумеруют узлы сеткой («C2R1»); имени у них нет и не нужно.
    expect(placeName('C2R1')).toBeNull();
    expect(placeLabel('C2R1')).toBe('C2R1');
  });
});

describe('каждое место шипнутых карт названо в обеих локалях', () => {
  // Сторож со стороны ДАННЫХ: ключ строится из id, литерала в коде нет, и проверка
  // «ключ из кода заведён» его не видит. Без этого новая карта уехала бы к игроку с
  // сырыми id — ровно так и жили главы Sector Zero.
  const dir = new URL('../data/maps/', import.meta.url);
  const maps = readdirSync(dir).filter((f) => f.endsWith('.json'));

  it('разбор карт не пуст', () => {
    expect(maps).toContain('pve-1.json');
    expect(maps).toContain('pve-2.json');
  });

  for (const file of maps) {
    it(file, () => {
      const map = JSON.parse(readFileSync(new URL(file, dir), 'utf8')) as {
        sectors: Record<string, unknown>;
      };
      const ids = Object.keys(map.sectors);
      expect(ids.length).toBeGreaterThan(0);
      const missing = ids
        .map(placeKey)
        .filter((k) => !(k in ru) || !(k in en))
        .sort();
      expect(missing).toEqual([]);
    });
  }
});
