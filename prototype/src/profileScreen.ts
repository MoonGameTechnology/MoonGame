/**
 * «Профиль командира» — the career dossier (docs/main-menu.md §4.2, REFM-10).
 *
 * ONE overlay behind two doors: the hub identity strip and the in-match player card
 * («досье» button). Observation only — nothing here touches the simulation.
 *
 * Where each number comes from, so nothing on this screen is invented:
 *   · matches / winrate / avg place / streak / season score — the local career
 *     counters folded at checkEnd (`meta.ts` `recordMatch`);
 *   · league — a cosmetic band over the commander level (`leagueKey`);
 *   · influence + corporation — the live corp record, when a session has one;
 *   · medals — the account's grants, cache-first like the arsenal.
 * Anything unavailable prints «—» rather than a plausible-looking zero — that rule is
 * the point of the screen, and it is what `pfCell(…, null)` encodes.
 *
 * Same REFM shape as the other screens: the markup is pure (`profileHtml` takes a
 * finished `ProfileView`, so it needs neither storage nor a clock), and only
 * `initProfile(host)` touches the host, through explicit hooks.
 */
import { t } from '../../localization/runtime';
import { esc, kfmt, nfmt } from './format';
import { SOV_SVG } from './icons';
import { averagePlace, leagueKey, metaLevel, winRate, type MetaStats } from './meta';
import { parseMedals } from './corp';

/** One medal as the server reports it: an id plus display text. */
export interface MedalEntry {
  id: string;
  name: string;
}

/** Everything the dossier prints, already gathered — no lookups happen inside. */
export interface ProfileView {
  nick: string;
  /** Commander XP — the level and its cosmetic league band derive from it here. */
  xp: number;
  stats: MetaStats;
  /** The live corp record, or null when this commander flies alone. */
  corp: { name: string; influence: number } | null;
  sovereigns: number;
  /** Medal ids the account holds, and the full catalog to show them against. */
  owned: readonly string[];
  catalog: readonly MedalEntry[];
}

/** The cached medal blob (per callsign), parsed fail-soft: a corrupt cache is an empty
 *  showcase, never a crash. */
export function parseMedalCache(raw: unknown): { owned: string[]; catalog: MedalEntry[] } {
  if (typeof raw !== 'object' || raw === null) return { owned: [], catalog: [] };
  const v = raw as { owned?: unknown; catalog?: unknown };
  const owned = Array.isArray(v.owned)
    ? v.owned.filter((x): x is string => typeof x === 'string')
    : [];
  return { owned, catalog: parseMedalCatalog(v.catalog) };
}

/** A medal catalog from an untrusted blob (cache or server body) — entries missing a
 *  string id/name are dropped rather than rendered as `undefined`. */
export function parseMedalCatalog(raw: unknown): MedalEntry[] {
  if (!Array.isArray(raw)) return [];
  return raw.flatMap((x) => {
    const o = x as { id?: unknown; name?: unknown };
    return typeof o?.id === 'string' && typeof o?.name === 'string'
      ? [{ id: o.id, name: o.name }]
      : [];
  });
}

/** Big number + caption, the end screen's tile shape. `null` prints «—». */
export function pfCell(label: string, value: string | null, accent = false): string {
  return (
    `<div class="pf-cell"><span class="pf-k">${esc(label)}</span>` +
    `<span class="pf-v${accent ? ' accent' : ''}">${value === null ? '—' : esc(value)}</span></div>`
  );
}

/** The dossier body — pure string building over an already-gathered view. */
export function profileHtml(v: ProfileView): string {
  const nick = v.nick.trim() || t('auth.commander');
  const stats = v.stats;
  const league = t(leagueKey(metaLevel(v.xp)));
  // Subtitle mirrors the mock: «<corp> · Лига: <band>», degrading to the league
  // alone when this commander flies without a corporation.
  const sub =
    (v.corp ? `${esc(v.corp.name)} · ` : '') + `${esc(t('profile.league'))}: ${esc(league)}`;
  const avg = averagePlace(stats);
  const played = stats.matches > 0;
  const medals = v.catalog.length
    ? v.catalog
        .map((m) => {
          const own = v.owned.includes(m.id);
          // Names live in data/medals.json as display text (no i18n keys), so they
          // are printed as the server sends them — escaped, never as markup.
          return (
            `<div class="pf-medal${own ? '' : ' off'}"><div class="pf-mc">${own ? '◎' : '○'}</div>` +
            `<div class="pf-mn">${esc(m.name)}</div></div>`
          );
        })
        .join('')
    : '';
  return (
    `<button class="pf-close" type="button" aria-label="${esc(t('card.close'))}">✕</button>` +
    `<div class="pf-top">` +
    `<div class="pf-av">${esc(nick.slice(0, 1).toUpperCase())}</div>` +
    `<div class="pf-who"><div class="pf-nm">${esc(nick)}</div><div class="pf-sub">${sub}</div></div>` +
    `<div class="pf-cur" title="${esc(t('hub.sovereigns'))}"><i>${SOV_SVG}</i><b>${kfmt(v.sovereigns)}</b><em>+</em></div>` +
    `</div>` +
    `<div class="pf-body">` +
    `<div class="pf-h">${esc(t('profile.title'))}</div>` +
    `<div class="pf-grid">` +
    pfCell(t('profile.matches'), String(stats.matches)) +
    pfCell(t('profile.winrate'), played ? `${winRate(stats)}%` : null, true) +
    pfCell(t('profile.place'), avg === null ? null : avg.toFixed(1)) +
    // Influence is the corporation's ledger (metagame.md) — without one there is
    // no number to show, and a bare 0 would read as «you earned nothing».
    pfCell(t('profile.influence'), v.corp ? nfmt(v.corp.influence) : null, true) +
    pfCell(t('profile.season'), nfmt(stats.score)) +
    pfCell(t('profile.streak'), stats.streak > 0 ? `×${stats.streak}` : '—') +
    `</div>` +
    `<div class="pf-sec">${esc(t('profile.medals'))}</div>` +
    (medals
      ? `<div class="pf-medals">${medals}</div>`
      : `<p class="pf-hint">${esc(t('profile.medals.empty'))}</p>`) +
    `</div>`
  );
}

/** What the dossier needs from the shell. */
export interface ProfileHost {
  /** The overlay element (`#profile`) — painted and click-delegated here. */
  root(): HTMLElement;
  /** Everything the card prints EXCEPT the medals (those are this module's cache). */
  view(): Omit<ProfileView, 'owned' | 'catalog'>;
  /** The cached medal blob for the current callsign, as stored (parsed here). */
  readCache(): unknown;
  /** Persist a freshly fetched showcase for the current callsign. */
  writeCache(value: { owned: string[]; catalog: MedalEntry[] }): void;
  /** HTTP base + session token for the session-gated GET, or null when there is no
   *  server, no accounts, or no session token a prior join already stashed — the card
   *  must never prompt for a password just to LOOK at the dossier. */
  authorizedBase(): Promise<{ base: string; token: string } | null>;
}

/** Wire the dossier up. Call once at boot (it attaches the overlay's click delegate);
 *  `open()` is what the hub strip and the in-match player card call. */
export function initProfile(host: ProfileHost): { open: () => void; close: () => void } {
  let owned: string[] = [];
  let catalog: MedalEntry[] = [];

  const paint = (): void => {
    host.root().innerHTML = profileHtml({ ...host.view(), owned, catalog });
  };

  /** Cache-first paint, then a best-effort session-gated refresh — the arsenal's
   *  pattern. Note the prototype host does NOT mount `/medals/*` (only the full
   *  server does), so a playtest session simply keeps an empty showcase. */
  async function refresh(): Promise<void> {
    const cached = parseMedalCache(host.readCache());
    owned = cached.owned;
    catalog = cached.catalog;
    paint();
    const auth = await host.authorizedBase();
    if (!auth) return;
    const headers = { authorization: `Bearer ${auth.token}` };
    try {
      const [catRes, mineRes] = await Promise.all([
        fetch(`${auth.base}/medals`, { headers }),
        fetch(`${auth.base}/medals/me`, { headers }),
      ]);
      if (!catRes.ok || !mineRes.ok) return;
      const cat = (await catRes.json().catch(() => null)) as { medals?: unknown } | null;
      const mine = (await mineRes.json().catch(() => null)) as { medals?: unknown } | null;
      catalog = parseMedalCatalog(cat?.medals);
      owned = parseMedals(mine?.medals).map((m) => m.medalId);
      host.writeCache({ owned, catalog });
      paint();
    } catch {
      // offline/unreachable — the cached showcase painted above stays as it is
    }
  }

  host.root().addEventListener('click', (ev) => {
    const tg = ev.target as HTMLElement;
    // Close on the ✕ or on the backdrop itself, never on a tap inside the sheet.
    if (tg.closest('.pf-close') || tg === host.root()) host.root().classList.remove('show');
  });

  return {
    open: () => {
      paint();
      host.root().classList.add('show');
      void refresh(); // cache is already on screen; the server refresh trails
    },
    close: () => host.root().classList.remove('show'),
  };
}
