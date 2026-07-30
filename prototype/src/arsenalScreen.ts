/**
 * «Арсенал» — the hub tab over the account's persistent collection (ARS-5, REFM-5).
 *
 * ARS-1..4 built the server-side store; this is the витрина that finally reads it.
 * Cache-first: the tab paints instantly from the last known collection, then a
 * background session-gated GET refreshes it. No server / no account yet ⇒ the empty
 * state — the same "no restriction without a snapshot" spirit as the core build gate.
 *
 * `arsenal.ts` next door stays the PURE model (filter/grade/parse). This module is the
 * screen: markup + the tab's own live cache. Split the same way as every REFM brick —
 * the HTML is pure and testable (`arsenalPanelHtml`), and only the wiring
 * (`initArsenal`) touches the host, through explicit hooks rather than `main.ts`'s
 * module-level state.
 */
import type { ArsenalItem } from '../../packages/shared-core/src/index';
import { t, tData } from '../../localization/runtime';
import { data } from './prototypeData';
import { esc } from './format';
import { unitTitle } from './dossiers';
import { filterArsenal, gradesOf, parseArsenalItems, type ArsenalFilter } from './arsenal';

const KIND_ICON: Record<ArsenalItem['kind'], string> = {
  hull: '◈',
  module: '◆',
  hero_fitting: '◇',
};

/** Which codex page a card deep-links to (`codexHtml`'s kind vocabulary). */
const CODEX_KIND: Record<ArsenalItem['kind'], string> = {
  hull: 'u',
  module: 'md',
  hero_fitting: 'hf',
};

const KIND_KEY: Record<ArsenalItem['kind'], string> = {
  hull: 'arsenal.kind.hull',
  module: 'arsenal.kind.module',
  hero_fitting: 'arsenal.kind.fitting',
};

const ORIGIN_KEY: Record<ArsenalItem['origin'], string> = {
  starter: 'arsenal.origin.starter',
  drop: 'arsenal.origin.drop',
  craft: 'arsenal.origin.craft',
  auction: 'arsenal.origin.auction',
  lootbox: 'arsenal.origin.lootbox',
  rent: 'arsenal.origin.rent',
};

/** «откуда» — the localized origin label. Exported because the Верфь tags its cards
 *  with it too (LARS-4), and the arsenal owns that vocabulary. */
export function originLabel(origin: ArsenalItem['origin']): string {
  return t(ORIGIN_KEY[origin]);
}

/** Display name of one owned thing, per kind: hulls read as units, modules and hero
 *  fittings as their catalogue names (falling back to the raw defId). */
export function arsenalItemName(item: ArsenalItem): string {
  if (item.kind === 'hull') return unitTitle(item.defId);
  if (item.kind === 'module') return tData(data.modules[item.defId]?.name ?? item.defId);
  return tData(data.heroFittings[item.defId]?.name ?? item.defId);
}

/** One collection card: icon, name, and the grade/durability/origin footnote. */
export function arsenalCardHtml(item: ArsenalItem): string {
  const badges = [
    item.grade ? `+${item.grade}` : '',
    typeof item.durability === 'number' ? `⛭${item.durability}` : '',
  ]
    .filter(Boolean)
    .join(' ');
  return (
    `<button class="hub-tile ar-card" data-codex="${CODEX_KIND[item.kind]}:${esc(item.defId)}">` +
    `<span class="ht-ic">${KIND_ICON[item.kind]}</span><span>${esc(arsenalItemName(item))}</span>` +
    `<span class="ar-meta">${badges ? badges + ' · ' : ''}${originLabel(item.origin)}</span></button>`
  );
}

/** The whole tab as markup: the empty state, or the filter chips + the card grid.
 *  Pure — `initArsenal` feeds it the live items and the active filter. */
export function arsenalPanelHtml(
  items: readonly ArsenalItem[],
  filter: ArsenalFilter,
): string {
  if (items.length === 0) {
    return (
      `<div class="hub-empty"><span class="he-ic">⚔</span>${t('arsenal.empty')}<br>` +
      `<span style="font-size:11px;color:var(--cyan-dim)">${t('arsenal.empty.hint')}</span></div>`
    );
  }
  const kinds: Array<ArsenalItem['kind']> = ['hull', 'module', 'hero_fitting'];
  let chips = `<button class="ar-fchip${filter.kind ? '' : ' on'}" data-ar-kind="">${t('arsenal.filter.all')}</button>`;
  for (const k of kinds)
    chips += `<button class="ar-fchip${filter.kind === k ? ' on' : ''}" data-ar-kind="${k}">${t(KIND_KEY[k])}</button>`;
  const grades = gradesOf(items);
  if (grades.length) {
    chips += `<span class="ar-fsep"></span>`;
    for (const g of grades)
      chips += `<button class="ar-fchip${filter.grade === g ? ' on' : ''}" data-ar-grade="${g}">+${g}</button>`;
  }
  const cards = filterArsenal(items, filter).map(arsenalCardHtml).join('');
  return `<div class="ar-filters">${chips}</div><div class="hub-grid ar-grid">${cards}</div>`;
}

/** What the витрина needs from the hub. */
export interface ArsenalHost {
  /** The tab's container (`#hp-arsenal`) — painted and click-delegated here. */
  root(): HTMLElement;
  /** The last known collection for the CURRENT callsign, as stored (parsed here, so a
   *  corrupt blob degrades to an empty витрина rather than throwing). */
  readCache(): unknown;
  /** Persist a freshly fetched collection for the current callsign. */
  writeCache(items: readonly ArsenalItem[]): void;
  /** Open the codex card for a `<kind>:<defId>` key. */
  openCodex(key: string): void;
  /** HTTP base + session token for the session-gated GET, or null when there is no
   *  server, no accounts, or no session token a prior join already stashed — the tab
   *  must never prompt for a password just to LOOK at the collection. */
  authorizedBase(): Promise<{ base: string; token: string } | null>;
}

/** Wire the tab up: paints, filters, cache, and the background refresh. Call once at
 *  boot — it attaches the container's click delegate. */
export function initArsenal(host: ArsenalHost): {
  refresh: () => Promise<void>;
  items: () => readonly ArsenalItem[];
} {
  let items: ArsenalItem[] = [];
  let filter: ArsenalFilter = {};

  function paint(): void {
    host.root().innerHTML = arsenalPanelHtml(items, filter);
  }

  host.root().addEventListener('click', (ev) => {
    const tg = ev.target as HTMLElement;
    const kindBtn = tg.closest('[data-ar-kind]') as HTMLElement | null;
    if (kindBtn) {
      const k = kindBtn.dataset.arKind as ArsenalItem['kind'] | '';
      filter = { ...filter, kind: k || undefined };
      paint();
      return;
    }
    const gradeBtn = tg.closest('[data-ar-grade]') as HTMLElement | null;
    if (gradeBtn) {
      const g = Number(gradeBtn.dataset.arGrade);
      filter = { ...filter, grade: filter.grade === g ? undefined : g };
      paint();
      return;
    }
    const card = tg.closest('[data-codex]') as HTMLElement | null;
    if (card?.dataset.codex) host.openCodex(card.dataset.codex);
  });

  /** Cache-first paint, then a best-effort refresh. Any failure keeps the cache. */
  async function refresh(): Promise<void> {
    items = parseArsenalItems(host.readCache());
    paint();
    const auth = await host.authorizedBase();
    if (!auth) return;
    try {
      const res = await fetch(`${auth.base}/arsenal/me`, {
        headers: { authorization: `Bearer ${auth.token}` },
      });
      if (!res.ok) return;
      const body = (await res.json().catch(() => null)) as { items?: unknown } | null;
      items = parseArsenalItems(body?.items);
      host.writeCache(items);
      paint();
    } catch {
      // offline/unreachable — the cache painted above stays the source of truth
    }
  }

  return { refresh, items: () => items };
}
