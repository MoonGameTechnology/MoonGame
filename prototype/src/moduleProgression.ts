import {
  buildModuleCopies,
  moduleStarMultiplier,
  moduleRarityBonus,
  type ArsenalItem,
} from '../../packages/shared-core/src/index';
import type {
  ModuleUpgradeQuote,
  MetaEconomyView,
} from '../../packages/protocol/src/metaEconomyView';
import { t, tData } from '../../localization/runtime';
import { data } from './gameData';
import { esc, nfmt } from './format';
import { effectChip } from './moduleEffect';
import { moduleIcon } from './moduleIcons';

export function moduleItemEffects(item: ArsenalItem): string[] {
  const def = data.modules[item.defId];
  if (!def || item.kind !== 'module') return [];
  const stats = { ...def.effects.stats };
  for (const [k, v] of Object.entries(
    moduleRarityBonus(def, item.rarity ?? def.rarity ?? 'simple'),
  ))
    stats[k] = (stats[k] ?? 0) + v;
  return Object.entries(stats).map(([k, v]) =>
    effectChip(k, v * moduleStarMultiplier(item.grade ?? 0, data)),
  );
}
export function moduleItemHtml(item: ArsenalItem): string {
  if (item.kind !== 'module') return '';
  const tier = item.rarity ?? data.modules[item.defId]?.rarity ?? 'simple';
  const cap = data.sectorZeroStars.capByRarity?.[tier] ?? 6;
  return `<div class="mi-summary r-${esc(tier)}"><span class="mi-art" aria-hidden="true">${moduleIcon(item.defId)}</span><div><b>${esc(t('rarity.' + tier))}</b><span class="mi-stars" aria-label="${esc(t('module.stars', { n: item.grade ?? 0, cap }))}">${'★'.repeat(item.grade ?? 0)}${'☆'.repeat(Math.max(0, cap - (item.grade ?? 0)))}</span></div></div><div class="mi-effects" aria-label="${esc(t('module.effect'))}">${moduleItemEffects(
    item,
  )
    .map((e) => `<span>${esc(e)}</span>`)
    .join('')}</div>`;
}
export function moduleCopyControls(
  item: ArsenalItem,
  items: readonly ArsenalItem[],
  view: MetaEconomyView,
  busy: boolean,
): string {
  const chosen = buildModuleCopies(items).some((i) => i.itemId === item.itemId);
  const quotes = view.moduleUpgrades?.filter((q) => chosen && q.itemId === item.itemId) ?? [];
  return `<div class="mi-upgrades">${moduleItemHtml(item)}<div class="ar-acts-row">${chosen ? `<span class="ar-tagline">✓ ${t('module.selected')}</span>` : `<button type="button" class="btn-second" data-ar-select="${esc(item.itemId)}"${busy ? ' disabled' : ''}>${t('module.select')}</button>`}</div>${quotes.map((q) => `<div class="mi-upgrade"><div><b>${q.next === null ? t('module.max') : q.mode === 'stars' ? t('module.star-up', { n: q.next }) : esc(t('rarity.' + q.next))}</b><span>${t('module.cost', { n: nfmt(q.warrants) })} · ${t('module.odds', { n: Math.round(q.chance * 100) })}</span>${q.mode === 'stars' && q.pity ? `<small>${t('module.pity', { n: q.misses, max: q.pity })}</small>` : ''}${q.blueprint ? `<small>${t('module.blueprint', { tier: t('rarity.' + q.blueprint), n: q.blueprintOwned ?? 0 })}</small>` : ''}${q.reason ? `<small class="ar-note">${esc(t('err.' + q.reason.slice(2).toLowerCase().replaceAll('_', '-')))}</small>` : ''}</div><button type="button" class="btn-second" data-ar-upgrade="${esc(item.itemId)}" data-ar-mode="${q.mode}"${busy || q.reason ? ' disabled' : ''}>${q.mode === 'stars' ? t('module.star-up', { n: q.grade + 1 }) : t('module.rarity-up')}</button></div>`).join('')}</div>`;
}
export function moduleUpgradeConfirm(
  q: ModuleUpgradeQuote,
  items: readonly ArsenalItem[],
  busy: boolean,
): string {
  const item = items.find((i) => i.itemId === q.itemId);
  if (!item) return '';
  const next = {
    ...item,
    ...(q.mode === 'stars'
      ? { grade: Number(q.next) }
      : { rarity: q.next as ArsenalItem['rarity'] }),
  };
  return `<div class="ar-confirm mi-confirm" role="group"><h4>${t('module.confirm')}</h4><div class="mi-compare"><div>${moduleItemHtml(item)}</div><span aria-hidden="true">→</span><div>${moduleItemHtml(next)}</div></div><p>${t('module.cost', { n: nfmt(q.warrants) })} · ${t('module.odds', { n: Math.round(q.chance * 100) })}</p><p class="ar-note">${esc(
    t('module.copies', {
      ids: q.ingredientIds
        .map((id) => {
          const i = items.find((x) => x.itemId === id);
          return `${tData(data.modules[i?.defId ?? '']?.name ?? '')} · ${id.slice(-8)}`;
        })
        .join(', '),
    }),
  )}</p><p>${t('module.loss')}</p>${item.form === 'blueprint' ? `<p>${t('module.convert-blueprint')}</p>` : ''}${q.binds ? `<p class="ar-note warn">${t('module.bound')}</p>` : ''}<div class="ar-acts-row"><button type="button" class="btn-main" data-ar-upgrade-do${busy ? ' disabled' : ''}>${t('module.confirm')}</button><button type="button" class="btn-quiet" data-ar-cancel>${t('arsenal.cancel')}</button></div></div>`;
}

export function moduleUpgradeResult(
  result:
    | import('../../packages/protocol/src/metaEconomyView').MetaCommandReceipt['moduleUpgrade']
    | undefined,
  items: readonly ArsenalItem[],
): string {
  if (!result?.success) return '';
  const item = items.find((i) => i.itemId === result.itemId);
  if (!item) return '';
  return `<div class="mi-reward" role="status"><span class="mi-spark" aria-hidden="true">✦</span><strong>${t('module.success')}</strong><b>${esc(tData(data.modules[item.defId]?.name ?? item.defId))}</b>${moduleItemHtml(item)}</div>`;
}
