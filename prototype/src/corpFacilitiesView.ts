import type { CorpPublicFacilities } from '../../packages/protocol/src/corpInfrastructure';
import { t, tData } from '../../localization/runtime';
import { data } from './gameData';
import { unitTitle } from './dossiers';
import { esc } from './format';

const MEDAL_NAME: Readonly<Record<string, string>> = {
  ava_first_victory: 'corp.medal.ava_first_victory',
  ava_champion_5: 'corp.medal.ava_champion_5',
  ava_veteran_10: 'corp.medal.ava_veteran_10',
};
const MEDAL_CONDITION: Readonly<Record<string, string>> = {
  ava_first_victory: 'corp.medal.ava_first_victory.condition',
  ava_champion_5: 'corp.medal.ava_champion_5.condition',
  ava_veteran_10: 'corp.medal.ava_veteran_10.condition',
};
export const CORP_MEDALS = Object.keys(MEDAL_NAME);

/** The same server selection is shown in the headquarters, hall and public card. */
export function corpShowcaseHtml(corp: CorpPublicFacilities, eligible: readonly string[] = [], edit = false, busy = false): string {
  const capacity = corp.showcaseSlots ?? 0;
  if (!capacity) return '';
  const selected = corp.showcase ?? [];
  return `<section class="cf-showcase"><h4>${esc(t('corp.hall.title'))}</h4><p class="cb-note">${esc(t('corp.hall.capacity', { n: selected.length, max: capacity }))}</p>` +
    (selected.length ? `<ul class="cf-medals">${selected.filter((id) => (CORP_MEDALS as readonly string[]).includes(id)).map((id) => `<li><span aria-hidden="true">✪</span> ${esc(t(MEDAL_NAME[id] ?? 'corp.hall.empty'))}</li>`).join('')}</ul>` : `<p class="cb-note">${esc(t('corp.hall.empty'))}</p>`) +
    (edit ? `<p class="cb-note">${esc(t('corp.hall.edit'))}</p><div class="cf-choices">${CORP_MEDALS.map((id) => `<button type="button" class="btn-second" data-corpact="pin-medal" data-corparg="${id}" aria-pressed="${selected.includes(id)}"${busy || !eligible.includes(id) || (!selected.includes(id) && selected.length >= capacity) ? ' disabled' : ''}>${esc(t(MEDAL_NAME[id] ?? 'corp.hall.empty'))}<small>${esc(t(MEDAL_CONDITION[id] ?? 'corp.hall.empty'))}</small></button>`).join('')}</div>` : '') + `</section>`;
}

export interface WarehouseView {
  capacity: number;
  used: number;
  canLend: boolean;
  fighters: Array<{ accountId: string; login: string }>;
  items: Array<{ itemId: string; defId: string; kind: 'hull' | 'module'; durability: number | null; busy: boolean; borrower: string | null }>;
}
const obj = (v: unknown): v is Record<string, unknown> => v !== null && typeof v === 'object' && !Array.isArray(v);
export function parseWarehouse(v: unknown): WarehouseView | null {
  if (!obj(v) || !Number.isSafeInteger(v.capacity) || Number(v.capacity) < 0 || Number(v.capacity) > 6 || !Number.isSafeInteger(v.used) || Number(v.used) < 0 || typeof v.canLend !== 'boolean' || !Array.isArray(v.fighters) || !Array.isArray(v.items)) return null;
  if (v.fighters.some((f) => !obj(f) || typeof f.accountId !== 'string' || typeof f.login !== 'string') ||
      v.items.some((i) => !obj(i) || typeof i.itemId !== 'string' || typeof i.defId !== 'string' || !['hull', 'module'].includes(String(i.kind)) || typeof i.busy !== 'boolean' || !(i.borrower === null || typeof i.borrower === 'string') || !(i.durability === null || (typeof i.durability === 'number' && Number.isFinite(i.durability) && i.durability >= 0)))) return null;
  return v as unknown as WarehouseView;
}

export function warehouseHtml(view: WarehouseView | null, battles: readonly { id: string; name: string }[], selected: string, fighter: string, busy: boolean): string {
  const choose = `<label class="cf-select">${esc(t('corp.warehouse.battle'))}<select data-warehouse-match${busy ? ' disabled' : ''}><option value="">${esc(t('corp.warehouse.no-battle'))}</option>${battles.map((b) => `<option value="${esc(b.id)}"${selected === b.id ? ' selected' : ''}>${esc(b.name)}</option>`).join('')}</select></label>`;
  if (!view) return `<section class="cf-warehouse">${choose}<p class="cb-note">${esc(t('corp.warehouse.unavailable'))}</p><button class="btn-second" data-corpact="refresh">${esc(t('corp.buildings.refresh'))}</button></section>`;
  const who = view.fighters.find((f) => f.accountId === fighter);
  const rows = view.items.map((i) => {
    const name = i.kind === 'hull' ? unitTitle(i.defId) : data.modules[i.defId] ? tData(data.modules[i.defId]!.name) : t('corp.warehouse.item');
    const borrower = view.fighters.find((f) => f.accountId === i.borrower)?.login;
    return `<li><div><b>${esc(name)}</b><small>${esc(i.busy ? borrower ? t('corp.warehouse.borrower', { name: borrower }) : t('corp.warehouse.busy') : t('corp.warehouse.available'))}</small></div><button class="btn-second" data-corpact="rent-item" data-corparg="${esc(i.itemId)}"${busy || !view.canLend || !who || i.busy || view.used >= view.capacity || i.durability === 0 ? ' disabled' : ''}>${esc(t('corp.warehouse.lend'))}</button></li>`;
  }).join('');
  return `<section class="cf-warehouse"><p class="cb-note">${esc(t('corp.warehouse.limit', { n: view.used, max: view.capacity }))}</p><p class="cb-note">${esc(t('corp.warehouse.return'))}</p>${choose}` +
    (selected ? `<label class="cf-select">${esc(t('corp.warehouse.fighter'))}<select data-warehouse-fighter${busy || !view.canLend ? ' disabled' : ''}><option value="">${esc(t('corp.warehouse.choose'))}</option>${view.fighters.map((f) => `<option value="${esc(f.accountId)}"${fighter === f.accountId ? ' selected' : ''}>${esc(f.login)}</option>`).join('')}</select></label>` : '') +
    (rows ? `<ul class="cf-stock">${rows}</ul>` : `<p class="cb-note">${esc(t('corp.warehouse.empty'))}</p>`) + `</section>`;
}
