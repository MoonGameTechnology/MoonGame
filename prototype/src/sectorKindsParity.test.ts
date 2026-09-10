// ORB-1 — сторож на ТИХУЮ ЩЕДРОСТЬ ПЕРМИССИВНОГО ДЕФОЛТА.
//
// `SECTOR_TYPES` (map.ts) выводит игровые флаги вида узла из `data.sectorKinds` через
// резолвер ядра, а тот на НЕИЗВЕСТНЫЙ вид отвечает пермиссивным дефолтом — и в этом
// дефолте `orbit: true`. То есть вид, который прототип кладёт на карту, но каталог ядра
// не объявляет, ПОЛУЧАЕТ орбитальный слой молча: его можно бомбардировать, хотя решение
// владельца — «только планета и космическая крепость».
//
// Именно так и вышло: `ion_storm`, `dense_nebula` и `solar_flare` жили только в
// прототипной таблице, каталог о них не знал, и после ORB-1 туманность бомбардировать
// было нельзя, а ионный шторм — можно. Сторож ловит следующий такой вид на входе.
import { describe, expect, it } from 'vitest';
import { MAP, SECTOR_TYPES } from './map';
import { data } from './gameData';

describe('виды узлов прототипа объявлены в каталоге ядра', () => {
  it('КАЖДЫЙ вид из таблицы прототипа есть в data.sectorKinds', () => {
    const unknown = Object.keys(SECTOR_TYPES)
      .filter((kind) => data.sectorKinds[kind] === undefined)
      .sort();
    expect(unknown).toEqual([]);
  });

  it('и каждый вид, реально лежащий на карте, — тоже', () => {
    const unknown = [...new Set(MAP.map((n) => n.sector))]
      .filter((kind) => data.sectorKinds[kind] === undefined)
      .sort();
    expect(unknown).toEqual([]);
  });

  it('ОРБИТАЛЬНЫЙ СЛОЙ НА ЖИВОЙ КАРТЕ НЕСУТ ТОЛЬКО ПЛАНЕТЫ', () => {
    // Крепости на генерируемой карте нет (пустых узлов генератор не делает — см.
    // fortress-roadmap.md), поэтому здесь остаётся ровно `planet`.
    const withLayer = [
      ...new Set(MAP.filter((n) => SECTOR_TYPES[n.sector]?.orbit).map((n) => n.sector)),
    ].sort();
    expect(withLayer).toEqual(['planet']);
  });
});
