import { createHash } from 'node:crypto';
import { hashJson as gameDataHash, type ArsenalItem } from '@void/shared-core';
import { CORP_BACKDROP_STANDARD, CORP_STYLE_STANDARD } from '@void/protocol';
import type {
  EntitlementCommandV1,
  EntitlementReceipt,
  EntitlementResult,
  MaterialSource,
  MetaCommandReceipt,
  MetaCommandResult,
  MetaCorpStyleApplyCommand,
  MetaCorpStyleView,
  MetaCraftCommand,
  MetaEconomyAccount,
  MetaEconomyView,
  MetaMatchRewardsView,
  MedalGradeRef,
  MedalRewardGrant,
  MetaPremiumDailyCommand,
  MetaRecipeView,
  MetaSalvageCommand,
  MetaSeasonChoiceCommand,
  MetaSeasonState,
  MetaSelectPassCommand,
  MetaStoreBuyCommand,
  MetaStoreOfferView,
  MetaSupplyGoalCommand,
} from '@void/protocol';
import { chanceForPlace, pickFromPool, rollStream, type DropTables } from './dropRoller';
import type {
  MetaEconomyCatalog,
  MetaSeasonDefinition,
  MetaSeasonGrant,
  MetaStoreOffer,
} from './metaEconomyCatalog';
import type { MetaEconomyStore, MetaEconomyTransaction } from './metaEconomyStore';
import { parseEntitlementCommand } from './commerceTransport';

const DAY = 86_400_000;
const MAX_VALUE = 1_000_000_000;
const metricNames = ['recon', 'logistics', 'defense', 'objectives'] as const;
type OperationMetric = (typeof metricNames)[number];

/** Only the authoritative committed-match adapter may create these facts. */
export interface MatchRewardFacts {
  matchId: string;
  accountId: string;
  kind: 'stage' | 'final';
  stage?: number;
  place?: number;
  participation: boolean;
  /** Cumulative operation totals; the domain records a high-water mark. */
  seasonFacts?: Partial<Record<OperationMetric, number>>;
  occurredAt: number;
}

export interface MetaEconomyDeps {
  store: MetaEconomyStore;
  catalog: MetaEconomyCatalog;
  /** Retain fulfilled-order editions while their provider deliveries/refunds remain live. */
  catalogHistory?: readonly MetaEconomyCatalog[];
  dropTables: DropTables;
  now?: () => number;
  /** Observational only: failures never undo or block committed game value. */
  onEvent?: (event: MetaEconomyEvent) => void | Promise<void>;
}

export interface MetaEconomyEvent {
  accountId: string;
  catalogVersion: string;
  kind: string;
  receipt: MetaCommandReceipt | EntitlementReceipt;
}

/** Financial identities use a cryptographic digest, unlike the simulation hash. */
export function metaEconomyFingerprint(value: unknown): string {
  const canonical = (input: unknown): unknown => {
    if (Array.isArray(input)) return input.map(canonical);
    if (input !== null && typeof input === 'object') {
      return Object.fromEntries(
        Object.entries(input)
          .filter(([, entry]) => entry !== undefined)
          .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
          .map(([key, entry]) => [key, canonical(entry)]),
      );
    }
    return input;
  };
  return createHash('sha256')
    .update(JSON.stringify(canonical(value)))
    .digest('hex');
}

/** Account counter that records one paid medal degree. */
export const medalCounter = (ref: MedalGradeRef): string => `medal:${ref.medalId}:${ref.grade}`;

/** A corporation's record in the economy store: its base styles live here (CORP-14). The
 *  prefix keeps it apart from every player's record. */
export const corpEconomyKey = (corpId: string): string => `corp:${corpId}`;

/** What one medal degree pays under the catalog (`medals`): medals earned without playing
 *  pay their Sovereigns only. */
export function medalReward(
  table: MetaEconomyCatalog['medals'],
  ref: MedalGradeRef,
): MedalRewardGrant {
  const pay = table.grades[ref.grade];
  return table.sovereignsOnly.includes(ref.medalId)
    ? { ...ref, sovereigns: pay.sovereigns, warrants: 0, xp: 0 }
    : { ...ref, ...pay };
}

class MetaRejection extends Error {
  constructor(readonly code: string) {
    super(code);
  }
}

function reject(code: string): never {
  throw new MetaRejection(code);
}
function validKey(value: unknown): value is string {
  return (
    typeof value === 'string' &&
    value.length > 0 &&
    value.length <= 200 &&
    /^[a-zA-Z0-9_.:@/-]+$/.test(value) &&
    !['__proto__', 'prototype', 'constructor'].includes(value)
  );
}
function safeAdd(a: number, b: number): number {
  const result = a + b;
  if (!Number.isSafeInteger(result) || result < 0 || result > MAX_VALUE) reject('E_META_LIMIT');
  return result;
}
function premiumActive(account: MetaEconomyAccount, now: number): boolean {
  return (account.premiumUntil ?? 0) > now;
}
function receiptKey(kind: string, accountId: string, requestId: string): string {
  return `meta:${kind}:${metaEconomyFingerprint([accountId, requestId])}`;
}
export function metaSettlementReceiptKey(
  facts: Pick<MatchRewardFacts, 'accountId' | 'matchId' | 'kind' | 'stage'>,
): string {
  return receiptKey(
    'settlement',
    facts.accountId,
    metaEconomyFingerprint([facts.matchId, facts.kind, facts.stage ?? 0]),
  );
}
function totals(
  account: MetaEconomyAccount,
  materialId: string,
): { tradable: number; soulbound: number } {
  let tradable = 0;
  let soulbound = 0;
  for (const lot of account.materials) {
    if (lot.materialId !== materialId) continue;
    if (lot.soulbound) soulbound = safeAdd(soulbound, lot.quantity);
    else tradable = safeAdd(tradable, lot.quantity);
  }
  return { tradable, soulbound };
}
function boundItem(item: ArsenalItem): boolean {
  return (
    item.soulbound ||
    ['commerce', 'ad', 'season', 'lootbox', 'starter', 'rent'].includes(item.origin)
  );
}

/** All value changes share the local inventory/wallet transaction and durable receipts. */
export class MetaEconomy {
  private readonly now: () => number;
  constructor(private readonly deps: MetaEconomyDeps) {
    this.now = deps.now ?? Date.now;
  }

  private emit(event: MetaEconomyEvent): void {
    try {
      const pending = this.deps.onEvent?.(structuredClone(event));
      if (pending) void pending.catch(() => undefined);
    } catch {
      // Analytics is an observer, never the transaction's source of truth.
    }
  }

  /** `also` — further records the command changes, locked in the same transaction. */
  private async command(
    accountId: string,
    requestId: string,
    kind: string,
    payload: unknown,
    work: (
      tx: MetaEconomyTransaction,
      account: MetaEconomyAccount,
      receipt: MetaCommandReceipt,
    ) => Promise<void>,
    also: readonly string[] = [],
  ): Promise<MetaCommandResult> {
    if (!validKey(accountId) || !validKey(requestId) || !also.every(validKey))
      return { ok: false, code: 'E_META_REQUEST' };
    const key = receiptKey(kind, accountId, requestId);
    const fingerprint = metaEconomyFingerprint(payload);
    let applied = false;
    try {
      const result = await this.deps.store.transaction([accountId, ...also], async (tx) => {
        const previous = await tx.receipt(key);
        if (previous) {
          if (previous.fingerprint !== fingerprint) reject('E_IDEMPOTENCY_CONFLICT');
          return previous.response as MetaCommandResult;
        }
        const receipt: MetaCommandReceipt = { id: key, kind, at: this.now() };
        await work(tx, tx.account(accountId), receipt);
        const response: MetaCommandResult = { ok: true, receipt };
        await tx.saveReceipt(key, fingerprint, response);
        applied = true;
        return response;
      });
      if (applied && result.ok)
        this.emit({
          accountId,
          catalogVersion: this.deps.catalog.version,
          kind,
          receipt: result.receipt,
        });
      return result;
    } catch (error) {
      if (error instanceof MetaRejection) return { ok: false, code: error.code };
      throw error;
    }
  }

  private recipeView(account: MetaEconomyAccount, id: string): MetaRecipeView {
    const recipe = this.deps.catalog.recipes[id]!;
    const ingredients = Object.entries(recipe.ingredients).map(([materialId, required]) => ({
      materialId,
      required,
      ...totals(account, materialId),
    }));
    return {
      id,
      defId: recipe.defId,
      ingredients,
      canCraft: ingredients.every(
        (ingredient) => ingredient.tradable + ingredient.soulbound >= ingredient.required,
      ),
      requiresSoulbound: ingredients.some(
        (ingredient) => ingredient.tradable < ingredient.required,
      ),
      salvage: Object.entries(recipe.salvage).map(([materialId, quantity]) => ({
        materialId,
        quantity,
      })),
    };
  }

  async readModel(accountId: string): Promise<MetaEconomyView> {
    return this.deps.store.transaction([accountId], async (tx) => {
      const account = tx.account(accountId);
      const items = await tx.arsenal.listOf(accountId);
      const salvageableItemIds: string[] = [];
      for (const item of items) {
        if (this.salvageRecipe(item) && !(await tx.isItemListed(item.itemId)))
          salvageableItemIds.push(item.itemId);
      }
      const now = this.now();
      return {
        catalogVersion: this.deps.catalog.version,
        sovereigns: account.sovereigns ?? 0,
        premiumUntil: premiumActive(account, now) ? account.premiumUntil! : null,
        store: Object.entries(this.deps.catalog.store.offers).map(([id, offer]) =>
          this.storeOfferView(id, offer, account, items, now),
        ),
        premiumPerks: { ...this.deps.catalog.store.premium },
        premiumDaily:
          premiumActive(account, now) && this.deps.catalog.store.premium.dailySovereigns > 0
            ? {
                amount: this.deps.catalog.store.premium.dailySovereigns,
                claimed: Boolean(account.counters[`premium-daily:${Math.floor(now / DAY)}`]),
              }
            : null,
        ads: {
          used: account.counters[`ads:${Math.floor(now / DAY)}`] ?? 0,
          limit: this.adLimit(account, now),
        },
        materials: Object.entries(this.deps.catalog.materials).map(([id, material]) => ({
          id,
          nameKey: material.nameKey,
          ...totals(account, id),
        })),
        recipes: Object.keys(this.deps.catalog.recipes).map((id) => this.recipeView(account, id)),
        supplyGoal: account.supplyGoal ?? null,
        items,
        salvageableItemIds,
        cosmetics: [...account.cosmetics],
        seasons: this.deps.catalog.seasons.map((season) => {
          const progress = account.season[season.id];
          const endsAt = season.startsAt + season.durationDays * DAY;
          return {
            id: season.id,
            nameKey: season.nameKey,
            startsAt: season.startsAt,
            endsAt,
            levels: season.levels,
            xpPerLevel: season.xpPerLevel,
            ...(season.dailyXp ? { dailyXp: season.dailyXp } : {}),
            xp: progress?.xp ?? 0,
            level: this.seasonLevel(season, progress),
            premium: progress?.premium ?? false,
            active: account.activeSeasonId === season.id,
            started: progress !== undefined,
            archived: now >= endsAt,
            contracts: season.contracts.map((contract) => ({
              id: contract.id,
              metric: contract.metric,
              target: contract.target,
              progress: progress?.contracts[contract.id] ?? 0,
              xp: contract.xp,
              available: now >= season.startsAt + (contract.week - 1) * 7 * DAY,
              completed: progress?.claimed.includes(`contract:${contract.id}`) ?? false,
            })),
            milestones: season.milestones.map((milestone) => ({
              level: milestone.level,
              free: milestone.free.labelKey,
              premium: milestone.premium.labelKey,
              freeClaimed: progress?.claimed.includes(`free:${milestone.level}`) ?? false,
              premiumClaimed: progress?.claimed.includes(`premium:${milestone.level}`) ?? false,
              choices: milestone.free.choices ?? [],
              ...(milestone.free.module ? { module: milestone.free.module } : {}),
            })),
          };
        }),
        drops: {
          pityAfter: this.deps.dropTables.pityAfter,
          byPlace: [...this.deps.dropTables.byPlace]
            .sort((a, b) => a.maxPlace - b.maxPlace)
            .map(({ maxPlace, chance }) => ({ maxPlace, chance })),
          pool: this.deps.dropTables.pool.map(({ kind, defId, weight }) => ({
            kind,
            defId,
            weight,
          })),
        },
      };
    });
  }

  /** A result screen reads committed grants; opening it can never award game value. */
  async matchRewards(accountId: string, matchId: string): Promise<MetaMatchRewardsView> {
    // Observe the final commit first. A successful final receipt closes the operation,
    // so its earlier stage receipts are visible to every following read. Reading stages
    // first could combine an old empty stage snapshot with a newly committed final.
    const final = await this.deps.store.receipt(
      metaSettlementReceiptKey({ accountId, matchId, kind: 'final' }),
    );
    const keys = this.deps.catalog.rewards.stageFractions
      .slice(0, 10)
      .map((_fraction, index) =>
        metaSettlementReceiptKey({ accountId, matchId, kind: 'stage', stage: index + 1 }),
      );
    const stored = [...(await Promise.all(keys.map((key) => this.deps.store.receipt(key)))), final];
    const receipts = stored.flatMap((row) => {
      const result = row?.response as MetaCommandResult | undefined;
      return result?.ok && result.receipt ? [result.receipt] : [];
    });
    const finalResult = final?.response as MetaCommandResult | undefined;
    return { receipts, finalReady: Boolean(finalResult?.ok && finalResult.receipt) };
  }

  setSupplyGoal(accountId: string, command: MetaSupplyGoalCommand): Promise<MetaCommandResult> {
    return this.command(
      accountId,
      command.requestId,
      'supply-goal',
      command,
      async (_tx, account) => {
        if (
          command.recipeId !== null &&
          !Object.hasOwn(this.deps.catalog.recipes, command.recipeId)
        )
          reject('E_META_RECIPE');
        if (command.recipeId === null) delete account.supplyGoal;
        else {
          account.supplyGoal = command.recipeId;
          account.counters[`goal-selected:${command.recipeId}`] ??= this.now();
        }
      },
    );
  }

  craft(accountId: string, command: MetaCraftCommand): Promise<MetaCommandResult> {
    return this.command(
      accountId,
      command.requestId,
      'craft',
      command,
      async (tx, account, receipt) => {
        if (!Object.hasOwn(this.deps.catalog.recipes, command.recipeId)) reject('E_META_RECIPE');
        const recipe = this.deps.catalog.recipes[command.recipeId]!;
        const view = this.recipeView(account, command.recipeId);
        if (!view.canCraft) reject('E_META_MATERIALS');
        if (view.requiresSoulbound && command.allowSoulbound !== true)
          reject('E_SOULBOUND_CONFIRM');
        for (const [materialId, quantity] of Object.entries(recipe.ingredients)) {
          let remaining = quantity;
          const lots = account.materials
            .filter((lot) => lot.materialId === materialId)
            .sort(
              (a, b) =>
                Number(a.soulbound) - Number(b.soulbound) ||
                a.acquiredAt - b.acquiredAt ||
                a.lotId.localeCompare(b.lotId),
            );
          for (const lot of lots) {
            const consumed = Math.min(lot.quantity, remaining);
            if (consumed > 0)
              (receipt.spentMaterials ??= []).push({
                materialId,
                quantity: consumed,
                soulbound: lot.soulbound,
                lotId: lot.lotId,
                source: lot.source,
                sourceId: lot.sourceId,
              });
            lot.quantity -= consumed;
            remaining -= consumed;
          }
          if (remaining !== 0) reject('E_META_MATERIALS');
        }
        account.materials = account.materials.filter((lot) => lot.quantity > 0);
        const itemId = `craft:${metaEconomyFingerprint([accountId, command.requestId])}`;
        await tx.arsenal.grant({
          itemId,
          accountId,
          kind: 'module',
          form: 'instance',
          defId: recipe.defId,
          soulbound: view.requiresSoulbound,
          origin: 'craft',
          acquiredAt: receipt.at,
        });
        account.itemSources[itemId] = { source: 'craft', sourceId: receipt.id };
        receipt.itemIds = [itemId];
        receipt.soulbound = view.requiresSoulbound;
        if (account.supplyGoal === command.recipeId) {
          receipt.goalElapsedMs = Math.max(
            0,
            receipt.at - (account.counters[`goal-selected:${command.recipeId}`] ?? receipt.at),
          );
          receipt.firstSelectedCraft = !account.counters['selected-craft'];
          account.counters['selected-craft'] = 1;
        }
      },
    );
  }

  private salvageRecipe(item: ArsenalItem): MetaEconomyCatalog['recipes'][string] | undefined {
    if (item.kind !== 'module' || item.origin === 'starter' || item.origin === 'rent')
      return undefined;
    return Object.values(this.deps.catalog.recipes).find((recipe) => recipe.defId === item.defId);
  }

  salvage(accountId: string, command: MetaSalvageCommand): Promise<MetaCommandResult> {
    return this.command(
      accountId,
      command.requestId,
      'salvage',
      command,
      async (tx, account, receipt) => {
        const item = await tx.arsenal.get(command.itemId);
        if (!item || item.accountId !== accountId) reject('E_NOT_OWNER');
        const recipe = this.salvageRecipe(item);
        if (!recipe) reject('E_META_SALVAGE');
        if (await tx.isItemListed(item.itemId)) reject('E_ALREADY_LISTED');
        if (!(await tx.arsenal.consume(item.itemId, accountId))) reject('E_NOT_OWNER');
        const soulbound = boundItem(item);
        receipt.consumedItem = {
          itemId: item.itemId,
          defId: item.defId,
          origin: item.origin,
          soulbound,
          sourceId: account.itemSources[item.itemId]?.sourceId,
        };
        this.grantMaterials(
          account,
          recipe.salvage,
          soulbound,
          'salvage',
          receipt.id,
          receipt.at,
          receipt,
        );
        receipt.soulbound = soulbound;
      },
    );
  }

  private grantMaterials(
    account: MetaEconomyAccount,
    amounts: Record<string, number>,
    soulbound: boolean,
    source: MaterialSource,
    sourceId: string,
    at: number,
    receipt?: MetaCommandReceipt,
  ): void {
    for (const [materialId, quantity] of Object.entries(amounts)) {
      if (quantity === 0) continue;
      if (
        !Number.isSafeInteger(quantity) ||
        quantity < 0 ||
        !Object.hasOwn(this.deps.catalog.materials, materialId)
      )
        reject('E_META_MATERIALS');
      const total = totals(account, materialId);
      safeAdd(total.tradable + total.soulbound, quantity);
      account.materials.push({
        lotId: `material:${metaEconomyFingerprint([sourceId, materialId])}`,
        materialId,
        quantity,
        soulbound,
        source,
        sourceId,
        acquiredAt: at,
      });
      if (receipt) (receipt.materials ??= []).push({ materialId, quantity, soulbound });
    }
  }

  /** What the offer costs this account now and why it cannot be bought, if it cannot. */
  private storeTerms(
    id: string,
    offer: MetaStoreOffer,
    account: MetaEconomyAccount,
    items: readonly ArsenalItem[],
    now: number,
  ): {
    price: number;
    fullPrice: number;
    missing: string[];
    blocked?: MetaStoreOfferView['blocked'];
  } {
    const bought = account.counters[`offer:${id}`] ?? 0;
    const missing = (offer.modules ?? []).filter(
      (defId) => !items.some((item) => item.defId === defId),
    );
    const fullPrice = offer.modules
      ? missing.reduce((sum, defId) => sum + this.deps.catalog.store.modulePrices[defId]!, 0)
      : offer.price!;
    const price = Math.round((fullPrice * (100 - (offer.discountPercent ?? 0))) / 100);
    const season = offer.premiumSeason
      ? this.deps.catalog.seasons.find((row) => row.id === offer.premiumSeason)
      : undefined;
    let blocked: MetaStoreOfferView['blocked'];
    if (offer.limit !== undefined && bought >= offer.limit) blocked = 'limit';
    else if (offer.modules && missing.length === 0) blocked = 'owned';
    else if (season && account.season[season.id]?.premium) blocked = 'owned';
    else if (
      season &&
      (now < season.startsAt || now >= season.startsAt + season.durationDays * DAY)
    )
      blocked = 'season';
    return { price, fullPrice, missing, ...(blocked ? { blocked } : {}) };
  }

  private storeOfferView(
    id: string,
    offer: MetaStoreOffer,
    account: MetaEconomyAccount,
    items: readonly ArsenalItem[],
    now: number,
  ): MetaStoreOfferView {
    const terms = this.storeTerms(id, offer, account, items, now);
    return {
      id,
      category: offer.category,
      price: terms.price,
      ...(terms.fullPrice !== terms.price ? { fullPrice: terms.fullPrice } : {}),
      ...(offer.premiumDays ? { premiumDays: offer.premiumDays } : {}),
      ...(offer.premiumSeason ? { premiumSeason: offer.premiumSeason } : {}),
      ...(offer.modules
        ? {
            modules: offer.modules.map((defId) => ({
              defId,
              owned: !terms.missing.includes(defId),
            })),
          }
        : {}),
      ...(offer.materials ? { materials: { ...offer.materials } } : {}),
      ...(offer.corpStyle ? { corpStyle: offer.corpStyle } : {}),
      ...(offer.corpBackdrop ? { corpBackdrop: offer.corpBackdrop } : {}),
      ...(offer.limit !== undefined ? { limit: offer.limit } : {}),
      bought: account.counters[`offer:${id}`] ?? 0,
      ...(terms.blocked ? { blocked: terms.blocked } : {}),
    };
  }

  /** Rewarded-ad supplies allowed today: premium adds its extra ones. */
  private adLimit(account: MetaEconomyAccount, now: number): number {
    return (
      this.deps.catalog.commerce.dailyAdLimit +
      (premiumActive(account, now) ? this.deps.catalog.store.premium.extraDailyAds : 0)
    );
  }

  /** Running premium shows a frame on the public profile; no other account data leaves here. */
  async isPremium(accountId: string): Promise<boolean> {
    if (!validKey(accountId)) return false;
    return premiumActive(await this.deps.store.read(accountId), this.now());
  }

  /** Premium's daily Sovereigns: once per UTC day while premium runs. */
  claimPremiumDaily(
    accountId: string,
    command: MetaPremiumDailyCommand,
  ): Promise<MetaCommandResult> {
    return this.command(
      accountId,
      command.requestId,
      'premium-daily',
      command,
      async (_tx, account, receipt) => {
        const amount = this.deps.catalog.store.premium.dailySovereigns;
        if (amount === 0 || !premiumActive(account, receipt.at)) reject('E_PREMIUM');
        const counter = `premium-daily:${Math.floor(receipt.at / DAY)}`;
        if (account.counters[counter]) reject('E_DAILY_CLAIMED');
        account.counters[counter] = 1;
        account.sovereigns = safeAdd(account.sovereigns ?? 0, amount);
        receipt.sovereignsGranted = amount;
      },
    );
  }

  /** Medal degrees the account has reached but not been paid for yet. */
  async unpaidMedals(
    accountId: string,
    earned: readonly MedalGradeRef[],
  ): Promise<MedalGradeRef[]> {
    if (!validKey(accountId)) return [];
    const account = await this.deps.store.read(accountId);
    return earned.filter((ref) => !account.counters[medalCounter(ref)]);
  }

  /** Pays reached medal degrees once per account: Sovereigns and Warrants here. XP lives in
   *  the commander store, so the caller credits it per degree BEFORE this call
   *  (`medalRewards.ts`); the receipt lists the full grant, XP included. */
  claimMedals(accountId: string, earned: readonly MedalGradeRef[]): Promise<MetaCommandResult> {
    const keys = earned.map(medalCounter).sort();
    return this.command(
      accountId,
      metaEconomyFingerprint(['medals', keys]),
      'medal-reward',
      { medals: keys },
      async (tx, account, receipt) => {
        const medals: MedalRewardGrant[] = [];
        let sovereigns = 0;
        let warrants = 0;
        for (const ref of earned) {
          const counter = medalCounter(ref);
          if (account.counters[counter]) continue;
          const grant = medalReward(this.deps.catalog.medals, ref);
          account.counters[counter] = 1;
          sovereigns = safeAdd(sovereigns, grant.sovereigns);
          if (grant.warrants > 0) {
            await tx.creditWarrants(accountId, grant.warrants, 'medal_reward', counter, receipt.at);
            warrants = safeAdd(warrants, grant.warrants);
          }
          medals.push(grant);
        }
        account.sovereigns = safeAdd(account.sovereigns ?? 0, sovereigns);
        receipt.sovereignsGranted = sovereigns;
        receipt.warrants = warrants;
        receipt.medals = medals;
      },
    );
  }

  /** Spend Sovereigns on a store offer. Bought goods are personal (soulbound), like paid ones. */
  buyOffer(accountId: string, command: MetaStoreBuyCommand): Promise<MetaCommandResult> {
    return this.command(
      accountId,
      command.requestId,
      'store-buy',
      command,
      async (tx, account, receipt) => {
        if (
          !validKey(command.offerId) ||
          !Object.hasOwn(this.deps.catalog.store.offers, command.offerId)
        )
          reject('E_META_OFFER');
        const offer = this.deps.catalog.store.offers[command.offerId]!;
        // A base style or backdrop belongs to a corporation: it is bought through `buyCorpStyle`.
        if (offer.corpStyle || offer.corpBackdrop) reject('E_META_OFFER');
        const items = await tx.arsenal.listOf(accountId);
        const terms = this.storeTerms(command.offerId, offer, account, items, receipt.at);
        if (terms.blocked === 'limit') reject('E_OFFER_LIMIT');
        if (terms.blocked === 'owned') reject('E_ALREADY_OWNED');
        if (terms.blocked === 'season') reject('E_META_SEASON');
        const balance = account.sovereigns ?? 0;
        if (balance < terms.price) reject('E_SOVEREIGNS');
        account.sovereigns = balance - terms.price;
        receipt.sovereignsSpent = terms.price;
        const counter = `offer:${command.offerId}`;
        account.counters[counter] = safeAdd(account.counters[counter] ?? 0, 1);
        if (offer.materials)
          this.grantMaterials(
            account,
            offer.materials,
            true,
            'commerce',
            receipt.id,
            receipt.at,
            receipt,
          );
        for (const defId of terms.missing) {
          const itemId = `store-item:${metaEconomyFingerprint([receipt.id, defId])}`;
          await tx.arsenal.grant({
            itemId,
            accountId,
            kind: 'module',
            form: 'blueprint',
            defId,
            soulbound: true,
            origin: 'commerce',
            acquiredAt: receipt.at,
          });
          account.itemSources[itemId] = { source: 'commerce', sourceId: receipt.id };
          (receipt.itemIds ??= []).push(itemId);
        }
        if (offer.premiumDays) {
          // A new term extends a running one; an expired one restarts from now.
          const until = Math.max(receipt.at, account.premiumUntil ?? 0) + offer.premiumDays * DAY;
          if (!Number.isSafeInteger(until)) reject('E_META_LIMIT');
          account.premiumUntil = until;
          receipt.premiumUntil = account.premiumUntil;
        }
        if (offer.premiumSeason) {
          const season = this.deps.catalog.seasons.find((row) => row.id === offer.premiumSeason)!;
          const progress = this.startSeason(account, season, receipt.at);
          progress.premium = true;
          account.activeSeasonId ??= season.id;
          account.itemSources[`premium:${season.id}`] = {
            source: 'commerce',
            sourceId: receipt.id,
          };
          await this.grantMilestones(tx, accountId, account, season, receipt.at);
        }
        receipt.soulbound = true;
      },
    );
  }

  /** The corporation's base style and backdrop: applied and bought (CORP-14, CORP-15). */
  async corpStyle(corpId: string): Promise<Omit<MetaCorpStyleView, 'head'>> {
    const key = corpEconomyKey(corpId);
    const record = validKey(key) ? await this.deps.store.read(key) : undefined;
    return {
      active: record?.corpStyle ?? CORP_STYLE_STANDARD,
      backdrop: record?.corpBackdrop ?? CORP_BACKDROP_STANDARD,
      owned: [...(record?.cosmetics ?? [])],
    };
  }

  /** The head buys a base style or backdrop for the whole corporation with personal Sovereigns. The
   *  caller checks that `accountId` heads `corpId`; the corporation keeps the style when
   *  the head changes. */
  buyCorpStyle(
    accountId: string,
    corpId: string,
    command: MetaStoreBuyCommand,
  ): Promise<MetaCommandResult> {
    const corp = corpEconomyKey(corpId);
    return this.command(
      accountId,
      command.requestId,
      'corp-style-buy',
      { ...command, corpId },
      async (tx, account, receipt) => {
        if (
          !validKey(command.offerId) ||
          !Object.hasOwn(this.deps.catalog.store.offers, command.offerId)
        )
          reject('E_META_OFFER');
        const offer = this.deps.catalog.store.offers[command.offerId]!;
        const look = offer.corpStyle ?? offer.corpBackdrop;
        if (!look) reject('E_META_OFFER');
        const record = tx.account(corp);
        if (record.cosmetics.includes(look)) reject('E_ALREADY_OWNED');
        const price = offer.price!;
        const balance = account.sovereigns ?? 0;
        if (balance < price) reject('E_SOVEREIGNS');
        account.sovereigns = balance - price;
        record.cosmetics.push(look);
        receipt.sovereignsSpent = price;
        receipt.corpStyle = look;
      },
      [corp],
    );
  }

  /** The head applies a bought style or backdrop, or a free one, to the corporation's base.
   *  The catalog tells a backdrop from a style. The caller checks that the actor heads
   *  `corpId`. */
  applyCorpStyle(corpId: string, command: MetaCorpStyleApplyCommand): Promise<MetaCommandResult> {
    return this.command(
      corpEconomyKey(corpId),
      command.requestId,
      'corp-style-apply',
      command,
      async (_tx, record, receipt) => {
        const look = command.styleId;
        if (look === CORP_STYLE_STANDARD) delete record.corpStyle;
        else if (look === CORP_BACKDROP_STANDARD) delete record.corpBackdrop;
        else if (!record.cosmetics.includes(look)) reject('E_CORP_STYLE');
        else if (this.isBackdrop(look)) record.corpBackdrop = look;
        else record.corpStyle = look;
        receipt.corpStyle = command.styleId;
      },
    );
  }

  private isBackdrop(look: string): boolean {
    return Object.values(this.deps.catalog.store.offers).some(
      (offer) => offer.corpBackdrop === look,
    );
  }

  private seasonLevel(season: MetaSeasonDefinition, progress?: MetaSeasonState): number {
    return progress ? Math.min(season.levels, 1 + Math.floor(progress.xp / season.xpPerLevel)) : 0;
  }

  private startSeason(
    account: MetaEconomyAccount,
    season: MetaSeasonDefinition,
    at: number,
  ): MetaSeasonState {
    return (account.season[season.id] ??= {
      xp: 0,
      premium: false,
      startedAt: at,
      claimed: [],
      choices: {},
      contracts: {},
    });
  }

  selectPass(accountId: string, command: MetaSelectPassCommand): Promise<MetaCommandResult> {
    return this.command(
      accountId,
      command.requestId,
      'season-select',
      command,
      async (tx, account, receipt) => {
        const season = this.deps.catalog.seasons.find((row) => row.id === command.seasonId);
        if (!season) reject('E_META_SEASON');
        if (receipt.at < season.startsAt) reject('E_SEASON_NOT_STARTED');
        if (!account.season[season.id] && receipt.at >= season.startsAt + season.durationDays * DAY)
          reject('E_META_SEASON');
        this.startSeason(account, season, receipt.at);
        account.activeSeasonId = season.id;
        await this.grantMilestones(tx, accountId, account, season, receipt.at);
      },
    );
  }

  chooseSeasonReward(
    accountId: string,
    command: MetaSeasonChoiceCommand,
  ): Promise<MetaCommandResult> {
    return this.command(
      accountId,
      command.requestId,
      'season-choice',
      command,
      async (tx, account, receipt) => {
        const season = this.deps.catalog.seasons.find((row) => row.id === command.seasonId);
        if (!season) reject('E_META_SEASON');
        const progress = account.season[season.id];
        const milestone = season.milestones.find((row) => row.level === command.level);
        if (!progress || this.seasonLevel(season, progress) < command.level)
          reject('E_SEASON_LEVEL');
        if (!milestone?.free.choices?.includes(command.defId)) reject('E_SEASON_CHOICE');
        if (progress.claimed.includes(`free:${command.level}`)) reject('E_SEASON_CHOICE');
        progress.choices[String(command.level)] = command.defId;
        await this.grantMilestones(tx, accountId, account, season, receipt.at);
      },
    );
  }

  private async grantSeasonReward(
    tx: MetaEconomyTransaction,
    accountId: string,
    account: MetaEconomyAccount,
    season: MetaSeasonDefinition,
    level: number,
    track: 'free' | 'premium',
    reward: MetaSeasonGrant,
    at: number,
  ): Promise<void> {
    const sourceId = `season:${metaEconomyFingerprint([accountId, season.id, track, level])}`;
    if (reward.materials)
      this.grantMaterials(account, reward.materials, true, 'season', sourceId, at);
    if (reward.goalMaterials) {
      const recipe = account.supplyGoal ? this.deps.catalog.recipes[account.supplyGoal] : undefined;
      this.grantMaterials(
        account,
        recipe?.ingredients ?? this.deps.catalog.rewards.materials,
        true,
        'season',
        sourceId,
        at,
      );
    }
    const module =
      reward.module ??
      (reward.choices ? account.season[season.id]!.choices[String(level)] : undefined);
    if (module) {
      const itemId = `${sourceId}:module`;
      await tx.arsenal.grant({
        itemId,
        accountId,
        kind: 'module',
        form: 'blueprint',
        defId: module,
        soulbound: true,
        origin: 'season',
        acquiredAt: at,
      });
      account.itemSources[itemId] = { source: 'season', sourceId };
    }
    if (reward.cosmetic && !account.cosmetics.includes(reward.cosmetic))
      account.cosmetics.push(reward.cosmetic);
  }

  private async grantMilestones(
    tx: MetaEconomyTransaction,
    accountId: string,
    account: MetaEconomyAccount,
    season: MetaSeasonDefinition,
    at: number,
  ): Promise<void> {
    const progress = account.season[season.id]!;
    for (const milestone of season.milestones) {
      if (this.seasonLevel(season, progress) < milestone.level) continue;
      for (const track of ['free', 'premium'] as const) {
        const key = `${track}:${milestone.level}`;
        if (progress.claimed.includes(key) || (track === 'premium' && !progress.premium)) continue;
        const reward = milestone[track];
        if (reward.choices && !progress.choices[String(milestone.level)]) continue;
        await this.grantSeasonReward(
          tx,
          accountId,
          account,
          season,
          milestone.level,
          track,
          reward,
          at,
        );
        progress.claimed.push(key);
      }
    }
  }

  private async progressSeason(
    tx: MetaEconomyTransaction,
    facts: Pick<MatchRewardFacts, 'accountId' | 'occurredAt'>,
    account: MetaEconomyAccount,
    xp: number | ((season: MetaSeasonDefinition) => number),
    metrics: Record<string, number>,
    receipt: MetaCommandReceipt,
  ): Promise<void> {
    let season = this.deps.catalog.seasons.find((row) => row.id === account.activeSeasonId);
    if (!season) {
      season = this.deps.catalog.seasons.find(
        (row) =>
          facts.occurredAt >= row.startsAt &&
          facts.occurredAt < row.startsAt + row.durationDays * DAY,
      );
      if (!season) return;
      account.activeSeasonId = season.id;
    }
    if (facts.occurredAt < season.startsAt) return;
    const progress = this.startSeason(account, season, receipt.at);
    let earnedXp = typeof xp === 'number' ? xp : xp(season);
    for (const contract of season.contracts) {
      if (
        facts.occurredAt < season.startsAt + (contract.week - 1) * 7 * DAY ||
        progress.claimed.includes(`contract:${contract.id}`)
      )
        continue;
      const value = metrics[contract.metric] ?? 0;
      progress.contracts[contract.id] = Math.min(
        contract.target,
        safeAdd(progress.contracts[contract.id] ?? 0, value),
      );
      if (progress.contracts[contract.id] === contract.target) {
        earnedXp = safeAdd(earnedXp, contract.xp);
        progress.claimed.push(`contract:${contract.id}`);
      }
    }
    const previousXp = progress.xp;
    const maxXp = (season.levels - 1) * season.xpPerLevel;
    progress.xp = Math.min(maxXp, safeAdd(previousXp, earnedXp));
    receipt.seasonXp = progress.xp - previousXp;
    receipt.seasonCompleted = previousXp < maxXp && progress.xp === maxXp;
    await this.grantMilestones(tx, facts.accountId, account, season, receipt.at);
  }

  settle(facts: MatchRewardFacts): Promise<MetaCommandResult> {
    if (
      !validKey(facts.matchId) ||
      !Number.isSafeInteger(facts.occurredAt) ||
      facts.occurredAt < 0 ||
      !['stage', 'final'].includes(facts.kind) ||
      (facts.kind === 'final' &&
        (!Number.isSafeInteger(facts.place) || facts.place! < 1 || facts.stage !== undefined)) ||
      (facts.kind === 'stage' &&
        (!Number.isSafeInteger(facts.stage) ||
          facts.stage! < 1 ||
          facts.stage! > this.deps.catalog.rewards.stageFractions.length)) ||
      Object.entries(facts.seasonFacts ?? {}).some(
        ([key, value]) =>
          !metricNames.includes(key as OperationMetric) ||
          !Number.isSafeInteger(value) ||
          value < 0 ||
          value > MAX_VALUE,
      )
    ) {
      return Promise.resolve({ ok: false, code: 'E_META_FACTS' });
    }
    if (!facts.participation) return Promise.resolve({ ok: false, code: 'E_NOT_PARTICIPATING' });
    return this.command(
      facts.accountId,
      metaEconomyFingerprint([facts.matchId, facts.kind, facts.stage ?? 0]),
      'settlement',
      facts,
      async (tx, account, receipt) => {
        const policy = this.deps.catalog.rewards;
        const operation = (account.operations[facts.matchId] ??= {
          materials: {},
          seasonXp: 0,
          finalized: false,
          metrics: {},
          budget: { ...policy.materials },
          policyVersion: this.deps.catalog.version,
          seasonXpBudget: policy.seasonXp,
        });
        if (operation.finalized) reject('E_MATCH_SETTLED');
        const bonus =
          facts.kind === 'final'
            ? (policy.resultBonuses.find((row) => facts.place! <= row.maxPlace)?.percent ?? 0)
            : 0;
        const fraction =
          facts.kind === 'final' ? 1 + bonus / 100 : policy.stageFractions[facts.stage! - 1]!;
        const materials: Record<string, number> = {};
        for (const [materialId, total] of Object.entries(operation.budget ?? policy.materials)) {
          const target = Math.floor(total * fraction);
          materials[materialId] = Math.max(0, target - (operation.materials[materialId] ?? 0));
          operation.materials[materialId] = Math.max(target, operation.materials[materialId] ?? 0);
        }
        this.grantMaterials(
          account,
          materials,
          false,
          'match',
          receipt.id,
          facts.occurredAt,
          receipt,
        );
        const totalXp = Math.floor((operation.seasonXpBudget ?? policy.seasonXp) * fraction);
        const deltaXp = Math.max(0, totalXp - operation.seasonXp);
        operation.seasonXp = Math.max(totalXp, operation.seasonXp);
        const metrics: Record<string, number> = {};
        operation.metrics ??= {};
        for (const metric of metricNames) {
          const total = facts.seasonFacts?.[metric] ?? 0;
          metrics[metric] = Math.max(0, total - (operation.metrics[metric] ?? 0));
          operation.metrics[metric] = Math.max(total, operation.metrics[metric] ?? 0);
        }
        if (facts.kind === 'final') {
          operation.finalized = true;
          metrics.matches = 1;
          // Existing AvA claims survive migration; they must never reroll the old drop.
          if (await tx.drops.claim(facts.matchId, facts.accountId)) {
            const rng = rollStream(`${facts.matchId}:${facts.accountId}`);
            const hit = rng() < chanceForPlace(this.deps.dropTables, facts.place!);
            const pity = await tx.drops.stepPity(
              facts.accountId,
              hit,
              this.deps.dropTables.pityAfter,
            );
            const forced = pity + 1 >= this.deps.dropTables.pityAfter;
            receipt.dropOdds = {
              chance: chanceForPlace(this.deps.dropTables, facts.place!),
              pity,
              forced,
              tablesHash: gameDataHash(this.deps.dropTables),
            };
            receipt.drop = null;
            if (hit || forced) {
              const found = pickFromPool(this.deps.dropTables.pool, rng());
              const itemId = `drop:${facts.matchId}:${facts.accountId}`;
              await tx.arsenal.grant({
                itemId,
                accountId: facts.accountId,
                kind: found.kind,
                form: 'blueprint',
                defId: found.defId,
                soulbound: false,
                origin: 'drop',
                acquiredAt: facts.occurredAt,
              });
              account.itemSources[itemId] = { source: 'match', sourceId: receipt.id };
              receipt.itemIds = [itemId];
              receipt.drop = { kind: found.kind, defId: found.defId, forced };
            }
          }
          const day = Math.floor(facts.occurredAt / DAY);
          const counter = `warrants:${day}`;
          const warrants = Math.max(
            0,
            Math.min(policy.warrants, policy.dailyWarrants - (account.counters[counter] ?? 0)),
          );
          if (warrants > 0) {
            await tx.creditWarrants(
              facts.accountId,
              warrants,
              'match_reward',
              facts.matchId,
              facts.occurredAt,
            );
            account.counters[counter] = safeAdd(account.counters[counter] ?? 0, warrants);
          }
          receipt.warrants = warrants;
        }
        await this.progressSeason(tx, facts, account, deltaXp, metrics, receipt);
      },
    );
  }

  /** Season tempo in real time: one UTC day with the account's own orders in a match
   *  grants the pass's `dailyXp` once, however many matches it played that day. */
  settleActiveDay(accountId: string, day: number): Promise<MetaCommandResult> {
    if (!Number.isSafeInteger(day) || day < 0 || day * DAY > Number.MAX_SAFE_INTEGER) {
      return Promise.resolve({ ok: false, code: 'E_META_FACTS' });
    }
    return this.command(
      accountId,
      metaEconomyFingerprint(['active-day', day]),
      'season-day',
      { day },
      (tx, account, receipt) =>
        this.progressSeason(
          tx,
          { accountId, occurredAt: day * DAY },
          account,
          (season) => season.dailyXp ?? 0,
          {},
          receipt,
        ),
    );
  }

  async entitlementStatus(commandId: string): Promise<EntitlementReceipt | null> {
    if (!validKey(commandId)) return null;
    const stored = await this.deps.store.receipt(`entitlement:${commandId}`);
    const result = stored?.response as EntitlementResult | undefined;
    if (!result?.ok) return null;
    const revoked = (await this.deps.store.receipt(`entitlement-revocation:${commandId}`))
      ?.response as EntitlementReceipt | undefined;
    return revoked ? { ...result.receipt, status: revoked.status } : result.receipt;
  }

  async applyEntitlement(command: EntitlementCommandV1): Promise<EntitlementResult> {
    if (!parseEntitlementCommand(command)) return { ok: false, code: 'E_ENTITLEMENT' };
    const key = `entitlement:${command.commandId}`;
    const fingerprint = metaEconomyFingerprint(command);
    let applied = false;
    try {
      const result = await this.deps.store.transaction([command.accountId], async (tx) => {
        const previous = await tx.receipt(key);
        if (previous) {
          if (previous.fingerprint !== fingerprint) reject('E_IDEMPOTENCY_CONFLICT');
          return previous.response as EntitlementResult;
        }
        const account = tx.account(command.accountId);
        const receipt: EntitlementReceipt = {
          commandId: command.commandId,
          payloadHash: command.payloadHash,
          status: 'applied',
          at: this.now(),
        };
        if (command.kind === 'revoke') {
          await this.revokeEntitlement(tx, account, command, receipt);
        } else {
          const edition = [this.deps.catalog, ...(this.deps.catalogHistory ?? [])].find(
            (catalog) => catalog.version === command.catalogVersion,
          );
          if (!edition || !Object.hasOwn(edition.commerce.products, command.productId))
            reject('E_ENTITLEMENT');
          const product = edition.commerce.products[command.productId]!;
          if (product.source !== command.source) reject('E_ENTITLEMENT');
          const providerKey = `entitlement-provider:${metaEconomyFingerprint([command.provider, command.providerTransactionId])}`;
          const providerReceipt = await tx.receipt(providerKey);
          if (providerReceipt) reject('E_IDEMPOTENCY_CONFLICT');
          const source: MaterialSource = command.source === 'rewarded_ad' ? 'ad' : 'commerce';
          if (source === 'ad') {
            const counter = `ads:${Math.floor(receipt.at / DAY)}`;
            if ((account.counters[counter] ?? 0) >= this.adLimit(account, receipt.at))
              reject('E_AD_LIMIT');
            account.counters[counter] = safeAdd(account.counters[counter] ?? 0, 1);
          }
          if (product.materials)
            this.grantMaterials(
              account,
              product.materials,
              true,
              source,
              command.commandId,
              receipt.at,
            );
          if (product.module) {
            const itemId = `entitlement-item:${metaEconomyFingerprint(command.commandId)}`;
            await tx.arsenal.grant({
              itemId,
              accountId: command.accountId,
              kind: 'module',
              form: 'blueprint',
              defId: product.module,
              soulbound: true,
              origin: source,
              acquiredAt: receipt.at,
            });
            account.itemSources[itemId] = { source, sourceId: command.commandId };
          }
          if (product.sovereigns)
            account.sovereigns = safeAdd(
              account.sovereigns ?? 0,
              product.sovereigns + (product.bonusSovereigns ?? 0),
            );
          if (product.premiumSeason) {
            const season = this.deps.catalog.seasons.find(
              (row) => row.id === product.premiumSeason,
            );
            if (
              !season ||
              command.at < season.startsAt ||
              command.at >= season.startsAt + season.durationDays * DAY
            )
              reject('E_META_SEASON');
            const progress = this.startSeason(account, season, receipt.at);
            if (progress.premium) reject('E_ALREADY_OWNED');
            progress.premium = true;
            account.activeSeasonId ??= season.id;
            account.itemSources[`premium:${season.id}`] = { source, sourceId: command.commandId };
            await this.grantMilestones(tx, command.accountId, account, season, receipt.at);
          }
          await tx.saveReceipt(
            providerKey,
            metaEconomyFingerprint([command.accountId, command.productId, command.orderId]),
            command,
          );
          await tx.saveReceipt(`entitlement-origin:${command.commandId}`, fingerprint, {
            command,
            product,
          });
        }
        const response: EntitlementResult = { ok: true, receipt };
        await tx.saveReceipt(key, fingerprint, response);
        applied = true;
        return response;
      });
      if (applied && result.ok)
        this.emit({
          accountId: command.accountId,
          catalogVersion: command.catalogVersion,
          kind: `entitlement-${command.kind}:${command.source}`,
          receipt: result.receipt,
        });
      return result;
    } catch (error) {
      if (error instanceof MetaRejection) return { ok: false, code: error.code };
      throw error;
    }
  }

  private async revokeEntitlement(
    tx: MetaEconomyTransaction,
    account: MetaEconomyAccount,
    command: EntitlementCommandV1,
    receipt: EntitlementReceipt,
  ): Promise<void> {
    if (!command.originalCommandId || !validKey(command.originalCommandId)) reject('E_ENTITLEMENT');
    const stored = (await tx.receipt(`entitlement-origin:${command.originalCommandId}`))
      ?.response as
      | {
          command: EntitlementCommandV1;
          product: MetaEconomyCatalog['commerce']['products'][string];
        }
      | undefined;
    const original = stored?.command;
    if (
      !original ||
      original.accountId !== command.accountId ||
      original.productId !== command.productId ||
      original.orderId !== command.orderId ||
      original.provider !== command.provider ||
      original.providerTransactionId !== command.providerTransactionId ||
      original.source !== command.source ||
      original.catalogVersion !== command.catalogVersion
    )
      reject('E_ENTITLEMENT');
    const revocationKey = `entitlement-revocation:${original.commandId}`;
    const previous = await tx.receipt(revocationKey);
    if (previous) {
      receipt.status = (previous.response as EntitlementReceipt).status;
      return;
    }
    const product = stored!.product;
    const lots = account.materials.filter(
      (lot) =>
        lot.sourceId === original.commandId &&
        lot.soulbound &&
        (lot.source === 'commerce' || lot.source === 'ad'),
    );
    let recoverable =
      !product.materials ||
      Object.entries(product.materials).every(
        ([materialId, quantity]) =>
          lots
            .filter((lot) => lot.materialId === materialId)
            .reduce((sum, lot) => sum + lot.quantity, 0) === quantity,
      );
    const itemId = `entitlement-item:${metaEconomyFingerprint(original.commandId)}`;
    const item = product.module ? await tx.arsenal.get(itemId) : null;
    if (product.module && (!item || item.accountId !== command.accountId || !boundItem(item)))
      recoverable = false;
    if (product.premiumSeason) {
      const progress = account.season[product.premiumSeason];
      if (!progress?.premium || progress.claimed.some((claim) => claim.startsWith('premium:')))
        recoverable = false;
    }
    // Sovereigns already spent cannot be taken back automatically: a person reviews it.
    const sovereigns = (product.sovereigns ?? 0) + (product.bonusSovereigns ?? 0);
    if ((account.sovereigns ?? 0) < sovereigns) recoverable = false;
    receipt.status = recoverable ? 'revoked' : 'review-required';
    if (recoverable) {
      if (sovereigns > 0) account.sovereigns = (account.sovereigns ?? 0) - sovereigns;
      account.materials = account.materials.filter((lot) => !lots.includes(lot));
      if (product.module && !(await tx.arsenal.consume(itemId, command.accountId)))
        reject('E_NOT_OWNER');
      if (product.premiumSeason) account.season[product.premiumSeason]!.premium = false;
    }
    await tx.saveReceipt(revocationKey, metaEconomyFingerprint(original), receipt);
  }
}
