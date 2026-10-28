/**
 * Вкладка хаба «Корпорация» (CORP-3) — разметка по макету, одобренному владельцем
 * 2026-10-21: шапка корпорации, разделы «База», «Битвы», «Состав», «Казна» и шторка над
 * хабом (лист здания, уровни корпорации, участник). Что показать, решают
 * `decisions/corpHub.ts`, `corpBase.ts`, `corpTreasury.ts` и `corpMembers.ts`; данные,
 * запросы и нажатия держит `corpScreen.ts`. Здесь — только сборка разметки из картины.
 *
 * Кнопки несут те же `data-corpact`, что и окно корпорации в партии: приказ один, и
 * разбирает его один обработчик. Приказ, который не отменить (покинуть, расформировать,
 * исключить, передать главенство), просит второго нажатия: `data-corpconfirm` — ключ
 * кнопки, и взведённая кнопка вместо названия задаёт вопрос.
 *
 * Здания рисуются в стиле базы (CORP-14): его применяет глава в шторке «Стиль базы»
 * (`data-corpstyle`), а за некупленным ведёт в магазин (`data-corpshop`).
 */
import {
  CORP_HQ,
  corpBuildingStatus,
  corpLevel,
  corpLevelPlan,
  corpLevelTable,
  corpLotState,
  corpRequirements,
  type CorpCondition,
  type CorpLotState,
  type CorpOpening,
} from '../../decisions/corpBase';
import type { CorpHubState } from '../../decisions/corpHub';
import { corpConstructionProgress } from '../../decisions/corpInfrastructure';
import { corpMemberActions, type CorpMemberAction } from '../../decisions/corpMembers';
import { corpStyleCard, type CorpStyleCard } from '../../decisions/corpStyle';
import { corpIncomeParts, corpLedger, type CorpLedgerRow } from '../../decisions/corpTreasury';
import type {
  CorpBuildingLevel,
  CorpBuildingView,
  CorpInfrastructureView,
} from '../../packages/protocol/src/corpInfrastructure';
import { CORP_STYLE_STANDARD, type MetaCorpStyleView } from '../../packages/protocol/src/corpStyle';
import { t } from '../../localization/runtime';
import { corpEmblemId, type CorpEmblemId } from '../../packages/protocol/src/corpIdentity';
import { corpEmblem, corpEmblemPicker } from './corpEmblems';
import type { CorpAuditEntry, CorpMembership, CorpRecord, CorpRole, CorpSummary } from './corp';
import { CORP_STYLES, corpStyleName } from './corpArt';
import {
  CORP_DRAW_ORDER,
  CORP_LOTS,
  CORP_PANORAMA,
  corpPanoramaBg,
  corpSprite,
} from './corpSprites';
import { esc, nfmt } from './format';
import { newsCalendar, newsTimeText } from './newsScreen';

// --- таблицы ---------------------------------------------------------------------------

export type CorpHubSection = 'base' | 'battles' | 'members' | 'treasury';

export const CORP_HUB_SECTIONS: readonly CorpHubSection[] = ['base', 'battles', 'members', 'treasury'];

export const CORP_HUB_SECTION_LABEL: Readonly<Record<CorpHubSection, string>> = {
  base: 'corp.hub.tab.base',
  battles: 'corp.tab.battles',
  members: 'corp.hub.tab.members',
  treasury: 'corp.tab.treasury',
};

/** Что открыто в шторке над хабом. */
export type CorpHubSheet =
  | { kind: 'building'; id: string }
  | { kind: 'levels' }
  | { kind: 'member'; accountId: string }
  | { kind: 'emblem' }
  | { kind: 'style' };

const ROLE_LABEL: Readonly<Record<CorpRole, string>> = {
  head: 'corp.role.head',
  officer: 'corp.role.officer',
  member: 'corp.role.member',
  recruit: 'corp.role.recruit',
};

/** Таблица, а не сборка ключа: гейт локализации ищет ключ литералом. */
const LOT_KEY: Readonly<Record<CorpLotState, string>> = {
  built: 'corp.hub.key.built',
  build: 'corp.hub.key.build',
  open: 'corp.hub.key.open',
  locked: 'corp.hub.key.locked',
};

const MEMBER_ACTION: Readonly<Record<Exclude<CorpMemberAction, 'accept' | 'decline'>, string>> = {
  officer: 'corp.hub.member.officer',
  member: 'corp.hub.member.member',
  transfer: 'corp.hub.member.transfer',
  kick: 'corp.hub.member.kick',
};

/** Условие уровня (CORP-6): «есть из нужных» в листе и строке здания, «нужно» в таблице. */
const CONDITION_KEY: Readonly<Record<CorpCondition['kind'], { have: string; need: string }>> = {
  members: { have: 'corp.hub.req.members', need: 'corp.hub.levels.members' },
  battles: { have: 'corp.hub.req.battles', need: 'corp.hub.levels.battles' },
};
const conditionText = (c: Pick<CorpCondition, 'kind' | 'need' | 'have'>): string =>
  t(CONDITION_KEY[c.kind].have, { n: c.need, have: c.have });
const conditionHtml = (c: CorpCondition): string =>
  `<li class="${c.ok ? 'ok' : 'no'}">${esc(conditionText(c))}</li>`;

/** Карточка стиля без кнопки: что о нём сказать. */
const STYLE_STATE: Readonly<Record<Exclude<CorpStyleCard, 'apply' | 'shop'>, string>> = {
  applied: 'corp.style.applied',
  owned: 'corp.style.owned',
  locked: 'corp.style.locked',
};

// --- картина ---------------------------------------------------------------------------

/** Всё, из чего рисуется вкладка. */
export interface CorpHubPaint {
  state: CorpHubState;
  section: CorpHubSection;
  corp: CorpRecord | null;
  me: CorpMembership | null;
  /** Состав с заявками, как его отдаёт `/corps/:id`. */
  members: readonly CorpMembership[];
  /** База; null — сервер её не отдал. */
  view: CorpInfrastructureView | null;
  /** Стиль базы; null — сервер его не отдал, здания рисуются стандартными. */
  style: MetaCorpStyleView | null;
  /** Сколько прошло с чтения базы: время стройки идёт от времени сервера. */
  elapsedMs: number;
  rank: number | null;
  /** Журнал корпорации; null — роль его не видит. */
  journal: readonly CorpAuditEntry[] | null;
  browse: readonly CorpSummary[];
  /** Приказ ушёл и ждёт ответа: кнопки приказов погашены. */
  busy: boolean;
  draftEmblem?: CorpEmblemId;
  /** Взведённая кнопка необратимого приказа. */
  armed: string | null;
  badges: { members: number; battles: number };
  /** «Битвы» до CORP-10 — построители окна корпорации. */
  battles: string;
  canSignIn: boolean;
  /** Часы игрока — для «сегодня» и «вчера» в казне. */
  now: number;
}

// --- мелочи ----------------------------------------------------------------------------

const MINUS = '−';
const pct = (v: number, of: number): string => `${((v / of) * 100).toFixed(3)}%`;
const off = (busy: boolean): string => (busy ? ' disabled' : '');
/** Стиль, в котором рисуются здания. */
const styleOf = (p: CorpHubPaint): string => p.style?.active ?? CORP_STYLE_STANDARD;

function duration(ms: number): string {
  const minutes = Math.max(1, Math.ceil(ms / 60_000));
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  if (!h) return t('corp.hub.time.m', { n: m });
  if (!m) return t('corp.hub.time.h', { n: h });
  return t('corp.buildings.duration', { h, m });
}

const price = (n: number): string => (n > 0 ? `${nfmt(n)} ⟡` : t('corp.hub.free'));

function effects(level: CorpBuildingLevel | undefined): string {
  if (!level) return '';
  return [
    level.influencePerDay > 0 ? t('corp.buildings.income', { n: level.influencePerDay }) : '',
    level.constructionReduction > 0 ? t('corp.buildings.speed', { n: level.constructionReduction }) : '',
    level.maxFormat ? t('corp.buildings.format', { n: level.maxFormat }) : '',
  ]
    .filter(Boolean)
    .join(' · ');
}

const initial = (s: string): string => (Array.from(s.trim())[0] ?? '?').toUpperCase();

function hexNum(n: number): string {
  return (
    `<svg class="cb-hexn" width="56" height="62" viewBox="0 0 40 44" aria-hidden="true">` +
    `<path d="M20 1.5L37.5 11.5V32.5L20 42.5L2.5 32.5V11.5Z"/>` +
    `<text x="20" y="28.5" text-anchor="middle">${n}</text></svg>`
  );
}

function pips(level: number, max: number, building: boolean): string {
  let s = '';
  for (let i = 0; i < max; i++)
    s += `<i class="${i < level ? 'on' : i === level && building ? 'bld' : ''}"></i>`;
  return `<span class="cb-pips" aria-hidden="true">${s}</span>`;
}

function remainingText(ms: number): string {
  return ms > 0 ? t('corp.buildings.remaining', { time: duration(ms) }) : t('corp.buildings.settling');
}

/** Полоса и остаток стройки — обновляет их `updateCorpHubCountdown` без перерисовки. */
function jobBar(view: CorpInfrastructureView, elapsedMs: number): string {
  const p = corpConstructionProgress(view, elapsedMs);
  if (!p) return '';
  return (
    `<span class="cb-bar"><i data-corp-bar style="width:${p.percent.toFixed(1)}%"></i></span>` +
    `<small data-corp-left>${esc(remainingText(p.remainingMs))}</small>`
  );
}

const buildingName = (view: CorpInfrastructureView, id: string): string =>
  t(view.buildings.find((b) => b.id === id)?.nameKey ?? id);

function opensHtml(opens: readonly CorpOpening[]): string {
  return opens
    .map((o) =>
      o.level === 1
        ? `<span class="cb-op new"><em>${t('corp.hub.new')}</em>${esc(t(o.nameKey))}</span>`
        : `<span class="cb-op">${esc(t(o.nameKey))} ${o.level}</span>`,
    )
    .join('');
}

// --- шапка и разделы -------------------------------------------------------------------

function levelPill(view: CorpInfrastructureView): string {
  const level = corpLevel(view) ?? 0;
  const text =
    level > 0
      ? t('corp.hub.level', { n: level })
      : view.construction?.buildingId === CORP_HQ
        ? t('corp.hub.level.building')
        : t('corp.hub.level.none');
  return `<button type="button" class="cb-lvl" data-corphub="levels">${esc(text)}</button>`;
}

function headHtml(p: CorpHubPaint, corp: CorpRecord): string {
  const count = p.members.filter((m) => m.role !== 'recruit').length;
  const style = p.style
    ? `<button type="button" class="cb-lvl" data-corphub="style">${esc(
        t('corp.style.current', { name: t(corpStyleName(p.style.active)) }),
      )}</button>`
    : '';
  return (
    `<header class="cb-head">` +
    (p.me?.role === 'head'
      ? `<button type="button" class="cb-emblem-edit" data-corphub="emblem" aria-label="${esc(t('corp.emblem.change'))}" title="${esc(t('corp.emblem.change'))}"${off(p.busy)}>${corpEmblem(corp.corpId, corp.emblemId, 50)}</button>`
      : corpEmblem(corp.corpId, corp.emblemId, 50)) +
    `<div class="cb-id"><h2>${esc(corp.name)}</h2><div class="cb-meta">` +
    (p.view ? levelPill(p.view) : '') +
    style +
    (count ? `<span>${esc(t('corp.members.count', { n: count }))}</span>` : '') +
    `<span>${esc(p.rank === null ? t('corp.head.rank.none') : t('corp.head.rank', { n: p.rank }))}</span>` +
    `</div></div>` +
    `<div class="cb-infl"><b>${nfmt(corp.influence)} ⟡</b>` +
    (p.view ? `<small>${esc(t('corp.hub.per-day', { n: p.view.influencePerDay }))}</small>` : '') +
    `</div></header>`
  );
}

function tabsHtml(p: CorpHubPaint): string {
  const badge: Partial<Record<CorpHubSection, number>> = {
    members: p.badges.members,
    battles: p.badges.battles,
  };
  return (
    `<div class="cb-tabs" role="tablist" aria-label="${esc(t('corp.hub.tabs'))}">` +
    CORP_HUB_SECTIONS.map((s) => {
      const n = badge[s] ?? 0;
      return (
        `<button type="button" role="tab" class="cb-tab" data-corpsec="${s}" aria-selected="${s === p.section}">` +
        `${esc(t(CORP_HUB_SECTION_LABEL[s]))}${n ? `<small>${n}</small>` : ''}</button>`
      );
    }).join('') +
    `</div>`
  );
}

// --- база ------------------------------------------------------------------------------

function lotLabel(view: CorpInfrastructureView, b: CorpBuildingView, st: CorpLotState): string {
  if (st === 'built') return t('corp.hub.level-of', { n: b.level, max: b.levels.length });
  if (st === 'build') return t('corp.hub.st.job', { n: view.construction?.level ?? b.level + 1 });
  if (st === 'open') return t('corp.hub.key.open');
  return t('corp.buildings.requirement', { n: b.levels[0]?.headquarters ?? 1 });
}

function lotHtml(view: CorpInfrastructureView, b: CorpBuildingView, canBuild: boolean, style: string): string {
  const lot = CORP_LOTS[b.id];
  if (!lot) return '';
  const st = corpLotState(view, b);
  const max = b.levels.length;
  const mark =
    st === 'built'
      ? { tag: `${b.level}/${max}`, badge: String(b.level) }
      : st === 'build'
        ? { tag: `⚒ ${view.construction?.level ?? b.level + 1}`, badge: '⚒' }
        : st === 'open'
          ? { tag: canBuild ? '+' : '', badge: '+' }
          : { tag: t('corp.hub.lot.from', { n: b.levels[0]?.headquarters ?? 1 }), badge: '🔒' };
  const pos =
    `left:${pct(lot.x, CORP_PANORAMA.w)};top:${pct(lot.y, CORP_PANORAMA.h)};` +
    `width:${pct(lot.w, CORP_PANORAMA.w)};height:${pct(lot.h, CORP_PANORAMA.h)}`;
  return (
    `<button type="button" class="cb-lot ${st} tag-${lot.tag}" style="${pos}" data-corpbld="${esc(b.id)}" ` +
    `aria-label="${esc(`${t(b.nameKey)}: ${lotLabel(view, b, st)}`)}">` +
    corpSprite(b.id, b.level, st, style, true) +
    (st === 'open' && canBuild ? `<span class="cb-plus" aria-hidden="true">+</span>` : '') +
    `<span class="cb-tagl" aria-hidden="true"><b>${esc(t(b.nameKey))}</b>${mark.tag ? `<i>${esc(mark.tag)}</i>` : ''}</span>` +
    `<span class="cb-bdg" aria-hidden="true">${esc(mark.badge)}</span></button>`
  );
}

function hudHtml(view: CorpInfrastructureView, elapsedMs: number): string {
  const job = view.construction;
  if (!job)
    return (
      `<div class="cb-hud idle"><span class="cb-hud-ic" aria-hidden="true">⚒</span><div class="cb-hud-b">` +
      `<b>${esc(t('corp.buildings.idle'))}</b>` +
      (view.canBuild ? '' : `<small>${esc(t('corp.buildings.lead-only'))}</small>`) +
      `</div></div>`
    );
  return (
    `<div class="cb-hud" aria-live="polite"><span class="cb-hud-ic" aria-hidden="true">⚒</span><div class="cb-hud-b">` +
    `<b>${esc(t('corp.buildings.queue', { name: buildingName(view, job.buildingId), n: job.level }))}</b>` +
    jobBar(view, elapsedMs) +
    `</div></div>`
  );
}

function legendHtml(): string {
  return (
    `<div class="cb-key" aria-hidden="true">` +
    (['built', 'build', 'open', 'locked'] as const)
      .map((k) => `<span><i class="k-${k}"></i>${esc(t(LOT_KEY[k]))}</span>`)
      .join('') +
    `</div>`
  );
}

function levelCardHtml(view: CorpInfrastructureView, elapsedMs: number): string {
  const plan = corpLevelPlan(view);
  if (!plan) return '';
  const all = `<button type="button" class="btn-quiet" data-corphub="levels">${esc(t('corp.hub.levels'))}</button>`;
  const title =
    plan.level > 0 ? t('corp.hub.level.title', { n: plan.level }) : t('corp.hub.level.none');
  const top =
    `<div class="cb-lvc-top">${hexNum(plan.level)}<div><h3>${esc(title)}</h3>` +
    `<p>${esc(plan.next ? t('corp.hub.level.rule') : t('corp.hub.level.max'))}</p></div></div>`;
  if (!plan.next) return `<section class="cb-lvc">${top}${all}</section>`;
  const next = plan.next;
  const job = view.construction?.buildingId === CORP_HQ;
  const need = job
    ? `<div class="cb-lvc-job"><b>${esc(t('corp.hub.st.job', { n: next.level }))}</b>${jobBar(view, elapsedMs)}</div>`
    : `<ul class="cb-reqs"><li class="${next.enough ? 'ok' : 'no'}">${esc(
        t('corp.hub.level.need', { n: next.level, cost: price(next.cost), time: duration(next.durationMs) }),
      )}</li>${next.conditions.map(conditionHtml).join('')}</ul>`;
  return (
    `<section class="cb-lvc">${top}` +
    `<div><h4>${esc(t('corp.hub.level.to', { n: next.level }))}</h4>${need}</div>` +
    (next.opens.length
      ? `<div><h4>${esc(t('corp.hub.level.opens'))}</h4><div class="cb-opens">${opensHtml(next.opens)}</div></div>`
      : '') +
    all +
    `</section>`
  );
}

function statusHtml(view: CorpInfrastructureView, b: CorpBuildingView, elapsedMs: number): { kind: string; html: string } {
  const st = corpBuildingStatus(view, b);
  switch (st.kind) {
    case 'job':
      return { kind: 'job', html: `<span>${esc(t('corp.hub.st.job', { n: st.level }))}</span>${jobBar(view, elapsedMs)}` };
    case 'max':
      return { kind: 'max', html: esc(t('corp.buildings.max')) };
    case 'locked':
      return { kind: 'locked', html: `🔒 ${esc(t('corp.buildings.requirement', { n: st.headquarters }))}` };
    case 'members':
    case 'battles':
      return { kind: 'locked', html: `🔒 ${esc(conditionText(st))}` };
    case 'busy':
      return { kind: 'busy', html: esc(t('corp.hub.st.busy')) };
    case 'short':
      return { kind: 'short', html: esc(t('corp.hub.st.short', { n: nfmt(st.missing), cost: nfmt(st.cost) })) };
    case 'can':
      return {
        kind: 'can',
        html: esc(
          t(st.first ? 'corp.hub.st.build' : 'corp.hub.st.upgrade', {
            cost: price(st.cost),
            time: duration(st.durationMs),
          }),
        ),
      };
    case 'view':
      return {
        kind: 'view',
        html: esc(t('corp.hub.st.next', { n: b.level + 1, cost: price(st.cost), time: duration(st.durationMs) })),
      };
  }
}

function buildingCardHtml(view: CorpInfrastructureView, b: CorpBuildingView, elapsedMs: number, style: string): string {
  const st = corpLotState(view, b);
  const status = statusHtml(view, b, elapsedMs);
  const max = b.levels.length;
  const effect =
    b.level > 0 ? effects(b.levels[b.level - 1]) : t('corp.hub.gives', { what: effects(b.levels[0]) });
  return (
    `<button type="button" class="cb-bc ${st} s-${status.kind}" data-corpbld="${esc(b.id)}">` +
    `<span class="cb-art">${corpSprite(b.id, b.level, st, style)}</span>` +
    `<span class="cb-bc-b"><span class="cb-bc-n"><b>${esc(t(b.nameKey))}</b></span>` +
    `<span class="cb-bc-l">${pips(b.level, max, st === 'build')}<span>${esc(
      b.level > 0 ? t('corp.hub.level-of', { n: b.level, max }) : t('corp.hub.not-built'),
    )}</span></span>` +
    (effect ? `<span class="cb-bc-e">${esc(effect)}</span>` : '') +
    `<span class="cb-bc-st">${status.html}</span></span></button>`
  );
}

function baseHtml(p: CorpHubPaint): string {
  const view = p.view;
  if (!view)
    return (
      `<div class="cb-empty"><p>${esc(t('corp.buildings.unavailable'))}</p>` +
      `<button type="button" class="btn-second" data-corphub="refresh"${off(p.busy)}>${esc(t('corp.buildings.refresh'))}</button></div>`
    );
  const drawn = CORP_DRAW_ORDER.map((id) => view.buildings.find((b) => b.id === id)).filter(
    (b): b is CorpBuildingView => b !== undefined,
  );
  const bg = corpPanoramaBg(drawn.map((b) => ({ id: b.id, built: b.level > 0 })));
  const style = styleOf(p);
  return (
    `<div class="cb-base">` +
    `<div class="cb-pano-box"><div class="cb-pano-scroll"><div class="cb-pano">${bg}` +
    drawn.map((b) => lotHtml(view, b, view.canBuild, style)).join('') +
    `</div></div>${hudHtml(view, p.elapsedMs)}${legendHtml()}</div>` +
    `<div class="cb-base-grid">${levelCardHtml(view, p.elapsedMs)}` +
    `<section class="cb-blds"><div class="cb-sec-h"><h3>${esc(t('corp.hub.buildings'))}</h3>` +
    `<small>${esc(t('corp.hub.buildings.rule'))}</small></div>` +
    `<div class="cb-bgrid">${view.buildings.map((b) => buildingCardHtml(view, b, p.elapsedMs, style)).join('')}</div>` +
    `</section></div></div>`
  );
}

// --- состав ----------------------------------------------------------------------------

function confirmable(
  p: CorpHubPaint,
  key: string,
  label: string,
  question: string,
  attrs: string,
  look: string,
): string {
  const armed = p.armed === key;
  return (
    `<button type="button" class="${look}${armed ? ' armed' : ''}" ${attrs} data-corpconfirm="${esc(key)}"${off(p.busy)}>` +
    `${esc(armed ? question : label)}</button>`
  );
}

function membersHtml(p: CorpHubPaint, me: CorpMembership): string {
  const manager = me.role === 'head' || me.role === 'officer';
  const order: Record<CorpRole, number> = { head: 0, officer: 1, member: 2, recruit: 3 };
  const roster = p.members
    .filter((m) => m.role !== 'recruit')
    .sort((a, b) => order[a.role] - order[b.role] || a.login.localeCompare(b.login));
  const rows = roster
    .map((m) => {
      const mine = m.accountId === me.accountId;
      const manage = corpMemberActions(me.role, me.accountId, m).length > 0;
      return (
        `<div class="cb-mrow${mine ? ' me' : ''}"><span class="cb-mav" aria-hidden="true">${esc(initial(m.login))}</span>` +
        `<b>${esc(m.login)}${mine ? `<em class="cb-you">${esc(t('corp.you'))}</em>` : ''}` +
        `<span class="cb-role ${m.role}">${esc(t(ROLE_LABEL[m.role]))}</span></b>` +
        (manage
          ? `<button type="button" class="btn-quiet" data-corphub="member" data-corparg="${esc(m.accountId)}">${esc(t('corp.hub.manage'))}</button>`
          : '') +
        `</div>`
      );
    })
    .join('');
  const recruits = p.members.filter((m) => m.role === 'recruit');
  const apps = manager
    ? `<section class="cb-card${recruits.length ? ' cb-apps' : ''}"><div class="cb-card-h"><h3>${esc(t('corp.hub.apps'))}</h3>` +
      `<small>${esc(recruits.length ? t('corp.hub.apps.count', { n: recruits.length }) : t('corp.hub.apps.none'))}</small></div>` +
      recruits
        .map(
          (r) =>
            `<div class="cb-app"><span class="cb-mav" aria-hidden="true">${esc(initial(r.login))}</span><b>${esc(r.login)}</b>` +
            `<div class="cb-acts"><button type="button" class="btn-main" data-corpact="accept" data-corparg="${esc(r.accountId)}"${off(p.busy)}>${esc(t('corp.hub.apps.accept'))}</button>` +
            `<button type="button" class="btn-second" data-corpact="decline" data-corparg="${esc(r.accountId)}"${off(p.busy)}>${esc(t('corp.hub.apps.decline'))}</button></div></div>`,
        )
        .join('') +
      `</section>`
    : `<section class="cb-card"><div class="cb-card-h"><h3>${esc(t('corp.hub.apps'))}</h3></div>` +
      `<p class="cb-note">${esc(t('corp.hub.apps.lead'))}</p></section>`;
  const roles =
    `<section class="cb-card cb-roles"><div class="cb-card-h"><h3>${esc(t('corp.hub.roles'))}</h3></div><ul class="cb-reqs">` +
    `<li class="info">${esc(t('corp.hub.roles.head'))}</li><li class="info">${esc(t('corp.hub.roles.officer'))}</li>` +
    `<li class="info">${esc(t('corp.hub.roles.member'))}</li></ul></section>`;
  const exit =
    me.role === 'head'
      ? confirmable(p, 'disband', t('corp.disband'), t('corp.hub.disband.confirm'), 'data-corpact="disband"', 'btn-second danger')
      : confirmable(p, 'leave', t('corp.leave'), t('corp.hub.leave.confirm'), 'data-corpact="leave"', 'btn-second danger');
  return (
    `<div class="cb-two"><section class="cb-card"><div class="cb-card-h"><h3>${esc(t('corp.tab.members'))}</h3>` +
    `<small>${esc(t('corp.members.count', { n: roster.length }))}</small></div><div class="cb-mlist">${rows}</div>` +
    `<div class="cb-exit">${exit}</div></section>` +
    `<div class="cb-side">${apps}${roles}</div></div>`
  );
}

// --- казна -----------------------------------------------------------------------------

function ledgerWhat(view: CorpInfrastructureView | null, row: CorpLedgerRow): string {
  if (row.kind === 'income') return t('corp.hub.ledger.income');
  if (row.kind === 'battle') return t('corp.hub.ledger.battle');
  return t('corp.hub.ledger.build', {
    name: view ? buildingName(view, row.buildingId) : row.buildingId,
    n: row.level,
  });
}

function treasuryHtml(p: CorpHubPaint, corp: CorpRecord): string {
  const calendar = newsCalendar(p.now);
  let ledger: string;
  if (p.journal === null) ledger = `<p class="cb-note">${esc(t('corp.history.private'))}</p>`;
  else {
    const rows = corpLedger(p.journal);
    ledger = rows.length
      ? rows
          .map(
            (r) =>
              `<div class="cb-lrow"><span>${esc(ledgerWhat(p.view, r))}</span><small>${esc(newsTimeText(r.at, calendar))}</small>` +
              `<b class="${r.delta > 0 ? 'p' : 'm'}">${r.delta > 0 ? '+' : MINUS}${nfmt(Math.abs(r.delta))} ⟡</b></div>`,
          )
          .join('')
      : `<p class="cb-note">${esc(t('corp.empty'))}</p>`;
  }
  const parts = p.view ? corpIncomeParts(p.view) : [];
  return (
    `<div class="cb-two"><section class="cb-card"><div class="cb-card-h"><h3>${esc(t('corp.hub.ledger'))}</h3>` +
    `<small>${esc(t('corp.hub.ledger.recent'))}</small></div><div class="cb-ledger">${ledger}</div></section>` +
    `<section class="cb-card cb-bal"><small>${esc(t('corp.hub.balance'))}</small><b class="cb-big">${nfmt(corp.influence)} ⟡</b>` +
    (p.view
      ? `<div class="cb-incs"><span>${esc(t('corp.hub.per-day', { n: p.view.influencePerDay }))}</span>` +
        (parts.length
          ? `<small>${parts.map((x) => `${esc(t(x.nameKey))} +${x.perDay}`).join(' · ')}</small>`
          : '') +
        `</div>`
      : '') +
    `<ul class="cb-reqs"><li class="info">${esc(t('corp.hub.balance.in'))}</li><li class="info">${esc(t('corp.hub.balance.out'))}</li></ul>` +
    `</section></div>`
  );
}

// --- без корпорации, заявка, гость ------------------------------------------------------

function noneHtml(p: CorpHubPaint): string {
  const rows = p.browse
    .map(
      (c) =>
        `<div class="cb-rrow">${corpEmblem(c.corpId, c.emblemId, 36)}<span><b>${esc(c.name)}</b>` +
        `<small>${esc(t('corp.members.count', { n: c.members }))} · ${nfmt(c.influence)} ⟡</small></span>` +
        `<button type="button" class="btn-second" data-corpact="apply" data-corparg="${esc(c.corpId)}"${off(p.busy)}>${esc(t('corp.apply'))}</button></div>`,
    )
    .join('');
  return (
    `<div class="cb-nc"><section class="cb-nc-hero"><div class="cb-art">${corpSprite(CORP_HQ, 3, 'built')}</div>` +
    `<div class="cb-nc-b"><h2>${esc(t('corp.hub.none.title'))}</h2><p>${esc(t('corp.hub.none.text'))}</p>` +
    `<p class="cb-note">${esc(t('corp.create.generated'))}</p>` +
    corpEmblemPicker(p.draftEmblem ?? 'falcon', p.busy, true) +
    `<div class="cb-create"><button type="button" class="btn-main" data-corpact="create"${off(p.busy)}>${esc(t('corp.create.title'))}</button></div>` +
    `</div></section>` +
    `<section class="cb-card"><div class="cb-card-h"><h3>${esc(t('corp.browse.title'))}</h3></div>` +
    (rows ? `<div class="cb-rlist">${rows}</div>` : `<p class="cb-note">${esc(t('corp.browse.empty'))}</p>`) +
    `</section></div>`
  );
}

function pendingHtml(p: CorpHubPaint): string {
  const name = p.corp?.name ?? '';
  return (
    `<section class="cb-card cb-pending">${corpEmblem(p.corp?.corpId ?? '', p.corp?.emblemId, 50)}` +
    `<div><h3>${esc(t('corp.hub.pending.title', { name }))}</h3><p class="cb-note">${esc(t('corp.hub.pending.text'))}</p></div>` +
    `<button type="button" class="btn-second" data-corpact="cancel"${off(p.busy)}>${esc(t('corp.hub.pending.cancel'))}</button></section>`
  );
}

function emptyHtml(icon: string, title: string, body: string, button: string): string {
  return (
    `<div class="cb-empty"><span class="cb-empty-ic" aria-hidden="true">${icon}</span>` +
    `<b>${esc(title)}</b>${body ? `<p>${esc(body)}</p>` : ''}${button}</div>`
  );
}

/** Вся вкладка: шапка, ярлыки и открытый раздел — или то, что стоит вместо них. */
export function corpHubHtml(p: CorpHubPaint): string {
  switch (p.state) {
    case 'guest':
      return emptyHtml(
        '⬢',
        t('corp.hub.guest.title'),
        t('corp.hub.guest.body'),
        p.canSignIn
          ? `<button type="button" class="btn-main" data-corphub="signin">${esc(t('corp.hub.guest.sign-in'))}</button>`
          : '',
      );
    case 'loading':
      return emptyHtml('⬢', t('corp.hub.loading'), '', '');
    case 'offline':
      return emptyHtml(
        '⚠',
        t('corp.hub.offline'),
        '',
        `<button type="button" class="btn-second" data-corphub="refresh"${off(p.busy)}>${esc(t('corp.buildings.refresh'))}</button>`,
      );
    case 'none':
      return noneHtml(p);
    case 'pending':
      return pendingHtml(p);
    case 'corp':
      break;
  }
  const corp = p.corp;
  const me = p.me;
  if (!corp || !me) return emptyHtml('⬢', t('corp.hub.loading'), '', '');
  const section =
    p.section === 'base'
      ? baseHtml(p)
      : p.section === 'battles'
        ? `<div class="cb-legacy">${p.battles}</div>`
        : p.section === 'members'
          ? membersHtml(p, me)
          : treasuryHtml(p, corp);
  return `<div class="cb">${headHtml(p, corp)}${tabsHtml(p)}${section}</div>`;
}

// --- шторка ----------------------------------------------------------------------------

function buildingSheetHtml(p: CorpHubPaint, view: CorpInfrastructureView, b: CorpBuildingView): string {
  const st = corpLotState(view, b);
  const max = b.levels.length;
  const next = b.next;
  const job = view.construction?.buildingId === b.id;
  const status = corpBuildingStatus(view, b);
  const tag = b.level > 0 ? t('corp.hub.level-of', { n: b.level, max }) : job ? t('corp.hub.key.build') : t('corp.hub.not-built');
  const reqs =
    next && !job
      ? `<div class="cb-sec"><h4>${esc(t('corp.hub.req.title', { n: b.level + 1 }))}</h4><ul class="cb-reqs">` +
        corpRequirements(view, b)
          .map((r) => {
            if (r.kind === 'hq') return `<li class="${r.ok ? 'ok' : 'no'}">${esc(t('corp.hub.req.hq', { n: r.level }))}</li>`;
            if (r.kind === 'members' || r.kind === 'battles') return conditionHtml(r);
            if (r.kind === 'cost')
              return `<li class="${r.ok ? 'ok' : 'no'}">${esc(
                r.cost > 0 ? t('corp.hub.req.cost', { cost: nfmt(r.cost), n: nfmt(r.treasury) }) : t('corp.buildings.free'),
              )}</li>`;
            if (r.kind === 'queue')
              return `<li class="${r.ok ? 'ok' : 'no'}">${esc(
                r.ok || !r.busyWith ? t('corp.hub.req.queue') : t('corp.hub.req.queue-busy', { name: t(r.busyWith) }),
              )}</li>`;
            return `<li class="info">${esc(
              r.reduction > 0
                ? t('corp.hub.req.time-cut', { time: duration(r.durationMs), n: r.reduction })
                : t('corp.hub.req.time', { time: duration(r.durationMs) }),
            )}</li>`;
          })
          .join('') +
        `</ul></div>`
      : '';
  let action: string;
  if (job)
    action = `<div class="cb-sheet-job"><b>${esc(t('corp.hub.st.job', { n: view.construction?.level ?? b.level + 1 }))}</b>${jobBar(view, p.elapsedMs)}</div>`;
  else if (!next) action = `<p class="cb-note ok">${esc(t('corp.buildings.max'))}</p>`;
  else if (!view.canBuild) action = `<p class="cb-note">${esc(t('corp.buildings.lead-only'))}</p>`;
  else {
    const label = t(b.level > 0 ? 'corp.hub.act.upgrade' : 'corp.hub.act.build', { cost: price(next.cost) });
    action =
      status.kind === 'can'
        ? `<button type="button" class="btn-main" data-corpact="build" data-corparg="${esc(b.id)}"${off(p.busy)}>${esc(label)}</button>`
        : `<button type="button" class="btn-main" aria-disabled="true" disabled>${esc(label)}</button>` +
          `<p class="cb-note warn">${statusHtml(view, b, p.elapsedMs).html}</p>`;
  }
  const opens = b.id === CORP_HQ && next ? corpLevelPlan(view)?.next?.opens ?? [] : [];
  const style = styleOf(p);
  const thumbs = b.levels
    .map(
      (l, i) =>
        `<figure class="cb-lt${i + 1 === b.level ? ' cur' : ''}${i + 1 > b.level ? ' fut' : ''}">` +
        `<div class="cb-art">${corpSprite(b.id, i + 1, 'built', style)}</div>` +
        `<figcaption><b>${i + 1}</b>${esc(effects(l) || t('corp.hub.level', { n: i + 1 }))}</figcaption></figure>`,
    )
    .join('');
  return (
    `<div class="cb-art cb-bs-art ${st}">${corpSprite(b.id, b.level, st, style)}</div>` +
    `<div class="cb-bs-head"><h3 id="cb-sheet-title">${esc(t(b.nameKey))}</h3><span class="cb-lvtag">${esc(tag)}</span></div>` +
    `<p class="cb-bs-d">${esc(t(b.descriptionKey))}</p>` +
    `<div class="cb-cmp"><div><small>${esc(t('corp.buildings.current'))}</small><b>${esc(
      b.level > 0 ? effects(b.levels[b.level - 1]) || t('corp.hub.level', { n: b.level }) : t('corp.hub.not-built'),
    )}</b></div>` +
    `<div><small>${esc(next ? t('corp.hub.level', { n: b.level + 1 }) : t('corp.buildings.next'))}</small><b>${esc(
      next ? effects(next) || t('corp.hub.level', { n: b.level + 1 }) : t('corp.hub.last-level'),
    )}</b></div></div>` +
    (opens.length
      ? `<div class="cb-sec"><h4>${esc(t('corp.hub.level.opens'))}</h4><div class="cb-opens">${opensHtml(opens)}</div></div>`
      : '') +
    reqs +
    `<div class="cb-acts">${action}</div>` +
    `<div class="cb-sec"><h4>${esc(t('corp.hub.levels.title'))}</h4><div class="cb-lvls">${thumbs}</div></div>`
  );
}

function levelsSheetHtml(view: CorpInfrastructureView): string {
  const rows = corpLevelTable(view)
    .map(
      (r) =>
        `<tr class="${r.current ? 'cur' : ''}"><td>${r.level}${r.current ? ` · ${esc(t('corp.hub.levels.here'))}` : ''}</td>` +
        `<td>${esc(price(r.cost))} · ${esc(duration(r.durationMs))}` +
        (r.conditions.length
          ? `<span class="cb-lv-cond">${esc(r.conditions.map((c) => t(CONDITION_KEY[c.kind].need, { n: c.need })).join(' · '))}</span>`
          : '') +
        `</td>` +
        `<td>${r.opens.length ? r.opens.map((o) => esc(o.level === 1 ? t(o.nameKey) : `${t(o.nameKey)} ${o.level}`)).join(', ') : '—'}</td></tr>`,
    )
    .join('');
  return (
    `<h3 id="cb-sheet-title">${esc(t('corp.hub.levels.sheet'))}</h3>` +
    `<p class="cb-note">${esc(t('corp.hub.level.rule'))} ${esc(t('corp.hub.levels.note'))}</p>` +
    `<div class="cb-tablewrap"><table class="cb-lvtable"><thead><tr><th>${esc(t('corp.hub.levels.col.level'))}</th>` +
    `<th>${esc(t('corp.hub.levels.col.hq'))}</th><th>${esc(t('corp.hub.level.opens'))}</th></tr></thead>` +
    `<tbody>${rows}</tbody></table></div>`
  );
}

function memberSheetHtml(p: CorpHubPaint, me: CorpMembership, m: CorpMembership): string {
  const acts = corpMemberActions(me.role, me.accountId, m)
    .filter((a): a is keyof typeof MEMBER_ACTION => a in MEMBER_ACTION)
    .map((a) => {
      const label = t(MEMBER_ACTION[a]);
      const target = `data-corparg="${esc(m.accountId)}"`;
      if (a === 'kick')
        return confirmable(p, `kick:${m.accountId}`, label, t('corp.hub.kick.confirm', { name: m.login }), `data-corpact="kick" ${target}`, 'btn-second danger');
      if (a === 'transfer')
        return confirmable(p, `transfer:${m.accountId}`, label, t('corp.hub.transfer.confirm', { name: m.login }), `data-corpact="transfer" ${target}`, 'btn-second');
      return `<button type="button" class="btn-second" data-corpact="role" ${target} data-corprole="${a}"${off(p.busy)}>${esc(label)}</button>`;
    })
    .join('');
  return (
    `<div class="cb-ms-h"><span class="cb-mav" aria-hidden="true">${esc(initial(m.login))}</span>` +
    `<div><h3 id="cb-sheet-title">${esc(m.login)}</h3><small>${esc(t(ROLE_LABEL[m.role]))}</small></div></div>` +
    (acts ? `<div class="cb-ms-acts">${acts}</div>` : `<p class="cb-note">${esc(t('corp.hub.member.none'))}</p>`)
  );
}

/** «Стиль базы»: каждый стиль штабом III уровня. Глава применяет купленный и идёт в магазин
 *  за остальными; участник видит, что есть у корпорации. */
function styleSheetHtml(p: CorpHubPaint, view: MetaCorpStyleView): string {
  const cards = CORP_STYLES.map((id) => {
    const card = corpStyleCard(view, id);
    const act =
      card === 'apply'
        ? `<button type="button" class="btn-second" data-corpstyle="${esc(id)}"${off(p.busy)}>${esc(t('corp.style.apply'))}</button>`
        : card === 'shop'
          ? `<button type="button" class="btn-second" data-corpshop="${esc(id)}">${esc(t('corp.style.to-shop'))}</button>`
          : `<span class="cb-sty-st ${card}">${esc(t(STYLE_STATE[card]))}</span>`;
    return (
      `<figure class="cb-sty${card === 'applied' ? ' cur' : ''}"><div class="cb-art">${corpSprite(CORP_HQ, 3, 'built', id)}</div>` +
      `<figcaption><b>${esc(t(corpStyleName(id)))}</b>${act}</figcaption></figure>`
    );
  }).join('');
  return (
    `<h3 id="cb-sheet-title">${esc(t('corp.style.title'))}</h3>` +
    `<p class="cb-note">${esc(t('corp.style.note'))}</p>` +
    `<div class="cb-styles">${cards}</div>`
  );
}

/** Содержимое шторки; пустая строка — показывать нечего (здание или участник ушли). */
export function corpHubSheetHtml(p: CorpHubPaint, sheet: CorpHubSheet, notice: string): string {
  let body = '';
  if (sheet.kind === 'building') {
    const b = p.view?.buildings.find((x) => x.id === sheet.id);
    if (p.view && b) body = buildingSheetHtml(p, p.view, b);
  } else if (sheet.kind === 'levels') {
    if (p.view) body = levelsSheetHtml(p.view);
  } else if (sheet.kind === 'style') {
    if (p.style) body = styleSheetHtml(p, p.style);
  } else if (sheet.kind === 'emblem') {
    if (p.corp && p.me?.role === 'head')
      body = `<h3 id="cb-sheet-title">${esc(t('corp.emblem.title'))}</h3>` +
        corpEmblemPicker(corpEmblemId(p.corp.corpId, p.corp.emblemId), p.busy);
  } else {
    const m = p.members.find((x) => x.accountId === sheet.accountId && x.role !== 'recruit');
    if (p.me && m) body = memberSheetHtml(p, p.me, m);
  }
  if (!body) return '';
  return (
    `<div class="cb-scrim" data-corp-close></div>` +
    `<div class="cb-sheet ${sheet.kind}" role="dialog" aria-modal="true" aria-labelledby="cb-sheet-title">` +
    `<div class="cb-sheet-top"><button type="button" class="btn-x" data-corp-close aria-label="${esc(t('corp.close'))}">✕</button></div>` +
    `<div class="cb-sheet-body">${notice ? `<p class="cb-notice" role="status">${esc(notice)}</p>` : ''}${body}</div></div>`
  );
}

/** Ход стройки без перерисовки: фокус клавиатуры на кнопке переживает тик таймера. */
export function updateCorpHubCountdown(root: ParentNode, view: CorpInfrastructureView, elapsedMs: number): void {
  const p = corpConstructionProgress(view, elapsedMs);
  if (!p) return;
  for (const bar of Array.from(root.querySelectorAll<HTMLElement>('[data-corp-bar]')))
    bar.style.width = `${p.percent.toFixed(1)}%`;
  const text = remainingText(p.remainingMs);
  for (const el of Array.from(root.querySelectorAll('[data-corp-left]'))) el.textContent = text;
}
