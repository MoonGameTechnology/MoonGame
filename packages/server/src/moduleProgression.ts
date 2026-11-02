import { readFileSync } from 'node:fs';
import { z } from 'zod';
import { createHash, randomBytes } from 'node:crypto';
import { RARITIES, type ArsenalItem, type GameData } from '@void/shared-core';
import type {
  MetaCommandReceipt,
  MetaEconomyAccount,
  ModuleUpgradeCommand,
  ModuleUpgradeQuote,
} from '@void/protocol';
import type { MetaEconomyTransaction } from './metaEconomyStore';

const policy = z
  .object({
    version: z.string().min(1),
    blueprints: z
      .object({
        firstPlaceChance: z.number().min(0).max(1),
        otherPlaceChance: z.number().min(0).max(1),
        tiers: z
          .array(
            z
              .object({
                rarity: z.enum(['unique', 'mythic', 'legendary']),
                weight: z.number().positive(),
              })
              .strict(),
          )
          .min(1),
      })
      .strict(),
  })
  .strict()
  .parse(JSON.parse(readFileSync('data/metaModuleProgression.json', 'utf8')));
export const moduleBlueprintOdds = {
  first: policy.blueprints.firstPlaceChance,
  other: policy.blueprints.otherPlaceChance,
};

type ModuleData = Pick<GameData, 'modules' | 'sectorZeroStars'>;
type Reject = (code: string) => never;
const seed = (): string => randomBytes(32).toString('hex');
/** Each committed attempt retains its own seed. Revealing it cannot predict the next. */
export const moduleRoll = (value: string): number =>
  createHash('sha256').update(value).digest().readUInt32BE(0) / 0x1_0000_0000;
const bound = (i: ArsenalItem): boolean =>
  i.soulbound || ['starter', 'rent', 'ad', 'commerce', 'lootbox', 'season'].includes(i.origin);
const spare = (i: ArsenalItem, target: ArsenalItem): boolean =>
  i.itemId !== target.itemId &&
  i.kind === 'module' &&
  i.defId === target.defId &&
  !['starter', 'rent'].includes(i.origin) &&
  !i.grade &&
  !i.rarity &&
  !i.preferred &&
  i.durability !== 0;
const rarity = (i: ArsenalItem, data: ModuleData): (typeof RARITIES)[number] => {
  const base = data.modules[i.defId]?.rarity ?? 'simple';
  return i.rarity && RARITIES.indexOf(i.rarity) > RARITIES.indexOf(base) ? i.rarity : base;
};

function quote(
  item: ArsenalItem,
  mode: 'stars' | 'rarity',
  items: readonly ArsenalItem[],
  listed: ReadonlySet<string>,
  account: MetaEconomyAccount,
  balance: number,
  data: ModuleData,
): ModuleUpgradeQuote {
  const tier = rarity(item, data),
    grade = item.grade ?? 0;
  const cap = Math.min(
    data.sectorZeroStars.cap,
    data.sectorZeroStars.capByRarity?.[tier] ?? data.sectorZeroStars.cap,
  );
  const step = data.sectorZeroStars.steps[grade];
  const nextTier = RARITIES[RARITIES.indexOf(tier) + 1];
  const copies = items
    .filter((i) => spare(i, item) && !listed.has(i.itemId))
    .sort((a, b) => Number(bound(a)) - Number(bound(b)) || a.itemId.localeCompare(b.itemId))
    .slice(0, 3);
  const misses = item.upgrade?.misses ?? 0;
  const guaranteed =
    grade < data.sectorZeroStars.guaranteed || (!!step?.pity && misses >= step.pity);
  const warrants = mode === 'stars' ? (step?.warrants ?? 0) : 0;
  const top = mode === 'stars' ? grade >= cap || !step : !nextTier;
  const blueprintOwned = account.moduleBlueprints?.[nextTier ?? ''] ?? 0;
  const reason =
    item.kind !== 'module' ||
    item.origin === 'starter' ||
    !data.modules[item.defId] ||
    item.origin === 'rent' ||
    item.durability === 0
      ? 'E_MODULE_INSTANCE'
      : listed.has(item.itemId)
        ? 'E_ITEM_LISTED'
        : top
          ? 'E_MODULE_CAP'
          : copies.length < 3
            ? 'E_MODULE_COPIES'
            : mode === 'rarity' && blueprintOwned < 1
              ? 'E_MODULE_BLUEPRINT'
              : balance < warrants
                ? 'E_INSUFFICIENT'
                : null;
  return {
    itemId: item.itemId,
    mode,
    grade,
    rarity: tier,
    next: top ? null : mode === 'stars' ? grade + 1 : nextTier!,
    cap,
    chance: mode === 'rarity' || guaranteed ? 1 : (step?.chance ?? 0),
    misses,
    pity: step?.pity ?? 0,
    warrants,
    ingredientIds: copies.map((i) => i.itemId),
    binds: bound(item) || copies.some(bound),
    reason,
    ...(mode === 'rarity' && nextTier ? { blueprint: nextTier, blueprintOwned } : {}),
  };
}

export async function moduleQuotes(
  tx: MetaEconomyTransaction,
  accountId: string,
  account: MetaEconomyAccount,
  items: readonly ArsenalItem[],
  data: ModuleData,
): Promise<ModuleUpgradeQuote[]> {
  const listed = new Set<string>();
  for (const i of [...items].sort((a, b) => a.itemId.localeCompare(b.itemId)))
    if (await tx.isItemListed(i.itemId)) listed.add(i.itemId);
  const balance = await tx.warrants(accountId);
  return items
    .filter((i) => i.kind === 'module' && !['starter', 'rent'].includes(i.origin))
    .flatMap((i) => [
      quote(i, 'stars', items, listed, account, balance, data),
      quote(i, 'rarity', items, listed, account, balance, data),
    ]);
}

export async function selectModule(
  tx: MetaEconomyTransaction,
  accountId: string,
  itemId: string,
  reject: Reject,
): Promise<void> {
  const items = await tx.arsenal.listOf(accountId);
  const target = items.find((i) => i.itemId === itemId);
  if (!target || target.kind !== 'module' || target.durability === 0) reject('E_NOT_OWNER');
  for (const item of items
    .filter((i) => i.defId === target.defId && i.kind === 'module')
    .sort((a, b) => a.itemId.localeCompare(b.itemId))) {
    // Lock then re-read: a sale must not restore a stale item to its former owner.
    if ((await tx.isItemListed(item.itemId)) && item.itemId === itemId) reject('E_ITEM_LISTED');
    const current = await tx.arsenal.get(item.itemId);
    if (!current || current.accountId !== accountId) {
      if (item.itemId === itemId) reject('E_NOT_OWNER');
      else continue;
    }
    delete current.preferred;
    if (item.itemId === itemId) current.preferred = true;
    if (!(await tx.arsenal.update(current))) reject('E_NOT_OWNER');
  }
}

export async function upgradeModule(
  tx: MetaEconomyTransaction,
  accountId: string,
  account: MetaEconomyAccount,
  receipt: MetaCommandReceipt,
  command: ModuleUpgradeCommand,
  data: ModuleData | undefined,
  reject: Reject,
  makeSeed = seed,
): Promise<void> {
  if (!data) reject('E_UNAVAILABLE');
  if (
    !['stars', 'rarity'].includes(command.mode) ||
    !Array.isArray(command.ingredientIds) ||
    command.ingredientIds.length !== 3 ||
    new Set(command.ingredientIds).size !== 3 ||
    command.ingredientIds.includes(command.itemId)
  )
    reject('E_BAD_REQUEST');
  // Same order for every multi-item operation; listing lock also locks the arsenal row.
  for (const id of [command.itemId, ...command.ingredientIds].sort())
    if (await tx.isItemListed(id)) reject('E_ITEM_LISTED');
  const target = await tx.arsenal.get(command.itemId);
  if (!target || target.accountId !== accountId) reject('E_NOT_OWNER');
  if ((target.grade ?? 0) !== command.grade || rarity(target, data) !== command.rarity)
    reject('E_MODULE_CHANGED');
  const inputs: ArsenalItem[] = [];
  for (const id of command.ingredientIds) {
    const item = await tx.arsenal.get(id);
    if (!item || item.accountId !== accountId || !spare(item, target)) reject('E_MODULE_COPIES');
    const { accountId: _owner, ...asset } = item;
    inputs.push(asset);
  }
  const plan = quote(
    target,
    command.mode,
    [target, ...inputs],
    new Set(),
    account,
    await tx.warrants(accountId),
    data,
  );
  if (plan.reason) reject(plan.reason);
  if (plan.binds && !target.soulbound && !command.allowSoulbound) reject('E_SOULBOUND_CONFIRM');
  if (plan.warrants && !(await tx.spendWarrants(accountId, plan.warrants, receipt.id, receipt.at)))
    reject('E_INSUFFICIENT');
  for (const item of inputs)
    if (!(await tx.arsenal.consume(item.itemId, accountId))) reject('E_NOT_OWNER');
  const attemptSeed = makeSeed(),
    success = plan.chance >= 1 || moduleRoll(attemptSeed) < plan.chance;
  if (command.mode === 'rarity') {
    account.moduleBlueprints![plan.blueprint!] =
      (account.moduleBlueprints![plan.blueprint!] ?? 0) - 1;
    target.rarity = plan.next as ArsenalItem['rarity'];
  } else {
    if (success) target.grade = Number(plan.next);
    target.upgrade = {
      attempts: (target.upgrade?.attempts ?? 0) + 1,
      misses: success ? 0 : (target.upgrade?.misses ?? 0) + 1,
    };
  }
  // Consuming bound inputs cannot launder them through a tradable target, even on failure.
  target.soulbound ||= plan.binds;
  target.form = 'instance';
  if (!(await tx.arsenal.update(target))) reject('E_NOT_OWNER');
  receipt.itemIds = [target.itemId];
  receipt.soulbound = target.soulbound;
  receipt.moduleUpgrade = {
    itemId: target.itemId,
    mode: command.mode,
    success,
    from: command.mode === 'stars' ? command.grade : command.rarity,
    to: success ? plan.next! : command.grade,
    chance: plan.chance,
    seed: attemptSeed,
    consumedIds: [...command.ingredientIds],
    consumedItems: structuredClone(inputs),
    warrants: plan.warrants,
  };
}

/** Online final rewards have their own earned blueprint balance, never the local Sector Zero save. */
export function grantModuleBlueprint(
  account: MetaEconomyAccount,
  receipt: MetaCommandReceipt,
  won: boolean,
  makeSeed = seed,
): void {
  const value = makeSeed();
  const chance = won ? moduleBlueprintOdds.first : moduleBlueprintOdds.other;
  if (moduleRoll(value) >= chance) return;
  let roll =
    moduleRoll(`${value}:tier`) * policy.blueprints.tiers.reduce((sum, row) => sum + row.weight, 0);
  const tier =
    policy.blueprints.tiers.find((row) => (roll -= row.weight) < 0)?.rarity ??
    policy.blueprints.tiers.at(-1)!.rarity;
  const blueprints = (account.moduleBlueprints ??= {});
  blueprints[tier] = (blueprints[tier] ?? 0) + 1;
  receipt.moduleBlueprint = tier;
  receipt.moduleBlueprintRoll = { seed: value, chance, policy: policy.version };
}
