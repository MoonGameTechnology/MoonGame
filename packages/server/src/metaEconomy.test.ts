import { describe, expect, it, vi } from 'vitest';
import type { EntitlementCommandV1 } from '@void/protocol';
import {
  MetaEconomy,
  metaEconomyFingerprint,
  metaSettlementReceiptKey,
  type MatchRewardFacts,
  type MetaEconomyDeps,
} from './metaEconomy';
import { loadMetaEconomyCatalog } from './metaEconomyCatalog';
import { MemoryMetaEconomyStore } from './metaEconomyStore';
import { MemoryMetaMarket } from './metaMarket';
import { MemoryArsenalStore, MemoryDropStore } from './store';
import { loadDropTables, loadShippedData } from './scenario';
import { hashEntitlementCommand } from './commerceTransport';
import { arsenalSnapshotOf } from './arsenal';

const data = loadShippedData();
const DAY = 86_400_000;

function setup(onEvent?: MetaEconomyDeps['onEvent']) {
  const catalog = loadMetaEconomyCatalog(data);
  let time = catalog.seasons[0]!.startsAt + DAY;
  const arsenal = new MemoryArsenalStore();
  const drops = new MemoryDropStore();
  const market = new MemoryMetaMarket(arsenal, () => time);
  const store = new MemoryMetaEconomyStore(arsenal, drops, market);
  market.setEconomy(store);
  const tables = loadDropTables(data);
  const service = new MetaEconomy({ store, catalog, dropTables: tables, now: () => time, onEvent });
  const final = (
    matchId = 'match_1',
    overrides: Partial<MatchRewardFacts> = {},
  ): MatchRewardFacts => ({
    matchId,
    accountId: 'alice',
    kind: 'final',
    place: 1,
    participation: true,
    occurredAt: time,
    ...overrides,
  });
  const credit = async (soulbound = false, quantity = 100): Promise<void> =>
    store.transaction(['alice'], async (tx) => {
      for (const materialId of Object.keys(catalog.materials)) {
        tx.account('alice').materials.push({
          lotId: `fixture:${soulbound}:${materialId}`,
          materialId,
          quantity,
          soulbound,
          source: soulbound ? 'ad' : 'match',
          sourceId: 'fixture',
          acquiredAt: time,
        });
      }
    });
  const entitlement = (
    id: string,
    productId = 'supply_personal',
    changes: Partial<EntitlementCommandV1> = {},
  ): EntitlementCommandV1 => {
    const payload = {
      version: 1 as const,
      commandId: id,
      kind: 'grant' as const,
      source: 'payment' as const,
      orderId: `order_${id}`,
      provider: 'fixture',
      providerTransactionId: `tx_${id}`,
      accountId: 'alice',
      productId,
      catalogVersion: catalog.version,
      at: time,
      ...changes,
    };
    const { payloadHash: _ignored, ...input } = payload;
    return { ...input, payloadHash: hashEntitlementCommand(input) };
  };
  return {
    service,
    catalog,
    arsenal,
    drops,
    market,
    store,
    tables,
    final,
    credit,
    entitlement,
    setTime: (at: number) => {
      time = at;
    },
  };
}

describe('MetaEconomy settlement', () => {
  it('does not announce a complete final while omitting stages committed during receipt reads', async () => {
    const f = setup();
    const stage = { ...f.final(), kind: 'stage' as const, stage: 1, place: undefined };
    const first = await f.service.settle(stage);
    const last = await f.service.settle(f.final());
    const stageKey = metaSettlementReceiptKey(stage);
    const finalKey = metaSettlementReceiptKey(f.final());
    const stageRow = await f.store.receipt(stageKey);
    const finalRow = await f.store.receipt(finalKey);
    let committed = false;
    vi.spyOn(f.store, 'receipt').mockImplementation(async (key) => {
      // Reproduce a writer finishing after an early stage read, before the final read.
      if (key === finalKey) {
        committed = true;
        return finalRow;
      }
      return committed && key === stageKey ? stageRow : null;
    });
    const view = await f.service.matchRewards('alice', 'match_1');
    expect(view.finalReady).toBe(true);
    expect(view.receipts).toEqual([first.ok ? first.receipt : null, last.ok ? last.receipt : null]);
  });
  it('reads only this account’s successful committed receipts in stage/final order without awarding anything', async () => {
    const f = setup();
    expect(await f.service.matchRewards('alice', 'match_1')).toEqual({
      receipts: [],
      finalReady: false,
    });
    const stage = { ...f.final(), kind: 'stage' as const, stage: 1, place: undefined };
    const first = await f.service.settle(stage);
    expect(first.ok).toBe(true);
    expect((await f.service.matchRewards('alice', 'match_1')).finalReady).toBe(false);
    await f.store.transaction(['alice'], async (tx) => {
      await tx.saveReceipt(metaSettlementReceiptKey({ ...stage, stage: 2 }), 'failed-stage', {
        ok: false,
        code: 'E_INTERNAL',
      });
    });
    const final = await f.service.settle(f.final());
    expect(final.ok).toBe(true);
    const before = await f.store.read('alice');
    const balance = await f.market.balance('alice');
    const settle = vi.spyOn(f.service, 'settle');
    const transaction = vi.spyOn(f.store, 'transaction');
    const read = await f.service.matchRewards('alice', 'match_1');
    expect(read).toEqual({
      receipts: [first.ok ? first.receipt : null, final.ok ? final.receipt : null],
      finalReady: true,
    });
    expect(await f.service.matchRewards('alice', 'match_1')).toEqual(read);
    expect(await f.service.matchRewards('bob', 'match_1')).toEqual({
      receipts: [],
      finalReady: false,
    });
    expect(await f.service.matchRewards('alice', 'another_match')).toEqual({
      receipts: [],
      finalReady: false,
    });
    expect(settle).not.toHaveBeenCalled();
    expect(transaction).not.toHaveBeenCalled();
    expect(await f.store.read('alice')).toEqual(before);
    expect(await f.market.balance('alice')).toBe(balance);
  });
  it('uses canonical cryptographic receipts and emits only committed new awards even when telemetry fails', async () => {
    expect(metaEconomyFingerprint({ a: 1, b: 2 })).toBe(metaEconomyFingerprint({ b: 2, a: 1 }));
    expect(metaEconomyFingerprint({ a: 1 })).toMatch(/^[a-f0-9]{64}$/);
    const observer = vi.fn(() => {
      throw new Error('telemetry unavailable');
    });
    const f = setup(observer);
    const first = await f.service.settle(f.final());
    expect(first.ok).toBe(true);
    expect(await f.service.settle(f.final())).toEqual(first);
    expect(observer).toHaveBeenCalledTimes(1);
    expect(observer.mock.calls[0]).toHaveLength(1);
    if (first.ok) expect(first.receipt.dropOdds).toMatchObject({ chance: 0.6, pity: 0 });
    expect(await f.market.balance('alice')).toBe(20);
  });
  it('includes stages in the final finite budget and durably returns the same receipt', async () => {
    const f = setup();
    const at = f.final().occurredAt;
    expect(
      (await f.service.settle({ ...f.final(), kind: 'stage', stage: 1, place: undefined })).ok,
    ).toBe(true);
    expect(
      (await f.service.settle({ ...f.final(), kind: 'stage', stage: 2, place: undefined })).ok,
    ).toBe(true);
    const first = await f.service.settle(f.final());
    const before = await f.store.read('alice');
    expect(await f.service.settle(f.final())).toEqual(first);
    expect(await f.store.read('alice')).toEqual(before);
    expect(before.operations.match_1?.materials).toEqual({
      ferroalloys: 26,
      technical_composites: 18,
      control_circuits: 18,
      energy_cells: 13,
      technology_archives: 1,
    });
    expect(before.operations.match_1?.seasonXp).toBe(260);
    expect(await f.market.balance('alice')).toBe(20);
    expect(
      before.materials
        .filter((lot) => lot.source === 'match')
        .every((lot) => !lot.soulbound && lot.acquiredAt === at),
    ).toBe(true);
    expect(await f.service.settle({ ...f.final(), place: 2 })).toEqual({
      ok: false,
      code: 'E_IDEMPOTENCY_CONFLICT',
    });
  });

  it('rolls back claim, pity, inventory and guaranteed supply when a grant fails', async () => {
    const f = setup();
    f.tables.byPlace = [{ maxPlace: 999, chance: 1 }];
    vi.spyOn(f.arsenal, 'grant').mockRejectedValueOnce(new Error('injected storage failure'));
    await expect(f.service.settle(f.final())).rejects.toThrow('injected');
    expect((await f.store.read('alice')).materials).toEqual([]);
    expect(await f.drops.pityOf('alice')).toBe(0);
    expect(await f.market.balance('alice')).toBe(0);
    expect((await f.service.settle(f.final())).ok).toBe(true);
    expect(await f.arsenal.listOf('alice')).toHaveLength(1);
  });

  it('respects a pre-existing AvA drop claim and caps earned warrant issuance by day', async () => {
    const f = setup();
    await f.drops.claim('match_1', 'alice');
    f.tables.byPlace = [{ maxPlace: 999, chance: 1 }];
    await f.service.settle(f.final());
    expect(await f.arsenal.listOf('alice')).toHaveLength(0);
    for (let i = 2; i <= 6; i++) await f.service.settle(f.final(`match_${i}`));
    expect(await f.market.balance('alice')).toBe(100);
    f.setTime(f.final().occurredAt + DAY);
    await f.service.settle(f.final('match_7'));
    expect(await f.market.balance('alice')).toBe(120);
  });

  it('rejects forged shape and ineligible participation without reserving a receipt', async () => {
    const f = setup();
    expect(await f.service.settle(f.final('match_1', { participation: false }))).toEqual({
      ok: false,
      code: 'E_NOT_PARTICIPATING',
    });
    expect(await f.service.settle(f.final('match_1', { place: 0 }))).toEqual({
      ok: false,
      code: 'E_META_FACTS',
    });
    expect(await f.service.settle(f.final('match_1', { kind: 'stage', stage: 100 }))).toEqual({
      ok: false,
      code: 'E_META_FACTS',
    });
    expect((await f.service.settle(f.final())).ok).toBe(true);
  });

  it('serializes overlapping matches so pity grants exactly one fourth-match drop', async () => {
    const f = setup();
    f.tables.byPlace = [{ maxPlace: 999, chance: 0 }];
    const outcomes = await Promise.all(
      [1, 2, 3, 4, 5].map((i) => f.service.settle(f.final(`concurrent_${i}`))),
    );
    expect(outcomes.every((r) => r.ok)).toBe(true);
    expect(await f.arsenal.listOf('alice')).toHaveLength(1);
    expect(await f.drops.pityOf('alice')).toBe(1);
  });
});

describe('MetaEconomy manufacturing', () => {
  it('completes the free loop from match supply through manufacturing and auction to build authorization', async () => {
    const f = setup();
    f.tables.byPlace = [{ maxPlace: 999, chance: 0 }];
    for (const accountId of ['alice', 'bob']) {
      await f.service.settle(f.final('war_1', { accountId, place: 4 }));
      await f.service.settle(f.final('war_2', { accountId, place: 4 }));
    }
    expect(
      (
        await f.service.craft('alice', {
          requestId: 'earned_module',
          recipeId: 'shield_booster',
          allowSoulbound: false,
        })
      ).ok,
    ).toBe(true);
    const item = (await f.arsenal.listOf('alice'))[0]!;
    const listed = await f.market.list('alice', 'Alice', item.itemId, 10);
    expect(listed.ok).toBe(true);
    if (!listed.ok) return;
    expect((await f.market.buy('bob', listed.listing.id, 'purchase')).ok).toBe(true);
    expect(await f.market.balance('alice')).toBe(49);
    expect(await f.market.balance('bob')).toBe(30);
    expect(arsenalSnapshotOf(await f.arsenal.listOf('bob')).modules).toContain('shield_booster');
    expect(await f.arsenal.listOf('alice')).toEqual([]);
  });
  it('guarantees earned crafting, keeps a supply goal and deduplicates craft retries', async () => {
    const f = setup();
    await f.credit();
    await f.service.setSupplyGoal('alice', { requestId: 'goal', recipeId: 'shield_booster' });
    const command = { requestId: 'craft_1', recipeId: 'shield_booster', allowSoulbound: false };
    const first = await f.service.craft('alice', command);
    expect(await f.service.craft('alice', command)).toEqual(first);
    expect(await f.arsenal.listOf('alice')).toHaveLength(1);
    expect((await f.arsenal.listOf('alice'))[0]).toMatchObject({
      form: 'instance',
      origin: 'craft',
      soulbound: false,
      defId: 'shield_booster',
    });
    const view = await f.service.readModel('alice');
    expect(view.supplyGoal).toBe('shield_booster');
    expect(view.materials.find((m) => m.id === 'control_circuits')?.tradable).toBe(80);
    expect(await f.service.craft('alice', { ...command, recipeId: 'tractor_beam' })).toEqual({
      ok: false,
      code: 'E_IDEMPOTENCY_CONFLICT',
    });
  });

  it('discloses the drop tables it rolls and the module a season level grants outright', async () => {
    const f = setup();
    const view = await f.service.readModel('alice');
    const tables = loadDropTables(data);
    expect(view.drops).toEqual({
      pityAfter: tables.pityAfter,
      byPlace: [...tables.byPlace].sort((a, b) => a.maxPlace - b.maxPlace),
      pool: tables.pool,
    });
    const season = f.catalog.seasons[0]!;
    for (const [i, milestone] of season.milestones.entries()) {
      expect(view.seasons[0]!.milestones[i]!.module).toBe(milestone.free.module);
    }
    expect(view.seasons[0]!.milestones.some((m) => m.module)).toBe(true);
  });

  it('requires consent before mixing personal inputs and keeps salvage personal', async () => {
    const f = setup();
    await f.credit(false, 2);
    await f.credit(true, 100);
    const command = { requestId: 'mixed', recipeId: 'shield_booster', allowSoulbound: false };
    expect(await f.service.craft('alice', command)).toEqual({
      ok: false,
      code: 'E_SOULBOUND_CONFIRM',
    });
    expect((await f.service.craft('alice', { ...command, allowSoulbound: true })).ok).toBe(true);
    const item = (await f.arsenal.listOf('alice'))[0]!;
    expect(item.soulbound).toBe(true);
    const before = (await f.service.readModel('alice')).materials.map((m) => m.tradable);
    expect(
      (await f.service.salvage('alice', { requestId: 'salvage', itemId: item.itemId })).ok,
    ).toBe(true);
    expect((await f.service.readModel('alice')).materials.map((m) => m.tradable)).toEqual(before);
    expect(
      (await f.store.read('alice')).materials
        .filter((lot) => lot.source === 'salvage')
        .every((lot) => lot.soulbound),
    ).toBe(true);
  });

  it('prevents concurrent double consumption and refuses another owner or listed item', async () => {
    const f = setup();
    await f.credit(false, 25);
    const results = await Promise.all(
      ['a', 'b'].map((requestId) =>
        f.service.craft('alice', {
          requestId,
          recipeId: 'siege_platform',
          allowSoulbound: false,
        }),
      ),
    );
    expect(results.filter((r) => r.ok)).toHaveLength(1);
    const item = (await f.arsenal.listOf('alice'))[0]!;
    expect(await f.service.salvage('bob', { requestId: 'theft', itemId: item.itemId })).toEqual({
      ok: false,
      code: 'E_NOT_OWNER',
    });
    await f.market.list('alice', 'Alice', item.itemId, 10);
    expect(await f.service.salvage('alice', { requestId: 'listed', itemId: item.itemId })).toEqual({
      ok: false,
      code: 'E_ALREADY_LISTED',
    });
    expect((await f.service.readModel('alice')).salvageableItemIds).not.toContain(item.itemId);
  });
});

describe('MetaEconomy season', () => {
  it('continues a started track after its competitive season ends, including accumulated weekly contracts', async () => {
    const f = setup();
    const season = f.catalog.seasons[0]!;
    expect(
      (await f.service.selectPass('alice', { requestId: 'select', seasonId: season.id })).ok,
    ).toBe(true);
    f.setTime(season.startsAt + 60 * DAY);
    await f.service.settle(f.final('late', { seasonFacts: { recon: 30, logistics: 12 } }));
    const progress = (await f.store.read('alice')).season[season.id]!;
    expect(progress.claimed).toEqual(
      expect.arrayContaining([
        'free:1',
        'contract:week_2_recon',
        'contract:week_7_recon',
        'contract:week_8_logistics',
      ]),
    );
    expect((await f.service.readModel('alice')).seasons[0]).toMatchObject({
      active: true,
      archived: true,
      started: true,
    });
    expect(
      await f.service.selectPass('bob', { requestId: 'late_start', seasonId: season.id }),
    ).toEqual({ ok: false, code: 'E_META_SEASON' });
  });

  it('awards cumulative operation metrics once across stage and final delivery', async () => {
    const f = setup();
    f.setTime(f.catalog.seasons[0]!.startsAt + 10 * DAY);
    await f.service.settle({
      ...f.final(),
      kind: 'stage',
      stage: 1,
      place: undefined,
      seasonFacts: { recon: 7 },
    });
    await f.service.settle(f.final('match_1', { seasonFacts: { recon: 7 } }));
    expect(
      (await f.store.read('alice')).season[f.catalog.seasons[0]!.id]!.contracts.week_2_recon,
    ).toBe(7);
  });

  it('credits only the selected pass and makes a blueprint choice exactly once', async () => {
    const f = setup();
    const season = f.catalog.seasons[0]!;
    const second = { ...structuredClone(season), id: 'second_season' };
    f.catalog.seasons.push(second);
    await f.service.selectPass('alice', { requestId: 'first', seasonId: season.id });
    await f.service.selectPass('alice', { requestId: 'second', seasonId: second.id });
    const fact = f.final('one_event');
    await f.service.settle(fact);
    await f.service.selectPass('alice', { requestId: 'back', seasonId: season.id });
    await f.service.settle(fact);
    expect((await f.store.read('alice')).season[season.id]!.xp).toBe(0);
    expect((await f.store.read('alice')).season[second.id]!.xp).toBe(260);
    const choice = { requestId: 'choice', seasonId: season.id, level: 10, defId: 'shield_booster' };
    expect(await f.service.chooseSeasonReward('alice', choice)).toEqual({
      ok: false,
      code: 'E_SEASON_LEVEL',
    });
    await f.store.transaction(['alice'], async (tx) => {
      tx.account('alice').season[season.id]!.xp = 1800;
    });
    expect((await f.service.chooseSeasonReward('alice', choice)).ok).toBe(true);
    expect((await f.service.chooseSeasonReward('alice', choice)).ok).toBe(true);
    expect(
      await f.service.chooseSeasonReward('alice', {
        ...choice,
        requestId: 'again',
        defId: 'targeting_array',
      }),
    ).toEqual({ ok: false, code: 'E_SEASON_CHOICE' });
  });
});

describe('MetaEconomy season tempo', () => {
  it('grants the pass daily XP once per UTC day with own orders, whatever the match count', async () => {
    const f = setup();
    const season = f.catalog.seasons[0]!;
    const day = season.startsAt / DAY + 3;
    const first = await f.service.settleActiveDay('alice', day);
    expect(first.ok && first.receipt.seasonXp).toBe(season.dailyXp);
    expect(await f.service.settleActiveDay('alice', day)).toEqual(first);
    await f.service.settleActiveDay('alice', day + 1);
    expect((await f.store.read('alice')).season[season.id]!.xp).toBe(2 * season.dailyXp!);
    expect((await f.service.readModel('alice')).seasons[0]!.dailyXp).toBe(season.dailyXp);
  });

  it('grants nothing before the season and rejects a malformed day', async () => {
    const f = setup();
    const season = f.catalog.seasons[0]!;
    const early = await f.service.settleActiveDay('alice', season.startsAt / DAY - 1);
    expect(early.ok && early.receipt.seasonXp).toBeFalsy();
    for (const day of [-1, 1.5, Number.NaN, Number.MAX_SAFE_INTEGER])
      expect(await f.service.settleActiveDay('alice', day)).toEqual({
        ok: false,
        code: 'E_META_FACTS',
      });
  });
});

describe('MetaEconomy verified entitlements', () => {
  it('replays an old catalog receipt and refunds its original quantities after a content update', async () => {
    const f = setup();
    const original = f.entitlement('old_edition');
    const first = await f.service.applyEntitlement(original);
    f.catalog.version = 'meta-v0.2';
    f.catalog.commerce.products.supply_personal!.materials!.ferroalloys = 999;
    expect(await f.service.applyEntitlement(original)).toEqual(first);
    const refund = f.entitlement('old_refund', 'supply_personal', {
      catalogVersion: original.catalogVersion,
      kind: 'revoke',
      originalCommandId: original.commandId,
      orderId: original.orderId,
      providerTransactionId: original.providerTransactionId,
    });
    expect(await f.service.applyEntitlement(refund)).toMatchObject({
      ok: true,
      receipt: { status: 'revoked' },
    });
    expect((await f.store.read('alice')).materials).toEqual([]);
    expect(await f.service.entitlementStatus(original.commandId)).toMatchObject({
      commandId: original.commandId,
      status: 'revoked',
    });
  });

  it('delivers a verified purchase after an outage even when the competitive season has ended', async () => {
    const f = setup();
    const purchase = f.entitlement('late_delivery', 'frontier_fleet_premium');
    f.setTime(f.catalog.seasons[0]!.startsAt + 60 * DAY);
    expect((await f.service.applyEntitlement(purchase)).ok).toBe(true);
    expect((await f.store.read('alice')).season[f.catalog.seasons[0]!.id]).toMatchObject({
      premium: true,
    });
    expect(
      await f.service.applyEntitlement({ ...purchase, productId: 'module_shield_booster' }),
    ).toEqual({ ok: false, code: 'E_ENTITLEMENT' });
  });
  it('deduplicates purchases by both command and provider transaction, with immutable personal provenance', async () => {
    const f = setup();
    const command = f.entitlement('purchase');
    const receipt = await f.service.applyEntitlement(command);
    expect(receipt.ok).toBe(true);
    expect(await f.service.applyEntitlement(command)).toEqual(receipt);
    expect((await f.store.read('alice')).materials).toHaveLength(4);
    expect(
      (await f.store.read('alice')).materials.every(
        (lot) => lot.soulbound && lot.source === 'commerce',
      ),
    ).toBe(true);
    expect(
      await f.service.applyEntitlement(
        f.entitlement('reused', 'supply_personal', {
          providerTransactionId: command.providerTransactionId,
        }),
      ),
    ).toEqual({ ok: false, code: 'E_IDEMPOTENCY_CONFLICT' });
  });

  it('caps rewarded packs at two server-confirmed grants daily and never grants XP or warrants', async () => {
    const f = setup();
    for (const id of ['ad_1', 'ad_2'])
      expect(
        (
          await f.service.applyEntitlement(
            f.entitlement(id, 'rewarded_supply', { source: 'rewarded_ad' }),
          )
        ).ok,
      ).toBe(true);
    expect(
      await f.service.applyEntitlement(
        f.entitlement('ad_3', 'rewarded_supply', { source: 'rewarded_ad' }),
      ),
    ).toEqual({ ok: false, code: 'E_AD_LIMIT' });
    expect((await f.store.read('alice')).season).toEqual({});
    expect(await f.market.balance('alice')).toBe(0);
    expect(
      await f.service.applyEntitlement(
        f.entitlement('bypass', 'frontier_fleet_premium', { source: 'rewarded_ad' }),
      ),
    ).toEqual({ ok: false, code: 'E_ENTITLEMENT' });
  });

  it('revokes untouched paid resources and sends consumed value to review without taking earned assets', async () => {
    const f = setup();
    await f.credit(false, 2);
    const original = f.entitlement('untouched');
    await f.service.applyEntitlement(original);
    const revoke = f.entitlement('refund', 'supply_personal', {
      kind: 'revoke',
      originalCommandId: original.commandId,
      orderId: original.orderId,
      providerTransactionId: original.providerTransactionId,
    });
    expect(await f.service.applyEntitlement(revoke)).toMatchObject({
      ok: true,
      receipt: { status: 'revoked' },
    });
    expect((await f.store.read('alice')).materials.every((lot) => lot.source === 'match')).toBe(
      true,
    );
    const purchased = f.entitlement('module', 'module_shield_booster');
    await f.service.applyEntitlement(purchased);
    const item = (await f.arsenal.listOf('alice'))[0]!;
    await f.service.salvage('alice', { requestId: 'break_paid', itemId: item.itemId });
    const refund = f.entitlement('consumed_refund', 'module_shield_booster', {
      kind: 'revoke',
      originalCommandId: purchased.commandId,
      orderId: purchased.orderId,
      providerTransactionId: purchased.providerTransactionId,
    });
    expect(await f.service.applyEntitlement(refund)).toMatchObject({
      ok: true,
      receipt: { status: 'review-required' },
    });
    expect(
      (await f.service.readModel('alice')).materials.find((m) => m.id === 'ferroalloys')?.tradable,
    ).toBe(2);
  });
});

describe('MetaEconomy Sovereign store', () => {
  const buyPack = async (f: ReturnType<typeof setup>, id: string, productId = 'sovereigns_1440') =>
    f.service.applyEntitlement(f.entitlement(id, productId));

  it('credits a verified Sovereign pack with its gift and spends it on premium days', async () => {
    const f = setup();
    expect((await f.service.readModel('alice')).sovereigns).toBe(0);
    expect((await buyPack(f, 'pack')).ok).toBe(true);
    expect((await f.service.readModel('alice')).sovereigns).toBe(1440);
    const now = f.catalog.seasons[0]!.startsAt + DAY;
    const first = await f.service.buyOffer('alice', { requestId: 'p1', offerId: 'premium_7' });
    expect(first).toMatchObject({
      ok: true,
      receipt: { sovereignsSpent: 149, premiumUntil: now + 7 * DAY },
    });
    // A repeated request returns the same receipt and charges once.
    expect(await f.service.buyOffer('alice', { requestId: 'p1', offerId: 'premium_7' })).toEqual(
      first,
    );
    // A second term extends the first instead of restarting it.
    await f.service.buyOffer('alice', { requestId: 'p2', offerId: 'premium_30' });
    const view = await f.service.readModel('alice');
    expect(view.sovereigns).toBe(1440 - 149 - 449);
    expect(view.premiumUntil).toBe(now + 37 * DAY);
    f.setTime(now + 38 * DAY);
    expect((await f.service.readModel('alice')).premiumUntil).toBeNull();
  });

  it('refuses a purchase it cannot pay for without changing anything', async () => {
    const f = setup();
    expect(
      await f.service.buyOffer('alice', { requestId: 'poor', offerId: 'materials_personal' }),
    ).toEqual({ ok: false, code: 'E_SOVEREIGNS' });
    expect(await f.service.buyOffer('alice', { requestId: 'x', offerId: 'nope' })).toEqual({
      ok: false,
      code: 'E_META_OFFER',
    });
    expect(await f.store.read('alice')).toMatchObject({ materials: [], counters: {} });
  });

  it('prices a module pack by the modules still missing and grants only those, as personal blueprints', async () => {
    const f = setup();
    await buyPack(f, 'pack', 'sovereigns_3125');
    const shield = await f.service.buyOffer('alice', {
      requestId: 'one',
      offerId: 'module_shield_booster',
    });
    expect(shield).toMatchObject({ ok: true, receipt: { sovereignsSpent: 180 } });
    const pack = (await f.service.readModel('alice')).store!.find((o) => o.id === 'pack_defense')!;
    // Shield owned: only the repair tender is left, 180 ◆ less 15%.
    expect(pack).toMatchObject({ price: 153, fullPrice: 180 });
    expect(pack.modules).toEqual([
      { defId: 'shield_booster', owned: true },
      { defId: 'repair_tender', owned: false },
    ]);
    const bought = await f.service.buyOffer('alice', { requestId: 'two', offerId: 'pack_defense' });
    expect(bought).toMatchObject({ ok: true, receipt: { sovereignsSpent: 153 } });
    const items = await f.arsenal.listOf('alice');
    expect(items.map((item) => item.defId).sort()).toEqual(['repair_tender', 'shield_booster']);
    expect(items.every((item) => item.soulbound && item.form === 'blueprint')).toBe(true);
    expect(
      await f.service.buyOffer('alice', { requestId: 'three', offerId: 'pack_defense' }),
    ).toEqual({ ok: false, code: 'E_ALREADY_OWNED' });
    expect((await f.service.readModel('alice')).sovereigns).toBe(3125 - 180 - 153);
  });

  it('sells personal materials and the season premium track once', async () => {
    const f = setup();
    await buyPack(f, 'pack');
    await f.service.buyOffer('alice', { requestId: 'm', offerId: 'materials_ferroalloys' });
    const lots = (await f.store.read('alice')).materials;
    expect(lots).toEqual([
      expect.objectContaining({
        materialId: 'ferroalloys',
        quantity: 30,
        soulbound: true,
        source: 'commerce',
      }),
    ]);
    const season = f.catalog.seasons[0]!.id;
    expect(
      (await f.service.buyOffer('alice', { requestId: 's', offerId: 'season_frontier_fleet' })).ok,
    ).toBe(true);
    expect((await f.store.read('alice')).season[season]).toMatchObject({ premium: true });
    expect(
      await f.service.buyOffer('alice', { requestId: 's2', offerId: 'season_frontier_fleet' }),
    ).toEqual({ ok: false, code: 'E_ALREADY_OWNED' });
  });

  it('refunds an unspent Sovereign pack and sends a spent one to review', async () => {
    const f = setup();
    const refundOf = (original: EntitlementCommandV1, id: string) =>
      f.entitlement(id, original.productId, {
        kind: 'revoke',
        originalCommandId: original.commandId,
        orderId: original.orderId,
        providerTransactionId: original.providerTransactionId,
      });
    const unspent = f.entitlement('unspent', 'sovereigns_100');
    await f.service.applyEntitlement(unspent);
    expect(await f.service.applyEntitlement(refundOf(unspent, 'r1'))).toMatchObject({
      ok: true,
      receipt: { status: 'revoked' },
    });
    expect((await f.service.readModel('alice')).sovereigns).toBe(0);
    const spent = f.entitlement('spent', 'sovereigns_330');
    await f.service.applyEntitlement(spent);
    await f.service.buyOffer('alice', { requestId: 'buy', offerId: 'premium_7' });
    expect(await f.service.applyEntitlement(refundOf(spent, 'r2'))).toMatchObject({
      ok: true,
      receipt: { status: 'review-required' },
    });
    expect((await f.service.readModel('alice')).sovereigns).toBe(330 - 149);
  });

  it('never credits Sovereigns from a rewarded ad', async () => {
    const f = setup();
    expect(
      await f.service.applyEntitlement(
        f.entitlement('ad', 'sovereigns_100', { source: 'rewarded_ad' }),
      ),
    ).toEqual({ ok: false, code: 'E_ENTITLEMENT' });
    expect((await f.service.readModel('alice')).sovereigns).toBe(0);
  });
});
