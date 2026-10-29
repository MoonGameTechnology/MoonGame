import {
  BATTLE_FORMATS,
  CORP_BATTLE_TABS,
  battlePhase,
  battleStats,
  challengeGroups,
  opponentOffer,
  topCorpFighters,
  type CorpBattleTab,
} from '../../decisions/corpBattles';
import type {
  CorpBattleChallenge,
  CorpBattleResult,
  CorpBattlesView,
  CorpWarView,
} from '../../packages/protocol/src/corpBattles';
import type { AvaRosterView, CorpMembership, CorpRecord, CorpSummary } from './corp';
import { corpEmblem } from './corpEmblems';
import { LOCALE, t } from '../../localization/runtime';
import { esc, nfmt } from './format';

export interface CorpBattlesPaint {
  view: CorpBattlesView | null;
  available: boolean;
  corp: CorpRecord;
  me: CorpMembership;
  members: readonly CorpMembership[];
  pool: ReadonlyArray<CorpSummary & { formats: number[] }> | null;
  rosters: Readonly<Record<string, AvaRosterView | null>>;
  wars: Readonly<Record<string, CorpWarView | null>>;
  tab: CorpBattleTab;
  format: number;
  maxFormat: number;
  draftFormats: readonly number[];
  busy: boolean;
  now: number;
  canPlay: boolean;
}
const TABS: Record<CorpBattleTab, string> = {
  now: 'corp.combat.tab.now',
  challenges: 'corp.combat.tab.challenges',
  opponents: 'corp.combat.tab.opponents',
  history: 'corp.combat.tab.history',
  ready: 'corp.combat.tab.ready',
};
const PHASES = {
  roster: 'corp.combat.phase.roster',
  preparing: 'corp.combat.phase.preparing',
  peace: 'corp.combat.phase.peace',
  war: 'corp.combat.phase.war',
  settling: 'corp.combat.phase.settling',
};
const CLOSED = {
  declined: 'corp.combat.declined',
  expired: 'corp.combat.expired',
  cancelled: 'corp.combat.cancelled',
};
const OUTCOMES = { win: 'corp.battle.win', loss: 'corp.battle.loss', draw: 'corp.battle.draw' };
const REASONS = {
  domination: 'corp.combat.reason.domination',
  elimination: 'corp.combat.reason.elimination',
  score: 'corp.combat.reason.score',
  timeout: 'corp.combat.reason.timeout',
};
const OFFER = {
  head: 'corp.combat.head-only',
  ready: 'corp.combat.ready-first',
  format: 'corp.combat.no-common',
  influence: 'corp.combat.no-influence',
  sent: 'corp.combat.sent',
};
const hint = (key: string): string => `<p class="cb-battle-hint">${esc(t(key))}</p>`;
const fmt = (n: number): string => `${n}×${n}`;
const date = (at: number): string =>
  new Date(at).toLocaleString(LOCALE, {
    day: 'numeric',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  });
const stat = (label: string, value: string): string =>
  `<div class="cb-battle-stat"><b>${esc(value)}</b><span>${esc(t(label))}</span></div>`;
const opponent = (
  p: CorpBattlesPaint,
  row: { challengerCorp: string; targetCorp: string },
): string => (row.challengerCorp === p.corp.corpId ? row.targetCorp : row.challengerCorp);
const name = (p: CorpBattlesPaint, id: string): string =>
  p.view?.names[id] ?? p.pool?.find((c) => c.corpId === id)?.name ?? t('corp.combat.unknown-corp');
const login = (p: CorpBattlesPaint, id: string): string =>
  p.members.find((m) => m.accountId === id)?.login ?? t('corp.combat.unknown-player');
function button(action: string, arg: string, label: string, disabled = false, extra = ''): string {
  return `<button type="button" class="btn-second" data-corpact="${action}" data-corparg="${esc(arg)}"${disabled ? ' disabled' : ''}${extra}>${esc(label)}</button>`;
}
function formats(p: CorpBattlesPaint): string {
  return (
    `<div class="cb-battle-filter" role="group" aria-label="${esc(t('corp.combat.format-filter'))}">` +
    [0, ...BATTLE_FORMATS.map((f) => f.format)]
      .map(
        (f) =>
          `<button type="button" data-battle-format="${f}" aria-pressed="${p.format === f}" class="${p.format === f ? 'on' : ''}">${f ? fmt(f) : esc(t('corp.combat.all'))}</button>`,
      )
      .join('') +
    `</div>`
  );
}
function roster(p: CorpBattlesPaint, c: CorpBattleChallenge): string {
  const r = p.rosters[c.id];
  if (!r) return hint('corp.combat.roster-unavailable');
  const open = c.status === 'accepted' && (c.pauseEndsAt ?? 0) > p.now;
  const signed = r.mine.some((s) => s.accountId === p.me.accountId);
  const canManage = p.me.role === 'head' || p.me.role === 'officer';
  const candidates = [
    ...new Set([
      ...r.mine.map((s) => s.accountId),
      ...(open && canManage ? (p.view?.ready.players ?? []) : []),
    ]),
  ];
  return (
    `<div class="cb-battle-roster"><h4>${esc(t('corp.combat.roster'))} <span>${r.mine.length}/${c.format}</span></h4>` +
    (candidates.length
      ? `<ul>${candidates
          .map((id) => {
            const on = r.mine.some((s) => s.accountId === id);
            return (
              `<li><span>${esc(login(p, id))}</span>` +
              (open && canManage
                ? button(
                    'ava-roster-toggle',
                    c.id,
                    t(on ? 'corp.combat.roster-remove' : 'corp.combat.roster-add'),
                    p.busy || (!on && r.mine.length >= c.format),
                    ` data-corpaccount="${esc(id)}" aria-pressed="${on}"`,
                  )
                : `<span class="cb-battle-tag">${esc(t('corp.combat.rostered'))}</span>`) +
              `</li>`
            );
          })
          .join('')}</ul>`
      : hint('corp.combat.roster-empty')) +
    (open && !signed
      ? button('ava-join', c.id, t('corp.war.join-roster'), p.busy || r.mine.length >= c.format)
      : '') +
    `<p class="cb-battle-hint">${esc(t('corp.combat.rival-count', { n: r.counts[r.side === 'challenger' ? 'target' : 'challenger'] }))}</p></div>`
  );
}
function nowView(p: CorpBattlesPaint): string {
  const rows = p.view!.challenges.filter((c) => c.status === 'accepted' || c.status === 'locked');
  if (!rows.length)
    return `<section class="cb-card">${hint('corp.combat.no-active')}<button type="button" class="btn-second" data-battletab="opponents">${esc(t('corp.combat.find-opponent'))}</button></section>`;
  return rows
    .map((c) => {
      const war = p.wars[c.id] ?? null;
      const phase = battlePhase(c, war);
      const min = BATTLE_FORMATS.find((f) => f.format === c.format)?.minPlayers ?? c.format;
      const inRoster = p.rosters[c.id]?.mine.some((s) => s.accountId === p.me.accountId) ?? false;
      return (
        `<article class="cb-card cb-battle-card"><header><h3>${esc(name(p, opponent(p, c)))}</h3><span class="cb-battle-tag ${phase}">${esc(t(PHASES[phase]))}</span></header>` +
        `<p class="cb-battle-hint">${fmt(c.format)} · ${esc(t('corp.combat.minimum', { n: min }))}</p>` +
        (c.status === 'accepted' && c.pauseEndsAt !== undefined
          ? `<p class="cb-battle-hint">${esc(t('corp.combat.roster-until', { date: date(c.pauseEndsAt) }))}</p>`
          : '') +
        (war?.warAt !== undefined
          ? `<p class="cb-battle-hint">${esc(t(war.phase === 'peace' ? 'corp.combat.war-at' : 'corp.combat.war-since', { date: date(war.warAt) }))}</p>`
          : '') +
        (war
          ? `<div class="cb-battle-stats">${stat('corp.combat.score', `${nfmt(war.score)} / ${nfmt(war.scoreGoal)}`)}${stat('corp.combat.land', `${war.provinces} / ${war.capturable}`)}</div>` +
            `<p class="cb-battle-hint">${esc(t('corp.combat.domination-goal', { n: Math.ceil(war.dominationPercent * 100) }))}</p>`
          : '') +
        roster(p, c) +
        (war?.phase === 'war' && war.rivals.seats
          ? `<section class="cb-battle-roster"><h4>${esc(t('corp.combat.their-side'))}</h4><ul>${war.rivals.seats.map((s) => `<li><span>${esc(s.bot ? t('corp.combat.bot') : (s.login ?? t('corp.combat.unknown-player')))}</span><span>${esc(t(s.out ? 'corp.combat.eliminated' : 'corp.combat.survived'))}</span></li>`).join('')}</ul></section>`
          : '') +
        (war && p.canPlay && inRoster && war.phase !== 'ended'
          ? button('ava-play', c.id, t('corp.combat.enter'), p.busy)
          : '') +
        (war && !inRoster ? hint('corp.combat.not-rostered') : '') +
        `</article>`
      );
    })
    .join('');
}
function challengesView(p: CorpBattlesPaint): string {
  const groups = challengeGroups(p.view!.challenges, p.corp.corpId);
  const groupLabels = {
    incoming: 'corp.combat.incoming',
    outgoing: 'corp.combat.outgoing',
    closed: 'corp.combat.closed',
  };
  return (Object.keys(groups) as Array<keyof typeof groups>)
    .map(
      (group) =>
        `<section class="cb-battle-group"><h3>${esc(t(groupLabels[group]))} <span>${groups[group].length}</span></h3>` +
        (groups[group].length
          ? groups[group]
              .map((c) => {
                const expired = c.expiresAt <= p.now;
                const status = c.status as keyof typeof CLOSED;
                return (
                  `<article class="cb-card cb-battle-card"><header><h4>${esc(name(p, opponent(p, c)))}</h4><b>${fmt(c.format)}</b></header>` +
                  `<p class="cb-battle-hint">${esc(t('corp.combat.price', { n: c.cost }))}</p>` +
                  (group === 'closed'
                    ? `<span class="cb-battle-tag">${esc(t(CLOSED[status]))}</span>`
                    : `<p class="cb-battle-hint">${esc(t('corp.combat.expires', { date: date(c.expiresAt) }))}</p>`) +
                  (group === 'incoming' && p.me.role === 'head'
                    ? `<div class="cb-battle-actions">${button('ava-accept', c.id, t('corp.combat.accept'), p.busy || expired)}${button('ava-decline', c.id, t('corp.combat.decline'), p.busy || expired)}</div>`
                    : '') +
                  (group === 'incoming' && p.me.role !== 'head'
                    ? hint('corp.combat.head-only')
                    : '') +
                  `</article>`
                );
              })
              .join('')
          : hint('corp.combat.no-calls')) +
        `</section>`,
    )
    .join('');
}
function opponentsView(p: CorpBattlesPaint): string {
  if (p.pool === null)
    return `<section class="cb-card">${hint('corp.combat.unavailable')}${button('refresh', '', t('corp.combat.refresh'), p.busy)}</section>`;
  const rows = p.pool.filter(
    (r) => r.corpId !== p.corp.corpId && (!p.format || r.formats.includes(p.format)),
  );
  return (
    formats(p) +
    (rows.length
      ? rows
          .map((r) => {
            const offer = opponentOffer({
              corpId: p.corp.corpId,
              opponent: r.corpId,
              head: p.me.role === 'head',
              ready: p.view!.ready.corp,
              mine: p.view!.ready.formats,
              theirs: r.formats,
              format: p.format,
              maxFormat: p.maxFormat,
              influence: p.corp.influence,
              challenges: p.view!.challenges,
              now: p.now,
            });
            const record = battleStats(
              p.view!.tally.filter((x) => x.opponent === r.corpId),
              p.format,
            );
            const rematch = record.played > 0;
            let action: string;
            if (offer.kind === 'challenge')
              action =
                button(
                  'ava-challenge',
                  r.corpId,
                  t(rematch ? 'corp.combat.rematch' : 'corp.combat.challenge'),
                  p.busy,
                  ` data-corpformat="${offer.format}"`,
                ) +
                `<small>${fmt(offer.format)} · ${esc(t('corp.combat.price', { n: offer.cost }))}</small>`;
            else if (offer.kind === 'answer' || offer.kind === 'active')
              action = `<button type="button" class="btn-second" data-battletab="${offer.kind === 'answer' ? 'challenges' : 'now'}">${esc(t(offer.kind === 'answer' ? 'corp.combat.answer' : 'corp.combat.to-current'))}</button>`;
            else action = hint(OFFER[offer.kind]);
            return (
              `<article class="cb-card cb-battle-card"><header><div class="cb-battle-identity">${corpEmblem(r.corpId, r.emblemId, 40)}<h3>${esc(r.name)}</h3></div><b>${nfmt(r.influence)} ⟡</b></header>` +
              `<p class="cb-battle-hint">${esc(t('corp.members.count', { n: r.members }))} · ${r.formats.map(fmt).join(' · ')}</p>` +
              (rematch
                ? `<p class="cb-battle-hint">${esc(t('corp.combat.encounters', { wins: record.wins, losses: record.losses, draws: record.draws }))}</p>`
                : '') +
              `<div class="cb-battle-actions">${action}</div></article>`
            );
          })
          .join('')
      : hint('corp.combat.no-opponents'))
  );
}
function historyView(p: CorpBattlesPaint): string {
  const stats = battleStats(p.view!.tally, p.format);
  const results = p.view!.results.filter((r) => !p.format || r.format === p.format);
  const best = topCorpFighters(results, p.format);
  return (
    formats(p) +
    `<div class="cb-battle-stats four">${stat('corp.combat.played', nfmt(stats.played))}${stat('corp.combat.wins', nfmt(stats.wins))}${stat('corp.combat.losses', nfmt(stats.losses))}${stat('corp.combat.draws', nfmt(stats.draws))}</div>` +
    (best.length
      ? `<section class="cb-card"><h3>${esc(t('corp.combat.best'))}</h3>${hint('corp.combat.best-note')}<ol class="cb-battle-best">${best.map((s) => `<li><b>${esc(s.login ?? t('corp.combat.unknown-player'))}</b><span>${esc(t('corp.combat.fighter-score', { n: s.score, battles: s.battles }))}</span></li>`).join('')}</ol></section>`
      : '') +
    (results.length
      ? results
          .map((r) => {
            const outcome =
              r.winnerCorp === null ? 'draw' : r.winnerCorp === p.corp.corpId ? 'win' : 'loss';
            return (
              `<article class="cb-card cb-battle-card"><header><h3>${esc(name(p, opponent(p, r)))}</h3><span class="cb-battle-tag ${outcome}">${esc(t(OUTCOMES[outcome]))}</span></header>` +
              `<p class="cb-battle-hint">${fmt(r.format)} · ${esc(date(r.at))}</p>` +
              (r.report
                ? `<button type="button" class="btn-second" data-battle-report="${esc(r.matchupId)}">${esc(t('corp.combat.report'))}</button>`
                : hint('corp.combat.no-report')) +
              `</article>`
            );
          })
          .join('')
      : hint('corp.combat.no-history'))
  );
}
function readyView(p: CorpBattlesPaint): string {
  const ready = p.view!.ready;
  const head = p.me.role === 'head';
  return (
    `<section class="cb-card"><header class="cb-card-h"><h3>${esc(t('corp.combat.corp-ready'))}</h3><span class="cb-battle-tag">${esc(t(ready.corp ? 'corp.combat.ready-on' : 'corp.combat.ready-off'))}</span></header>` +
    hint('corp.combat.format-help') +
    `<div class="cb-battle-formats">` +
    BATTLE_FORMATS.map((f) => {
      const locked = f.format > p.maxFormat;
      return (
        `<button type="button" data-battle-ready-format="${f.format}" aria-pressed="${p.draftFormats.includes(f.format)}"${!head || p.busy || locked ? ' disabled' : ''}>` +
        `<b>${fmt(f.format)}</b><span>${esc(t('corp.combat.price', { n: f.cost }))}</span><span>${esc(t('corp.combat.reward', { n: f.reward }))}</span><small>${esc(t(locked ? 'corp.combat.format-locked' : 'corp.combat.minimum', { n: f.minPlayers }))}</small></button>`
      );
    }).join('') +
    `</div>` +
    (head
      ? `<div class="cb-battle-actions">${button('ava-ready-save', '', t('corp.combat.save-ready'), p.busy || !p.draftFormats.length)}${ready.corp ? button('ready-corp-clear', '', t('corp.combat.clear-ready'), p.busy) : ''}</div>`
      : hint('corp.combat.head-only')) +
    `</section>` +
    `<section class="cb-card"><h3>${esc(t('corp.combat.my-ready'))}</h3>${hint('corp.combat.my-ready-help')}` +
    button(
      ready.player ? 'ready-player-clear' : 'ready-player',
      '',
      t(ready.player ? 'corp.combat.my-ready-off' : 'corp.combat.my-ready-on'),
      p.busy,
    ) +
    `</section>` +
    `<section class="cb-card cb-battle-roster"><h3>${esc(t('corp.combat.ready-players', { n: ready.players.length }))}</h3>` +
    (ready.players.length
      ? `<ul>${ready.players.map((id) => `<li><span>${esc(login(p, id))}</span><span class="cb-battle-tag">${esc(t('corp.combat.ready-on'))}</span></li>`).join('')}</ul>`
      : hint('corp.combat.none-ready')) +
    `</section>`
  );
}

export function corpBattlesViewHtml(p: CorpBattlesPaint): string {
  const v = p.view;
  const counts: Record<CorpBattleTab, number> = {
    now: v?.challenges.filter((c) => c.status === 'accepted' || c.status === 'locked').length ?? 0,
    challenges:
      v?.challenges.filter((c) => c.status === 'pending' && c.targetCorp === p.corp.corpId)
        .length ?? 0,
    opponents: p.pool?.filter((c) => c.corpId !== p.corp.corpId).length ?? 0,
    history: v?.results.length ?? 0,
    ready: v?.ready.players.length ?? 0,
  };
  const tabs =
    `<div class="cb-battle-tabs" role="tablist" aria-label="${esc(t('corp.combat.tabs'))}">` +
    CORP_BATTLE_TABS.map(
      (tab) =>
        `<button type="button" role="tab" id="cb-battle-tab-${tab}" aria-controls="cb-battle-panel" tabindex="${tab === p.tab ? 0 : -1}" data-battletab="${tab}" aria-selected="${tab === p.tab}" class="${tab === p.tab ? 'on' : ''}">${esc(t(TABS[tab]))}${counts[tab] ? `<small>${counts[tab]}</small>` : ''}</button>`,
    ).join('') +
    `</div>`;
  const views: Record<CorpBattleTab, (p: CorpBattlesPaint) => string> = {
    now: nowView,
    challenges: challengesView,
    opponents: opponentsView,
    history: historyView,
    ready: readyView,
  };
  const body = !p.available
    ? hint('corp.combat.disabled')
    : v
      ? views[p.tab](p)
      : `<section class="cb-card">${hint('corp.combat.unavailable')}${button('refresh', '', t('corp.combat.refresh'), p.busy)}</section>`;
  return `<div class="cb-battles">${tabs}<div class="cb-battle-body" id="cb-battle-panel" role="tabpanel" aria-labelledby="cb-battle-tab-${p.tab}">${body}</div></div>`;
}

export function corpBattleReportHtml(r: CorpBattleResult, rivalName: string): string {
  const report = r.report;
  if (!report) return '';
  const mine = report.sides[r.side];
  const theirs = report.sides[r.side === 'challenger' ? 'target' : 'challenger'];
  return (
    `<h3 id="cb-sheet-title">${esc(t('corp.combat.report'))}</h3><p class="cb-battle-hint">${esc(rivalName)} · ${fmt(r.format)} · ${esc(date(r.at))}</p>` +
    (report.reason ? hint(REASONS[report.reason]) : '') +
    `<div class="cb-battle-stats">${stat('corp.combat.our-score', nfmt(mine.score))}${stat('corp.combat.their-score', nfmt(theirs.score))}${stat('corp.combat.our-land', nfmt(mine.provinces))}${stat('corp.combat.their-land', nfmt(theirs.provinces))}</div>` +
    (['challenger', 'target'] as const)
      .map(
        (side) =>
          `<section class="cb-battle-roster"><h4>${esc(t(side === r.side ? 'corp.combat.our-side' : 'corp.combat.their-side'))}</h4><ul>` +
          report.seats
            .filter((s) => s.side === side)
            .map(
              (s) =>
                `<li><div><b>${esc(s.bot ? t('corp.combat.bot') : (s.login ?? t('corp.combat.unknown-player')))}</b><small>${esc(t(s.out ? 'corp.combat.eliminated' : 'corp.combat.survived'))}</small></div><span>${esc(t('corp.combat.seat-score', { score: s.score, land: s.provinces }))}</span></li>`,
            )
            .join('') +
          `</ul></section>`,
      )
      .join('')
  );
}
