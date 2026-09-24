import { describe, it, expect } from 'vitest';
import { shippedGameData } from '../data/bundle';
import { advanceShopDay, dailyOffers, shopRefresh, shopRows } from './sectorZeroShop';
import {
  changeSectorZeroProgress,
  freshSectorZeroProgress,
  parseSectorZeroProgress,
  SHOP_AD_REFRESHES_PER_DAY,
  type SectorZeroProgress,
} from './sectorZeroProgress';

const data = shippedGameData();
const profile = (over: Partial<SectorZeroProgress> = {}): SectorZeroProgress => ({
  ...freshSectorZeroProgress(data, 'rotator'),
  ...over,
});
const ids = (seed: string, day: number, round?: number) =>
  dailyOffers(seed, day, data, round).map((o) => o.id);
const refresh = (p: SectorZeroProgress) =>
  changeSectorZeroProgress(p, { kind: 'refresh-shop' }, data);
/** Лоты каталога на момент съёмки эталона раунда 0. */
const GOLDEN_IDS = [
  'shield_booster',
  'point_defense_array',
  'targeting_array',
  'ablative_plating',
  'radar_module',
  'void_attunement',
  'neural_lace',
  'data_small',
  'data_large',
  'warrants_pack',
];

describe('SZE-3.4 — раунд витрины: сверх суточной ротации одно обновление за ролик', () => {
  it('РАУНД 0 — ТА ЖЕ витрина, что до кирпича: существующие профили не сдвинулись', () => {
    // Эталон снят с `main` ДО появления раунда. Раунд 0 обязан хешироваться прежней
    // строкой `сид ∥ день ∥ id` — иначе у каждого игрока в день выхода обновления
    // витрина молча сменилась бы, и купленное вчера «на завтра» исчезло бы.
    //
    // Каталог — в том составе, с которым эталон снимался: новые лоты (чертежи SZE-5.3)
    // законно меняют выборку дня, а сторожит тест не ассортимент, а строку хеша.
    const catalog = {
      ...data,
      sectorZeroShop: {
        ...data.sectorZeroShop,
        offers: Object.fromEntries(
          Object.entries(data.sectorZeroShop.offers).filter(([id]) => GOLDEN_IDS.includes(id)),
        ),
      },
    };
    const ids = (seed: string, day: number, round?: number) =>
      dailyOffers(seed, day, catalog, round).map((o) => o.id);
    expect(ids('golden', 20_000, 0)).toEqual([
      'warrants_pack',
      'shield_booster',
      'data_small',
      'void_attunement',
      'radar_module',
    ]);
    expect(ids('k3x.9f2a', 20_353, 0)).toEqual([
      'targeting_array',
      'point_defense_array',
      'data_small',
      'ablative_plating',
      'warrants_pack',
    ]);
    expect(ids('', 0, 0)).toEqual([
      'ablative_plating',
      'data_large',
      'neural_lace',
      'targeting_array',
      'point_defense_array',
    ]);
    // Без номера раунда — раунд 0.
    expect(ids('golden', 20_000)).toEqual(ids('golden', 20_000, 0));
  });

  it('раунд 1 — другая выборка того же дня, и детерминированная', () => {
    const days = Array.from({ length: 20 }, (_, i) => 20_000 + i);
    const differs = days.filter(
      (d) => JSON.stringify(ids('golden', d, 1)) !== JSON.stringify(ids('golden', d, 0)),
    );
    // Обновление, которое почти никогда ничего не меняет, — обман за просмотр ролика.
    expect(differs.length).toBeGreaterThan(15);
    expect(ids('golden', 20_000, 1)).toEqual(ids('golden', 20_000, 1));
  });

  it('обновление двигает раунд, а витрина профиля идёт за ним', () => {
    const p = profile({ day: 20_000 });
    const next = refresh(p);
    expect(next?.shopRound).toBe(1);
    expect(shopRows(next!, data, { ads: true, sovereigns: false }).map((r) => r.id)).toEqual(
      ids(p.seed, 20_000, 1),
    );
  });

  it('ВТОРОЕ обновление за сутки недоступно', () => {
    expect(SHOP_AD_REFRESHES_PER_DAY).toBe(1); // резолюция владельца §0.7: «1 раз за рекламу»
    const once = refresh(profile({ day: 20_000 }))!;
    expect(refresh(once)).toBeNull();
  });

  it('новые сутки обнуляют раунд — обновление снова доступно', () => {
    const used = refresh(profile({ day: 20_000 }))!;
    const tomorrow = advanceShopDay(used, 20_001);
    expect(tomorrow.shopRound).toBe(0);
    expect(refresh(tomorrow)?.shopRound).toBe(1);
  });

  it('часы НАЗАД не возвращают попытку', () => {
    const used = refresh(profile({ day: 20_000 }))!;
    expect(advanceShopDay(used, 19_999)).toBe(used);
    expect(advanceShopDay(used, 20_000)).toBe(used);
    expect(refresh(used)).toBeNull();
  });

  it('обновление ничего не списывает и ничего не выдаёт — меняется только раунд', () => {
    // Платой служит просмотр, подтверждённый адаптером; до действия дело доходит только
    // после него. Отказ от ролика действие не зовёт вовсе — значит и не тратит попытку.
    const p = profile({ day: 20_000, warrants: 7, research: 3 });
    const next = refresh(p)!;
    expect({ ...next, shopRound: p.shopRound }).toEqual(p);
  });
});

describe('SZE-3.4 — раунд в сохранении', () => {
  const stored = (over: Record<string, unknown>) =>
    JSON.stringify({ ...profile({ day: 20_000 }), ...over });

  it('старый профиль без поля читается как раунд 0 — витрина та же', () => {
    const { shopRound: _drop, ...legacy } = profile({ day: 20_000 });
    const p = parseSectorZeroProgress(JSON.stringify(legacy), data);
    expect(p.shopRound).toBe(0);
  });

  it('раунд переживает перезагрузку', () => {
    expect(parseSectorZeroProgress(stored({ shopRound: 1 }), data).shopRound).toBe(1);
  });

  it('мусор — раунд 0; раунд сверх лимита срезается до лимита, а не даёт новых', () => {
    // Профиль лежит в localStorage и правится игроком. Срез сверху — чтобы «999» не
    // означало ничего, кроме «сегодня уже обновлял».
    for (const junk of [-1, 1.5, '1', null]) {
      expect(parseSectorZeroProgress(stored({ shopRound: junk }), data).shopRound).toBe(0);
    }
    expect(parseSectorZeroProgress(stored({ shopRound: 999 }), data).shopRound).toBe(
      SHOP_AD_REFRESHES_PER_DAY,
    );
  });
});

describe('SZE-3.4 — кнопка обновления', () => {
  it('рекламы у площадки нет — кнопки нет вовсе, а не погашена', () => {
    expect(shopRefresh(profile(), { ads: false, sovereigns: false })).toBe('hidden');
  });

  it('реклама есть — кнопка живая; обновление потрачено — видна, но погашена', () => {
    const caps = { ads: true, sovereigns: false };
    expect(shopRefresh(profile(), caps)).toBe('ready');
    expect(shopRefresh(refresh(profile())!, caps)).toBe('used');
  });
});
