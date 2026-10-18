/** Main-game supply screen. All grants and affordability decisions belong to Meta. */
import type { CommerceOffer } from '../../packages/protocol/src/commerce';
import type {
  MetaEconomyView,
  MetaRecipeView,
  MetaSeasonView,
} from '../../packages/protocol/src/metaEconomyView';
import { hasKey, t, tData } from '../../localization/runtime';
import { refusalKeyOf } from '../../decisions/refusalText';
import { esc, nfmt } from './format';
import { data } from './gameData';
import { arsenalItemName } from './arsenalScreen';
import { detach } from './detach';

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

function recipeHtml(view: MetaEconomyView, recipe: MetaRecipeView, busy: boolean): string {
  const selected = view.supplyGoal === recipe.id;
  const ingredients = recipe.ingredients
    .map(
      (i) =>
        `<div class="me-row"><span>${esc(materialName(view, i.materialId))}</span><b>${nfmt(i.tradable + i.soulbound)} / ${nfmt(i.required)}</b></div>`,
    )
    .join('');
  return (
    `<article class="me-card${selected ? ' me-goal' : ''}"><h4>${esc(moduleName(recipe.defId))}</h4>` +
    (selected ? `<span class="me-badge">${t('supply.goal.active')}</span>` : '') +
    `<div class="me-material-list">${ingredients}</div><p class="me-hint">${t('supply.recipe.guaranteed')}</p>` +
    (recipe.requiresSoulbound ? `<p class="me-bound">${t('supply.craft.bound')}</p>` : '') +
    `<div class="me-actions">${button(`data-me-craft="${esc(recipe.id)}"`, recipe.canCraft ? t('supply.craft') : t('supply.craft.missing'), busy || !recipe.canCraft)}` +
    button(
      `data-me-goal="${esc(recipe.id)}"`,
      selected ? t('supply.goal.active') : t('supply.goal.choose'),
      busy || selected,
    ) +
    '</div></article>'
  );
}

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
  const salvage = view.items
    .filter((i) => view.salvageableItemIds.includes(i.itemId))
    .map((item) => {
      const recipe = view.recipes.find((r) => r.defId === item.defId);
      if (!recipe) return '';
      return (
        `<article class="me-card"><h4>${esc(arsenalItemName(item))}</h4><span class="me-hint">${t('supply.salvage.yield')}</span>` +
        recipe.salvage
          .map(
            (m) =>
              `<div class="me-row"><span>${esc(materialName(view, m.materialId))}</span><b>${nfmt(m.quantity)}</b></div>`,
          )
          .join('') +
        (item.soulbound ? `<p class="me-bound">${t('supply.salvage.bound')}</p>` : '') +
        button(`data-me-salvage="${esc(item.itemId)}"`, t('supply.salvage'), busy) +
        '</article>'
      );
    })
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
    `<section class="me-section"><h3>${t('supply.recipes')}</h3><div class="me-grid">${view.recipes.map((r) => recipeHtml(view, r, busy)).join('')}</div></section>` +
    `<section class="me-section"><h3>${t('supply.salvage.title')}</h3><div class="me-grid">${salvage || `<p class="me-hint">${t('supply.salvage.empty')}</p>`}</div></section>` +
    `<section class="me-section"><h3>${t('supply.season')}</h3>${view.seasons.map((s) => seasonHtml(s, busy)).join('')}</section>` +
    `<section class="me-section" data-me-store><h3>${t('supply.store')}</h3><div class="me-grid">${store || `<p class="me-hint">${t('supply.store.unavailable')}</p>`}</div></section>`
  );
}

export interface MetaEconomyHost {
  root(): HTMLElement;
  authorizedBase(): Promise<{ base: string; token: string } | null>;
  changed(): Promise<void>;
  confirm(message: string): boolean;
  requestId?(): string;
}

interface Session {
  base: string;
  token: string;
}
const sameSession = (a: Session | null, b: Session | null): boolean =>
  a?.base === b?.base && a?.token === b?.token;

/** No value is cached in the browser. A failed POST retains its id for a safe retry. */
export function initMetaEconomy(host: MetaEconomyHost): {
  refresh(): Promise<void>;
  /** Плашка Суверенов ведёт в магазин: после ближайшей загрузки экран прокручен к нему. */
  showStore(): void;
} {
  let view: MetaEconomyView | null = null;
  let wantStore = false;
  let offers: CommerceOffer[] = [];
  let session: Session | null = null;
  let generation = 0;
  let busy = false;
  let status = '';
  let statusError = false;
  const attempts = new Map<string, string>();
  const paint = (): void => {
    const statusHtml = status
      ? `<p class="me-hint${statusError ? ' me-error' : ''}" role="status">${esc(status)}</p>`
      : '';
    host.root().innerHTML =
      statusHtml +
      (view
        ? metaEconomyHtml(view, offers, busy)
        : `<div class="hub-empty">${t('supply.title')}<br>${button('data-me-refresh', t('supply.retry'), busy)}</div>`);
    if (wantStore && !busy) {
      wantStore = false;
      if (view) host.root().querySelector('[data-me-store]')?.scrollIntoView({ block: 'start' });
    }
  };
  const json = async (auth: Session, path: string, body?: object): Promise<unknown> => {
    const res = await fetch(auth.base + path, {
      method: body ? 'POST' : 'GET',
      headers: {
        authorization: `Bearer ${auth.token}`,
        ...(body ? { 'content-type': 'application/json' } : {}),
      },
      ...(body ? { body: JSON.stringify(body) } : {}),
    });
    const value: unknown = await res.json();
    if (!res.ok || (typeof value === 'object' && value && 'ok' in value && value.ok === false)) {
      const failure = value as { error?: unknown; code?: unknown } | null;
      const code = failure?.error ?? failure?.code;
      throw new Error(typeof code === 'string' && /^E_[A-Z_]+$/.test(code) ? code : 'E_NETWORK');
    }
    return value;
  };
  const load = async (auth: Session, current: number): Promise<void> => {
    const [raw, commerce] = await Promise.all([
      json(auth, '/meta-economy/me'),
      json(auth, '/commerce/offers').catch(() => ({ offers: [] })),
    ]);
    if (current !== generation) return;
    if (!sameSession(auth, await host.authorizedBase())) {
      view = null;
      attempts.clear();
      throw new Error('E_AUTH');
    }
    const next = raw as MetaEconomyView;
    if (
      !next ||
      !Array.isArray(next.materials) ||
      !Array.isArray(next.recipes) ||
      !Array.isArray(next.items) ||
      !Array.isArray(next.salvageableItemIds) ||
      !Array.isArray(next.seasons)
    )
      throw new Error('E_NETWORK');
    // Render before accepting the response: malformed nested data never replaces a valid view.
    const nextOffers = (commerce as { offers?: CommerceOffer[] } | null)?.offers;
    const safeOffers = Array.isArray(nextOffers) ? nextOffers : [];
    metaEconomyHtml(next, safeOffers);
    view = next;
    offers = safeOffers;
  };
  const refresh = async (): Promise<void> => {
    if (busy) return;
    const current = ++generation;
    busy = true;
    view = null;
    status = t('supply.loading');
    statusError = false;
    paint();
    try {
      const auth = await host.authorizedBase();
      if (!sameSession(session, auth)) attempts.clear();
      session = auth;
      if (!auth) {
        status = t('supply.auth');
        return;
      }
      await load(auth, current);
      status = '';
    } catch {
      status = t('supply.unavailable');
      statusError = true;
    } finally {
      if (current === generation) {
        busy = false;
        paint();
      }
    }
  };
  const mutate = async (
    path: string,
    body: Record<string, unknown>,
    success?: string,
  ): Promise<void> => {
    if (busy || !view) return;
    busy = true;
    status = t('supply.pending');
    statusError = false;
    paint();
    try {
      const auth = await host.authorizedBase();
      if (!auth || !sameSession(auth, session)) {
        view = null;
        attempts.clear();
        status = t('supply.auth');
        return;
      }
      const key = path + JSON.stringify(body);
      const requestId = attempts.get(key) ?? host.requestId?.() ?? crypto.randomUUID();
      attempts.set(key, requestId);
      const response = (await json(auth, path, { ...body, requestId })) as { ok?: boolean } | null;
      if (response?.ok !== true) throw new Error('E_NETWORK');
      attempts.delete(key);
      view = null; // A confirmed write must never leave stale controls after a failed refresh.
      await load(auth, generation);
      status = success ? t(success) : '';
      await host.changed().catch(() => undefined);
    } catch (e) {
      const key = refusalKeyOf(e instanceof Error ? e.message : 'E_NETWORK');
      status = hasKey(key) ? t(key) : t('supply.failed');
      statusError = true;
    } finally {
      busy = false;
      paint();
    }
  };
  host.root().addEventListener('click', (event) => {
    const el = (event.target as HTMLElement).closest<HTMLButtonElement>('button');
    if (!el || el.disabled || busy) return;
    if (el.hasAttribute('data-me-refresh')) {
      detach('снабжение: обновление', refresh());
      return;
    }
    if (!view) return;
    if (el.dataset.meGoal) {
      detach(
        'снабжение: цель',
        mutate('/meta-economy/supply-goal', { recipeId: el.dataset.meGoal }),
      );
      return;
    }
    if (el.dataset.meCraft) {
      const recipe = view.recipes.find((r) => r.id === el.dataset.meCraft);
      if (
        !recipe?.canCraft ||
        (recipe.requiresSoulbound && !host.confirm(t('supply.craft.confirm')))
      )
        return;
      detach(
        'снабжение: сборка',
        mutate(
          '/meta-economy/craft',
          { recipeId: recipe.id, allowSoulbound: recipe.requiresSoulbound },
          'supply.craft.success',
        ),
      );
      return;
    }
    if (el.dataset.meSalvage) {
      const item = view.items.find((i) => i.itemId === el.dataset.meSalvage);
      if (
        !item ||
        !view.salvageableItemIds.includes(item.itemId) ||
        !host.confirm(t('supply.salvage.confirm', { item: arsenalItemName(item) }))
      )
        return;
      detach(
        'снабжение: разбор',
        mutate('/meta-economy/salvage', { itemId: item.itemId }, 'supply.salvage.success'),
      );
      return;
    }
    if (el.dataset.meSeason) {
      detach(
        'снабжение: дорожка сезона',
        mutate('/meta-economy/season/select', { seasonId: el.dataset.meSeason }),
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
          mutate('/meta-economy/season/claim', { seasonId, level, defId: select.value }),
        );
    }
  });
  return {
    refresh,
    showStore: () => {
      wantStore = true;
      if (!busy) paint();
    },
  };
}
