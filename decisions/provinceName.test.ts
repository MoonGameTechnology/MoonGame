/**
 * ИМЕНА ПРОВИНЦИЙ (PVR-6.19): ключ из карты и узла, полнота имён карт глав, запасной
 * текст там, где имён нет.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { provinceKey, provinceName } from './provinceName';
import { setLocale } from '../localization/core';
import { ru } from '../localization/ru';
import { en } from '../localization/en';
import { shippedGameData } from '../data/bundle';
import { PVE_MISSION_COUNT, pveState } from '../packages/client/src/gameData';
import testbed from '../data/maps/duel-testbed.json';

const data = shippedGameData();
/** Карты глав — ровно те, что открывает дверь Sector Zero, а не список рядом. */
const chapters = Array.from({ length: PVE_MISSION_COUNT }, (_, i) => pveState(data, i));

afterEach(() => setLocale('ru'));

describe('ключ имени провинции', () => {
  it('выводится из карты и узла: подчёркивания узла — в дефисы', () => {
    expect(provinceKey('pve-1', 'home_a')).toBe('province.pve-1.home-a');
    expect(provinceKey('pve-2', 'spore_cloud')).toBe('province.pve-2.spore-cloud');
  });

  it('один и тот же узел на разных картах — разные ключи', () => {
    // `drift` и `home_a` стоят и в главе I, и в дуэли: имя одной карты не должно
    // приклеиться к другой.
    expect(provinceKey('pve-1', 'drift')).not.toBe(provinceKey('ava-duel-1', 'drift'));
  });
});

describe('имена карт глав', () => {
  it('каждая провинция каждой главы названа на обоих языках', () => {
    expect(chapters.length).toBeGreaterThan(1);
    const missing: string[] = [];
    for (const s of chapters) {
      expect(s.mapId, 'у главы нет mapId — имя искать не по чему').toBeTruthy();
      for (const id of Object.keys(s.planets)) {
        const key = provinceKey(s.mapId!, id);
        if (!(key in ru) || !(key in en)) missing.push(key);
      }
    }
    expect(missing).toEqual([]);
  });

  it('в главе нет двух провинций с одним именем — их было бы не различить', () => {
    for (const s of chapters)
      for (const table of [ru, en]) {
        const names = Object.keys(s.planets).map((id) => table[provinceKey(s.mapId!, id)]);
        expect(new Set(names).size).toBe(names.length);
      }
  });

  it('в локалях нет имён несуществующих провинций', () => {
    // Префикс `province.` разбор ключей пропускает как собранный в рантайме, поэтому
    // имя переименованного узла осталось бы в локали навсегда. Держим здесь.
    // Имена есть у карт глав и у тестовой дуэли (M2.14); полноту её имён держит
    // `data/duelTestbed.test.ts`.
    const real = new Set([
      ...chapters.flatMap((s) => Object.keys(s.planets).map((id) => provinceKey(s.mapId!, id))),
      ...Object.keys(testbed.sectors).map((id) => provinceKey(testbed.id, id)),
    ]);
    const stale = Object.keys(ru).filter((k) => k.startsWith('province.') && !real.has(k));
    expect(stale).toEqual([]);
  });
});

describe('имя для игрока', () => {
  it('на языке игрока', () => {
    setLocale('en');
    expect(provinceName('pve-1', 'home_a')).toBe(en['province.pve-1.home-a']);
    setLocale('ru');
    expect(provinceName('pve-1', 'home_a')).toBe(ru['province.pve-1.home-a']);
  });

  it('нет имени — null, а не ключ: песочница, чужая карта, лишний узел', () => {
    expect(provinceName(undefined, 'home_a')).toBeNull();
    expect(provinceName('skirmish-1', 'home_green')).toBeNull();
    expect(provinceName('pve-1', 'C2R1')).toBeNull();
  });
});
