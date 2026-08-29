import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { loadGameData, parseGameData, type GameData } from '../../packages/shared-core/src/index';
import { data as protoData } from './prototypeData';
import { contentDivergences, parityDrift, parseBaseline } from './contentParity';

/** Минимальный валидный каталог, поверх которого лепятся синтетические случаи. */
const catalog = (over: Record<string, unknown> = {}): GameData =>
  parseGameData({
    version: 'test',
    resources: ['metal'],
    units: {},
    factions: {},
    buildings: {},
    events: {},
    ...over,
  });

const unit = (over: Record<string, unknown> = {}): Record<string, unknown> => ({
  faction: 'test',
  stats: { attack: 1, defense: 1, hp: 1, speed: 1 },
  cost: { metal: 1 },
  buildTimeHours: 1,
  ...over,
});

describe('что считается расхождением каталогов (CONV-11)', () => {
  it('одинаковые каталоги не расходятся ни в чём', () => {
    expect(contentDivergences(catalog(), catalog())).toEqual([]);
  });

  it('сущность есть только в одном каталоге — с какой стороны, видно из строки', () => {
    expect(contentDivergences(catalog({ units: { scout: unit() } }), catalog())).toEqual([
      'units/scout only-in-prototype',
    ]);
    expect(contentDivergences(catalog(), catalog({ units: { scout: unit() } }))).toEqual([
      'units/scout only-in-canon',
    ]);
  });

  it('ПОЛЕ, А НЕ СУЩНОСТЬ: иначе новое расхождение спрячется за уже записанным', () => {
    // Строка `units/frigate` в базовом списке уже стояла бы из-за `stats`; при
    // сущностной гранулярности разошедшийся следом `buildTimeHours` прошёл бы молча.
    const proto = catalog({ units: { frigate: unit({ stats: { attack: 9, defense: 1, hp: 1, speed: 1 }, buildTimeHours: 5 }) } });
    const canon = catalog({ units: { frigate: unit() } });
    expect(contentDivergences(proto, canon)).toEqual([
      'units/frigate field:buildTimeHours',
      'units/frigate field:stats',
    ]);
  });

  it('порядок ключей внутри определения — не расхождение', () => {
    const proto = catalog({ units: { frigate: { ...unit(), cost: { metal: 1 } } } });
    const canon = catalog({ units: { frigate: { cost: { metal: 1 }, ...unit() } } });
    expect(contentDivergences(proto, canon)).toEqual([]);
  });

  it('ресурсы сравниваются как множество идентификаторов', () => {
    expect(contentDivergences(catalog(), catalog({ resources: ['metal', 'food'] }))).toEqual([
      'resources/food only-in-canon',
    ]);
  });

  it('ВЕРСИЯ БАНДЛА НЕ СРАВНИВАЕТСЯ: она различается по определению', () => {
    // Иначе список краснел бы на каждом релизе канона, ничего не говоря о дрейфе.
    const proto = parseGameData({ ...catalog(), version: '0.1.0' });
    const canon = parseGameData({ ...catalog(), version: '9.9.9' });
    expect(contentDivergences(proto, canon)).toEqual([]);
  });

  it('разделы-объекты сравниваются по полям, а не по ключам сущностей', () => {
    expect(contentDivergences(catalog({ market: { goods: ['metal'] } }), catalog())).toEqual([
      'market field:goods',
    ]);
  });
});

describe('чем нынешний список отличается от базового (CONV-11)', () => {
  it('НОВОЕ расхождение — дрейф вырос', () => {
    expect(parityDrift(['a', 'b'], ['a'])).toEqual({ added: ['b'], gone: [] });
  });

  it('ИСЧЕЗНУВШЕЕ расхождение тоже валит: устаревший список врёт о размере долга', () => {
    expect(parityDrift(['a'], ['a', 'b'])).toEqual({ added: [], gone: ['b'] });
  });

  it('совпадение — тишина', () => {
    expect(parityDrift(['a', 'b'], ['b', 'a'])).toEqual({ added: [], gone: [] });
  });

  it('базовый список читается как `.trivyignore`: комментарии и пустые строки — не записи', () => {
    expect(parseBaseline('# заголовок\n\nunits/scout only-in-prototype\n  \n# хвост\n')).toEqual([
      'units/scout only-in-prototype',
    ]);
  });
});

describe('СТОРОЖ: дрейф двух каталогов не растёт (CONV-11)', () => {
  it('расхождения совпадают с базовым списком строка в строку', () => {
    const canon = loadGameData((name) => JSON.parse(readFileSync(`data/${name}`, 'utf8')));
    const baseline = parseBaseline(readFileSync('prototype/content-parity-baseline.txt', 'utf8'));
    const { added, gone } = parityDrift(contentDivergences(protoData, canon), baseline);
    expect(
      { added, gone },
      'Каталоги разошлись сильнее (added) или сошлись (gone). Новое расхождение ЧИНЯТ, ' +
        'а не дописывают в базовый список; закрытое — убирают из него тем же PR. ' +
        'Подробности — в шапке prototype/content-parity-baseline.txt.',
    ).toEqual({ added: [], gone: [] });
  });
});
