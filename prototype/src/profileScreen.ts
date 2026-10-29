import { corpShowcaseHtml } from './corpFacilitiesView';
/**
 * «Профиль командира» — the career dossier (docs/main-menu.md §4.2, REFM-10).
 *
 * Shared owner/public overlay, opened from the hub, friends, ranking and match cards.
 * Cosmetic edits persist on the account; nothing here touches the simulation.
 *
 * Where each number comes from, so nothing on this screen is invented:
 *   · authenticated matches / wins / XP — the server account projection;
 *   · PvP counts / resource value / modes — completed authoritative career ledgers;
 *   · guest career — local counters folded at checkEnd (`meta.ts` `recordMatch`);
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
import { LOCALE, t, hasKey } from '../../localization/runtime';
import { esc, kfmt, nfmt } from './format';
import { SOV_SVG } from './icons';
import { averagePlace, leagueKey, winRate, type MetaStats } from './meta';
import { parseMedals, parseCorpRecord, parseMemberships, sortMembers, type CorpRecord, type CorpMembership, type CorpRole } from './corp';
import { corpEmblem } from './corpEmblems';
import { accountLevel } from '../../decisions/playerCareer';
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
import {
  parseProfileTab,
  profileSaveBarHtml,
  profileStudioHtml,
  PROFILE_TABS,
  type ProfileTab,
  type StudioState,
} from './profileStudio';
import { PORTRAITS } from './profileArt';

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
  account?: PlayerProfile;
  accountReady?: boolean;
  /** The live corp record, or null when this commander flies alone. */
  corp: { name: string; influence: number } | null;
  sovereigns: number | null;
  /** Medal ids the account holds, and the full catalog to show them against. */
  owned: readonly string[];
  catalog: readonly MedalEntry[];
  /** Header portrait, a static asset URL; without it the avatar is the callsign's first
   *  letter. */
  face?: string;
  /** The editor (`profileStudioHtml`), which places the career block itself. Generated
   *  locally from validated data, never server-provided HTML. */
  studio?: string;
  /** A running premium account: the header wears its frame. */
  premium?: boolean;
}

/** The premium frame's mark under the callsign (the frame itself is `.pf-top.premium`). */
const premiumMark = (on: boolean | undefined): string =>
  on ? `<span class="pf-prem">★ ${esc(t('profile.premium'))}</span>` : '';

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

/** The public corporation card uses the same verified record and roster as the cabinet. */
export function profileCorporationHtml(corp: CorpRecord, members: readonly CorpMembership[]): string {
  const roster = sortMembers(members.filter((m) => m.role !== 'recruit'));
  const roles: Record<CorpRole, string> = {
    head: 'corp.role.head', officer: 'corp.role.officer', member: 'corp.role.member', recruit: 'corp.role.recruit',
  };
  return (
    `<header class="pf-corp-head">${corpEmblem(corp.corpId, corp.emblemId, 64)}<div>` +
    `<p class="pf-corp-kicker">${esc(t('profile.corporation'))}</p><h2>${esc(corp.name)}</h2></div></header>` +
    `<div class="pf-grid pf-corp-stats">${pfCell(t('profile.influence'), nfmt(corp.influence), true)}` +
    `${pfCell(t('corp.tab.members'), nfmt(roster.length))}</div>${corpShowcaseHtml(corp)}` +
    `<section class="pf-corp-roster" aria-label="${esc(t('profile.corporation.members', { n: roster.length }))}">` +
    `<h3>${esc(t('corp.hub.tab.members'))}</h3>` +
    (roster.length
      ? `<ul class="pf-corp-members">` + roster.map((m) =>
        `<li class="${m.role}"><span class="pf-corp-avatar" aria-hidden="true">${esc((Array.from(m.login.trim())[0] ?? '?').toUpperCase())}</span>` +
        `<div><b>${esc(m.login)}</b><small>${esc(t(roles[m.role]))}</small></div></li>`,
      ).join('') + `</ul>`
      : `<p class="pf-hint">${esc(t('corp.empty'))}</p>`) + `</section>`
  );
}

/** Career numbers and the corporation's medal showcase. `titled` heads them with the
 *  dossier title where they stand under the card; the owner's Career tab is its own
 *  title (UIX-15.3). */
export function profileCareerHtml(v: ProfileView, titled = true): string {
  const stats = v.stats;
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
    (titled ? `<div class="pf-h">${esc(t('profile.title'))}</div>` : '') +
    (v.account
      ? accountCareerHtml(v.account, v.accountReady ?? true)
      : `<div class="pf-grid">` +
        pfCell(t('profile.matches'), String(stats.matches)) +
        pfCell(t('profile.winrate'), played ? `${winRate(stats)}%` : null, true) +
        pfCell(t('profile.place'), avg === null ? null : avg.toFixed(1)) +
        // Influence is the corporation's ledger (metagame.md) — without one there is
        // no number to show, and a bare 0 would read as «you earned nothing».
        pfCell(t('profile.influence'), v.corp ? nfmt(v.corp.influence) : null, true) +
        pfCell(t('profile.season'), nfmt(stats.score)) +
        pfCell(t('profile.streak'), stats.streak > 0 ? `×${stats.streak}` : '—') +
        `</div>`) +
    `<div class="pf-sec">${esc(t('profile.medals'))}</div>` +
    (medals
      ? `<div class="pf-medals">${medals}</div>`
      : `<p class="pf-hint">${esc(t('profile.medals.empty'))}</p>`)
  );
}

/** The dossier — pure string building over an already-gathered view. */
export function profileHtml(v: ProfileView): string {
  const nick = v.nick.trim() || t('auth.commander');
  const league = t(leagueKey(accountLevel(v.xp).level));
  // Subtitle mirrors the mock: «<corp> · Лига: <band>», degrading to the league
  // alone when this commander flies without a corporation.
  const sub =
    (v.corp ? `${esc(v.corp.name)} · ` : '') + `${esc(t('profile.league'))}: ${esc(league)}`;
  return (
    `<button class="pf-close btn-x" type="button" aria-label="${esc(t('card.close'))}">✕</button>` +
    `<div class="pf-top${v.premium ? ' premium' : ''}">` +
    (v.face
      ? `<div class="pf-av face"><img src="${esc(v.face)}" alt=""></div>`
      : `<div class="pf-av">${esc(nick.slice(0, 1).toUpperCase())}</div>`) +
    `<div class="pf-who"><div class="pf-nm">${esc(nick)}</div><div class="pf-sub">${sub}</div>${premiumMark(v.premium)}</div>` +
    (v.sovereigns === null
      ? ''
      : `<div class="pf-cur" title="${esc(t('hub.sovereigns'))}"><i>${SOV_SVG}</i><b>${kfmt(v.sovereigns)}</b><em>+</em></div>`) +
    `</div>` +
    `<div class="pf-body">` +
    (v.studio ?? profileCareerHtml(v)) +
    `</div>`
  );
}

/** Shared account career; bots additionally retain their bounded completed history. */
function publicCareerHtml(profile: PlayerProfile, ready: boolean): string {
  const bot = ready && profile.kind === 'bot';
  const grid = accountCareerHtml(profile, ready);
  if (!bot) return grid;
  const history = profile.recentMatches ?? [];
  const title = `<h3>${esc(t('profile.history.title'))}</h3>`;
  if (!history.length)
    return grid + title + `<p class="pf-hint">${esc(t('profile.history.empty'))}</p>`;
  const dateFormat = new Intl.DateTimeFormat(LOCALE, {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  });
  return (
    grid +
    title +
    `<ol class="pf-history">` +
    history
      .map((match) => {
        const date = new Date(match.endedAt);
        const outcome =
          match.outcome === 'win'
            ? t('profile.history.win')
            : match.outcome === 'draw'
              ? t('profile.history.draw')
              : t('profile.history.loss');
        const place =
          match.place === null
            ? ''
            : `<span>${esc(t('profile.history.place', { n: match.place }))}</span>`;
        return (
          `<li><div class="pf-history-main"><b>${esc(outcome)}</b><time datetime="${esc(date.toISOString())}">${esc(dateFormat.format(date))}</time></div>` +
          `<div class="pf-history-details"><span class="pf-history-map">${esc(t('profile.history.map', { map: match.mapId }))}</span>${place}<span>${esc(t('profile.history.xp', { n: match.xp }))}</span></div></li>`
        );
      })
      .join('') +
    `</ol>`
  );
}

/** No local career counters or invented zeroes enter a public account card. */
export function accountCareerHtml(profile: PlayerProfile, ready: boolean): string {
  const level = accountLevel(profile.xp);
  const stats = ready
    ? (profile.statistics ??
      (profile.kind === 'bot'
        ? { matches: profile.progress.matches ?? 0, wins: profile.progress.wins ?? 0 }
        : undefined))
    : undefined;
  const career = ready ? profile.career : null;
  const ratio = (destroyed: number, lost: number): string =>
    lost > 0 ? (destroyed / lost).toFixed(2) : destroyed > 0 ? t('profile.career.no-losses') : '—';
  const corporation =
    !ready || profile.corporation === undefined
      ? esc(t('profile.corporation.unknown'))
      : profile.corporation === null
        ? esc(t('profile.corporation.none'))
        : `<button type="button" class="btn-second pf-corporation" data-profile-corp="${esc(profile.corporation.id)}">${esc(profile.corporation.name)}</button>`;
  const combat = career?.pvp;
  const resources = combat
    ? [...new Set([...Object.keys(combat.destroyedCost), ...Object.keys(combat.lostCost)])].sort()
    : [];
  const detail = career
    ? `<p class="pf-hint">${esc(t('profile.career.since', { date: new Intl.DateTimeFormat(LOCALE).format(new Date(career.since)) }))}</p>` +
      `<h4>${esc(t('profile.career.resources'))}</h4><ul>` +
      resources
        .map(
          (resource) =>
            `<li>${esc(t('profile.career.resource', { resource: t('hud.resource.' + resource), destroyed: nfmt(combat!.destroyedCost[resource] ?? 0), lost: nfmt(combat!.lostCost[resource] ?? 0), ratio: ratio(combat!.destroyedCost[resource] ?? 0, combat!.lostCost[resource] ?? 0) }))}</li>`,
        )
        .join('') +
      `</ul>` +
      `<h4>${esc(t('profile.career.modes'))}</h4><ul>` +
      Object.entries(career.modes)
        .sort(([a], [b]) => a.localeCompare(b))
        .map(
          ([mode, n]) =>
            `<li>${esc(t('profile.career.mode', { mode: mode === 'versus-bots' ? t('profile.career.versus-bots') : hasKey('data.' + mode.replaceAll('_','-')) ? t('data.' + mode.replaceAll('_','-')) : t('profile.career.mode-other'), matches: n.matches, wins: n.wins }))}</li>`,
        )
        .join('') +
      `</ul>`
    : `<p class="pf-hint">${esc(t('profile.career.none'))}</p>`;
  return (
    `<div class="pf-account-level"><b>${ready ? esc(t('profile.account.level', { n: level.level })) : '—'}</b>` +
    (ready
      ? `<progress max="${level.needed}" value="${level.earned}" aria-label="${esc(t('profile.xp'))}"></progress><span>${esc(t('profile.account.progress', level))}</span>`
      : '') +
    `</div>` +
    `<div class="pf-corp-line">${esc(t('profile.corporation'))}: ${corporation}</div><div class="pf-grid">` +
    pfCell(t('profile.matches'), stats ? String(stats.matches) : null) +
    pfCell(t('profile.metric.wins'), stats ? String(stats.wins) : null) +
    pfCell(
      t('profile.winrate'),
      stats?.matches ? `${Math.round((stats.wins / stats.matches) * 100)}%` : null,
    ) +
    pfCell(t('profile.career.destroyed'), combat ? nfmt(combat.destroyed) : null) +
    pfCell(t('profile.career.lost'), combat ? nfmt(combat.lost) : null) +
    pfCell(t('profile.career.ratio'), combat ? ratio(combat.destroyed, combat.lost) : null) +
    `</div>` +
    `<details class="pf-career-details"><summary>${esc(t('profile.career.details'))}</summary>${detail}<p class="pf-hint">${esc(t('profile.career.rules'))}</p></details>`
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
} {
  let owned: string[] = [];
  let catalog: MedalEntry[] = [];
  let generation = 0;
  let corporationHtml: string | null = null;
  let corporationRequest = 0;
  let playerScroll = 0;
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
  // Kept across opens: the dossier comes back on the section the player left.
  let tab: ProfileTab = 'portrait';
  // One-shot motion for the next paint: the stage after a new portrait, the slot that
  // just took a medal. The dossier repaints whole on every click, so motion keyed to
  // state alone would replay on each one.
  let flash: { stage?: boolean; slot?: number } = {};
  let barShown = false;
  const currentIdentity = (): string => host.identity?.() ?? host.view().nick;
  const current = (n: number): boolean => n === generation && identity === currentIdentity();
  const appearance = (): ProfileAppearance => ({
    portrait: custom.portrait,
    slots: [...custom.slots],
  });
  const dirty = (): boolean => JSON.stringify(appearance()) !== JSON.stringify(saved);

  const paint = (opts: { tabSwitched?: boolean } = {}): void => {
    const root = host.root();
    const bodyScroll = root.querySelector?.('.pf-body')?.scrollTop ?? 0;
    const active =
      typeof document === 'undefined' ? null : (document.activeElement as HTMLElement | null);
    const focusData =
      active && root.contains?.(active) && active.tagName === 'BUTTON'
        ? JSON.stringify(active.dataset)
        : null;
    const state: StudioState = {
      owner: target === undefined,
      preview,
      selected,
      ready,
      saving,
      dirty: dirty(),
      notice,
      tab,
    };
    if (corporationHtml !== null) {
      const scroll = root.querySelector?.('.pf-corp-body')?.scrollTop ?? 0;
      root.innerHTML = `<div class="pf-corp-view"><nav class="pf-corp-nav">` +
        `<button type="button" class="btn-quiet" data-profile-corp-back><span aria-hidden="true">←</span>${esc(t('profile.corporation.back'))}</button>` +
        `</nav><div class="pf-body pf-corp-body"><article class="pf-corp-card">${corporationHtml}</article></div></div>`;
      const body = root.querySelector?.('.pf-corp-body');
      if (body) body.scrollTop = scroll;
      if (active?.hasAttribute('data-profile-corp-back'))
        root.querySelector<HTMLElement>('[data-profile-corp-back]')?.focus({ preventScroll: true });
      return;
    }
    if (target === undefined) {
      const view: ProfileView = {
        ...host.view(),
        ...(auth ? { account: custom, accountReady: ready, xp: custom.xp, corp: null } : {}),
        owned,
        catalog,
        face: PORTRAITS[custom.portrait - 1],
        ...(custom.premium ? { premium: true } : {}),
      };
      const studio = profileStudioHtml(custom, state, profileCareerHtml(view, preview));
      root.innerHTML = profileHtml({ ...view, studio }) + profileSaveBarHtml(state);
    } else {
      root.innerHTML = `<button class="pf-close btn-x" type="button" aria-label="${esc(t('card.close'))}">✕</button><div class="pf-top${custom.premium ? ' premium' : ''}"><div class="pf-who"><div class="pf-nm">${esc(custom.login)}</div><div class="pf-sub">${esc(t('profile.public'))}</div>${premiumMark(custom.premium)}</div></div><div class="pf-body">${profileStudioHtml(custom, state, publicCareerHtml(custom, ready))}</div>`;
    }
    const body = root.querySelector?.('.pf-body');
    if (body) {
      body.scrollTop = bodyScroll;
      // A new tab opens at its top: scrolled past the tab bar, come back up to it.
      const side = opts.tabSwitched ? root.querySelector('.ps-side') : null;
      if (side)
        body.scrollTop = Math.min(
          body.scrollTop,
          side.getBoundingClientRect().top - body.getBoundingClientRect().top + body.scrollTop,
        );
    }
    if (flash.stage) root.querySelector?.('.ps-stage')?.classList.add('ps-new');
    if (flash.slot !== undefined)
      root.querySelector?.(`[data-slot="${flash.slot}"]`)?.classList.add('ps-placed');
    flash = {};
    // The save bar rises once, when changes appear, not on every repaint after that.
    const bar = root.querySelector?.('.ps-savebar');
    if (bar && !barShown) bar.classList.add('ps-rise');
    barShown = !!bar;
    if (focusData)
      Array.from(root.querySelectorAll('button'))
        .find((b) => JSON.stringify(b.dataset) === focusData)
        ?.focus({ preventScroll: true });
  };

  const openTab = (next: ProfileTab): void => {
    if (target !== undefined || next === tab) return;
    tab = next;
    paint({ tabSwitched: true });
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
    if (corporationHtml !== null) {
      corporationRequest++;
      corporationHtml = null;
      paint();
      const root = host.root();
      const body = root.querySelector?.('.pf-body');
      if (body) body.scrollTop = playerScroll;
      root.querySelector?.<HTMLElement>('[data-profile-corp]')?.focus({ preventScroll: true });
      return;
    }
    generation++;
    host.root().classList.remove('show');
  };

  host.root().addEventListener('click', (ev) => {
    const tg = ev.target as HTMLElement;
    if (tg.closest('[data-profile-corp-back]')) {
      close();
      return;
    }
    const corpButton = tg.closest<HTMLElement>('[data-profile-corp]');
    if (
      corpButton &&
      auth &&
      custom.corporation &&
      corpButton.dataset.profileCorp === custom.corporation.id
    ) {
      const session = auth,
        n = generation,
        request = ++corporationRequest;
      const corpId = custom.corporation.id;
      playerScroll = host.root().querySelector?.('.pf-body')?.scrollTop ?? 0;
      corporationHtml = `<p class="pf-hint" role="status">${esc(t('profile.corporation.loading'))}</p>`;
      paint();
      host.root().querySelector?.<HTMLElement>('[data-profile-corp-back]')?.focus();
      detach(
        'player corporation card',
        (async () => {
          try {
            const response = await fetch(`${session.base}/corps/${encodeURIComponent(corpId)}`, {
              headers: { authorization: `Bearer ${session.token}` },
            });
            const body = response.ok
              ? ((await response.json()) as { corp?: unknown; members?: unknown })
              : null;
            const corp = parseCorpRecord(body?.corp);
            if (!corp || corp.corpId !== corpId || !Array.isArray(body?.members))
              throw new Error('E_NO_CORP');
            if (!current(n) || request !== corporationRequest) return;
            corporationHtml = profileCorporationHtml(corp, parseMemberships(body.members));
          } catch {
            if (!current(n) || request !== corporationRequest) return;
            corporationHtml = `<p class="pf-hint">${esc(t('profile.corporation.error'))}</p>`;
          }
          paint();
        })(),
      );
      return;
    }
    // Close on the ✕ or on the backdrop itself, never on a tap inside the sheet.
    if (tg.closest('.pf-close') || tg === host.root()) {
      close();
      return;
    }
    // Tabs only navigate, so they answer even while the profile loads or saves.
    const tabId = parseProfileTab(
      (tg.closest('[data-pstab]') as HTMLElement | null)?.dataset.pstab,
    );
    if (tabId) {
      openTab(tabId);
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
      if (next && next.portrait !== custom.portrait) flash.stage = true;
      if (next) custom = { ...custom, ...next };
    }
    if (button.dataset.slot !== undefined) {
      const index = Number(button.dataset.slot);
      if (Number.isInteger(index) && index >= 0 && index < 15) selected = index;
    }
    if (button.dataset.ps === 'remove')
      custom = { ...custom, ...placeProfileMedal(custom, selected, null) };
    const medal = PROFILE_MEDALS.find((m) => m.id === button.dataset.medal);
    if (medal && medalGrade(medal.id, custom.progress)) {
      if (custom.slots[selected] !== medal.id) flash.slot = selected;
      custom = { ...custom, ...placeProfileMedal(custom, selected, medal.id) };
    }
    notice = dirty() ? t('profile.unsaved') : '';
    paint();
  });

  // Arrow keys, Home and End walk the tabs (the WAI-ARIA tabs pattern); focus follows.
  host.root().addEventListener('keydown', (ev) => {
    const e = ev as KeyboardEvent;
    const at = parseProfileTab(
      (e.target as HTMLElement | null)?.closest?.<HTMLElement>('[data-pstab]')?.dataset.pstab,
    );
    if (!at) return;
    const i = PROFILE_TABS.indexOf(at);
    const last = PROFILE_TABS.length - 1;
    const to =
      e.key === 'ArrowRight'
        ? i === last
          ? 0
          : i + 1
        : e.key === 'ArrowLeft'
          ? i === 0
            ? last
            : i - 1
          : e.key === 'Home'
            ? 0
            : e.key === 'End'
              ? last
              : -1;
    if (to < 0) return;
    e.preventDefault();
    const next = PROFILE_TABS[to]!;
    openTab(next);
    (host.root().querySelector?.(`[data-pstab="${next}"]`) as HTMLElement | null)?.focus();
  });

  return {
    open: (login) => {
      generation++;
      identity = currentIdentity();
      corporationRequest++;
      corporationHtml = null;
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
  };
}
