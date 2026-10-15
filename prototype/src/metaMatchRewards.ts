/** Read-only main-game result receipts. Opening this panel never awards value. */
import type { MetaMatchRewardsView } from '../../packages/protocol/src/metaEconomyView';
import { t, tData } from '../../localization/runtime';
import { data } from './gameData';
import { esc, nfmt } from './format';
import { detach } from './detach';
import { unitTitle } from './dossiers';

export interface MatchRewardsReader {
  matchId(): string | null;
  read(matchId: string): Promise<MetaMatchRewardsView>;
}

export function matchRewardsHtml(
  view: MetaMatchRewardsView | null,
  loading: boolean,
  failed: boolean,
): string {
  const materials = new Map<string, { name: string; quantity: number }>();
  let xp = 0;
  let warrants = 0;
  const finds: string[] = [];
  const seen = new Set<string>();
  for (const receipt of view?.receipts ?? []) {
    if (seen.has(receipt.id)) continue;
    seen.add(receipt.id);
    for (const material of receipt.materials ?? []) {
      const key = `${material.materialId}:${material.soulbound}`;
      const name = t(`meta.material.${material.materialId}`);
      const row = materials.get(key) ?? {
        name: material.soulbound ? t('end.rewards.personal', { name }) : name,
        quantity: 0,
      };
      row.quantity += material.quantity;
      materials.set(key, row);
    }
    xp += receipt.seasonXp ?? 0;
    warrants += receipt.warrants ?? 0;
    if (receipt.drop) {
      const name =
        receipt.drop.kind === 'hull'
          ? unitTitle(receipt.drop.defId)
          : tData(data.modules[receipt.drop.defId]?.name ?? receipt.drop.defId);
      finds.push(t('end.rewards.find', { name }));
    }
  }
  const row = (name: string, quantity: number) =>
    `<li><span>${esc(name)}</span><b>+${esc(nfmt(quantity))}</b></li>`;
  const rows = [...materials.values()]
    .filter((m) => m.quantity > 0)
    .map((m) => row(m.name, m.quantity));
  if (xp > 0) rows.push(row(t('end.rewards.season-xp'), xp));
  if (warrants > 0) rows.push(row(t('end.rewards.warrants'), warrants));
  rows.push(...finds.map((name) => `<li><span>${esc(name)}</span></li>`));
  const status = failed
    ? t('end.rewards.unavailable')
    : loading && !view
      ? t('end.rewards.loading')
      : !rows.length
        ? t('end.rewards.none')
        : !view?.finalReady
          ? t('end.rewards.partial')
          : '';
  return (
    `<section class="es-run es-rewards"><h3>${rows.length ? t('end.rewards.title') : t('supply.title')}</h3><ul>${rows.join('')}</ul>` +
    (status ? `<p class="es-note" role="status">${esc(status)}</p>` : '') +
    `<p class="es-note">${t('end.rewards.automatic')}</p><button type="button" class="es-btn btn-quiet" data-es="rewards-refresh"${loading ? ' disabled' : ''}>${t('end.rewards.refresh')}</button></section>`
  );
}

/** One initial read and at most one automatic retry per visible result. */
export function createMatchRewardsPanel(
  reader: MatchRewardsReader,
  changed: () => void,
): {
  show(visible: boolean): void;
  html(): string;
  refresh(): void;
} {
  let key: string | null = null;
  let generation = 0;
  let view: MetaMatchRewardsView | null = null;
  let busy = false;
  let failed = false;
  let attempts = 0;
  let retry: ReturnType<typeof setTimeout> | null = null;
  const clearRetry = () => {
    if (retry !== null) clearTimeout(retry);
    retry = null;
  };
  const refresh = (): void => {
    if (!key || busy) return;
    clearRetry();
    const matchId = key;
    const current = generation;
    busy = true;
    failed = false;
    attempts++;
    detach(
      'награды матча: чтение квитанций',
      (async () => {
        try {
          const result = await reader.read(matchId);
          if (current !== generation || key !== matchId) return;
          if (!Array.isArray(result?.receipts) || typeof result.finalReady !== 'boolean')
            throw new Error('E_NETWORK');
          matchRewardsHtml(result, false, false);
          view = result;
        } catch {
          if (current === generation) failed = true;
        } finally {
          if (current === generation) {
            busy = false;
            if (!view?.finalReady && attempts < 2)
              retry = setTimeout(() => {
                retry = null;
                refresh();
              }, 1500);
            changed();
          }
        }
      })(),
    );
  };
  return {
    show(visible) {
      const next = visible ? reader.matchId() : null;
      if (next === key) return;
      clearRetry();
      key = next;
      generation++;
      view = null;
      failed = false;
      busy = false;
      attempts = 0;
      if (key) refresh();
    },
    html: () => (key ? matchRewardsHtml(view, busy, failed) : ''),
    refresh,
  };
}
