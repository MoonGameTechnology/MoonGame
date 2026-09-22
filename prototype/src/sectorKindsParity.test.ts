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

  it('СТРОЙКА НА ЖИВОЙ КАРТЕ: у планеты ростера нет, у астероида — только добыча', () => {
    // ORB-4. Тот же сторож, следующий флаг. ORB-1 завёл этот файл ровно против тихой
    // щедрости дефолта, но проверил ею только `orbit` — а `buildable` и ростер остались
    // без утверждения, и астероидное поле принимало все двадцать зданий каталога.
    //
    // Смотрит РОСТЕР, а не итог: третий гейт стройки — `buildings[id].onlyOn`, правило со
    // стороны здания, — отсюда не виден, и `ЛЮБОЕ` у планеты значит «своего списка нет»,
    // а не «пройдёт что угодно» (добывающую станцию планета не примет). Итог целиком
    // меряет голдён-таблица ядра через настоящий редьюсер.
    const built = Object.fromEntries(
      [...new Set(MAP.map((n) => n.sector))].sort().map((kind) => {
        const type = SECTOR_TYPES[kind];
        const roster = type?.buildable === false ? [] : (type?.allowedBuildings ?? ['ЛЮБОЕ']);
        return [kind, roster];
      }),
    );
    expect(built).toEqual({
      planet: ['ЛЮБОЕ'],
      asteroid: ['metal_station'],
      nebula: [],
      dead_world: ['metal_station'],
      graveyard: [],
      ion_storm: [],
      dense_nebula: [],
      solar_flare: [],
    });
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
