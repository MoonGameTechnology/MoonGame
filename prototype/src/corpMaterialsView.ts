import type {
  CorpBuildingLevel,
  CorpMaterialsView,
} from '../../packages/protocol/src/corpInfrastructure';
import { t } from '../../localization/runtime';
import { esc, nfmt } from './format';

export const CORP_MATERIAL_NAMES: Record<string, string> = {
  construction_blocks: 'meta.material.construction_blocks',
  engineering_kits: 'meta.material.engineering_kits',
  command_cores: 'meta.material.command_cores',
};
const KIND_KEY = {
  contribution: 'corp.materials.contribution',
  construction: 'corp.materials.construction',
  refund: 'corp.materials.refund',
};
const STATUS_KEY = {
  complete: 'corp.materials.status.complete',
  pending: 'corp.materials.status.pending',
  spent: 'corp.materials.status.spent',
  refunded: 'corp.materials.status.refunded',
};
const object = (v: unknown): v is Record<string, unknown> =>
  v !== null && typeof v === 'object' && !Array.isArray(v);
const amount = (v: unknown): v is number =>
  typeof v === 'number' && Number.isSafeInteger(v) && v >= 0;
export function parseCorpMaterials(raw: unknown): CorpMaterialsView | null {
  if (!object(raw) || !object(raw.corp)) return null;
  const c = raw.corp;
  if (
    typeof c.corpId !== 'string' ||
    typeof c.pending !== 'boolean' ||
    !Array.isArray(c.materials) ||
    c.materials.length !== 3 ||
    !Array.isArray(c.history) ||
    c.history.length > 100
  )
    return null;
  const seen = new Set<string>();
  for (const r of c.materials) {
    if (
      !object(r) ||
      typeof r.id !== 'string' ||
      seen.has(r.id) ||
      !Object.hasOwn(CORP_MATERIAL_NAMES, r.id) ||
      r.nameKey !== CORP_MATERIAL_NAMES[r.id] ||
      !amount(r.available) ||
      !amount(r.personal) ||
      !amount(r.reserved)
    )
      return null;
    seen.add(r.id);
  }
  for (const r of c.history) {
    if (
      !object(r) ||
      typeof r.id !== 'string' ||
      !amount(r.at) ||
      !['contribution', 'construction', 'refund'].includes(r.kind as string) ||
      !['pending', 'spent', 'refunded', 'complete'].includes(r.status as string) ||
      !object(r.amounts) ||
      Object.entries(r.amounts).some(
        ([id, n]) =>
          !Object.hasOwn(CORP_MATERIAL_NAMES, id) ||
          typeof n !== 'number' ||
          !Number.isSafeInteger(n),
      )
    )
      return null;
  }
  return c as unknown as CorpMaterialsView;
}
export function canFundCorpBuilding(
  next: CorpBuildingLevel & { price?: string },
  bank: CorpMaterialsView | null | undefined,
): boolean {
  const prices = Object.entries(next.materials ?? {});
  return (
    !prices.length ||
    (!!bank &&
      !bank.pending &&
      typeof next.price === 'string' &&
      /^[a-f0-9]{64}$/.test(next.price) &&
      prices.every(([id, n]) => (bank.materials.find((r) => r.id === id)?.available ?? 0) >= n))
  );
}
export function corpMaterialPriceHtml(
  materials: Record<string, number> | undefined,
  bank?: CorpMaterialsView | null,
): string {
  return Object.entries(materials ?? {})
    .map(([id, n]) => {
      const row = bank?.materials.find((r) => r.id === id);
      return `<li class="${row && row.available >= n ? 'ok' : 'no'}">${esc(t(CORP_MATERIAL_NAMES[id] ?? 'corp.materials.title'))}: ${nfmt(n)} · ${esc(row ? t('corp.materials.have', { n: row.available }) : t('corp.materials.unavailable'))}</li>`;
    })
    .join('');
}
export function corpMaterialsHtml(
  bank: CorpMaterialsView | null | undefined,
  busy: boolean,
): string {
  if (!bank)
    return `<section class="cb-card"><h3>${t('corp.materials.title')}</h3><p class="cb-note">${t('corp.materials.unavailable')}</p></section>`;
  return (
    `<section class="cb-card cb-materials"><h3>${t('corp.materials.title')}</h3><p class="cb-note">${t('corp.materials.hint')}</p>` +
    (bank.pending
      ? `<p role="status" class="cb-note warn">${t('corp.materials.pending')}</p>`
      : '') +
    bank.materials
      .map(
        (r) =>
          `<div class="cb-material-row"><div><b>${esc(t(r.nameKey))}</b><small>${t('corp.materials.stock', { n: r.available, own: r.personal, reserved: r.reserved })}</small></div>` +
          `<label><input aria-label="${esc(t('corp.materials.quantity', { name: t(r.nameKey) }))}" type="number" inputmode="numeric" min="1" max="${r.personal}" value="1" data-corpmaterial="${esc(r.id)}"${r.personal < 1 || busy ? ' disabled' : ''}></label>` +
          `<button type="button" class="btn-second" data-corpact="contribute" data-corparg="${esc(r.id)}"${r.personal < 1 || busy ? ' disabled' : ''}>${t('corp.materials.contribute')}</button></div>`,
      )
      .join('') +
    `<button type="button" class="btn-second" data-corpact="materials-market">${t('corp.materials.market')}</button>` +
    `<details><summary>${t('corp.materials.history')}</summary>` +
    bank.history
      .map(
        (e) =>
          `<div class="cb-lrow"><span>${esc(t(KIND_KEY[e.kind]))} · ${esc(new Date(e.at).toLocaleDateString())}<small>${esc(t(STATUS_KEY[e.status]))}</small></span><b>` +
          Object.entries(e.amounts)
            .map(
              ([id, n]) =>
                `${n > 0 ? '+' : '−'}${nfmt(Math.abs(n))} ${esc(t(CORP_MATERIAL_NAMES[id]!))}`,
            )
            .join('<br>') +
          '</b></div>',
      )
      .join('') +
    '</details></section>'
  );
}
