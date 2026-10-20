/**
 * Main-game supply screen: materials, the season and the store. All grants and affordability
 * decisions belong to Meta. The workshop (craft, goal, salvage) lives in the arsenal next to
 * the module it makes (заказ владельца 2026-10-20); both screens share one session client.
 */
import type { CommerceOffer } from '../../packages/protocol/src/commerce';
import type { MetaEconomyView, MetaSeasonView } from '../../packages/protocol/src/metaEconomyView';
import { t, tData } from '../../localization/runtime';
import { esc, nfmt } from './format';
import { data } from './gameData';
import { detach } from './detach';
import {
  createMetaEconomyClient,
  type MetaEconomyStatus,
  type MetaSession,
} from './metaEconomyClient';

const CONTRACT_KEYS: Record<string, string> = {
  matches: 'supply.contract.matches',
  recon: 'supply.contract.recon',
  logistics: 'supply.contract.logistics',
  defense: 'supply.contract.defense',
  objectives: 'supply.contract.objectives',
};

const moduleName = (defId: string): string => tData(data.modules[defId]?.name ?? defId);
const materialName = (view: MetaEconomyView, id: string): string =>
  t(view.materials.find((m) => m.id === id)?.nameKey ?? id);
const button = (attributes: string, label: string, disabled: boolean): string =>
  `<button type="button" ${attributes}${disabled ? ' disabled' : ''}>${esc(label)}</button>`;

function seasonHtml(season: MetaSeasonView, busy: boolean): string {
  const contracts = season.contracts
    .filter((c) => c.available)
    .map(
      (c) =>
        `<div class="me-row"><span>${esc(t(CONTRACT_KEYS[c.metric] ?? 'supply.contracts'))}</span><b>${esc(t('supply.contract.progress', { progress: c.progress, target: c.target, xp: c.xp }))}</b></div>`,
    )
    .join('');
  const milestones = season.milestones
    .map((m) => {
      const choice = m.choices.length > 0 && !m.freeClaimed;
      const choose = choice
        ? `<select class="me-select" data-me-choice="${esc(season.id)}:${m.level}" aria-label="${esc(t(m.free))}"${busy ? ' disabled' : ''}>` +
          m.choices
            .map((defId) => `<option value="${esc(defId)}">${esc(moduleName(defId))}</option>`)
            .join('') +
          '</select>' +
          button(
            `data-me-claim="${esc(season.id)}" data-me-level="${m.level}"`,
            t('supply.season.claim'),
            busy || season.level < m.level,
          )
        : '';
      const freeStatus = m.freeClaimed ? t('supply.season.claimed') : t('supply.season.locked');
      const premiumStatus = m.premiumClaimed
        ? t('supply.season.claimed')
        : t('supply.season.locked');
      return (
        `<article class="me-card me-level"><h4>${esc(t('supply.season.level', { level: m.level, max: season.levels }))}</h4>` +
        `<p class="me-hint">${t('supply.season.free')}</p><b>${esc(t(m.free))}</b>${choose || `<span class="me-hint">${freeStatus}</span>`}` +
        `<p class="me-hint">${t('supply.season.premium')}</p><b>${esc(t(m.premium))}</b><span class="me-hint">${premiumStatus}</span></article>`
      );
    })
    .join('');
  return (
    `<section class="me-section"><div class="me-head"><h3>${esc(t(season.nameKey))}</h3>` +
    button(
      `data-me-season="${esc(season.id)}"`,
      season.active ? t('supply.season.active') : t('supply.season.select'),
      busy || season.active,
    ) +
    `</div><div class="me-amounts"><b>${esc(t('supply.season.level', { level: season.level, max: season.levels }))}</b><span>${esc(t('supply.season.xp', { xp: nfmt(season.xp) }))}</span></div>` +
    (season.archived ? `<p class="me-hint">${t('supply.season.archive')}</p>` : '') +
    (season.dailyXp && (season.active || !season.archived)
      ? `<p class="me-hint">${esc(t('supply.season.daily', { xp: nfmt(season.dailyXp) }))}</p>`
      : '') +
    `<h4>${t('supply.contracts')}</h4>${contracts}<p class="me-hint">${t('supply.season.auto')}</p>` +
    `<details><summary>${t('supply.season.rewards')}</summary><div class="me-track">${milestones}</div></details></section>`
  );
}

export function metaEconomyHtml(
  view: MetaEconomyView,
  offers: readonly CommerceOffer[],
  busy = false,
): string {
  const materials = view.materials
    .map(
      (m) =>
        `<article class="me-card"><h4>${esc(t(m.nameKey))}</h4><div class="me-amounts"><span>${t('supply.tradable')} <b>${nfmt(m.tradable)}</b></span><span>${t('supply.personal')} <b>${nfmt(m.soulbound)}</b></span></div></article>`,
    )
    .join('');
  const store = offers
    .map((offer) => {
      const contents = Object.entries(offer.contents.materials ?? {}).map(
        ([id, quantity]) => `<li>${esc(materialName(view, id))} ×${nfmt(quantity)}</li>`,
      );
      if (offer.contents.moduleId)
        contents.push(`<li>${esc(moduleName(offer.contents.moduleId))}</li>`);
      if (offer.contents.seasonId) {
        const season = view.seasons.find((s) => s.id === offer.contents.seasonId);
        contents.push(
          `<li>${esc(season ? t(season.nameKey) : offer.contents.seasonId)} · ${t('supply.season.premium')}</li>`,
        );
      }
      return (
        `<article class="me-card"><h4>${esc(t(offer.nameKey))}</h4><span class="me-hint">${t('supply.store.known')}</span><ul class="me-reward">${contents.join('')}</ul><p class="me-hint">${esc(t(offer.contentsKey))}</p>` +
        (offer.dailyLimit === undefined
          ? ''
          : `<span class="me-hint">${t('supply.store.daily-limit', { n: offer.dailyLimit })}</span>`) +
        `<span class="me-hint">${t('supply.store.unavailable')}</span></article>`
      );
    })
    .join('');
  return (
    `<header class="me-head"><div><h2>${t('supply.title')}</h2><p class="me-hint">${t('supply.subtitle')}</p></div>${button('data-me-refresh', t('supply.retry'), busy)}</header>` +
    `<section class="me-section"><h3>${t('supply.materials')}</h3><div class="me-grid">${materials}</div></section>` +
    `<section class="me-section"><h3>${t('supply.season')}</h3>${view.seasons.map((s) => seasonHtml(s, busy)).join('')}</section>` +
    `<section class="me-section" data-me-store><h3>${t('supply.store')}</h3><div class="me-grid">${store || `<p class="me-hint">${t('supply.store.unavailable')}</p>`}</div></section>`
  );
}

export interface MetaEconomyHost {
  root(): HTMLElement;
  authorizedBase(): Promise<MetaSession | null>;
  changed(): Promise<void>;
  requestId?(): string;
}

/** The supply screen's words for the shared client's state. */
function statusLine(status: MetaEconomyStatus): { text: string; error: boolean } {
  switch (status.kind) {
    case 'loading':
      return { text: t('supply.loading'), error: false };
    case 'guest':
      return { text: t('supply.auth'), error: false };
    case 'unavailable':
      return { text: t('supply.unavailable'), error: true };
    case 'pending':
      return { text: t('supply.pending'), error: false };
    case 'done':
      return { text: status.key ? t(status.key) : '', error: false };
    case 'failed':
      return { text: t(status.key ?? 'supply.failed'), error: true };
    default:
      return { text: '', error: false };
  }
}

/** No value is cached in the browser. A failed POST retains its id for a safe retry. */
export function initMetaEconomy(host: MetaEconomyHost): {
  refresh(): Promise<void>;
  /** Плашка Суверенов ведёт в магазин: после ближайшей загрузки экран прокручен к нему. */
  showStore(): void;
} {
  let wantStore = false;
  const client = createMetaEconomyClient({
    authorizedBase: () => host.authorizedBase(),
    paint: () => paint(),
    // Render before accepting the response: malformed nested data never replaces a valid view.
    accept: (view, offers) => void metaEconomyHtml(view, offers),
    changed: () => host.changed(),
    ...(host.requestId ? { requestId: () => host.requestId!() } : {}),
  });
  const paint = (): void => {
    const view = client.view();
    const busy = client.busy();
    const status = statusLine(client.status());
    const statusHtml = status.text
      ? `<p class="me-hint${status.error ? ' me-error' : ''}" role="status">${esc(status.text)}</p>`
      : '';
    host.root().innerHTML =
      statusHtml +
      (view
        ? metaEconomyHtml(view, client.offers(), busy)
        : `<div class="hub-empty">${t('supply.title')}<br>${button('data-me-refresh', t('supply.retry'), busy)}</div>`);
    if (wantStore && !busy) {
      wantStore = false;
      if (view) host.root().querySelector('[data-me-store]')?.scrollIntoView({ block: 'start' });
    }
  };
  host.root().addEventListener('click', (event) => {
    const el = (event.target as HTMLElement).closest<HTMLButtonElement>('button');
    if (!el || el.disabled || client.busy()) return;
    if (el.hasAttribute('data-me-refresh')) {
      detach('снабжение: обновление', client.refresh());
      return;
    }
    if (!client.view()) return;
    if (el.dataset.meSeason) {
      detach(
        'снабжение: дорожка сезона',
        client.mutate('/meta-economy/season/select', { seasonId: el.dataset.meSeason }),
      );
      return;
    }
    if (el.dataset.meClaim) {
      const seasonId = el.dataset.meClaim;
      const level = Number(el.dataset.meLevel);
      const select = host
        .root()
        .querySelector<HTMLSelectElement>(`[data-me-choice="${CSS.escape(seasonId)}:${level}"]`);
      if (select?.value)
        detach(
          'снабжение: выбор награды',
          client.mutate('/meta-economy/season/claim', { seasonId, level, defId: select.value }),
        );
    }
  });
  return {
    refresh: () => client.refresh(),
    showStore: () => {
      wantStore = true;
      if (!client.busy()) paint();
    },
  };
}
