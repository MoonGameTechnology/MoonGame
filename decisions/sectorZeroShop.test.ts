import { describe, it, expect } from 'vitest';
import { shippedGameData } from '../data/bundle';
import {
  changeSectorZeroProgress,
  freshSectorZeroProgress,
  type SectorZeroProgress,
} from './sectorZeroProgress';
import { shopRows, type ShopCapabilities } from './sectorZeroShop';

const data = shippedGameData();
const ALL: ShopCapabilities = { sovereigns: true, ads: true };
const NONE: ShopCapabilities = { sovereigns: false, ads: false };
const profile = (over: Partial<SectorZeroProgress> = {}): SectorZeroProgress => ({
  ...freshSectorZeroProgress(data, 'shopper'),
  ...over,
});
const row = (p: SectorZeroProgress, caps: ShopCapabilities, id: string) =>
  shopRows(p, data, caps).find((r) => r.id === id)!;
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

  it('уже открытое не продаётся повторно', () => {
    const p = profile({ warrants: 9999, modules: ['cargo_bay', 'ion_engine', 'radar_module'] });
    expect(row(p, ALL, 'radar_module').owned).toBe(true);
    expect(priceOf(p, ALL, 'radar_module', 'warrants').reason).toBe('E_SHOP_OWNED');
  });

  it('пустая витрина выключает магазин данными', () => {
    expect(shopRows(profile(), { ...data, sectorZeroShop: { offers: {} } }, ALL)).toEqual([]);
  });
});

describe('sectorZeroShop — покупка доходит до профиля всеми тремя способами', () => {
  const rich = () => profile({ warrants: 9999, sovereigns: 9999 });

  it('за Варранты: модуль открыт, кошелёк списан', () => {
    const p = changeSectorZeroProgress(rich(), { kind: 'buy', id: 'targeting_array', pay: 'warrants' }, data)!;
    expect(p).not.toBeNull();
    expect(p.modules).toContain('targeting_array');
    expect(p.warrants).toBe(9999 - data.sectorZeroShop.offers.targeting_array!.prices.warrants!);
  });

  it('за Суверены: ресурс начислен, списаны Суверены, а не Варранты', () => {
    const before = rich();
    const p = changeSectorZeroProgress(before, { kind: 'buy', id: 'warrants_pack', pay: 'sovereigns' }, data)!;
    expect(p.warrants).toBe(before.warrants + data.sectorZeroShop.offers.warrants_pack!.amount);
    expect(p.sovereigns).toBeLessThan(before.sovereigns);
  });

  it('за рекламу: товар выдан, НИ ОДНА валюта не списана', () => {
    const before = profile({ warrants: 0, sovereigns: 0 });
    const p = changeSectorZeroProgress(before, { kind: 'buy', id: 'data_small', pay: 'ad' }, data)!;
    expect(p.research).toBe(before.research + data.sectorZeroShop.offers.data_small!.amount);
    expect([p.warrants, p.sovereigns]).toEqual([0, 0]);
  });

  it('отказ от рекламы ничего не ломает и не отнимает', () => {
    // Отказ = хозяин просто не зовёт действие. Профиль обязан остаться тем же объектом.
    const before = profile({ warrants: 500 });
    expect(changeSectorZeroProgress(before, { kind: 'buy', id: 'data_small', pay: 'ad' }, data))
      .not.toBe(before); // купил — новый профиль
    expect(before.research).toBe(0); // а прежний не тронут
  });

  it('способ, которым товар не продаётся, отклоняется', () => {
    expect(
      changeSectorZeroProgress(rich(), { kind: 'buy', id: 'warrants_pack', pay: 'ad' }, data),
    ).toBeNull();
  });

  it('без денег, дважды и за несуществующий товар — отказ', () => {
    expect(
      changeSectorZeroProgress(profile({ warrants: 1 }), { kind: 'buy', id: 'targeting_array', pay: 'warrants' }, data),
    ).toBeNull();
    const owned = changeSectorZeroProgress(rich(), { kind: 'buy', id: 'targeting_array', pay: 'warrants' }, data)!;
    expect(changeSectorZeroProgress(owned, { kind: 'buy', id: 'targeting_array', pay: 'warrants' }, data)).toBeNull();
    expect(changeSectorZeroProgress(rich(), { kind: 'buy', id: 'ghost', pay: 'warrants' }, data)).toBeNull();
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

  it('доступность способа не зависит от товара', () => {
    const p = profile({ warrants: 9999 });
    for (const id of ['data_small', 'radar_module'])
      expect([id, priceOf(p, ALL, id, 'ad')?.available]).toEqual([id, true]);
  });
});
