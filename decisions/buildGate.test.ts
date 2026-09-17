/**
 * Механизм ворот на СИНТЕТИЧЕСКИХ данных: здесь видно, КАКОЕ из трёх правил сработало.
 * Сведение с настоящим редьюсером по шипнутому каталогу — соседний
 * `buildGateMirror.test.ts`; там ответ один на всю тройку (`E_WRONG_SECTOR`), и по нему
 * не отличить «сюда вообще не строят» от «это здание не для такой земли».
 */
import { describe, expect, it } from 'vitest';
import { parseGameData, type GameData } from '../packages/shared-core/src/index';
import { buildsAnything, canBuildHere } from './buildGate';

const data: GameData = parseGameData({
  version: '0.1.0',
  resources: ['metal'],
  units: {},
  factions: {},
  buildings: {
    mine: { name: 'Mine' },
    shipyard: { name: 'Shipyard' },
    // Здание, сузившее себя само (решение владельца 3) — как шипнутая добывающая станция.
    metal_station: { name: 'Metal Station', onlyOn: ['dead_world', 'void_station'] },
    // `onlyOn: []` — «не строится нигде»; так объявлено ядро крепости (решение 18).
    starfort: { name: 'Starfort', onlyOn: [] },
  },
  events: {},
  sectorKinds: {
    planet: {}, // застраиваемый и БЕЗ ростера — то есть «любое здание»
    void_station: { allowedBuildings: ['shipyard', 'metal_station'] },
    dead_world: { allowedBuildings: ['metal_station'] },
    nebula: { buildable: false }, // флаг без ростера — та самая форма из ORB-4
    empty: { allowedBuildings: [] },
  },
});

describe('buildGate — можно ли строить здесь (MIG-10)', () => {
  it('вид без ростера принимает всё, что не сузило себя само', () => {
    // Ровно то, что рукописный `BUILDABLE` прототипа терял: верфь редьюсер на планете
    // принимает, а кнопки не было.
    expect(canBuildHere({ kind: 'planet' }, 'shipyard', data)).toBe(true);
    expect(canBuildHere({ kind: 'planet' }, 'mine', data)).toBe(true);
  });

  it('ростер вида решает, ЧТО здесь стоит', () => {
    expect(canBuildHere({ kind: 'void_station' }, 'shipyard', data)).toBe(true);
    expect(canBuildHere({ kind: 'void_station' }, 'mine', data)).toBe(false);
  });

  it('`buildable: false` закрывает вид целиком — пустой ростер для этого не нужен', () => {
    expect(canBuildHere({ kind: 'nebula' }, 'mine', data)).toBe(false);
    expect(canBuildHere({ kind: 'nebula' }, 'shipyard', data)).toBe(false);
  });

  it('`onlyOn` держит здание вне вида, у которого ростера нет', () => {
    // Ростер тут бессилен по построению: у планеты его нет, и запретить станцию можно
    // было бы лишь выписав поимённо все ОСТАЛЬНЫЕ здания.
    expect(canBuildHere({ kind: 'planet' }, 'metal_station', data)).toBe(false);
    expect(canBuildHere({ kind: 'dead_world' }, 'metal_station', data)).toBe(true);
    expect(canBuildHere({ kind: 'void_station' }, 'metal_station', data)).toBe(true);
  });

  it('`onlyOn: []` не пускает никуда, включая вид без ростера', () => {
    expect(canBuildHere({ kind: 'planet' }, 'starfort', data)).toBe(false);
    expect(canBuildHere({ kind: 'void_station' }, 'starfort', data)).toBe(false);
  });

  it('узел без вида и незнакомый вид деградируют мягко — как и в ядре', () => {
    expect(canBuildHere({}, 'shipyard', data)).toBe(true);
    expect(canBuildHere({ kind: 'no_such_kind' }, 'shipyard', data)).toBe(true);
    // ...но «нигде» и «только там-то» их тоже касается: вида-то у узла нет.
    expect(canBuildHere({}, 'metal_station', data)).toBe(false);
    expect(canBuildHere({}, 'starfort', data)).toBe(false);
  });

  it('неизвестное здание — отказ, а не «ростер промолчал»', () => {
    expect(canBuildHere({ kind: 'planet' }, 'no_such_building', data)).toBe(false);
  });
});

describe('buildGate — есть ли тут стройка вообще', () => {
  it('пустой ростер и незастраиваемый вид дают «нет»', () => {
    expect(buildsAnything({ kind: 'empty' }, data)).toBe(false);
    expect(buildsAnything({ kind: 'nebula' }, data)).toBe(false);
  });

  it('вид с ростером и вид без ростера дают «да»', () => {
    expect(buildsAnything({ kind: 'dead_world' }, data)).toBe(true);
    expect(buildsAnything({ kind: 'planet' }, data)).toBe(true);
    expect(buildsAnything({}, data)).toBe(true);
  });

  it('вид, которому каталог не предлагает ничего, пуст — хотя ростера у него нет', () => {
    // Длина ростера на этот вопрос не отвечает: ростера НЕТ, а строить всё равно нечего,
    // потому что каждое здание каталога сузило себя мимо этого вида.
    const restricted: GameData = parseGameData({
      version: '0.1.0',
      resources: ['metal'],
      units: {},
      factions: {},
      buildings: { metal_station: { name: 'Metal Station', onlyOn: ['dead_world'] } },
      events: {},
      sectorKinds: { planet: {}, dead_world: {} },
    });
    expect(buildsAnything({ kind: 'planet' }, restricted)).toBe(false);
    expect(buildsAnything({ kind: 'dead_world' }, restricted)).toBe(true);
  });
});
