import { describe, it, expect } from 'vitest';
import { shippedGameData } from '../data/bundle';
import {
  changeSectorZeroProgress,
  freshSectorZeroProgress,
  type SectorZeroProgress,
} from './sectorZeroProgress';
import { advanceShopDay, shopRows, type ShopCapabilities } from './sectorZeroShop';
import { parseSectorZeroProgress } from './sectorZeroProgress';

const data = shippedGameData();
const ALL: ShopCapabilities = { sovereigns: true, ads: true };
const NONE: ShopCapabilities = { sovereigns: false, ads: false };
const profile = (over: Partial<SectorZeroProgress> = {}): SectorZeroProgress => ({
  ...freshSectorZeroProgress(data, 'shopper'),
  ...over,
});
/** Витрина ротируется посуточно (`SZE-3.2`), поэтому нужный лот ищется по дню, а не
 *  предполагается на месте: иначе тест проверял бы удачу ротации, а не правило. */
const dayWith = (p: SectorZeroProgress, id: string): SectorZeroProgress => {
  for (let day = 0; day < 400; day++) {
    const on = { ...p, day };
    if (shopRows(on, data, ALL).some((r) => r.id === id)) return on;
  }
  throw new Error(`лот ${id} не выпал ни на одни сутки из 400 — проверь веса`);
};
const row = (p: SectorZeroProgress, caps: ShopCapabilities, id: string) =>
  shopRows(dayWith(p, id), data, caps).find((r) => r.id === id)!;
const priceOf = (p: SectorZeroProgress, caps: ShopCapabilities, id: string, kind: string) =>
  row(p, caps, id).prices.find((x) => x.kind === kind)!;

describe('sectorZeroShop — витрина знает, чем можно платить', () => {
  it('способы оплаты приходят ИЗ ДАННЫХ, а не из веток в коде', () => {
    // `warrants_pack` продаётся только за Суверены, `data_small` — за Варранты и рекламу.
    expect(row(profile(), ALL, 'warrants_pack').prices.map((x) => x.kind)).toEqual(['sovereigns']);
    expect(row(profile(), ALL, 'data_small').prices.map((x) => x.kind).sort()).toEqual([
      'ad',
      'warrants',
    ]);
  });

  it('недоступная площадкой оплата ОТКАЗАНА, а не выдумана', () => {
    // `platform-adapters.md`: отсутствие рекламы — нормальное состояние, а не поломка.
    const p = profile({ warrants: 9999, sovereigns: 9999 });
    expect(priceOf(p, NONE, 'data_small', 'ad').reason).toBe('E_SHOP_UNAVAILABLE');
    expect(priceOf(p, NONE, 'warrants_pack', 'sovereigns').reason).toBe('E_SHOP_UNAVAILABLE');
    expect(priceOf(p, ALL, 'data_small', 'ad').can).toBe(true);
  });

  it('цена видна, даже когда платить нечем', () => {
    const cost = priceOf(profile({ warrants: 0 }), ALL, 'data_small', 'warrants');
    expect([cost.amount > 0, cost.can, cost.reason]).toEqual([true, false, 'E_SHOP_NOT_ENOUGH']);
  });

  it('открытый модуль продаётся ДУБЛЕМ — материалом для редкости (SZE-5.3)', () => {
    // Решение владельца 2026-09-24: раньше открытое гасло «уже есть».
    const p = profile({ warrants: 9999, modules: ['cargo_bay', 'ion_engine', 'radar_module'] });
    expect(row(p, ALL, 'radar_module').owned).toBe(true);
    expect(priceOf(p, ALL, 'radar_module', 'warrants').can).toBe(true);
    const bought = changeSectorZeroProgress(
      dayWith(p, 'radar_module'),
      { kind: 'buy', id: 'radar_module', pay: 'warrants' },
      data,
    )!;
    expect(bought.modules.filter((id) => id === 'radar_module')).toHaveLength(1);
    expect(bought.moduleCopies.radar_module).toBe(1);
  });

  it('лот чертежа кладёт чертёж своей ступени', () => {
    const p = profile({ sovereigns: 999 });
    const bought = changeSectorZeroProgress(
      dayWith(p, 'blueprint_mythic'),
      { kind: 'buy', id: 'blueprint_mythic', pay: 'sovereigns' },
      data,
    )!;
    expect(bought.blueprints).toEqual({ mythic: 1 });
    expect(bought.sovereigns).toBe(999 - data.sectorZeroShop.offers.blueprint_mythic!.prices.sovereigns!);
  });

  it('пустая витрина выключает магазин данными', () => {
    expect(shopRows(profile(), { ...data, sectorZeroShop: { ...data.sectorZeroShop, slots: 5, offers: {} } }, ALL)).toEqual([]);
    // Ноль слотов выключает так же: каталог есть, показывать нечего.
    expect(shopRows(profile(), { ...data, sectorZeroShop: { ...data.sectorZeroShop, slots: 0 } }, ALL)).toEqual([]);
  });

  it('витрина суток короче каталога — в этом и смысл ротации', () => {
    expect(shopRows(profile(), data, ALL).length).toBe(data.sectorZeroShop.slots);
  });
});

describe('sectorZeroShop — покупка доходит до профиля всеми тремя способами', () => {
  const rich = () => profile({ warrants: 9999, sovereigns: 9999 });

  it('за Варранты: модуль открыт, кошелёк списан', () => {
    const p = changeSectorZeroProgress(
      dayWith(rich(), 'targeting_array'),
      { kind: 'buy', id: 'targeting_array', pay: 'warrants' },
      data,
    )!;
    expect(p).not.toBeNull();
    expect(p.modules).toContain('targeting_array');
    expect(p.warrants).toBe(9999 - data.sectorZeroShop.offers.targeting_array!.prices.warrants!);
  });

  it('за Суверены: ресурс начислен, списаны Суверены, а не Варранты', () => {
    const before = rich();
    const p = changeSectorZeroProgress(
      dayWith(before, 'warrants_pack'),
      { kind: 'buy', id: 'warrants_pack', pay: 'sovereigns' },
      data,
    )!;
    expect(p.warrants).toBe(before.warrants + data.sectorZeroShop.offers.warrants_pack!.amount);
    expect(p.sovereigns).toBeLessThan(before.sovereigns);
  });

  it('за рекламу: товар выдан, НИ ОДНА валюта не списана', () => {
    const before = profile({ warrants: 0, sovereigns: 0 });
    const p = changeSectorZeroProgress(
      dayWith(before, 'data_small'),
      { kind: 'buy', id: 'data_small', pay: 'ad' },
      data,
    )!;
    expect(p.research).toBe(before.research + data.sectorZeroShop.offers.data_small!.amount);
    expect([p.warrants, p.sovereigns]).toEqual([0, 0]);
  });

  it('отказ от рекламы ничего не ломает и не отнимает', () => {
    // Отказ = хозяин просто не зовёт действие. Профиль обязан остаться тем же объектом.
    const before = profile({ warrants: 500 });
    expect(
      changeSectorZeroProgress(
        dayWith(before, 'data_small'),
        { kind: 'buy', id: 'data_small', pay: 'ad' },
        data,
      ),
    ).not.toBe(before); // купил — новый профиль
    expect(before.research).toBe(0); // а прежний не тронут
  });

  it('способ, которым товар не продаётся, отклоняется', () => {
    expect(
      changeSectorZeroProgress(rich(), { kind: 'buy', id: 'warrants_pack', pay: 'ad' }, data),
    ).toBeNull();
  });

  it('без денег, дважды и за несуществующий товар — отказ', () => {
    expect(
      changeSectorZeroProgress(
        dayWith(profile({ warrants: 1 }), 'targeting_array'),
        { kind: 'buy', id: 'targeting_array', pay: 'warrants' },
        data,
      ),
    ).toBeNull();
    // Дважды за сутки — нет: купленный лот ушёл с прилавка (второй экземпляр — завтра, дублем).
    const owned = changeSectorZeroProgress(
      dayWith(rich(), 'targeting_array'),
      { kind: 'buy', id: 'targeting_array', pay: 'warrants' },
      data,
    )!;
    expect(
      changeSectorZeroProgress(
        owned,
        { kind: 'buy', id: 'targeting_array', pay: 'warrants' },
        data,
      ),
    ).toBeNull();
    expect(
      changeSectorZeroProgress(rich(), { kind: 'buy', id: 'ghost', pay: 'warrants' }, data),
    ).toBeNull();
  });
});

describe('sectorZeroShop — «площадка не умеет» и «тебе нельзя» это разные факты', () => {
  it('у закрытого героем навыка способ без площадки всё равно помечен недоступным', () => {
    // Смешай их в одно поле — и закрытый навык покажет кнопку за валюту, которой на
    // площадке не существует: витрина пообещала бы механику, которой у игрока нет.
    const p = profile({ warrants: 9999, sovereigns: 9999 });
    const price = priceOf(p, NONE, 'void_attunement', 'sovereigns');
    expect([price.available, price.reason]).toEqual([false, 'E_SHOP_UNAVAILABLE']);
    // А Варранты площадка умеет всегда — там видна настоящая причина отказа.
    expect(priceOf(p, NONE, 'void_attunement', 'warrants').available).toBe(true);
  });

  it('«уже есть» у навыка — про ВЫБРАННОГО героя: знание другого героя покупку не закрывает', () => {
    // Ревью Sector Zero: раньше хватало навыка у любого героя, и лот гас с «уже есть»,
    // хотя покупка идёт выбранному (`buy` → selectedHero) и была бы законной.
    const base = profile({ warrants: 9999 });
    const other = Object.keys(data.heroes).find((id) => id !== base.selectedHero)!;
    const p = {
      ...base,
      heroes: { ...base.heroes, [other]: { level: 1, skills: ['neural_lace'], equipped: [] } },
    };
    expect(row(p, ALL, 'neural_lace').owned).toBe(false);
    const mine = {
      ...base,
      heroes: {
        ...base.heroes,
        [base.selectedHero]: { ...base.heroes[base.selectedHero]!, skills: ['neural_lace'] },
      },
    };
    expect(priceOf(mine, ALL, 'neural_lace', 'warrants').reason).toBe('E_SHOP_OWNED');
  });

  it('доступность способа не зависит от товара', () => {
    const p = profile({ warrants: 9999 });
    for (const id of ['data_small', 'radar_module'])
      expect([id, priceOf(p, ALL, id, 'ad')?.available]).toEqual([id, true]);
  });
});

describe('sectorZeroShop — продаётся только сегодняшняя витрина (ревью Sector Zero)', () => {
  it('лот, которого нет на витрине этих суток, не покупается', () => {
    const p = profile({ warrants: 9999, sovereigns: 9999 });
    const shelf = new Set(shopRows(p, data, ALL).map((r) => r.id));
    const off = Object.keys(data.sectorZeroShop.offers).find((id) => !shelf.has(id))!;
    const offer = data.sectorZeroShop.offers[off]!;
    const pay = (['warrants', 'sovereigns'] as const).find((k) => offer.prices[k] !== undefined)!;
    expect(changeSectorZeroProgress(p, { kind: 'buy', id: off, pay }, data)).toBeNull();
    expect(
      changeSectorZeroProgress(dayWith(p, off), { kind: 'buy', id: off, pay }, data),
    ).not.toBeNull();
  });
});

describe('sectorZeroShop — купленный лот уходит с прилавка до смены суток', () => {
  it('ресурс за ролик второй раз не купить: лота на витрине больше нет', () => {
    // До решения владельца (2026-09-23) ресурс «своим» не становился, и лот за рекламу
    // покупался бесконечно.
    const before = dayWith(profile(), 'data_small');
    const once = changeSectorZeroProgress(before, { kind: 'buy', id: 'data_small', pay: 'ad' }, data)!;
    expect(once.shopSold).toEqual(['data_small']);
    expect(shopRows(once, data, ALL).some((r) => r.id === 'data_small')).toBe(false);
    expect(changeSectorZeroProgress(once, { kind: 'buy', id: 'data_small', pay: 'ad' }, data)).toBeNull();
    expect(
      changeSectorZeroProgress(once, { kind: 'buy', id: 'data_small', pay: 'warrants' }, data),
    ).toBeNull();
  });

  it('новые сутки возвращают прилавок', () => {
    const sold = changeSectorZeroProgress(
      dayWith(profile(), 'data_small'),
      { kind: 'buy', id: 'data_small', pay: 'ad' },
      data,
    )!;
    expect(advanceShopDay(sold, sold.day + 1).shopSold).toEqual([]);
  });

  it('проданное переживает перезагрузку, а мусор из хранилища отбрасывается', () => {
    const sold = { ...profile(), shopSold: ['data_small', 'ghost', 7] as unknown as string[] };
    expect(parseSectorZeroProgress(JSON.stringify(sold), data, 'shopper').shopSold).toEqual([
      'data_small',
    ]);
    const { shopSold: _drop, ...legacy } = profile();
    expect(parseSectorZeroProgress(JSON.stringify(legacy), data, 'shopper').shopSold).toEqual([]);
  });
});
