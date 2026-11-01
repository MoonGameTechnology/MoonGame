import { describe, expect, it } from 'vitest';
import { freshTargets, scoutParts } from './scoutReport';

describe('scoutReport — разведка в журнале', () => {
  it('новые цели: не названные раньше и прошедшие фильтр (правила 1, 3)', () => {
    const seen = new Set(['a']);
    expect(freshTargets(seen, ['a', 'b', 'c', 'd'], (id) => id !== 'c')).toEqual(['b', 'd']);
    expect([...seen]).toEqual(['a']); // запоминает зовущий
  });

  it('строка мира: гарнизон, постройки с уровнями, орбита (правило 4)', () => {
    expect(
      scoutParts({
        garrison: 12,
        buildings: [
          { name: 'Шахта', level: 2 },
          { name: 'Верфь', level: 1 },
        ],
        fleets: 2,
        ships: 9,
      }),
    ).toEqual([
      { key: 'log.scout.garrison', params: { n: 12 } },
      { key: 'log.scout.buildings', params: { list: 'Шахта 2, Верфь 1' } },
      { key: 'log.scout.orbit', params: { n: 2, k: 9 } },
    ]);
  });

  it('пустой мир называется пустым, орбиты без флотов нет', () => {
    expect(scoutParts({ garrison: 0, buildings: [], fleets: 0, ships: 0 })).toEqual([
      { key: 'log.scout.no-garrison' },
      { key: 'log.scout.no-buildings' },
    ]);
  });
});
