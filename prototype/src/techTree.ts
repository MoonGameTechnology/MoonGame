/**
 * Tech-tree screen (TT-3.1, REFM-9, TT-4) — the session research window: a pinned
 * «researching now» strip, branch tabs, the branch's nodes as a tier-grouped LIST, and
 * the tap-through node dossier with the «research» button.
 *
 * The rules live in the core (`technologyModule` / `technologyLock` decides what may
 * start); everything here is a READ of that truth. `techCondOk`
 * форвардит вопрос в ядро (`conditionMet`) — своей копии перебора условий здесь нет
 * (RULES-4); неизвестный тип условия ядро считает невыполненным (fail-secure).
 *
 * Same REFM shape as the other screens: the markup is pure (`techTreeHtml`), the shared
 * label helpers are plain exports (the scientist-council picker imports `branchLabel`),
 * and only `initTechTree(host)` touches the host, through explicit hooks.
 */
import {
  conditionMet,
  clampResearchSlots,
  scientistSlotBonus,
  techInMatch,
  techRulesOf,
  BASE_RESEARCH_SLOTS,
  MAX_RESEARCH_QUEUE,
  queueableTechnology,
  researchQueueCascade,
  researchQueueOrderOk,
  researchQueueView,
} from '../../packages/shared-core/src/index';
import type { Action, GameState, ResearchQueueWait } from '../../packages/shared-core/src/index';
import { matchCost, matchHours } from '../../packages/shared-core/src/index';
import { t, tData } from '../../localization/runtime';
import { data } from './gameData';
import { DAY, HOUR } from './time';
import { esc, cost, displayUnit, fmtDur, fmtEta } from './format';
import { dequeueTech, moveQueuedTech, queueTech, researchTech } from '../../decisions/actions';
import { isGrantOnlyTech } from './techCoverage';

const clamp = (v: number, a: number, b: number): number => Math.max(a, Math.min(b, v));

export const TECH_BRANCHES: Array<{ key: string; label: string }> = [
  { key: 'industry', label: 'tech.branch.industry' },
  { key: 'space', label: 'tech.branch.space' },
  { key: 'ground', label: 'tech.branch.ground' },
  { key: 'shuttle', label: 'tech.branch.shuttle' },
  { key: 'missile', label: 'tech.branch.missile' },
  { key: 'command', label: 'tech.branch.command' }, // automation / C2 — «Хранитель» lives here
];
export const branchLabel = (key: string): string =>
  t(TECH_BRANCHES.find((b) => b.key === key)?.label ?? key);
// Делегирует общему cost(): те же SVG-чипы, что в баре и карточках, и тот же
// показ нехватки — второй аргумент красит дефицит прямо в модалке технологии.
export const techCost = (c: Record<string, number>, have?: Record<string, number>): string =>
  Object.keys(c).length ? cost(c, have) : '';
export const TECH_ICONS: Record<string, string> = {
  industrial_automation: '⚙',
  microelectronics_fabrication: '▣',
  deep_survey: '📡',
  orbital_logistics: '⛽',
  siege_doctrine: '☄',
  void_armadas: '🛸',
  combined_arms: '⚔',
  garrison_networks: '⛺',
  fortified_infrastructure: '🏰',
  planetary_bastions: '🛡',
  flight_decks: '🛫',
  strike_vectors: '🎯',
  ace_programs: '🎖',
  guidance_arrays: '🧭',
  warhead_miniaturization: '🧨',
  saturation_barrage: '🚀',
  signal_corps: '📶',
  logistics_command: '🧠',
  ai_stewardship: '😴',
};
export const TECH_FX_LABEL: Record<string, string> = {
  productionBonus: 'tech.fx.production',
  fleetSpeedBonus: 'tech.fx.fleet-speed',
  combatDamageBonus: 'tech.fx.damage',
  radarRangeBonus: 'tech.fx.radar',
};
/** Урон теха с областью (`damageScope`, BAL-6) бьёт только в своём канале огня, и строка
 *  эффекта называет канал: «+8% урон в космосе», а не «+8% урон». */
export const DAMAGE_SCOPE_LABEL: Record<string, string> = {
  space: 'tech.fx.damage-space',
  ground: 'tech.fx.damage-ground',
  shuttle: 'tech.fx.damage-shuttle',
  missile: 'tech.fx.damage-missile',
};
/** Ярус римской цифрой — как в макете. Ярусов у контента единицы, поэтому таблица. */
const ROMAN = ['0', 'I', 'II', 'III', 'IV', 'V', 'VI', 'VII', 'VIII'];
function roman(n: number): string {
  return ROMAN[n] ?? String(n);
}

/** «ч:мм:сс» игрового времени — тот же формат, что у обратного отсчёта до нового дня
 *  в статус-баре. Часы отбрасываются, когда их нет: «38:12» читается лучше «0:38:12». */
export function fmtClock(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(total / 3600);
  const m = String(Math.floor((total % 3600) / 60)).padStart(2, '0');
  const sec = String(total % 60).padStart(2, '0');
  return h > 0 ? `${h}:${m}:${sec}` : `${m}:${sec}`;
}

type TechDefLike = (typeof data.technologies)[string];
type TechCond = TechDefLike['conditions'][number];
export function techCondText(c: TechCond): string {
  switch (c.type) {
    case 'has_scientist':
      return t('tech.req.scientist', {
        b: c.branch ? branchLabel(c.branch) : t('tech.req.scientist.any'),
      });
    case 'own_sectors':
      return t('tech.req.sectors', { n: c.min });
    case 'has_building':
      return t('tech.req.building', {
        b: tData(data.buildings[c.building]?.name ?? c.building),
        n: c.min,
      });
    case 'controls_planet_type':
      return t('tech.req.planet', { p: tData(c.planetType), n: c.min });
    case 'has_unit':
      // Unit defs carry no `name` field (buildings do) — the display name is the
      // space-joined id via displayUnit(); the old `?.name ?? id` fallback built a
      // broken l10n key for multiword ids ('strike_carrier' → data.strikecarrier).
      return t('tech.req.unit', { u: displayUnit(c.unit), n: c.min });
    default:
      return t('tech.req.special');
  }
}
/** Выполнено ли ОДНО условие узла — для галочки в строке требований. Финальную правду
 *  про весь узел по-прежнему говорит `technologyLock` в ядре. */
export function techCondOk(state: GameState, me: string, c: TechCond): boolean {
  // RULES-4: правило «выполнено ли условие» живёт в ядре и спрашивается, а не
  // переписывается. Прежняя копия перебирала 2 типа из 5 и на остальных возвращала
  // false — узел с условием `has_building` / `controls_planet_type` / `has_unit`
  // читался бы как запертый НАВСЕГДА, хотя ядро исследование разрешает. Fail-secure
  // при этом не ослаблен: неизвестный тип ядро тоже считает невыполненным.
  return conditionMet(c as Parameters<typeof conditionMet>[0], state, me, data);
}
/** «+10% производство · открывает: Fort» — эффекты и анлоки узла одной строкой. */
export function techFx(td: TechDefLike): string {
  const fx = Object.entries(td.effects ?? {})
    .filter(([, v]) => (v as number) !== 0)
    .map(([k, v]) => {
      const label =
        k === 'combatDamageBonus' && td.damageScope
          ? DAMAGE_SCOPE_LABEL[td.damageScope]
          : TECH_FX_LABEL[k];
      return `+${Math.round((v as number) * 100)}% ${t(label ?? k)}`;
    });
  for (const u of td.unlocks?.units ?? [])
    // no `name` on unit defs — displayUnit() is the canonical unit label (see has_unit)
    fx.push(t('tech.grants', { x: esc(displayUnit(u)) }));
  for (const b of td.unlocks?.buildings ?? [])
    fx.push(t('tech.grants', { x: esc(tData(data.buildings[b]?.name ?? b)) }));
  for (const a of td.unlocks?.abilities ?? [])
    fx.push(t('tech.grants.ability', { x: a === 'steward' ? t('tech.grants.steward') : esc(a) }));
  return fx.join(' · ');
}

/** The whole window body for one branch tab: the «researching now» strip + the branch's
 *  tier-grouped node list + (optionally) the open node's dossier. Pure — `initTechTree`
 *  feeds it the live state and the two bits of view state the window owns. */
export function techTreeHtml(
  state: GameState,
  me: string,
  tab: string,
  modalId: string | null,
  view: { queueFolded?: boolean; queueSel?: string | null } = {},
): string {
  const { queueFolded = false, queueSel = null } = view;
  const seat = state.players[me];
  // Run boons are grants, not researchable session techs — the tree
  // shows only the real nodes. The rule itself lives in `techCoverage.ts` (BAL-12): the
  // self-play report needs the same split for its denominator, and a second hand-written
  // prefix check is exactly how the two would drift apart.
  // PVR-6.17: и только узлы ЭТОГО матча — режим может убрать узел целиком (в забеге нет
  // «Хранителя»). Правило в ядре (`techInMatch`), редьюсер отвечает на него же.
  const techs = Object.fromEntries(
    Object.entries(data.technologies).filter(
      ([id, def]) => !isGrantOnlyTech(id, def) && techInMatch(state, id, data),
    ),
  );
  // Ворота дней режим может снять целиком (забег до третьего дня не доживает) — тогда нет
  // ни замка «нужен день N», ни счётчика дней в шапке: считать их незачем.
  const dayGates = techRulesOf(state).dayGates;
  const gateOf = (td: { dayGate?: number }): number => (dayGates ? (td.dayGate ?? 0) : 0);
  const done = new Set(seat?.technologies?.completed ?? []);
  // Research runs in CONCURRENT slots (core: technologies.active is a list).
  const activeRaw = seat?.technologies?.active;
  const activeList = Array.isArray(activeRaw) ? activeRaw : activeRaw ? [activeRaw] : [];
  const res = (seat?.resources ?? {}) as Record<string, number>;
  const started = state.startedAt ?? 0;
  const hudDay = Math.floor(state.time / DAY) + 1; // счёт статус-бара: день 1 — первый
  // Пилюля слотов считается ФОРМУЛОЙ ЯДРА, а не её копией (CONV-5). Копия здесь
  // рисовала бонус Полимата, которого редьюсер прототипа не давал вовсе: модуля
  // `scientistModule` в его сборке не было, хук `research.slots` оставался пустым, и
  // третье исследование отклонялось `E_RESEARCH_SLOTS_FULL` — интерфейс обещал слот,
  // которого нет. Модуль теперь загружен, а число берётся из одного места.
  const slots = clampResearchSlots(BASE_RESEARCH_SLOTS + scientistSlotBonus(seat, data));
  // RQ-1: очередь исследований. Что можно поставить и чего ждёт каждая тема, решает ЯДРО
  // (`queueableTechnology`, `researchQueueView`) — окно только читает его ответ.
  const queue = seat?.technologies?.queue ?? [];
  const freeSlot = activeList.length < slots;
  const canQueue = (id: string): boolean => queueableTechnology(state, me, data, id) === null;
  // Состояние узла в порядке проверок ядра (technologyLock): prereq → день → условия.
  const nodeState = (id: string): { st: string; prog: number; eta: number } => {
    const td = techs[id]!;
    if (done.has(id)) return { st: 'done', prog: 1, eta: 0 };
    const act = activeList.find((a) => a.technology === id);
    if (act) {
      const total = act.completesAt - act.startedAt;
      return {
        st: 'res',
        prog: total > 0 ? clamp((state.time - act.startedAt) / total, 0, 1) : 1,
        eta: Math.max(0, Math.ceil((act.completesAt - state.time) / HOUR)),
      };
    }
    // RQ-1: место в очереди — отдельное состояние: тема уже в плане, повторно её не
    // ставят, а снять можно из полосы очереди или из досье.
    if (queue.includes(id)) return { st: 'queued', prog: 0, eta: 0 };
    if ((td.prerequisites ?? []).some((p) => !done.has(p))) return { st: 'chain', prog: 0, eta: 0 };
    if (gateOf(td) > 0 && state.time - started < gateOf(td) * DAY)
      return { st: 'gate', prog: 0, eta: 0 };
    if ((td.conditions ?? []).some((c) => !techCondOk(state, me, c))) return { st: 'cond', prog: 0, eta: 0 };
    return { st: 'avail', prog: 0, eta: 0 };
  };
  // Счётчик «готово/всего» на вкладке — навигация без клика: где ещё осталось
  // что исследовать, видно с одного взгляда, не обходя все пять веток.
  const tabs = TECH_BRANCHES.map((b) => {
    const ids = Object.keys(techs).filter((id) => (techs[id]!.branch ?? 'space') === b.key);
    const n = ids.filter((id) => done.has(id)).length;
    const cnt = ids.length ? `<i class="tt-cnt">${n}/${ids.length}</i>` : '';
    // Подпись и счётчик — В СТОЛБИК: в сетке у вкладки треть ширины, и в строку
    // «Командование 3/7» не помещалось.
    return `<button class="tt-tab${b.key === tab ? ' on' : ''}" data-ttab="${b.key}"><span>${t(b.label)}</span>${cnt}</button>`;
  }).join('');
  // Кто из совета курирует эту ветку — и честное предупреждение, если никто.
  const lead = (seat?.scientists ?? [])
    .map((c) => data.scientists[c.id])
    .find((d) => d?.branch === tab);
  const leadHtml = lead
    ? `🧪 ${t('tech.curator')} <b>${esc(tData(lead.name))}</b>`
    : `🔭 ${t('tech.curator.none')}`;
  // PVR-6.17: предупреждение «без лидера ветки узлы с условием „учёный“ закрыты» — только
  // когда оно про что-то. Совета учёных у забега нет, и единственный такой узел («Хранитель»)
  // режим убрал: строка обещала замок, которого в дереве нет.
  const scientistGated = Object.values(techs).some((td) =>
    (td.conditions ?? []).some((c) => c.type === 'has_scientist'),
  );
  const showLead = !!lead || scientistGated;
  // СПИСОК вместо сетки (TT-4, макет владельца): узлы ветки идут ярусами, каждый —
  // полноразмерной строкой, где ЭФФЕКТ, ЦЕНА и СРОК видны без тапа. Сетка 52-пиксельных
  // иконок помещала на экран больше узлов, но про каждый молчала: чтобы узнать, что даёт
  // «⚙», приходилось открывать досье. На телефоне это ровно наоборот тому, что нужно.
  //
  // Ярус вместо рельсы дней: day-гейт никуда не делся, он стал ПРИЧИНОЙ ЗАМКА в самой
  // строке («нужно: день 3») — в одном ряду с «нужно: <родитель>». Так обе причины
  // читаются одинаково и обе называют лекарство, а не просто гасят узел.
  const branchIds = Object.keys(techs)
    .filter((id) => (techs[id]!.branch ?? 'space') === tab)
    .sort(
      (x, y) =>
        techs[x]!.tier - techs[y]!.tier ||
        gateOf(techs[x]!) - gateOf(techs[y]!) ||
        (x < y ? -1 : 1),
    );
  /** Почему узел заперт — словами и с ЛЕКАРСТВОМ, а не просто «закрыто». */
  const lockText = (id: string, st: string): string => {
    const td = techs[id]!;
    if (st === 'chain') {
      const missing = (td.prerequisites ?? []).find((p) => !done.has(p));
      return t('tech.lock.needs', { x: esc(tData(techs[missing ?? '']?.name ?? (missing ?? ''))) });
    }
    if (st === 'gate') return t('tech.lock.day', { n: gateOf(td) + 1 });
    const unmet = (td.conditions ?? []).find((c) => !techCondOk(state, me, c));
    return unmet ? esc(techCondText(unmet)) : t('tech.action.unmet');
  };
  let listHtml = '';
  let lastTier = -1;
  for (const id of branchIds) {
    const td = techs[id]!;
    const st = nodeState(id);
    // Изученное из списка уходит (решение владельца 2026-09-26): строка «✓ Изучено» только
    // отодвигала то, что ещё можно взять. Сколько изучено — видно по счётчику вкладки.
    if (st.st === 'done') continue;
    if (td.tier !== lastTier) {
      lastTier = td.tier;
      listHtml += `<div class="tt-tierh">${t('tech.tier', { n: roman(td.tier) })}</div>`;
    }
    const price = matchCost(state, td.cost);
    const affordable = Object.entries(price).every(([k, v]) => (res[k] ?? 0) >= v);
    // Правое поле строки — состояние: сделано / идёт / в очереди / можно взять / причина
    // замка. Под ним — «＋ В очередь», если начать прямо сейчас нельзя, а поставить в план
    // можно (RQ-1): причина остаётся на виду, а действие — в тот же тап.
    const queueBtn = canQueue(id)
      ? `<button class="tt-qadd btn-second" data-q="${id}">＋ ${t('tech.action.queue')}</button>`
      : '';
    let right: string;
    if (st.st === 'done') right = `<span class="tt-st done">✓ ${t('tech.state.done')}</span>`;
    else if (st.st === 'res') right = `<span class="tt-st run">⚗ ${fmtEta(st.eta)}</span>`;
    else if (st.st === 'queued')
      right = `<span class="tt-st q">⏳ ${t('tech.state.queued', { n: queue.indexOf(id) + 1 })}</span>`;
    else if (st.st === 'avail' && freeSlot && affordable)
      right = `<button class="tt-take btn-main" data-go="${id}">▷ ${t('tech.action.research')}</button>`;
    else if (st.st === 'avail' && !affordable)
      right =
        `<button class="tt-take btn-main" data-go="${id}" disabled>▷ ${t('tech.action.no-resources')}</button>` +
        queueBtn;
    else if (st.st === 'avail')
      right = queueBtn || `<span class="tt-st lock">⏳ ${t('tech.action.slots-full')}</span>`;
    else right = `<span class="tt-st lock">🔒 ${lockText(id, st.st)}</span>` + queueBtn;
    listHtml +=
      `<div class="tt-item st-${st.st}" data-tech="${id}">` +
      `<div class="tt-ih"><b>${esc(tData(td.name))}</b>${right}</div>` +
      (techFx(td) ? `<div class="tt-ifx">${techFx(td)}</div>` : '') +
      `<div class="tt-ifoot"><span>${techCost(price, res)}</span>` +
      `<span class="tt-idur">${fmtDur(matchHours(state, td.researchTimeHours))}</span></div>` +
      (st.st === 'res'
        ? `<span class="tt-prog"><i style="width:${Math.round(st.prog * 100)}%"></i></span>`
        : '') +
      `</div>`;
  }
  if (!listHtml && branchIds.length) listHtml = `<div class="hint">${t('tech.branch.done')}</div>`;
  // Закреплённая шапка: что исследуется ПРЯМО СЕЙЧАС, со сроком и полосой. Раньше это
  // приходилось искать глазами по сетке — а это единственное, ради чего экран открывают
  // повторно.
  const activeHtml = activeList.length
    ? `<div class="tt-now">` +
      activeList
        .map((a) => {
          const td = techs[a.technology];
          const total = a.completesAt - a.startedAt;
          const pct = total > 0 ? Math.round(clamp((state.time - a.startedAt) / total, 0, 1) * 100) : 100;
          const left = Math.max(0, a.completesAt - state.time);
          return (
            `<div class="tt-nowrow" data-now="${esc(a.technology)}"><i class="tt-nowdot"></i>` +
            `<b>${esc(tData(td?.name ?? a.technology))}</b>` +
            `<span class="tt-nowt">${fmtClock(left)}</span>` +
            `<span class="tt-prog"><i style="width:${pct}%"></i></span></div>`
          );
        })
        .join('') +
      `</div>`
    : '';

  // RQ-1: полоса очереди — под «исследуется сейчас», в том же закреплённом верху. Каждая
  // тема говорит, ЧЕГО она ждёт (правило насоса ядра, `researchQueueView`), и несёт три
  // кнопки: выше / ниже / убрать. Стрелка, которая подняла бы тему над её предком, гаснет
  // заранее — тот же вопрос, что задаст редьюсер (`researchQueueOrderOk`).
  let queueHtml = '';
  if (queue.length) {
    const view = researchQueueView(state, me, data, slots);
    const waitOf = new Map(view.map((v) => [v.technology, v.wait]));
    const nameOf = (id: string): string => esc(tData(techs[id]?.name ?? data.technologies[id]?.name ?? id));
    const swapped = (i: number, j: number): string[] => {
      const next = [...queue];
      [next[i], next[j]] = [next[j]!, next[i]!];
      return next;
    };
    const waitText = (id: string, wait: ResearchQueueWait | undefined): string => {
      const td = data.technologies[id];
      switch (wait) {
        case 'starting':
          return `<button class="tt-qgo btn-main" data-go="${esc(id)}">▶ ${t('tech.action.research')}</button>`;
        case 'resources':
          return `${t('tech.queue.wait.resources')} ${techCost(matchCost(state, td?.cost ?? {}), res)}`;
        case 'slot':
          return t('tech.queue.wait.slot');
        case 'queue':
          return t('tech.queue.wait.queue');
        case 'prerequisite': {
          const parent = (td?.prerequisites ?? []).find((p) => !done.has(p)) ?? '';
          return t('tech.queue.wait.prerequisite', { x: nameOf(parent) });
        }
        case 'day':
          return t('tech.from-day', { n: (td ? gateOf(td) : 0) + 1 });
        case 'conditions': {
          const unmet = (td?.conditions ?? []).find((c) => !techCondOk(state, me, c));
          return unmet ? esc(techCondText(unmet)) : t('tech.action.unmet');
        }
        default:
          return '';
      }
    };
    const rows = (queueFolded ? [] : queue)
      .map((id, i) => {
        const wait = waitOf.get(id);
        const up = i > 0 && researchQueueOrderOk(swapped(i, i - 1), data);
        const down = i < queue.length - 1 && researchQueueOrderOk(swapped(i, i + 1), data);
        const gone = researchQueueCascade(state, me, data, id);
        const removeTitle =
          gone.length > 1
            ? t('tech.queue.remove-with', { x: gone.slice(1).map(nameOf).join(', ') })
            : t('tech.action.dequeue');
        const qid = esc(id);
        return (
          `<div class="tt-qrow w-${wait ?? 'none'}${id === queueSel ? ' sel' : ''}" data-qitem="${qid}">` +
          `<em>${i + 1}</em>` +
          `<div class="tt-qmain"><b>${nameOf(id)}</b><span class="tt-qwait">${waitText(id, wait)}</span></div>` +
          `<span class="tt-qbtns">` +
          `<button class="tt-qb btn-second" data-qmove="${qid}" data-to="${i - 1}" title="${esc(t('tech.queue.up'))}" aria-label="${esc(t('tech.queue.up'))}"${up ? '' : ' disabled'}>▲</button>` +
          `<button class="tt-qb btn-second" data-qmove="${qid}" data-to="${i + 1}" title="${esc(t('tech.queue.down'))}" aria-label="${esc(t('tech.queue.down'))}"${down ? '' : ' disabled'}>▼</button>` +
          `<button class="tt-qx btn-x" data-dq="${qid}" title="${esc(removeTitle)}" aria-label="${esc(removeTitle)}">✕</button>` +
          `</span></div>`
        );
      })
      .join('');
    // Свёрнутая полоса — одна строка: заголовок, первая тема и счётчик. Так очередь не
    // отнимает у телефона место под дерево, а свернуть её можно тапом по заголовку.
    const fold = t(queueFolded ? 'tech.queue.unfold' : 'tech.queue.fold');
    queueHtml =
      `<div class="tt-queue${queueFolded ? ' folded' : ''}">` +
      `<div class="tt-qhead" data-qfold><span>⏭ ${t('tech.queue.title')}</span>` +
      (queueFolded ? `<span class="tt-qpeek">1 · ${nameOf(queue[0]!)}</span>` : '') +
      `<button class="tt-qfold btn-quiet" aria-expanded="${!queueFolded}" title="${esc(fold)}" aria-label="${esc(fold)}">` +
      `<i>${queue.length}/${MAX_RESEARCH_QUEUE}</i> ${queueFolded ? '▾' : '▴'}</button></div>` +
      (queueFolded ? '' : `<div class="tt-qlist">${rows}</div>`) +
      `</div>`;
  }

  // Досье узла (тап) — рендерится из состояния, так что живой 500мс-ререндер
  // обновляет прогресс/день, не закрывая окно.
  let modal = '';
  if (modalId && !techs[modalId]) modalId = null;
  if (modalId) {
    const id = modalId;
    const td = techs[id]!;
    const st = nodeState(id);
    const gate = gateOf(td);
    const prereqNames = (td.prerequisites ?? [])
      .map((p) => esc(tData(techs[p]?.name ?? p)))
      .join(', ');
    const condRows = (td.conditions ?? [])
      .map((c) => `<span>${techCondOk(state, me, c) ? '☑' : '⚗'} <b>${esc(techCondText(c))}</b></span>`)
      .join('');
    const price = matchCost(state, td.cost);
    const affordable = Object.entries(price).every(([k, v]) => (res[k] ?? 0) >= v);
    const tag =
      st.st === 'done'
        ? `<span class="tt-tag">${t('tech.state.done')}</span>`
        : st.st === 'res'
          ? `<span class="tt-tag amb">${t('tech.state.running')}</span>`
          : st.st === 'queued'
            ? `<span class="tt-tag amb">${t('tech.state.queued', { n: queue.indexOf(id) + 1 })}</span>`
            : st.st === 'avail'
              ? `<span class="tt-tag">${t('tech.state.open')}</span>`
              : `<span class="tt-tag dim">${t('tech.state.locked')}</span>`;
    // RQ-1: под кнопкой состояния — действие очереди: «＋ В очередь», если начать сейчас
    // нельзя, а поставить в план можно; «убрать», если тема уже стоит в очереди.
    const qBtn =
      st.st === 'queued'
        ? `<button class="tt-mq btn-second danger" data-dq="${id}">✕ ${t('tech.action.dequeue')}</button>`
        : !(st.st === 'avail' && freeSlot && affordable) && canQueue(id)
          ? `<button class="tt-mq btn-second" data-q="${id}">＋ ${t('tech.action.queue')}</button>`
          : '';
    const btn =
      st.st === 'queued'
        ? `<button class="tt-mbtn wait btn-main" disabled>⏳ ${t('tech.state.queued', { n: queue.indexOf(id) + 1 })}</button>`
        : st.st === 'avail' && affordable && !freeSlot
          ? `<button class="tt-mbtn wait btn-main" disabled>⏳ ${t('tech.action.slots-full')}</button>`
          : st.st === 'avail'
        ? `<button class="tt-mbtn btn-main" data-go="${id}"${affordable ? '' : ' disabled'}>🔬 ${affordable ? t('tech.action.research') : t('tech.action.no-resources')}</button>`
        : st.st === 'done'
          ? `<button class="tt-mbtn wait btn-main" disabled>✓ ${t('tech.action.done')}</button>`
          : st.st === 'res'
            ? `<button class="tt-mbtn wait btn-main" disabled>⏳ ${t('tech.action.running', { n: st.eta })}</button>`
            : st.st === 'gate'
              ? `<button class="tt-mbtn wait btn-main" disabled>🔒 ${t('tech.action.opens-day', { n: gate + 1 })}</button>`
              : st.st === 'chain'
                ? `<button class="tt-mbtn wait btn-main" disabled>🔒 ${t('tech.action.needs-parent')}</button>`
                : `<button class="tt-mbtn wait btn-main" disabled>⚗ ${t('tech.action.unmet')}</button>`;
    modal =
      `<div class="tt-modal"><div class="tt-mback" data-mclose="1"></div><div class="tt-mwin">` +
      `<button class="tt-mx btn-x" data-mclose="1">✕</button>` +
      `<div class="tt-mhead"><div class="tt-mico">${TECH_ICONS[id] ?? '🔬'}</div><div>` +
      `<div class="tt-mname">${esc(tData(td.name))}<span class="tt-tier">T${td.tier}</span></div>` +
      `<div class="tt-mtags">${tag}</div></div></div>` +
      (td.description ? `<div class="tt-mdesc">${esc(t(td.description))}</div>` : '') +
      `<div class="tt-mstats">` +
      `<span>💰 <b>${techCost(price, res)} · ${fmtDur(matchHours(state, td.researchTimeHours))}</b></span>` +
      (techFx(td) ? `<span>✦ <b>${techFx(td)}</b></span>` : '') +
      (gate > 0 ? `<span>📅 <b>${t('tech.from-day', { n: gate + 1 })}</b></span>` : '') +
      (prereqNames ? `<span>🔗 <b>${t('tech.req.title')} ${prereqNames}</b></span>` : '') +
      condRows +
      `</div>${btn}${qBtn}</div></div>`;
  }
  const html =
    `<div class="tt-top">${dayGates ? `<span class="tt-day">📅 ${t('tech.day', { n: hudDay })}</span>` : ''}` +
    `<span class="tt-slots">⚛ ${t('tech.slots', { a: activeList.length, b: slots })}</span></div>` +
    activeHtml +
    queueHtml +
    `<div class="tt-tabs">${tabs}</div>` +
    (showLead ? `<div class="tt-lead${lead ? '' : ' closed'}">${leadHtml}</div>` : '') +
    `<div class="tt-scroll"><div class="tt-list">${listHtml}</div></div>` +
    modal;
  return html;
}

/** What the tech window needs from the match screen. */
export interface TechHost {
  /** The window element (`#tech`) — shown/hidden and click-delegated here. */
  root(): HTMLElement;
  /** The body element inside it (`#techbody`) — the part that repaints. */
  body(): HTMLElement;
  /** The current match state (read fresh on every paint — it is replaced, not mutated). */
  state(): GameState;
  /** Whose research this is: the seat you are playing. */
  me(): string;
  /** Submit a player order through the host's usual path (gate, net, replay). */
  order(action: Action): void;
  /** Fired when the window opens — the host shows its just-in-time intro card here. */
  onOpen(): void;
}

/** Wire the window up. Call once at boot (it attaches the click delegate); `open()` is
 *  what the rail button and the Steward's «research it» call, `repaint()` what the frame
 *  loop calls to keep progress bars and ETAs live while the window is open. */
export function initTechTree(host: TechHost): {
  open: () => void;
  repaint: () => void;
  isOpen: () => boolean;
} {
  let tab = 'space'; // активная вкладка-ветка
  let modalId: string | null = null; // открытое досье узла
  let queueFolded = false; // RQ-1: полоса очереди свёрнута в одну строку
  let queueSel: string | null = null; // RQ-1: строка очереди, чьи кнопки открыты на телефоне
  // Появление досье анимируется одноразовым классом .pop: живой 500мс-ререндер окна
  // пересоздаёт DOM, и анимация на самом .tt-mwin переигрывалась бы каждый тик —
  // досье «схлопывалось и выпрыгивало» дважды в секунду (баг живого плейтеста).
  let modalPop = false;
  // Кэш разметки в духе lastCmdHtml/lastPanelHtml из main.ts: одинаковую строку не
  // переприсваиваем — innerHTML пересоздаёт DOM даже на идентичном тексте (и выбивал
  // бы элемент из-под пальца между touchstart и click).
  let lastHtml = '';
  // RQ-1: отклик на приказ очереди — тема, которую поставили, сдвинули или начали,
  // коротко вспыхивает там, где оказалась. Живой ререндер пересоздаёт узлы, поэтому
  // вспышка помнит, когда началась, и пересозданный узел продолжает её с того же места
  // (отрицательная задержка анимации), а не начинает заново. В сетевой игре узел
  // появляется с ответом сервера — вспышка ждёт его до `FLASH_WAIT_MS`.
  let flash: { id: string; since: number | null; asked: number } | null = null;
  const FLASH_MS = 700;
  const FLASH_WAIT_MS = 3000;
  const now = (): number => (typeof performance !== 'undefined' ? performance.now() : Date.now());

  function paintFlash(body: HTMLElement): void {
    if (!flash || typeof body.querySelectorAll !== 'function') return;
    const at = now();
    const sel = `[data-qitem="${CSS.escape(flash.id)}"],[data-now="${CSS.escape(flash.id)}"],.tt-item[data-tech="${CSS.escape(flash.id)}"]`;
    const nodes = body.querySelectorAll<HTMLElement>(sel);
    if (flash.since === null) {
      if (nodes.length) flash.since = at;
      else if (at - flash.asked > FLASH_WAIT_MS) flash = null;
      if (!flash || flash.since === null) return;
    }
    const elapsed = at - flash.since;
    if (elapsed >= FLASH_MS) {
      flash = null;
      return;
    }
    nodes.forEach((n) => {
      if (n.classList.contains('tt-flash')) return;
      n.style.animationDelay = `-${Math.round(elapsed)}ms`;
      n.classList.add('tt-flash');
    });
  }

  function repaint(): void {
    const body = host.body();
    const html = techTreeHtml(host.state(), host.me(), tab, modalId, { queueFolded, queueSel });
    if (html !== lastHtml) {
      // A live re-render (innerHTML) would reset the panel's scroll — save and restore it.
      const before = body.querySelector('.tt-scroll');
      const sx = before?.scrollLeft ?? 0;
      const sy = before?.scrollTop ?? 0;
      body.innerHTML = html;
      lastHtml = html;
      const after = body.querySelector('.tt-scroll');
      if (after) {
        after.scrollLeft = sx;
        after.scrollTop = sy;
      }
    }
    if (modalPop) {
      // Класс мутирует DOM, но кэш сравнивает СТРОКУ разметки, а не живой DOM —
      // .pop не делает кэш вечно «грязным».
      body.querySelector('.tt-mwin')?.classList.add('pop');
      modalPop = false;
    }
    paintFlash(body);
  }

  /** Приказ очереди: отправить, вспыхнуть на месте темы, перерисовать. */
  function queueOrder(action: Action, id: string): void {
    host.order(action);
    flash = { id, since: null, asked: now() };
    repaint();
  }

  host.root().addEventListener('click', (e) => {
    const tg = e.target as HTMLElement;
    if (tg === host.root() || tg.classList.contains('tw-close')) {
      modalId = null;
      host.root().classList.remove('show');
      return;
    }
    if (tg.closest('[data-mclose]')) {
      modalId = null;
      repaint();
      return;
    }
    // Кнопка «исследовать» есть и в строке списка (.tt-take), и в досье (.tt-mbtn) —
    // спрашиваем по САМОМУ приказу (data-go), а не по классу кнопки. Ранний выход тут
    // же гасит открытие досье: тап по кнопке в строке — это приказ, а не «показать».
    const go = (tg.closest('[data-go]') as HTMLElement | null)?.dataset.go;
    if (go) {
      queueOrder(researchTech(host.me(), go), go); // узел тут же перекрашивается в «исследуется»
      return;
    }
    // RQ-1: приказы очереди — поставить, снять, переставить. Как и «исследовать», они
    // гасят открытие досье: кнопки лежат внутри кликабельной строки.
    const q = (tg.closest('[data-q]') as HTMLElement | null)?.dataset.q;
    if (q) {
      queueOrder(queueTech(host.me(), q), q);
      return;
    }
    const dq = (tg.closest('[data-dq]') as HTMLElement | null)?.dataset.dq;
    if (dq) {
      host.order(dequeueTech(host.me(), dq));
      repaint();
      return;
    }
    if (tg.closest('[data-qfold]')) {
      queueFolded = !queueFolded;
      repaint();
      return;
    }
    const mv = tg.closest('[data-qmove]') as HTMLElement | null;
    if (mv?.dataset.qmove) {
      const to = Number(mv.dataset.to);
      if (Number.isInteger(to) && to >= 0) queueOrder(moveQueuedTech(host.me(), mv.dataset.qmove, to), mv.dataset.qmove);
      return;
    }
    // Тап по строке очереди (мимо её кнопок) открывает или прячет её кнопки — на телефоне
    // они скрыты, чтобы строка занимала две строки текста, а не высоту 44-пиксельных кнопок.
    const qi = (tg.closest('[data-qitem]') as HTMLElement | null)?.dataset.qitem;
    if (qi) {
      queueSel = queueSel === qi ? null : qi;
      repaint();
      return;
    }
    const next = (tg.closest('.tt-tab') as HTMLElement | null)?.dataset.ttab;
    if (next) {
      if (next !== tab) {
        tab = next;
        modalId = null;
      }
      repaint();
      return;
    }
    const node = (tg.closest('.tt-item') as HTMLElement | null)?.dataset.tech;
    if (node) {
      modalId = node;
      modalPop = true; // реальное открытие досье — единственный случай с анимацией
      repaint();
    }
  });

  return {
    open: () => {
      modalId = null; // свежее открытие — без прошлого досье
      host.root().classList.add('show');
      repaint();
      host.onOpen();
    },
    repaint,
    isOpen: () => host.root().classList.contains('show'),
  };
}
