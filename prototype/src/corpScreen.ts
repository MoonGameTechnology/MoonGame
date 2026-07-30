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
 * REFM shape: the label tables are pure exports; everything stateful lives inside
 * `initCorp(host)`, which takes its four DOM slots and four host services explicitly.
 */
import { t } from '../../localization/runtime';
import { esc, nfmt } from './format';
import {
  canManage,
  parseAccountIds,
  parseAudit,
  parseChallenges,
  parseCorpRecord,
  parseCorpSummaries,
  parseFeed,
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
} from './corp';

// The cross-session alliance ("corporation") management screen designed in
// docs/corporation-ui.md — the REAL screen now, over the live CORP-0/AVA-2..9/
// MED-1 HTTP API (packages/server/src/corpApi.ts/avaApi.ts/medalApi.ts). Scope
// follows the doc's own §7 degradation order: Обзор/Участники/Войны/Казна are
// real; Владения (sector ownership) and Чат (persistent corp chat) have no
// server counterpart at all (no meta-layer Контур 2 yet) and stay honest "скоро"
// stubs rather than simulated data.
export const CORP_TABS: { id: string; label: string }[] = [
  { id: 'overview', label: 'corp.tab.overview' },
  { id: 'members', label: 'corp.tab.members' },
  { id: 'wars', label: 'corp.tab.wars' },
  { id: 'treasury', label: 'corp.tab.treasury' },
  { id: 'holdings', label: 'corp.tab.holdings' },
  { id: 'comms', label: 'corp.tab.comms' },
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
  let corpTab = 'overview'; // открытая вкладка кабинета

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

      const challengesRaw = (await corpFetch('/ava/challenges')) as { challenges?: unknown } | null;
      avaChallenges = parseChallenges(challengesRaw?.challenges);
      const poolRaw = (await corpFetch('/ava/pool')) as { pool?: unknown } | null;
      avaPool = parseReadyPool(poolRaw?.pool);
      const feedRaw = (await corpFetch('/ava/feed?limit=8')) as { feed?: unknown } | null;
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

  function corpOverviewHtml(): string {
    if (!corpMine.corp || !corpMine.membership) return corpNoneHtml();
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
    return (
      `${nextWarHtml}` +
      `<div class="ccols">` +
      `<section class="ccard"><h4>${t('corp.overview.name')}</h4>` +
      `<div class="cline"><span>${t('corp.influence')}</span><em>${nfmt(c.influence)} ⟡</em></div>` +
      `<div class="cline"><span>${t('corp.my-role')}</span><em>${corpRoleLabel(corpMine.membership.role)}</em></div>` +
      `<p class="chint">${t('corp.holdings.note')}</p></section>` +
      `<section class="ccard"><h4>${t('corp.log')}</h4>${feedHtml}</section>` +
      `</div>`
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
        return (
          `<div class="crow2${isMe ? ' me' : ''}">` +
          `<span class="cdot" style="color:${CORP_ROLE_DOT[m.role]}"></span>` +
          `<span class="cnm">${esc(m.login)}${isMe ? ` <i>(${t('corp.you')})</i>` : ''}</span>` +
          `<span class="crole">${corpRoleLabel(m.role)}</span>` +
          `<span class="cman">${manage}</span>` +
          `</div>`
        );
      })
      .join('');
    const mine = corpMine.membership;
    const leave =
      mine.role === 'head'
        ? `<button class="cbtn2 danger wide" data-corpact="disband">${t('corp.disband')}</button>`
        : `<button class="cbtn2 wide" data-corpact="leave">${t('corp.leave')}</button>`;
    return `<div class="ctable">${rows}</div>${leave}`;
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

  function corpHoldingsHtml(): string {
    return `<div class="hub-empty"><span class="he-ic">▦</span>${t('corp.holdings.soon')}<br><span style="font-size:11px;color:var(--cyan-dim)">${t('corp.holdings.soon.hint')}</span></div>`;
  }

  function corpCommsHtml(): string {
    return `<div class="hub-empty"><span class="he-ic">▭</span>${t('corp.chat.soon')}<br><span style="font-size:11px;color:var(--cyan-dim)">${t('corp.chat.soon.hint')}</span></div>`;
  }

  function renderCorp(): void {
    const c = corpMine.corp;
    const mem = corpMine.membership;
    host.head().innerHTML = c
      ? `<div class="chrow"><span class="cemblem">⬢</span>` +
        `<div class="cident"><b>${esc(c.name)}</b></div>` +
        `<button id="corpclose" class="cx" title="${t('corp.close')}">✕</button></div>` +
        `<div class="cmetrics">` +
        `<span>${t('corp.card.influence')} <b>${nfmt(c.influence)} ⟡</b></span>` +
        `<span>${t('corp.card.members')} <b>${corpDetail?.members.filter((m) => m.role !== 'recruit').length ?? '—'}</b></span>` +
        `<span>${t('corp.card.role')} <b>${mem ? corpRoleLabel(mem.role) : '—'}</b></span>` +
        `</div>`
      : `<div class="chrow"><span class="cemblem">⬢</span>` +
        `<div class="cident"><b>${t('corp.card.none')}</b></div>` +
        `<button id="corpclose" class="cx" title="${t('corp.close')}">✕</button></div>`;
    host.tabs().innerHTML = CORP_TABS.map(
      (ct) =>
        `<button class="ctab${ct.id === corpTab ? ' on' : ''}" data-corptab="${ct.id}">${t(ct.label)}</button>`,
    ).join('');
    let body = '';
    if (corpTab === 'overview') body = corpOverviewHtml();
    else if (corpTab === 'members') body = corpMembersHtml();
    else if (corpTab === 'wars') body = corpWarsHtml();
    else if (corpTab === 'treasury') body = corpTreasuryHtml();
    else if (corpTab === 'holdings') body = corpHoldingsHtml();
    else if (corpTab === 'comms') body = corpCommsHtml();
    host.body().innerHTML = body;
  }

  function openCorp(): void {
    renderCorp(); // paint instantly from whatever's cached in memory…
    host.root().style.display = 'flex';
    void refreshCorp(); // …then refresh from the server
    host.onIntro('corp');
  }
  function closeCorp(): void {
    host.root().style.display = 'none';
  }

  host.tabs().addEventListener('click', (e) => {
    const b = (e.target as HTMLElement | null)?.closest('[data-corptab]') as HTMLElement | null;
    if (!b) return;
    corpTab = b.dataset.corptab ?? 'overview';
    renderCorp();
    if (corpTab === 'wars') host.onIntro('ava');
  });
  host.root().addEventListener('click', (e) => {
    const tg = e.target as HTMLElement | null;
    if (!tg) return;
    if (tg.id === 'corpclose' || tg.id === 'corp') {
      closeCorp();
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
