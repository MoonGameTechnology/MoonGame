import { canFundCorpBuilding, corpMaterialsHtml, corpMaterialPriceHtml } from './corpMaterialsView';
import type { CorpMaterialsView } from '../../packages/protocol/src/corpInfrastructure';
/**
 * Вкладка хаба «Корпорация» (CORP-3) — разметка по макету, одобренному владельцем
 * 2026-10-21: шапка корпорации, разделы «База», «Битвы», «Состав», «Казна», «Настройки» и шторка над
 * хабом (лист здания, уровни корпорации, участник). Что показать, решают
 * `decisions/corpHub.ts`, `corpBase.ts`, `corpTreasury.ts` и `corpMembers.ts`; данные,
 * запросы и нажатия держит `corpScreen.ts`. Здесь — только сборка разметки из картины.
 *
 * Кнопки несут те же `data-corpact`, что и окно корпорации в партии: приказ один, и
 * разбирает его один обработчик. Приказ, который не отменить (покинуть, расформировать,
 * исключить, передать главенство), просит второго нажатия: `data-corpconfirm` — ключ
 * кнопки, и взведённая кнопка вместо названия задаёт вопрос.
 *
 * Здания рисуются в стиле базы (CORP-14): его применяет глава из «Настроек» в шторке «Стиль базы»
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
  CORP_BACKDROPS,
  CORP_DRAW_ORDER,
  CORP_LOTS,
  CORP_LOTS_PHONE,
  CORP_PAD,
  CORP_PANORAMA,
  CORP_PANORAMA_PHONE,
  CORP_TAG_ABOVE,
  corpBackdropName,
  corpPanoramaBg,
  corpSceneBg,
  corpSprite,
  corpSpriteBox,
  type CorpLot,
} from './corpSprites';
import { esc, nfmt } from './format';
import { newsCalendar, newsTimeText } from './newsScreen';

// --- таблицы ---------------------------------------------------------------------------

export type CorpHubSection = 'base' | 'battles' | 'members' | 'treasury' | 'settings';

export const CORP_HUB_SECTIONS: readonly CorpHubSection[] = ['base', 'battles', 'members', 'treasury', 'settings'];

export const CORP_HUB_SECTION_LABEL: Readonly<Record<CorpHubSection, string>> = {
  base: 'corp.hub.tab.base',
  battles: 'corp.tab.battles',
  members: 'corp.hub.tab.members',
  treasury: 'corp.tab.treasury',
  settings: 'corp.tab.settings',
};

/** Что открыто в шторке над хабом. */
export type CorpHubSheet =
  | { kind: 'building'; id: string }
  | { kind: 'levels' }
  | { kind: 'report'; matchupId: string }
  | { kind: 'member'; accountId: string }
  | { kind: 'emblem' }
  | { kind: 'style' };

const ROLE_LABEL: Readonly<Record<CorpRole, string>> = {
  head: 'corp.role.head',
  officer: 'corp.role.officer',
  member: 'corp.role.member',
  recruit: 'corp.role.recruit',
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
  materials?: CorpMaterialsView | null;
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
  /** Five battle subsections, built from the private battle read model. */
  battles: string;
  battleReport?: string;
  facilities?: Readonly<Record<string, string>>;
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
    level.warehouseItems ? t('corp.buildings.warehouse.effect', { n: level.warehouseItems }) : '',
    level.showcaseSlots ? t('corp.buildings.hall.effect', { n: level.showcaseSlots }) : '',
    level.monument ? t('corp.buildings.monument.effect') : '',
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
  return (
    `<header class="cb-head">` +
    corpEmblem(corp.corpId, corp.emblemId, 50) +
    `<div class="cb-id"><h2>${esc(corp.name)}</h2><div class="cb-meta">` +
    (p.view ? levelPill(p.view) : '') +
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
      const settings = s === 'settings';
      return (
        `<button type="button" role="tab" class="cb-tab${settings ? ' cb-tab-settings' : ''}" data-corpsec="${s}" aria-selected="${s === p.section}"` +
        (settings ? ` aria-label="${esc(t('corp.settings.title'))}" title="${esc(t('corp.settings.title'))}"` : '') + `>` +
        (settings ? `<span class="cb-settings-icon" aria-hidden="true">⚙</span><span class="cb-settings-label">${esc(t(CORP_HUB_SECTION_LABEL[s]))}</span>` : esc(t(CORP_HUB_SECTION_LABEL[s]))) +
        `${n ? `<small>${n}</small>` : ''}</button>`
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

/** Значки сцены — рисунком, а не эмодзи: цвет и толщину даёт тема. */
const LOCK_ICON =
  `<svg class="cb-ico" viewBox="0 0 12 14" aria-hidden="true"><path d="M3.5 6V4.2a2.5 2.5 0 0 1 5 0V6"/><rect x="1.5" y="6" width="9" height="7" rx="1.5"/></svg>`;
const UP_ICON = `<svg class="cb-ico" viewBox="0 0 12 12" aria-hidden="true"><path d="M2.5 7.5L6 4l3.5 3.5"/></svg>`;

/** Строка таблички под зданием: уровень, стройка, «построить» или что нужно для участка. */
function lotStatus(view: CorpInfrastructureView, b: CorpBuildingView, st: CorpLotState, elapsedMs: number): string {
  if (st === 'build') return `<span class="cb-tag-job"><i aria-hidden="true">⚒</i><span>${jobBar(view, elapsedMs)}</span></span>`;
  if (st === 'locked')
    return `<i>${LOCK_ICON}${esc(t('corp.hub.lot.from', { n: b.levels[0]?.headquarters ?? 1 }))}</i>`;
  const can = corpBuildingStatus(view, b).kind === 'can';
  if (st === 'open') return can ? `<i class="cb-tag-go">+ ${esc(t('corp.buildings.build'))}</i>` : `<i>${esc(t('corp.hub.key.open'))}</i>`;
  return pips(b.level, b.levels.length, false) + (can ? `<i class="cb-tag-up">${UP_ICON}</i>` : '');
}

/** Место участка в обеих сценах — переменными: какую взять, решает ширина вкладки (CSS). */
function lotPlace(id: string): string | null {
  const lot = CORP_LOTS[id];
  const phone = CORP_LOTS_PHONE[id];
  if (!lot || !phone) return null;
  const at = (l: CorpLot, w: number, h: number, k: string): string =>
    `--${k}x:${pct(l.x, w)};--${k}y:${pct(l.y, h)};--${k}w:${pct(l.w, w)};--${k}h:${pct(l.h, h)}`;
  return `${at(lot, CORP_PANORAMA.w, CORP_PANORAMA.h, 'l')};${at(phone, CORP_PANORAMA_PHONE.w, CORP_PANORAMA_PHONE.h, 'p')}`;
}

function lotHtml(view: CorpInfrastructureView, b: CorpBuildingView, style: string, elapsedMs: number): string {
  const place = lotPlace(b.id);
  if (!place) return '';
  const st = corpLotState(view, b);
  const box = corpSpriteBox(b.id, b.level, st, style);
  const above = CORP_TAG_ABOVE.has(b.id) ? ' above' : '';
  return (
    `<button type="button" class="cb-lot ${st}${above}" style="${place};--fx:${pct(box.x, 1)};--fw:${pct(box.w, 1)};--ft:${pct(box.top, 1)}" data-corpbld="${esc(b.id)}" ` +
    `aria-label="${esc(`${t(b.nameKey)}: ${lotLabel(view, b, st)}`)}">` +
    `<span class="cb-pad" aria-hidden="true">${CORP_PAD}</span>` +
    corpSprite(b.id, b.level, st, style, true) +
    `<span class="cb-tagl" aria-hidden="true"><b>${esc(t(b.nameKey))}</b><span class="cb-tag-s">${lotStatus(view, b, st, elapsedMs)}</span></span>` +
    `</button>`
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
  const bg = corpSceneBg(p.style?.backdrop);
  const style = styleOf(p);
  return (
    `<div class="cb-base">` +
    `<div class="cb-pano-box"><div class="cb-pano" style="${bg.style}">${bg.html}` +
    drawn.map((b) => lotHtml(view, b, style, p.elapsedMs)).join('') +
    `</div></div>` +
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
  return (
    `<div class="cb-two"><section class="cb-card"><div class="cb-card-h"><h3>${esc(t('corp.tab.members'))}</h3>` +
    `<small>${esc(t('corp.members.count', { n: roster.length }))}</small></div><div class="cb-mlist">${rows}</div>` +
    `</section>` +
    `<div class="cb-side">${apps}${roles}</div></div>`
  );
}

// --- настройки -------------------------------------------------------------------------

function settingsHtml(p: CorpHubPaint, corp: CorpRecord, me: CorpMembership): string {
  const appearance = p.style
    ? `<button type="button" class="btn-second cb-setting" data-corphub="style"><span>` +
      `<b>${esc(t('corp.settings.appearance'))}</b>` +
      `<small>${esc(t('corp.style.current', { name: t(corpStyleName(p.style.active)) }))} · ${esc(t(corpBackdropName(p.style.backdrop)))}</small>` +
      `</span><span aria-hidden="true">›</span></button>`
    : `<p class="cb-note">${esc(t('corp.settings.appearance-unavailable'))}</p>` +
      `<button type="button" class="btn-second" data-corphub="refresh"${off(p.busy)}>${esc(t('corp.buildings.refresh'))}</button>`;
  const emblem = me.role === 'head'
    ? `<button type="button" class="btn-second cb-setting" data-corphub="emblem"${off(p.busy)}>` +
      `<span>${esc(t('corp.emblem.change'))}</span>${corpEmblem(corp.corpId, corp.emblemId, 36)}</button>`
    : '';
  const exit = me.role === 'head'
    ? confirmable(p, 'disband', t('corp.disband'), t('corp.hub.disband.confirm'), 'data-corpact="disband"', 'btn-second danger')
    : confirmable(p, 'leave', t('corp.leave'), t('corp.hub.leave.confirm'), 'data-corpact="leave"', 'btn-second danger');
  return (
    `<section class="cb-card cb-settings"><div class="cb-card-h"><h3>${esc(t('corp.settings.title'))}</h3></div>` +
    `<p class="cb-note">${esc(t('corp.my-role'))}: ${esc(t(ROLE_LABEL[me.role]))}</p>` +
    `<div class="cb-settings-options">${appearance}${emblem}</div>` +
    `<div class="cb-exit">${exit}</div></section>`
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
    `</section></div>` + corpMaterialsHtml(p.materials, p.busy)
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
        ? p.battles
        : p.section === 'members'
          ? membersHtml(p, me)
          : p.section === 'settings'
            ? settingsHtml(p, corp, me)
            : treasuryHtml(p, corp);
  // Строка стройки «Базы» стоит в ряду вкладок: на ПК там пусто, а небо над сценой занято табличками.
  const hud = p.section === 'base' && p.view ? hudHtml(p.view, p.elapsedMs) : '';
  return `<div class="cb">${headHtml(p, corp)}<div class="cb-tabrow">${tabsHtml(p)}${hud}</div>${section}</div>`;
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
      status.kind === 'can' && canFundCorpBuilding(next, p.materials)
        ? `<button type="button" class="btn-main" data-corpact="build" data-corparg="${esc(b.id)}"${off(p.busy)}>${esc(label)}</button>`
        : `<button type="button" class="btn-main" aria-disabled="true" disabled>${esc(label)}</button>` +
          `<p class="cb-note warn">${status.kind === 'can' ? esc(t(!p.materials ? 'corp.materials.unavailable' : p.materials.pending ? 'corp.materials.pending' : 'corp.materials.insufficient')) : statusHtml(view, b, p.elapsedMs).html}</p>`;
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
    (p.facilities?.[b.id] ?? '') +
    reqs +
    (next && Object.keys(next.materials ?? {}).length ? `<div class="cb-sec"><h4>${esc(t('corp.materials.cost'))}</h4><ul class="cb-reqs">${corpMaterialPriceHtml(next.materials, p.materials)}</ul>` +
      (p.materials?.pending ? `<p role="status" class="cb-note warn">${esc(t('corp.materials.pending'))}</p>` : '') + `</div>` : '') +
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
        `<ul class="cb-reqs">${Object.entries(view.buildings.find((b) => b.id === CORP_HQ)?.levels[r.level - 1]?.materials ?? {}).map(([id, n]) => `<li>${n} ${esc(t('meta.material.' + id))}</li>`).join('')}</ul>` +
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

/** Кнопка или пометка под карточкой стиля и фона. */
function lookActHtml(p: CorpHubPaint, card: CorpStyleCard, id: string): string {
  return card === 'apply'
    ? `<button type="button" class="btn-second" data-corpstyle="${esc(id)}"${off(p.busy)}>${esc(t('corp.style.apply'))}</button>`
    : card === 'shop'
      ? `<button type="button" class="btn-second" data-corpshop="${esc(id)}">${esc(t('corp.style.to-shop'))}</button>`
      : `<span class="cb-sty-st ${card}">${esc(t(STYLE_STATE[card]))}</span>`;
}

/** «Стиль базы»: каждый стиль штабом III уровня, ниже фоны базы (CORP-15) панорамой. Глава
 *  применяет купленное и идёт в магазин за остальным; участник видит, что есть у корпорации. */
function styleSheetHtml(p: CorpHubPaint, view: MetaCorpStyleView): string {
  const backdrops = CORP_BACKDROPS.map((id) => {
    const card = corpStyleCard(view, id);
    return (
      `<figure class="cb-sty cb-bd${card === 'applied' ? ' cur' : ''}"><div class="cb-bd-art">${corpPanoramaBg(id)}</div>` +
      `<figcaption><b>${esc(t(corpBackdropName(id)))}</b>${lookActHtml(p, card, id)}</figcaption></figure>`
    );
  }).join('');
  const cards = CORP_STYLES.map((id) => {
    const card = corpStyleCard(view, id);
    const act = lookActHtml(p, card, id);
    return (
      `<figure class="cb-sty${card === 'applied' ? ' cur' : ''}"><div class="cb-art">${corpSprite(CORP_HQ, 3, 'built', id)}</div>` +
      `<figcaption><b>${esc(t(corpStyleName(id)))}</b>${act}</figcaption></figure>`
    );
  }).join('');
  return (
    `<h3 id="cb-sheet-title">${esc(t('corp.style.title'))}</h3>` +
    `<p class="cb-note">${esc(t('corp.style.note'))}</p>` +
    `<div class="cb-styles">${cards}</div>` +
    `<h4 class="cb-sty-h">${esc(t('corp.backdrop.title'))}</h4>` +
    `<div class="cb-styles">${backdrops}</div>`
  );
}

/** Содержимое шторки; пустая строка — показывать нечего (здание или участник ушли). */
export function corpHubSheetHtml(p: CorpHubPaint, sheet: CorpHubSheet, notice: string): string {
  let body = '';
  if (sheet.kind === 'building') {
    const b = p.view?.buildings.find((x) => x.id === sheet.id);
    if (p.view && b) body = buildingSheetHtml(p, p.view, b);
  } else if (sheet.kind === 'report') {
    body = p.battleReport ?? '';
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
