/**
 * Corporation cabinet (AVA-C1/C2, REFM-11) — the cross-session alliance management
 * screen designed in docs/corporation-ui.md, over the live CORP-0/AVA-2..9/MED-1 HTTP
 * API (`corpApi.ts` / `avaApi.ts` / `medalApi.ts`).
 *
 * Scope follows the doc's own §7 degradation order: Обзор / Участники / Войны / Казна
 * are REAL; Владения (sector ownership) and Чат (persistent corp chat) have no server
 * counterpart at all (no meta-layer Контур 2 yet) and stay honest «скоро» stubs rather
 * than simulated data.
 *
 * Deliberately CACHE-FREE, unlike the arsenal and the profile: roster windows and
 * challenges are too volatile to show stale — a corp screen that lies about who is
 * ready is worse than one that shows nothing. Every read goes through `corpFetch`,
 * which returns null on ANY failure and surfaces a server-given `E_*` code as a toast.
 *
 * REFM shape: the label tables and the pure view builders are exports; everything
 * stateful lives inside `initCorp(host)`, which takes its four DOM slots and four host
 * services explicitly.
 */
import { t } from '../../localization/runtime';
import { esc, nfmt } from './format';
import { readRaw, writeRaw } from './prefs';
import {
  canManage,
  parseAccountIds,
  parseAudit,
  parseChallenges,
  parseCorpRecord,
  parseCorpSummaries,
  parseFeed,
  parseMedalDefs,
  parseMedals,
  parseMembership,
  parseMemberships,
  parseReadyPool,
  parseRosterView,
  sortMembers,
  type AvaChallenge,
  type AvaChallengeStatus,
  type AvaFeedEntry,
  type AvaRosterView,
  type CorpAuditEntry,
  type CorpMembership,
  type CorpRecord,
  type CorpRole,
  type CorpSummary,
  type MedalDef,
} from './corp';

// Six tabs, every one backed by a real route (CORP-HUB). The row is a GRID, not a
// scrolling strip: six tabs fit a phone in two rows, so no tab can hide off-screen
// behind a swipe. `icon` is what makes that grid readable at a glance — six labels
// alone read as a wall of text.
//
// What the cabinet deliberately does NOT show, because the server has no such data
// (inventing it is the one unforgivable bug on a screen people plan around): corp
// buildings, a crafting bench, a parts inventory, weekly tasks, a resource treasury
// (influence is the only corp currency), squads, member online status, a corp tag /
// motto / join policy / tax, and per-battle scores. Sector holdings and a persistent
// corp chat have no server counterpart either (no meta-layer Контур 2 yet) and stay
// honest "скоро" lines in Настройки rather than simulated tabs.
export const CORP_TABS: { id: string; label: string; icon: string }[] = [
  { id: 'hq', label: 'corp.tab.hq', icon: '⬢' },
  { id: 'members', label: 'corp.tab.members', icon: '▤' },
  { id: 'wars', label: 'corp.tab.wars', icon: '⚔' },
  { id: 'battles', label: 'corp.tab.battles', icon: '🏆' },
  { id: 'treasury', label: 'corp.tab.treasury', icon: '⟡' },
  { id: 'settings', label: 'corp.tab.settings', icon: '⚙' },
];
export const CORP_ROLE_LABEL: Record<CorpRole, string> = {
  head: 'corp.role.head',
  officer: 'corp.role.officer',
  member: 'corp.role.member',
  recruit: 'corp.role.recruit',
};
export const corpRoleLabel = (r: CorpRole): string => t(CORP_ROLE_LABEL[r]);
export const CORP_ROLE_DOT: Record<CorpRole, string> = {
  head: 'var(--cyan)',
  officer: 'var(--amber)',
  member: 'var(--dim)',
  recruit: 'var(--red)',
};
export const CORP_AUDIT_RU: Record<string, string> = {
  create: 'corp.audit.create',
  accept: 'corp.audit.accept',
  decline: 'corp.audit.decline',
  kick: 'corp.audit.kick',
  role: 'corp.audit.role',
  transfer: 'corp.audit.transfer',
  leave: 'corp.audit.leave',
  disband: 'corp.audit.disband',
  influence: 'corp.audit.influence',
  ready: 'corp.audit.ready',
  medal: 'corp.audit.medal',
  rent: 'corp.audit.rent',
  rent_return: 'corp.audit.rent-return',
};

// --- pure view builders (CORP-HUB) ------------------------------------------------

/** One finished war as the Битвы tab reads it. Built from the PUBLIC AvA feed, which
 *  is the only history the server exposes — so there is no score line and no rating
 *  delta here: those simply are not recorded (`AvaResult` is who/whom/winner/when). */
export interface CorpBattle {
  at: number;
  foe: string;
  outcome: 'win' | 'loss' | 'draw';
}

/** Таблица, а не сборка ключа из `outcome`: гейт локализации ищет ключ ЛИТЕРАЛОМ, и
 *  собранный в шаблоне ключ он посчитал бы осиротевшим переводом. */
export const CORP_BATTLE_LABEL: Record<CorpBattle['outcome'], string> = {
  win: 'corp.battle.win',
  loss: 'corp.battle.loss',
  draw: 'corp.battle.draw',
};

/** My corp's finished wars, newest first as the feed already is. A `result` entry with
 *  `winnerCorp === null` is a DRAW — not a loss (the difference is the whole point of
 *  storing null). Entries my corp is not a party to are skipped: the feed is global. */
export function corpBattles(feed: readonly AvaFeedEntry[], myCorpId: string): CorpBattle[] {
  const out: CorpBattle[] = [];
  for (const f of feed) {
    if (f.kind !== 'result') continue;
    const iAmChallenger = f.challengerCorp === myCorpId;
    if (!iAmChallenger && f.targetCorp !== myCorpId) continue;
    out.push({
      at: f.at,
      foe: iAmChallenger ? f.targetName : f.challengerName,
      outcome:
        f.winnerCorp === null || f.winnerCorp === undefined
          ? 'draw'
          : f.winnerCorp === myCorpId
            ? 'win'
            : 'loss',
    });
  }
  return out;
}

/** Витрина: how many awards the Штаб pins. Three is what fits a phone row. */
export const SHOWCASE_SLOTS = 3;
/** Which awards are pinned is a LOCAL choice (the server has no showcase field), so it
 *  lives in prefs — and the screen never claims other players see it. */
export const SHOWCASE_KEY = 'corp.showcase';

/** Stored form is a comma-joined id list; a missing/short/garbled value degrades to
 *  empty slots rather than throwing. Always exactly `SHOWCASE_SLOTS` entries. */
export function readShowcase(raw: string | null): string[] {
  const parts = (raw ?? '').split(',');
  return Array.from({ length: SHOWCASE_SLOTS }, (_, i) => parts[i] ?? '');
}

export function writeShowcase(slots: readonly string[]): string {
  return Array.from({ length: SHOWCASE_SLOTS }, (_, i) => slots[i] ?? '').join(',');
}

/** Big number + caption — the Штаб's tile shape. `null` prints «—» (нет данных), which
 *  is honestly different from a zero. */
export function hqTile(label: string, value: string | null): string {
  return (
    `<div class="chq-tile"><b>${value === null ? '—' : esc(value)}</b>` +
    `<span>${esc(label)}</span></div>`
  );
}

/** The three pinned slots. An id that is not in the catalog, or not earned, reads as an
 *  empty slot — a stale pref must never print a medal the player does not hold. */
export function showcaseHtml(
  slots: readonly string[],
  defs: readonly MedalDef[],
  owned: readonly string[],
): string {
  const cells = Array.from({ length: SHOWCASE_SLOTS }, (_, i) => {
    const id = slots[i] ?? '';
    const def = owned.includes(id) ? defs.find((d) => d.id === id) : undefined;
    return (
      `<button class="chq-cup${def ? ' on' : ''}" data-corpcup="${i}">` +
      `<i>${def ? '🏆' : '＋'}</i>` +
      `<span>${def ? esc(def.name) : t('corp.showcase.empty')}</span></button>`
    );
  }).join('');
  return `<div class="chq-cups">${cells}</div>`;
}

/** The full award gallery — every medal of the catalog, earned ones tappable, the rest
 *  shown dim WITH their condition text (a locked award you can read is a goal; a hidden
 *  one is just an absence). */
export function medalGalleryHtml(defs: readonly MedalDef[], owned: readonly string[]): string {
  const rows = defs
    .map((d) => {
      const has = owned.includes(d.id);
      return (
        `<button class="cmg-row${has ? '' : ' off'}"${has ? ` data-corppick="${esc(d.id)}"` : ' disabled'}>` +
        `<i>${has ? '🏆' : '🔒'}</i><span><b>${esc(d.name)}</b><em>${esc(d.description)}</em></span>` +
        `${has ? '' : `<u>${t('corp.medals.locked')}</u>`}</button>`
      );
    })
    .join('');
  return (
    `<div class="cmg-head"><button class="cbtn2" data-corpback="1">‹ ${t('corp.medals.back')}</button>` +
    `<b>${t('corp.medals.title')}</b>` +
    `<button class="cbtn2 danger" data-corppick="">${t('corp.medals.clear')}</button></div>` +
    (rows
      ? `<div class="cmg-list">${rows}</div>`
      : `<p class="chint">${t('corp.medals.empty')}</p>`)
  );
}

/** What the cabinet needs from the shell. */
export interface CorpHost {
  /** The overlay (`#corp`) — shown/hidden and click-delegated here. */
  root(): HTMLElement;
  /** The header strip (`#corphd`). */
  head(): HTMLElement;
  /** The tab row (`#corptabs`) — click-delegated here. */
  tabs(): HTMLElement;
  /** The body (`#corpbody`) — the part that repaints per tab. */
  body(): HTMLElement;
  /** HTTP base + session token for the session-gated calls, or null when there is no
   *  server, no accounts, or no stashed session. Same resolution as the arsenal's. */
  authorizedBase(): Promise<{ base: string; token: string } | null>;
  /** Toast a line to the player (used for server-given `E_*` codes). */
  note(text: string): void;
  /** Localized text for a stable `E_*` error code. */
  errText(code: string): string;
  /** Fire a just-in-time intro card by id (`corp`, `ava`). */
  onIntro(id: string): void;
}

/** Wire the cabinet up. Call once at boot — it attaches the overlay's and the tab
 *  row's click delegates. `mine()` is how the profile card reads the live corp record
 *  (its influence line and subtitle) without reaching into this screen's internals. */
export function initCorp(host: CorpHost): {
  open: () => void;
  close: () => void;
  mine: () => { corp: CorpRecord | null; membership: CorpMembership | null };
} {
  let corpTab = 'hq'; // открытая вкладка кабинета
  // Открытая витрина наград (галерея). Не отдельный слой: она заменяет тело кабинета,
  // а Back закрывает СНАЧАЛА её — ступень `corp` в лестнице зовёт `close()` ниже.
  let cupSlot: number | null = null;

  // --- live state (fetched via corpFetch — see refreshCorp) --------------------
  let corpMine: { corp: CorpRecord | null; membership: CorpMembership | null } = {
    corp: null,
    membership: null,
  };
  let corpDetail: { corp: CorpRecord; members: CorpMembership[] } | null = null;
  let corpAudit: CorpAuditEntry[] = [];
  let corpBrowseList: CorpSummary[] = [];
  let avaChallenges: AvaChallenge[] = [];
  let avaPool: Array<CorpSummary & { readySince: number }> = [];
  let avaFeed: AvaFeedEntry[] = [];
  let avaRoster: AvaRosterView | null = null;
  // AVA-6 setRoster eligibility — accountIds flagged ready in my corp (head/officer only,
  // fetched only while a roster window is open; empty otherwise).
  let avaReadyPlayers: string[] = [];
  // Optimistic — no GET exists for "am I flagged ready" (server has no such read
  // model yet); reflects only what THIS session successfully posted.
  let corpReadyOptimistic: boolean | null = null;
  let playerReadyOptimistic: boolean | null = null;
  let corpFetchBusy = false;
  // Место корпорации в общей доске (RANK-1). Считает СЕРВЕР по всей популяции —
  // `null` значит «места нет» (доска пуста / не в рейтинге), а не «последнее».
  let corpRank: number | null = null;
  let medalDefs: MedalDef[] = [];
  let medalsOwned: string[] = [];
  let showcase: string[] = readShowcase(readRaw(SHOWCASE_KEY));

  /** Shared authenticated call for the corp/AvA/medals APIs — the host resolves the
   *  session exactly as it does for ARS-5's /arsenal/me, but there is no local cache: this data is too volatile (roster windows, challenges)
   *  to show stale. Returns the parsed JSON body, or null on ANY failure (no
   *  server configured, not logged in, network error, non-2xx) — surfaces a
   *  server-given error code via `host.note()` when there is one, never throws. */
  async function corpFetch(
    path: string,
    init?: { method?: string; body?: unknown },
  ): Promise<unknown> {
    const auth = await host.authorizedBase();
    if (!auth) return null;
    try {
      const res = await fetch(`${auth.base}${path}`, {
        method: init?.method ?? 'GET',
        headers: {
          authorization: `Bearer ${auth.token}`,
          ...(init?.body !== undefined ? { 'content-type': 'application/json' } : {}),
        },
        ...(init?.body !== undefined ? { body: JSON.stringify(init.body) } : {}),
      });
      const body = (await res.json().catch(() => null)) as unknown;
      if (!res.ok) {
        const code = (body as { error?: unknown } | null)?.error;
        if (typeof code === 'string') host.note('✖ ' + host.errText(code));
        return null;
      }
      return body;
    } catch {
      return null;
    }
  }

  /** Full refresh of the cabinet's live state, then re-render. Cheap enough to
   *  call after every intent (create/apply/accept/kick/…) — the server is the
   *  only source of truth, no local optimistic membership mutation. */
  async function refreshCorp(): Promise<void> {
    if (corpFetchBusy) return;
    corpFetchBusy = true;
    try {
      const mineRaw = (await corpFetch('/corps/me')) as {
        corp?: unknown;
        membership?: unknown;
      } | null;
      corpMine = mineRaw
        ? { corp: parseCorpRecord(mineRaw.corp), membership: parseMembership(mineRaw.membership) }
        : { corp: null, membership: null };

      if (corpMine.membership) {
        const corpId = corpMine.membership.corpId;
        const detailRaw = (await corpFetch(`/corps/${encodeURIComponent(corpId)}`)) as {
          corp?: unknown;
          members?: unknown;
        } | null;
        const corp = detailRaw ? parseCorpRecord(detailRaw.corp) : null;
        corpDetail = corp ? { corp, members: parseMemberships(detailRaw?.members) } : null;
        if (canManage(corpMine.membership.role)) {
          const auditRaw = (await corpFetch(`/corps/${encodeURIComponent(corpId)}/audit`)) as {
            audit?: unknown;
          } | null;
          corpAudit = parseAudit(auditRaw?.audit);
        } else {
          corpAudit = [];
        }
        corpBrowseList = [];
      } else {
        corpDetail = null;
        corpAudit = [];
        const listRaw = (await corpFetch('/corps')) as { corps?: unknown } | null;
        corpBrowseList = parseCorpSummaries(listRaw?.corps);
      }

      // Место в общей доске и награды — только когда корпорация есть: у безкорпного
      // и то и другое пусто по смыслу, а лишний запрос стоит сети.
      if (corpMine.membership) {
        const board = (await corpFetch('/leaderboard')) as {
          corps?: { me?: { rank?: unknown } };
        } | null;
        const rank = board?.corps?.me?.rank;
        corpRank = typeof rank === 'number' ? rank : null;
        const catRaw = (await corpFetch('/medals')) as { medals?: unknown } | null;
        medalDefs = parseMedalDefs(catRaw?.medals);
        const mineMedals = (await corpFetch('/medals/me')) as { medals?: unknown } | null;
        medalsOwned = parseMedals(mineMedals?.medals).map((m) => m.medalId);
      } else {
        corpRank = null;
        medalDefs = [];
        medalsOwned = [];
      }

      const challengesRaw = (await corpFetch('/ava/challenges')) as { challenges?: unknown } | null;
      avaChallenges = parseChallenges(challengesRaw?.challenges);
      const poolRaw = (await corpFetch('/ava/pool')) as { pool?: unknown } | null;
      avaPool = parseReadyPool(poolRaw?.pool);
      // Лента ПУБЛИЧНАЯ и общая: вкладка «Битвы» отбирает из неё свои бои, поэтому окно
      // берётся шире восьми записей — иначе чужие войны вытеснят мои из истории.
      const feedRaw = (await corpFetch('/ava/feed?limit=40')) as { feed?: unknown } | null;
      avaFeed = parseFeed(feedRaw?.feed);

      // A locked-or-accepted matchup my corp is party to: show its roster window.
      const myCorpId = corpMine.membership?.corpId;
      const activeMatchup = avaChallenges.find(
        (c) =>
          (c.status === 'accepted' || c.status === 'locked') &&
          (c.challengerCorp === myCorpId || c.targetCorp === myCorpId),
      );
      avaRoster = activeMatchup
        ? parseRosterView(await corpFetch(`/ava/matchup/${encodeURIComponent(activeMatchup.id)}`))
        : null;

      // The setRoster eligibility set (AVA-6) — head/officer only, only while curating.
      avaReadyPlayers =
        avaRoster?.status === 'accepted' &&
        myCorpId &&
        corpMine.membership &&
        canManage(corpMine.membership.role)
          ? parseAccountIds(
              (
                (await corpFetch(`/corps/${encodeURIComponent(myCorpId)}/ready-players`)) as {
                  accountIds?: unknown;
                } | null
              )?.accountIds,
            )
          : [];
    } finally {
      corpFetchBusy = false;
    }
    renderCorp();
  }

  /** Fire an intent, then always refresh (the server is authoritative — no local
   *  guess at the new state). */
  async function corpIntent(path: string, body?: unknown): Promise<void> {
    const result = await corpFetch(path, { method: 'POST', body: body ?? {} });
    if (result) await refreshCorp();
  }

  function corpNameOf(corpId: string): string {
    if (corpId === corpMine.membership?.corpId && corpMine.corp) return corpMine.corp.name;
    return (
      corpBrowseList.find((c) => c.corpId === corpId)?.name ??
      avaPool.find((c) => c.corpId === corpId)?.name ??
      corpId
    );
  }

  function corpNoneHtml(): string {
    const rows = corpBrowseList
      .map(
        (c) =>
          `<div class="crow2"><span class="cnm">${esc(c.name)}</span>` +
          `<span class="cinf">${nfmt(c.influence)} ⟡</span>` +
          `<span class="cpres">${t('corp.members.count', { n: String(c.members) })}</span>` +
          `<span class="cman"><button class="cbtn2" data-corpact="apply" data-corparg="${esc(c.corpId)}">${t('corp.apply')}</button></span></div>`,
      )
      .join('');
    return (
      `<div class="ccols">` +
      `<section class="ccard"><h4>${t('corp.create.title')}</h4>` +
      `<div class="cinput"><input id="corpnewname" placeholder="${t('corp.create.name-ph')}" maxlength="24">` +
      `<button class="cbtn2" data-corpact="create">${t('corp.create.go')}</button></div></section>` +
      `<section class="ccard"><h4>${t('corp.browse.title')}</h4>` +
      `<div class="ctable">${rows || `<p class="chint">${t('corp.browse.empty')}</p>`}</div></section>` +
      `</div>`
    );
  }

  function corpHqHtml(): string {
    if (!corpMine.corp || !corpMine.membership) return corpNoneHtml();
    if (cupSlot !== null) return medalGalleryHtml(medalDefs, medalsOwned);
    const c = corpMine.corp;
    const feed = corpAudit
      .slice(0, 6)
      .map(
        (a) =>
          `<div class="cline"><span>${esc(a.actor)} ${t(CORP_AUDIT_RU[a.action] ?? a.action)}${a.target ? ` → ${esc(a.target)}` : ''}</span>` +
          `<em class="cwhen">${new Date(a.at).toLocaleString('ru-RU')}</em></div>`,
      )
      .join('');
    const feedHtml = canManage(corpMine.membership.role)
      ? feed || `<p class="chint">${t('corp.empty')}</p>`
      : `<p class="chint">${t('corp.log.private')}</p>`;
    const nextWar = avaChallenges.find((w) => w.status === 'accepted' || w.status === 'pending');
    const nextWarHtml = nextWar
      ? `<div class="cwarn">⚔ ${t('corp.war.ava')} vs ${esc(corpNameOf(nextWar.challengerCorp === corpMine.membership.corpId ? nextWar.targetCorp : nextWar.challengerCorp))} — ${t(nextWar.status === 'accepted' ? 'corp.war.roster-open' : 'corp.war.pending')}</div>`
      : '';
    const members = corpDetail?.members.filter((m) => m.role !== 'recruit').length ?? null;
    return (
      `${nextWarHtml}` +
      `<div class="chq-tiles">` +
      hqTile(t('corp.card.influence'), nfmt(c.influence)) +
      hqTile(t('corp.hq.place'), corpRank === null ? null : `#${corpRank}`) +
      hqTile(t('corp.card.members'), members === null ? null : String(members)) +
      hqTile(t('corp.card.role'), corpRoleLabel(corpMine.membership.role)) +
      `</div>` +
      `<h4>${t('corp.showcase')}</h4>` +
      showcaseHtml(showcase, medalDefs, medalsOwned) +
      `<p class="chint">${t('corp.showcase.hint')}</p>` +
      `<h4>${t('corp.log')}</h4>${feedHtml}`
    );
  }

  function corpBattlesHtml(): string {
    if (!corpMine.membership) return corpNoneHtml();
    const rows = corpBattles(avaFeed, corpMine.membership.corpId)
      .map(
        (b) =>
          `<div class="cbat"><span class="cbat-v v-${b.outcome}">${t(CORP_BATTLE_LABEL[b.outcome])}</span>` +
          `<span class="cbat-f">vs ${esc(b.foe)}</span>` +
          `<em class="cwhen">${new Date(b.at).toLocaleDateString('ru-RU')}</em></div>`,
      )
      .join('');
    return (
      `<h4>${t('corp.battles.title')}</h4>` +
      (rows ? `<div class="cbats">${rows}</div>` : `<p class="chint">${t('corp.battles.none')}</p>`) +
      `<p class="chint">${t('corp.battles.note')}</p>`
    );
  }

  function corpSettingsHtml(): string {
    if (!corpMine.corp || !corpMine.membership) return corpNoneHtml();
    const mine = corpMine.membership;
    const leave =
      mine.role === 'head'
        ? `<button class="cbtn2 danger wide" data-corpact="disband">${t('corp.disband')}</button>`
        : `<button class="cbtn2 wide" data-corpact="leave">${t('corp.leave')}</button>`;
    return (
      `<section class="ccard"><h4>${t('corp.settings.identity')}</h4>` +
      `<div class="cline"><span>${t('corp.settings.name')}</span><em>${esc(corpMine.corp.name)}</em></div>` +
      `<div class="cline"><span>${t('corp.my-role')}</span><em>${corpRoleLabel(mine.role)}</em></div>` +
      `<p class="chint">${t('corp.settings.identity.hint')}</p></section>` +
      `<section class="ccard"><h4>${t('corp.settings.soon')}</h4>` +
      `<div class="cline"><span>${t('corp.holdings.soon')}</span></div>` +
      `<p class="chint">${t('corp.holdings.soon.hint')}</p>` +
      `<div class="cline"><span>${t('corp.chat.soon')}</span></div>` +
      `<p class="chint">${t('corp.chat.soon.hint')}</p></section>` +
      leave
    );
  }

  function corpMembersHtml(): string {
    if (!corpDetail || !corpMine.membership) return corpNoneHtml();
    const myRole = corpMine.membership.role;
    const myId = corpMine.membership.accountId;
    const rows = sortMembers(corpDetail.members)
      .map((m) => {
        const isMe = m.accountId === myId;
        let manage = '';
        if (m.role === 'recruit' && canManage(myRole)) {
          manage =
            `<button class="cbtn2" data-corpact="accept" data-corparg="${esc(m.accountId)}">✓ ${t('corp.request.accept')}</button>` +
            `<button class="cbtn2 danger" data-corpact="decline" data-corparg="${esc(m.accountId)}">✖ ${t('corp.request.reject')}</button>`;
        } else if (!isMe && m.role !== 'head') {
          const bits: string[] = [];
          if (myRole === 'head') {
            const toRole = m.role === 'officer' ? 'member' : 'officer';
            bits.push(
              `<button class="cbtn2" data-corpact="role" data-corparg="${esc(m.accountId)}" data-corprole="${toRole}">↑ ${corpRoleLabel(toRole)}</button>`,
            );
            bits.push(
              `<button class="cbtn2" data-corpact="transfer" data-corparg="${esc(m.accountId)}">⬆ ${t('corp.transfer-lead')}</button>`,
            );
          }
          if (canManage(myRole) && !(myRole === 'officer' && m.role === 'officer')) {
            bits.push(
              `<button class="cbtn2 danger" data-corpact="kick" data-corparg="${esc(m.accountId)}">✖</button>`,
            );
          }
          manage = bits.join('');
        }
        // Карточка, а не строка таблицы: на телефоне имя, роль и управление в один ряд
        // не помещаются — кнопки уезжали за край и до них было не дотянуться.
        return (
          `<div class="cmemb${isMe ? ' me' : ''}">` +
          `<div class="cm-top"><span class="cdot" style="color:${CORP_ROLE_DOT[m.role]}"></span>` +
          `<span class="cnm">${esc(m.login)}${isMe ? ` <i>(${t('corp.you')})</i>` : ''}</span>` +
          `<span class="cm-role">${corpRoleLabel(m.role)}</span></div>` +
          (manage ? `<div class="cm-act">${manage}</div>` : '') +
          `</div>`
        );
      })
      .join('');
    return `<div class="ctable">${rows}</div>`;
  }

  function corpWarsHtml(): string {
    const myCorpId = corpMine.membership?.corpId;
    const iAmHead = corpMine.membership?.role === 'head';
    const iCanFlag = corpMine.membership && corpMine.membership.role !== 'recruit';
    const corpReady = corpReadyOptimistic ?? avaPool.some((p) => p.corpId === myCorpId);
    const flags =
      `<div class="cbig">` +
      `<div><span>${t('corp.ready.corp')}</span><b>${corpReady ? t('corp.ready.yes') : t('corp.ready.no')}</b>` +
      (iAmHead
        ? `<button class="cbtn2" data-corpact="${corpReady ? 'ready-corp-clear' : 'ready-corp'}">${corpReady ? t('corp.ready.clear') : t('corp.ready.to-pool')}</button>`
        : `<span class="chint">${t('corp.ready.lead-only')}</span>`) +
      `</div>` +
      `<div><span>${t('corp.ready.mine')}</span><b>${playerReadyOptimistic ? t('corp.ready.yes') : t('—')}</b>` +
      (iCanFlag
        ? `<button class="cbtn2" data-corpact="${playerReadyOptimistic ? 'ready-player-clear' : 'ready-player'}">${playerReadyOptimistic ? t('corp.ready.clear') : t('corp.ready.set')}</button>`
        : '') +
      `</div></div>`;

    const wars = avaChallenges
      .map((w) => {
        const iAmChallenger = w.challengerCorp === myCorpId;
        const foe = corpNameOf(iAmChallenger ? w.targetCorp : w.challengerCorp);
        const st: Record<AvaChallengeStatus, string> = {
          pending: iAmChallenger ? t('corp.war.pending') : t('corp.war.incoming'),
          accepted: t('corp.war.roster'),
          declined: t('corp.war.declined'),
          expired: t('corp.war.expired'),
          locked: t('corp.war.locked'),
          cancelled: t('corp.war.cancelled'),
          ended: t('corp.war.finished'),
        };
        const canRespond = w.status === 'pending' && !iAmChallenger && iAmHead;
        const act = canRespond
          ? `<button class="cbtn2" data-corpact="ava-accept" data-corparg="${esc(w.id)}">${t('corp.war.accept')}</button>` +
            `<button class="cbtn2 danger" data-corpact="ava-decline" data-corparg="${esc(w.id)}">${t('corp.war.decline')}</button>`
          : w.status === 'accepted' &&
              corpMine.membership &&
              corpMine.membership.role !== 'recruit' &&
              !avaRoster?.mine.some((r) => r.accountId === corpMine.membership!.accountId)
            ? `<button class="cbtn2" data-corpact="ava-join" data-corparg="${esc(w.id)}">${t('corp.war.join-roster')}</button>`
            : '';
        const rosterOpen = w.status === 'accepted' && avaRoster && avaRoster.matchupId === w.id;
        const rosterLine = rosterOpen
          ? `<div class="cwmid">${t('corp.war.roster-label')}: ${avaRoster!.counts.challenger}/${avaRoster!.counts.target}</div>`
          : '';
        // AVA-6 setRoster — head/officer curates from the flagged pool wholesale;
        // everyone else still only has self-enroll `join` (rendered in `act` above).
        const curate =
          rosterOpen &&
          canManage(corpMine.membership?.role ?? 'recruit') &&
          avaReadyPlayers.length > 0
            ? `<div class="cwroster">${avaReadyPlayers
                .map((accountId) => {
                  const login =
                    corpDetail?.members.find((m) => m.accountId === accountId)?.login ?? accountId;
                  const on = avaRoster!.mine.some((r) => r.accountId === accountId);
                  return (
                    `<button class="cbtn2 ctoggle${on ? ' on' : ''}" data-corpact="ava-roster-toggle" ` +
                    `data-corparg="${esc(w.id)}" data-corpaccount="${esc(accountId)}">${on ? '✓' : '·'} ${esc(login)}</button>`
                  );
                })
                .join('')}</div>`
            : '';
        return (
          `<div class="cwar"><div class="cwtop"><b>⚔ ${esc(foe)}</b><span class="cst st-${w.status}">${st[w.status]}</span></div>` +
          `<div class="cwmid">${iAmChallenger ? t('corp.war.by-us') : t('corp.war.to-us')} · ${nfmt(w.cost)} ⟡</div>${rosterLine}${curate}` +
          (act ? `<div class="cwact">${act}</div>` : '') +
          `</div>`
        );
      })
      .join('');

    const pool = avaPool
      .filter((p) => p.corpId !== myCorpId)
      .map(
        (p) =>
          `<div class="crow2"><span class="cnm">${esc(p.name)}</span><span class="cinf">${nfmt(p.influence)} ⟡</span>` +
          (iAmHead
            ? `<span class="cman"><button class="cbtn2" data-corpact="ava-challenge" data-corparg="${esc(p.corpId)}">⚔ ${t('corp.war.challenge')}</button></span>`
            : '') +
          `</div>`,
      )
      .join('');

    const feed = avaFeed
      .slice(0, 5)
      .map(
        (f) =>
          `<div class="cline"><span>${esc(f.challengerName)} vs ${esc(f.targetName)}</span>` +
          `<em class="cwhen">${f.kind === 'result' ? (f.winnerCorp ? t('corp.war.win') : t('corp.war.draw')) : t('corp.war.scheduled')}</em></div>`,
      )
      .join('');

    return (
      flags +
      `<h4>${t('corp.war.mine')}</h4><div class="cwars">${wars || `<p class="chint">${t('corp.war.none')}</p>`}</div>` +
      `<h4>${t('corp.war.pool')}</h4><div class="ctable">${pool || `<p class="chint">${t('corp.war.pool-empty')}</p>`}</div>` +
      `<h4>${t('corp.war.feed')}</h4><div class="cledger">${feed || `<p class="chint">${t('corp.empty')}</p>`}</div>`
    );
  }

  function corpTreasuryHtml(): string {
    if (!corpMine.corp || !corpMine.membership) return corpNoneHtml();
    const rows = corpAudit
      .filter((a) => a.action === 'influence' || a.action === 'rent' || a.action === 'rent_return')
      .map(
        (a) =>
          `<div class="cline"><span>${esc(a.detail ?? t(CORP_AUDIT_RU[a.action] ?? a.action))} <b class="cwhen">· ${new Date(a.at).toLocaleString('ru-RU')}</b></span></div>`,
      )
      .join('');
    const ledgerHtml = canManage(corpMine.membership.role)
      ? rows || `<p class="chint">${t('corp.empty')}</p>`
      : `<p class="chint">${t('corp.history.private')}</p>`;
    return (
      `<div class="cbig"><div><span>${t('corp.influence')}</span><b>${nfmt(corpMine.corp.influence)} ⟡</b></div></div>` +
      `<h4>${t('corp.history')}</h4><div class="cledger">${ledgerHtml}</div>` +
      `<p class="chint">${t('corp.influence.hint')}</p>`
    );
  }

  function renderCorp(): void {
    const c = corpMine.corp;
    const members = corpDetail?.members.filter((m) => m.role !== 'recruit').length ?? null;
    // Шапка: кто мы, сколько нас и какое место — и отдельной плашкой то самое число,
    // ради которого корпорацию и качают.
    host.head().innerHTML = c
      ? `<div class="chrow"><span class="cemblem">⬢</span>` +
        `<div class="cident"><b>${esc(c.name)}</b><span class="csub">` +
        `${members === null ? '' : t('corp.members.count', { n: String(members) })}` +
        `${members === null ? '' : ' · '}` +
        `${corpRank === null ? t('corp.head.rank.none') : t('corp.head.rank', { n: String(corpRank) })}` +
        `</span></div>` +
        `<div class="cpoints"><b>${nfmt(c.influence)}</b><span>${t('corp.card.influence')}</span></div>` +
        `<button id="corpclose" class="cx" title="${t('corp.close')}">✕</button></div>`
      : `<div class="chrow"><span class="cemblem">⬢</span>` +
        `<div class="cident"><b>${t('corp.card.none')}</b></div>` +
        `<button id="corpclose" class="cx" title="${t('corp.close')}">✕</button></div>`;
    host.tabs().innerHTML = CORP_TABS.map(
      (ct) =>
        `<button class="ctab${ct.id === corpTab ? ' on' : ''}" data-corptab="${ct.id}">` +
        `<i>${ct.icon}</i>${t(ct.label)}</button>`,
    ).join('');
    let body = '';
    if (corpTab === 'hq') body = corpHqHtml();
    else if (corpTab === 'members') body = corpMembersHtml();
    else if (corpTab === 'wars') body = corpWarsHtml();
    else if (corpTab === 'battles') body = corpBattlesHtml();
    else if (corpTab === 'treasury') body = corpTreasuryHtml();
    else if (corpTab === 'settings') body = corpSettingsHtml();
    host.body().innerHTML = body;
  }

  function openCorp(): void {
    renderCorp(); // paint instantly from whatever's cached in memory…
    host.root().style.display = 'flex';
    void refreshCorp(); // …then refresh from the server
    host.onIntro('corp');
  }
  /** Ступень Back: сначала закрывается ВИТРИНА, и только потом сам кабинет — иначе
   *  аппаратная кнопка выбрасывала бы игрока из корпорации целиком с полпути выбора. */
  function closeCorp(): void {
    if (cupSlot !== null) {
      cupSlot = null;
      renderCorp();
      return;
    }
    hideCorp();
  }
  function hideCorp(): void {
    cupSlot = null;
    host.root().style.display = 'none';
  }

  host.tabs().addEventListener('click', (e) => {
    const b = (e.target as HTMLElement | null)?.closest('[data-corptab]') as HTMLElement | null;
    if (!b) return;
    corpTab = b.dataset.corptab ?? 'hq';
    cupSlot = null; // витрина живёт только на «Штабе»
    renderCorp();
    if (corpTab === 'wars') host.onIntro('ava');
  });
  host.root().addEventListener('click', (e) => {
    const tg = e.target as HTMLElement | null;
    if (!tg) return;
    if (tg.id === 'corpclose' || tg.id === 'corp') {
      hideCorp();
      return;
    }
    // Витрина наград: тап по кубку открывает общий список, тап по награде — ставит её
    // в ЭТОТ слот. Выбор локальный (у сервера поля витрины нет), поэтому и живёт в prefs.
    const cup = tg.closest('[data-corpcup]') as HTMLElement | null;
    if (cup) {
      cupSlot = Number(cup.dataset.corpcup);
      renderCorp();
      return;
    }
    const pick = tg.closest('[data-corppick]') as HTMLElement | null;
    if (pick) {
      if (cupSlot !== null) {
        showcase = showcase.map((id, i) => (i === cupSlot ? (pick.dataset.corppick ?? '') : id));
        writeRaw(SHOWCASE_KEY, writeShowcase(showcase));
      }
      cupSlot = null;
      renderCorp();
      return;
    }
    if (tg.closest('[data-corpback]')) {
      cupSlot = null;
      renderCorp();
      return;
    }
    const btn = tg.closest('[data-corpact]') as HTMLElement | null;
    const act = btn?.dataset.corpact;
    if (!act) return;
    const arg = btn?.dataset.corparg ?? '';
    const corpId = corpMine.membership?.corpId ?? '';
    const account = btn?.dataset.corpaccount ?? '';
    switch (act) {
      case 'create': {
        const input = document.getElementById('corpnewname') as HTMLInputElement | null;
        const name = input?.value.trim() ?? '';
        if (name) void corpIntent('/corps', { name });
        break;
      }
      case 'apply':
        void corpIntent(`/corps/${encodeURIComponent(arg)}/apply`);
        break;
      case 'accept':
        void corpIntent(`/corps/${encodeURIComponent(corpId)}/accept`, { target: arg });
        break;
      case 'decline':
        void corpIntent(`/corps/${encodeURIComponent(corpId)}/decline`, { target: arg });
        break;
      case 'kick':
        void corpIntent(`/corps/${encodeURIComponent(corpId)}/kick`, { target: arg });
        break;
      case 'role':
        void corpIntent(`/corps/${encodeURIComponent(corpId)}/role`, {
          target: arg,
          role: btn?.dataset.corprole,
        });
        break;
      case 'transfer':
        void corpIntent(`/corps/${encodeURIComponent(corpId)}/transfer`, { target: arg });
        break;
      case 'leave':
        void corpIntent(`/corps/${encodeURIComponent(corpId)}/leave`);
        break;
      case 'disband':
        void corpIntent(`/corps/${encodeURIComponent(corpId)}/disband`);
        break;
      case 'ready-corp':
        void corpFetch('/ava/ready/corp', { method: 'POST' }).then((r) => {
          if (r) {
            corpReadyOptimistic = true;
            void refreshCorp();
          }
        });
        break;
      case 'ready-corp-clear':
        void corpFetch('/ava/ready/corp/clear', { method: 'POST' }).then((r) => {
          if (r) {
            corpReadyOptimistic = false;
            void refreshCorp();
          }
        });
        break;
      case 'ready-player':
        void corpFetch('/ava/ready/player', { method: 'POST' }).then((r) => {
          if (r) {
            playerReadyOptimistic = true;
            renderCorp();
          }
        });
        break;
      case 'ready-player-clear':
        void corpFetch('/ava/ready/player/clear', { method: 'POST' }).then((r) => {
          if (r) {
            playerReadyOptimistic = false;
            renderCorp();
          }
        });
        break;
      case 'ava-challenge':
        void corpIntent('/ava/challenge', { target: arg });
        break;
      case 'ava-accept':
        void corpIntent(`/ava/challenge/${encodeURIComponent(arg)}/accept`);
        break;
      case 'ava-decline':
        void corpIntent(`/ava/challenge/${encodeURIComponent(arg)}/decline`);
        break;
      case 'ava-join':
        void corpIntent(`/ava/matchup/${encodeURIComponent(arg)}/join`);
        break;
      case 'ava-roster-toggle': {
        // arg = matchupId, account = the toggled accountId. Server is wholesale
        // (setRoster REPLACES the side), so send the full desired set every time.
        if (!avaRoster || avaRoster.matchupId !== arg) break;
        const current = avaRoster.mine.map((r) => r.accountId);
        const next = current.includes(account)
          ? current.filter((id) => id !== account)
          : [...current, account];
        void corpIntent(`/ava/matchup/${encodeURIComponent(arg)}/roster`, { players: next });
        break;
      }
    }
  });
  return {
    open: openCorp,
    close: closeCorp,
    mine: () => corpMine,
  };
}
