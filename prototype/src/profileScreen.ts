/**
 * «Профиль командира» — the career dossier (docs/main-menu.md §4.2, REFM-10).
 *
 * Shared owner/public overlay, opened from the hub, friends, ranking and match cards.
 * Cosmetic edits persist on the account; nothing here touches the simulation.
 *
 * Where each number comes from, so nothing on this screen is invented:
 *   · matches / winrate / avg place / streak / season score — the local career
 *     counters folded at checkEnd (`meta.ts` `recordMatch`);
 *   · league — a cosmetic band over the commander level (`leagueKey`);
 *   · influence + corporation — the live corp record, when a session has one;
 *   · corporation grants — the existing cached showcase;
 *   · portrait / medal slots / current grades — the server's account profile.
 * Public cards use ONLY the requested player's server projection, without currency.
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
import { detach } from './detach';
import {
  defaultAppearance,
  parseAppearance,
  PROFILE_MEDALS,
  medalGrade,
  type PlayerProfile,
  type ProfileAppearance,
} from '../../packages/protocol/src/playerProfile';
import { parsePlayerProfile, placeProfileMedal } from '../../decisions/playerProfile';
import { profileStudioHtml } from './profileStudio';

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
  /** Generated locally from validated data, never server-provided HTML. */
  studio?: string;
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
    (v.studio ?? '') +
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
  /** Scope cache and pending requests to the selected server AND account. */
  identity?(): string;
  readAppearance?(): unknown;
  writeAppearance?(value: ProfileAppearance): void;
  appearanceChanged?(portrait: number): void;
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
export function initProfile(host: ProfileHost): {
  open: (login?: string) => void;
  close: () => void;
  /** Repaint the open dossier as it stands (the page skin changed under it). */
  repaint: () => void;
} {
  let owned: string[] = [];
  let catalog: MedalEntry[] = [];
  let generation = 0;
  let target: string | undefined;
  let identity = '';
  let custom: PlayerProfile = { ...defaultAppearance(), login: '', xp: 0, progress: {} };
  let saved = defaultAppearance();
  let auth: { base: string; token: string } | null = null;
  let ready = false;
  let saving = false;
  let preview = false;
  let selected = 0;
  let notice = '';
  const currentIdentity = (): string => host.identity?.() ?? host.view().nick;
  const current = (n: number): boolean => n === generation && identity === currentIdentity();
  const appearance = (): ProfileAppearance => ({
    portrait: custom.portrait,
    slots: [...custom.slots],
  });
  const dirty = (): boolean => JSON.stringify(appearance()) !== JSON.stringify(saved);

  const paint = (): void => {
    const root = host.root();
    const bodyScroll = root.querySelector?.('.pf-body')?.scrollTop ?? 0;
    const galleryScroll = root.querySelector?.('.ps-portraits')?.scrollTop ?? 0;
    const active =
      typeof document === 'undefined' ? null : (document.activeElement as HTMLElement | null);
    const focusData =
      active && root.contains?.(active) && active.tagName === 'BUTTON'
        ? JSON.stringify(active.dataset)
        : null;
    const studio = profileStudioHtml(custom, {
      owner: target === undefined,
      preview,
      selected,
      ready,
      saving,
      dirty: dirty(),
      notice,
    });
    host.root().innerHTML =
      target === undefined
        ? profileHtml({ ...host.view(), owned, catalog, studio })
        : `<button class="pf-close" type="button" aria-label="${esc(t('card.close'))}">✕</button><div class="pf-top"><div class="pf-who"><div class="pf-nm">${esc(custom.login)}</div><div class="pf-sub">${esc(t('profile.public'))}</div></div></div><div class="pf-body">${studio}<div class="pf-grid">${pfCell(t('profile.matches'), ready ? String(custom.progress.matches ?? 0) : null)}${pfCell(t('profile.wins'), ready ? String(custom.progress.wins ?? 0) : null)}${pfCell(t('profile.xp'), ready ? String(custom.xp) : null)}</div></div>`;
    const body = root.querySelector?.('.pf-body');
    const gallery = root.querySelector?.('.ps-portraits');
    if (body) body.scrollTop = bodyScroll;
    if (gallery) gallery.scrollTop = galleryScroll;
    if (focusData)
      Array.from(root.querySelectorAll('button'))
        .find((b) => JSON.stringify(b.dataset) === focusData)
        ?.focus({ preventScroll: true });
  };

  async function refreshMedals(session: { base: string; token: string }, n: number): Promise<void> {
    const headers = { authorization: `Bearer ${session.token}` };
    try {
      const [catRes, mineRes] = await Promise.all([
        fetch(`${session.base}/medals`, { headers }),
        fetch(`${session.base}/medals/me`, { headers }),
      ]);
      if (!catRes.ok || !mineRes.ok) return;
      const cat = (await catRes.json().catch(() => null)) as { medals?: unknown } | null;
      const mine = (await mineRes.json().catch(() => null)) as { medals?: unknown } | null;
      if (!current(n)) return;
      catalog = parseMedalCatalog(cat?.medals);
      owned = parseMedals(mine?.medals).map((m) => m.medalId);
      host.writeCache({ owned, catalog });
      paint();
    } catch {
      // offline/unreachable — the cached showcase painted above stays as it is
    }
  }

  async function refresh(n: number): Promise<void> {
    try {
      const session = await host.authorizedBase();
      if (!current(n)) return;
      auth = session;
      if (!session) {
        ready = target === undefined;
        // Guests can choose a portrait locally; earned medals require an account.
        custom.slots = defaultAppearance().slots;
        saved = appearance();
        notice = t(target === undefined ? 'profile.guest' : 'profile.sign-in-public');
        paint();
        return;
      }
      if (target === undefined) detach('профиль: награды корпорации', refreshMedals(session, n));
      const res = await fetch(
        `${session.base}/profiles${target === undefined ? '' : `?login=${encodeURIComponent(target)}`}`,
        { headers: { authorization: `Bearer ${session.token}` } },
      );
      const parsed = res.ok ? parsePlayerProfile(await res.json()) : null;
      if (!current(n)) return;
      if (!parsed) throw new Error('E_PROFILE_READ');
      custom = parsed;
      saved = appearance();
      ready = true;
      notice = '';
      if (target === undefined) {
        host.writeAppearance?.(saved);
        host.appearanceChanged?.(custom.portrait);
      }
    } catch {
      if (!current(n)) return;
      notice = t('profile.load-error');
      ready = false;
    }
    paint();
  }

  async function save(): Promise<void> {
    if (!ready || saving || target !== undefined || !dirty()) return;
    const n = generation;
    if (!current(n)) return;
    const value = appearance();
    saving = true;
    notice = '';
    paint();
    try {
      if (auth) {
        // Recheck identity before writing: an account/server change invalidates the editor.
        const session = await host.authorizedBase();
        if (!current(n)) return;
        if (!session || session.base !== auth.base || session.token !== auth.token)
          throw new Error('E_AUTH');
        const res = await fetch(`${session.base}/profiles/me`, {
          method: 'POST',
          headers: { authorization: `Bearer ${session.token}`, 'content-type': 'application/json' },
          body: JSON.stringify(value),
        });
        const parsed = res.ok ? parsePlayerProfile(await res.json()) : null;
        if (!current(n)) return;
        if (!parsed) throw new Error('E_PROFILE_SAVE');
        custom = parsed;
      }
      if (!current(n)) return;
      saved = appearance();
      host.writeAppearance?.(saved);
      host.appearanceChanged?.(saved.portrait);
      notice = t(auth ? 'profile.saved' : 'profile.saved-local');
    } catch {
      if (!current(n)) return;
      notice = t('profile.save-error');
    } finally {
      if (current(n)) {
        saving = false;
        paint();
      }
    }
  }

  const close = (): void => {
    generation++;
    host.root().classList.remove('show');
  };

  host.root().addEventListener('click', (ev) => {
    const tg = ev.target as HTMLElement;
    // Close on the ✕ or on the backdrop itself, never on a tap inside the sheet.
    if (tg.closest('.pf-close') || tg === host.root()) {
      close();
      return;
    }
    const button = tg.closest('button') as HTMLButtonElement | null;
    if (!button || button.disabled || target !== undefined || saving || !current(generation))
      return;
    if (button.dataset.ps === 'mode') {
      preview = !preview;
      paint();
      return;
    }
    if (!ready) return;
    if (button.dataset.ps === 'save') {
      detach('профиль: сохранение', save());
      return;
    }
    if (button.dataset.ps === 'cancel') {
      custom = { ...custom, ...structuredClone(saved) };
      notice = '';
      paint();
      return;
    }
    if (preview) return;
    if (button.dataset.portrait) {
      const next = parseAppearance({ ...appearance(), portrait: Number(button.dataset.portrait) });
      if (next) custom = { ...custom, ...next };
    }
    if (button.dataset.slot !== undefined) {
      const index = Number(button.dataset.slot);
      if (Number.isInteger(index) && index >= 0 && index < 15) selected = index;
    }
    if (button.dataset.ps === 'remove')
      custom = { ...custom, ...placeProfileMedal(custom, selected, null) };
    const medal = PROFILE_MEDALS.find((m) => m.id === button.dataset.medal);
    if (medal && medalGrade(medal.id, custom.progress))
      custom = { ...custom, ...placeProfileMedal(custom, selected, medal.id) };
    notice = dirty() ? t('profile.unsaved') : '';
    paint();
  });

  return {
    open: (login) => {
      generation++;
      identity = currentIdentity();
      target = login;
      ready = false;
      saving = false;
      preview = false;
      selected = 0;
      auth = null;
      notice = t('profile.loading');
      const cached =
        login === undefined ? parseMedalCache(host.readCache()) : { owned: [], catalog: [] };
      owned = cached.owned;
      catalog = cached.catalog;
      const local = login === undefined ? parseAppearance(host.readAppearance?.()) : null;
      custom = {
        ...(local ?? defaultAppearance()),
        login: login ?? host.view().nick,
        xp: 0,
        progress: {},
        slots: defaultAppearance().slots,
      };
      saved = appearance();
      paint();
      host.root().classList.add('show');
      detach('профиль: обновление с сервера', refresh(generation));
    },
    close,
    repaint: () => {
      if (host.root().classList.contains('show')) paint();
    },
  };
}
