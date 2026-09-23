import { describe, it, expect } from 'vitest';
import { shippedGameData } from '../data/bundle';
import type { GameData } from '../packages/shared-core/src/index';
import { adSovereigns, advanceShopDay, shopCapabilities, shopRows } from './sectorZeroShop';
import {
  changeSectorZeroProgress,
  freshSectorZeroProgress,
  parseSectorZeroProgress,
  type SectorZeroProgress,
} from './sectorZeroProgress';

const data = shippedGameData();
const { amount, perDay } = data.sectorZeroShop.adSovereigns;
const profile = (over: Partial<SectorZeroProgress> = {}): SectorZeroProgress => ({
  ...freshSectorZeroProgress(data, 'sovereign'),
  day: 20_000,
  ...over,
});
const watch = (p: SectorZeroProgress, d: GameData = data) =>
  changeSectorZeroProgress(p, { kind: 'ad-sovereigns' }, d);
/** Данные с другим краном — числа порции и лимита живут в данных, не в коде. */
const withTap = (tap: { amount: number; perDay: number }): GameData => ({
  ...data,
  sectorZeroShop: { ...data.sectorZeroShop, adSovereigns: tap },
});

describe('SZE-3.5 — Суверены за ролик: малая порция, дневной лимит (§0.6б)', () => {
  it('кран включён в поставляемых данных, и порция действительно малая', () => {
    expect(amount).toBeGreaterThan(0);
    expect(perDay).toBeGreaterThan(0);
    // «Малая» — против цен: дневной максимум не покрывает даже самый дешёвый лот в
    // Суверенах, иначе ролики заменяли бы покупку, а не давали дорожку неплатящему.
    const cheapest = Math.min(
      ...Object.values(data.sectorZeroShop.offers)
        .map((o) => o.prices.sovereigns)
        .filter((n): n is number => n !== undefined),
    );
    expect(amount * perDay).toBeLessThan(cheapest);
  });

  it('досмотренный ролик кладёт порцию и засчитывает попытку', () => {
    const next = watch(profile({ sovereigns: 5 }))!;
    expect(next.sovereigns).toBe(5 + amount);
    expect(next.adSovereignsToday).toBe(1);
  });

  it('сверх дневного лимита — отказ, кошелёк не растёт', () => {
    let p = profile();
    for (let i = 0; i < perDay; i++) p = watch(p)!;
    expect(p.sovereigns).toBe(amount * perDay);
    expect(watch(p)).toBeNull();
  });

  it('новые сутки обнуляют счёт; часы назад попыток не возвращают', () => {
    let p = profile();
    for (let i = 0; i < perDay; i++) p = watch(p)!;
    expect(advanceShopDay(p, 19_999)).toBe(p);
    expect(advanceShopDay(p, 20_001).adSovereignsToday).toBe(0);
  });

  it('числа берутся из данных: другой кран — другая порция и другой лимит', () => {
    const d = withTap({ amount: 7, perDay: 1 });
    const once = watch(profile(), d)!;
    expect(once.sovereigns).toBe(7);
    expect(watch(once, d)).toBeNull();
  });

  it('кран выключен данными (ноль) — действие отказывает', () => {
    expect(watch(profile(), withTap({ amount: 0, perDay: 3 }))).toBeNull();
    expect(watch(profile(), withTap({ amount: 2, perDay: 0 }))).toBeNull();
  });

  it('ролик ничего, кроме кошелька и счёта, не трогает', () => {
    const p = profile({ warrants: 40, research: 3 });
    const next = watch(p)!;
    expect({ ...next, sovereigns: p.sovereigns, adSovereignsToday: p.adSovereignsToday }).toEqual(
      p,
    );
  });
});

describe('SZE-3.5 — счёт в сохранении', () => {
  const stored = (over: Record<string, unknown>) => JSON.stringify({ ...profile(), ...over });

  it('старый профиль без поля — ноль', () => {
    const { adSovereignsToday: _drop, ...legacy } = profile();
    expect(parseSectorZeroProgress(JSON.stringify(legacy), data).adSovereignsToday).toBe(0);
  });

  it('счёт переживает перезагрузку', () => {
    expect(parseSectorZeroProgress(stored({ adSovereignsToday: 2 }), data).adSovereignsToday).toBe(
      Math.min(2, perDay),
    );
  });

  it('мусор — ноль; сверх лимита — лимит, а не новые порции', () => {
    for (const junk of [-1, 0.5, '2', null]) {
      expect(
        parseSectorZeroProgress(stored({ adSovereignsToday: junk }), data).adSovereignsToday,
      ).toBe(0);
    }
    expect(
      parseSectorZeroProgress(stored({ adSovereignsToday: 999 }), data).adSovereignsToday,
    ).toBe(perDay);
  });
});

describe('SZE-3.5 — кнопка', () => {
  const caps = shopCapabilities({ iap: false, rewardedAds: true });

  it('рекламы у площадки нет — кнопки нет вовсе', () => {
    const off = shopCapabilities({ iap: true, rewardedAds: false });
    expect(adSovereigns(profile(), data, off).state).toBe('hidden');
  });

  it('кран выключен данными — кнопки тоже нет', () => {
    expect(adSovereigns(profile(), withTap({ amount: 0, perDay: 3 }), caps).state).toBe('hidden');
  });

  it('есть попытки — живая кнопка с порцией и остатком; кончились — погашена', () => {
    expect(adSovereigns(profile(), data, caps)).toEqual({ state: 'ready', amount, left: perDay });
    let p = profile();
    for (let i = 0; i < perDay; i++) p = watch(p)!;
    expect(adSovereigns(p, data, caps)).toEqual({ state: 'used', amount, left: 0 });
  });
});

describe('SZE-3.5 — Суверены тратятся там, где их можно ПОЛУЧИТЬ', () => {
  it('источник — покупка ИЛИ ролик; нет ни того ни другого — способа нет', () => {
    // До этого кирпича единственным краном была покупка, и тратить Суверены разрешалось
    // только при IAP. На площадке с роликами, но без покупок игрок копил бы валюту,
    // которую некуда деть.
    expect(shopCapabilities({ iap: false, rewardedAds: true }).sovereigns).toBe(true);
    expect(shopCapabilities({ iap: true, rewardedAds: false }).sovereigns).toBe(true);
    expect(shopCapabilities({ iap: false, rewardedAds: false }).sovereigns).toBe(false);
  });

  it('реклама как способ оплаты по-прежнему идёт только за `rewardedAds`', () => {
    expect(shopCapabilities({ iap: true, rewardedAds: false }).ads).toBe(false);
    expect(shopCapabilities({ iap: false, rewardedAds: true }).ads).toBe(true);
  });

  it('заработанное роликами тратится в витрине', () => {
    const rich = profile({ sovereigns: 999 });
    const rows = shopRows(rich, data, shopCapabilities({ iap: false, rewardedAds: true }));
    const priced = rows.flatMap((r) => r.prices).filter((p) => p.kind === 'sovereigns');
    expect(priced.length).toBeGreaterThan(0);
    expect(priced.every((p) => p.available)).toBe(true);
  });
});
