/**
 * Левая колонка окна «Технологии» (TT-5): что исследуется по слотам, очередь, совет учёных
 * и сумма того, что наука уже даёт. На телефоне колонки нет: сверху полоса слотов с двумя
 * кнопками, и «Очередь» или «Совет» выезжают снизу этой же разметкой (класс `sheet-*`).
 *
 * Чистая разметка от `TechModel`; приказы и выбор ловит делегат в `techTree.ts`.
 */
import {
  BASE_RESEARCH_SLOTS,
  MAX_RESEARCH_QUEUE,
  researchQueueCascade,
  researchQueueOrderOk,
  researchQueueView,
} from '../../packages/shared-core/src/index';
import type { ResearchQueueWait } from '../../packages/shared-core/src/index';
import { t, tData } from '../../localization/runtime';
import { data } from './gameData';
import { esc } from './format';
import { liveBarHtml, liveTimerHtml } from './liveTimers';
import {
  DAMAGE_SCOPE_LABEL,
  TECH_FX_LABEL,
  branchLabel,
  branchOf,
  techCondOk,
  techCondText,
  techCost,
  type TechModel,
} from './techTreeModel';

/** Какая выдвижная панель открыта на телефоне. */
export type TechSheet = 'queue' | 'council' | null;

const nameOf = (m: TechModel, id: string): string =>
  esc(tData(m.techs[id]?.name ?? data.technologies[id]?.name ?? id));

/** Чего ждёт тема очереди — правило насоса ядра (`researchQueueView`) словами. */
function waitText(m: TechModel, id: string, wait: ResearchQueueWait | undefined): string {
  const td = data.technologies[id];
  switch (wait) {
    case 'starting':
      return `<button class="tt-qgo btn-main" data-go="${esc(id)}">▶ ${t('tech.action.research')}</button>`;
    case 'resources':
      return `${t('tech.queue.wait.resources')} ${techCost(m.price(id), m.res)}`;
    case 'slot':
      return t('tech.queue.wait.slot');
    case 'queue':
      return t('tech.queue.wait.queue');
    case 'prerequisite': {
      const parent = (td?.prerequisites ?? []).find((p) => !m.done.has(p)) ?? '';
      return t('tech.queue.wait.prerequisite', { x: nameOf(m, parent) });
    }
    case 'day':
      return t('tech.from-day', { n: (td ? m.gateOf(td) : 0) + 1 });
    case 'conditions': {
      const unmet = (td?.conditions ?? []).find((c) => !techCondOk(m.state, m.me, c));
      return unmet ? esc(techCondText(unmet)) : t('tech.action.unmet');
    }
    default:
      return '';
  }
}

/** Строки очереди: номер, имя, чего ждёт, ▲ ▼ ✕. Стрелка, которая подняла бы тему над её
 *  предком, гаснет заранее — тот же вопрос, что задаст редьюсер (`researchQueueOrderOk`). */
function queueRowsHtml(m: TechModel, queueSel: string | null): string {
  const { queue } = m;
  if (!queue.length) return `<div class="tt-empty">${t('tech.queue.empty')}</div>`;
  const waitOf = new Map(researchQueueView(m.state, m.me, data, m.slots).map((v) => [v.technology, v.wait]));
  const swapped = (i: number, j: number): string[] => {
    const next = [...queue];
    [next[i], next[j]] = [next[j]!, next[i]!];
    return next;
  };
  return queue
    .map((id, i) => {
      const wait = waitOf.get(id);
      const up = i > 0 && researchQueueOrderOk(swapped(i, i - 1), data);
      const down = i < queue.length - 1 && researchQueueOrderOk(swapped(i, i + 1), data);
      const gone = researchQueueCascade(m.state, m.me, data, id);
      const removeTitle =
        gone.length > 1
          ? t('tech.queue.remove-with', { x: gone.slice(1).map((g) => nameOf(m, g)).join(', ') })
          : t('tech.action.dequeue');
      const qid = esc(id);
      return (
        `<div class="tt-qrow w-${wait ?? 'none'}${id === queueSel ? ' sel' : ''}" data-qitem="${qid}">` +
        `<em>${i + 1}</em>` +
        `<div class="tt-qmain"><b>${nameOf(m, id)}</b><span class="tt-qwait">${waitText(m, id, wait)}</span></div>` +
        `<span class="tt-qbtns">` +
        `<button class="tt-qb btn-second" data-qmove="${qid}" data-to="${i - 1}" title="${esc(t('tech.queue.up'))}" aria-label="${esc(t('tech.queue.up'))}"${up ? '' : ' disabled'}>▲</button>` +
        `<button class="tt-qb btn-second" data-qmove="${qid}" data-to="${i + 1}" title="${esc(t('tech.queue.down'))}" aria-label="${esc(t('tech.queue.down'))}"${down ? '' : ' disabled'}>▼</button>` +
        `<button class="tt-qx btn-x" data-dq="${qid}" title="${esc(removeTitle)}" aria-label="${esc(removeTitle)}">✕</button>` +
        `</span></div>`
      );
    })
    .join('');
}

/** Свободный слот: что с ним будет дальше — первая тема очереди или «выберите тему». */
function freeSlotHint(m: TechModel): string {
  const first = m.queue[0];
  if (!first) return t('tech.slot.free.pick');
  const wait = researchQueueView(m.state, m.me, data, m.slots).find((v) => v.technology === first)?.wait;
  const why = wait === 'starting' ? '' : waitText(m, first, wait);
  return t('tech.slot.free.next', { x: nameOf(m, first) }) + (why ? ` · ${why}` : '');
}

/** Что учёный совета даёт в матче — только то, что правда делает правило. */
export function councilEffect(m: TechModel, id: string): { fx: string; none: boolean } {
  const def = data.scientists[id];
  const parts: string[] = [];
  if (def?.slotBonus)
    parts.push(t('tech.council.slot', { a: BASE_RESEARCH_SLOTS, b: BASE_RESEARCH_SLOTS + def.slotBonus }));
  // Узлы, которые открывает именно он: по имени (своя линия) или как лидер их ветки.
  const opens = Object.values(m.techs)
    .filter((td) =>
      (td.conditions ?? []).some(
        (c) =>
          c.type === 'has_scientist' &&
          (c.scientist !== undefined ? c.scientist === id : !!def?.branch && (c.branch ?? branchOf(td)) === def.branch),
      ),
    )
    .map((td) => esc(tData(td.name)));
  if (opens.length) parts.push(t('tech.council.opens', { x: opens.join(', ') }));
  if (parts.length) return { fx: parts.join(' · '), none: false };
  return { fx: t('tech.council.none', { b: def?.branch ? branchLabel(def.branch) : '' }), none: true };
}

function councilHtml(m: TechModel): string {
  return m.council
    .map(({ id, def }) => {
      const name = esc(tData(def?.name ?? id));
      const e = councilEffect(m, id);
      return (
        `<div class="tt-sci"><span class="tt-av">${name.slice(0, 1)}</span>` +
        `<div><b>${name}</b><small class="${e.none ? 'none' : 'fx'}">${e.fx}</small></div></div>`
      );
    })
    .join('');
}

/** «Наука уже даёт»: сумма изученных бонусов — проценты по виду эффекта, слоты и планеты. */
export function fxSummaryHtml(m: TechModel): string {
  const pct = new Map<string, number>();
  let heroSlots = 0;
  let control = 0;
  for (const id of m.done) {
    const td = m.techs[id];
    if (!td) continue;
    for (const [k, v] of Object.entries(td.effects ?? {}) as Array<[string, number]>) {
      if (!v) continue;
      if (k === 'heroSlots') heroSlots += v;
      else if (k === 'controlLimit') control += v;
      else {
        const label =
          k === 'combatDamageBonus' && td.damageScope ? DAMAGE_SCOPE_LABEL[td.damageScope] : TECH_FX_LABEL[k];
        const key = label ?? k;
        pct.set(key, (pct.get(key) ?? 0) + v);
      }
    }
  }
  const out = [...pct].map(([k, v]) => `<b>+${Math.round(v * 100)}%</b> ${t(k)}`);
  if (heroSlots) out.push(`<b>${t('tech.fx.hero-slots', { n: heroSlots })}</b>`);
  if (control) out.push(`<b>${t('tech.fx.control-limit', { n: control })}</b>`);
  return out.length ? out.join(' · ') : t('tech.fxsum.none');
}

/** Колонка: слоты, очередь, совет, «наука уже даёт». На телефоне — выдвижная панель. */
export function techSideHtml(m: TechModel, view: { queueSel: string | null; sheet: TechSheet }): string {
  const slotRows =
    m.active
      .map(
        (a) =>
          `<button class="tt-nowrow" data-now="${esc(a.technology)}" data-pick="${esc(a.technology)}">` +
          `<b>${nameOf(m, a.technology)}</b>` +
          `<span class="tt-nowt">${liveTimerHtml(a.completesAt, 'clock')}</span>` +
          `<span class="tt-prog">${liveBarHtml(a.startedAt, a.completesAt)}</span></button>`,
      )
      .join('') +
    Array.from(
      { length: Math.max(0, m.slots - m.active.length) },
      (_, i) =>
        `<div class="tt-slotfree">${t('tech.slot.free')}${i === 0 ? `<small>${freeSlotHint(m)}</small>` : ''}</div>`,
    ).join('');
  const council = m.council.length
    ? `<section class="tt-sec tt-council"><div class="tt-sech">${t('tech.council.title')}<span>${t('tech.council.match')}</span></div>${councilHtml(m)}</section>`
    : '';
  return (
    `<aside class="tt-side${view.sheet ? ` sheet sheet-${view.sheet}` : ''}">` +
    `<section class="tt-sec tt-now"><div class="tt-sech">${t('tech.side.running')}<span>${m.active.length}/${m.slots}</span></div>${slotRows}</section>` +
    `<section class="tt-sec tt-queue"><div class="tt-sech">${t('tech.queue.title')}<span>${m.queue.length}/${MAX_RESEARCH_QUEUE}</span></div>` +
    `<div class="tt-qlist">${queueRowsHtml(m, view.queueSel)}</div></section>` +
    council +
    `<section class="tt-sec tt-fxsum"><div class="tt-sech">${t('tech.fxsum.title')}</div><div>${fxSummaryHtml(m)}</div></section>` +
    `</aside>`
  );
}

/** Телефон: что идёт по слотам и две кнопки — «Очередь» и «Совет» (выдвижные панели). */
export function techPhoneStripHtml(m: TechModel): string {
  const free = m.slots - m.active.length;
  const slots =
    m.active
      .map(
        (a) =>
          `<button class="tt-pslot" data-pick="${esc(a.technology)}"><b>${nameOf(m, a.technology)}</b>` +
          `<span class="tt-nowt">${liveTimerHtml(a.completesAt, 'clock')}</span>` +
          `<span class="tt-prog">${liveBarHtml(a.startedAt, a.completesAt)}</span></button>`,
      )
      .join('') +
    (free > 0 ? `<div class="tt-pslot idle">${t('tech.slot.free')}${free > 1 ? ` ×${free}` : ''}</div>` : '');
  const council = m.council.length
    ? `<button class="tt-pchip sci" data-sheet="council">${t('tech.chip.council', {
        x: m.council.map(({ id, def }) => esc(tData(def?.name ?? id))).join(' · '),
      })}</button>`
    : '';
  return (
    `<div class="tt-pstrip">${slots}<div class="tt-pchips">` +
    `<button class="tt-pchip" data-sheet="queue">${t('tech.queue.title')} <i>${m.queue.length}/${MAX_RESEARCH_QUEUE}</i> ▾</button>` +
    council +
    `</div></div>`
  );
}
