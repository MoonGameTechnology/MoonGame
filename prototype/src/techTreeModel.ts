/**
 * Модель окна «Технологии» (TT-3.1, REFM-9, TT-5): подписи эффектов и условий и ОДИН
 * снимок того, что окно знает о науке игрока (`techModel`). Разметка — в `techTree.ts`
 * (дерево, плитки, окошко узла) и `techTreeSide.ts` (слоты, очередь, совет).
 *
 * Правила живут в ядре (`technologyModule` / `technologyLock` решает, что можно начать);
 * здесь всё — ЧТЕНИЕ этой правды. `techCondOk` форвардит вопрос в ядро (`conditionMet`) —
 * своей копии перебора условий нет (RULES-4); неизвестный тип условия ядро считает
 * невыполненным (fail-secure).
 */
import {
  conditionMet,
  clampResearchSlots,
  scientistSlotBonus,
  techInMatch,
  techRulesOf,
  BASE_RESEARCH_SLOTS,
  queueableTechnology,
  matchCost,
  matchHours,
} from '../../packages/shared-core/src/index';
import type { GameState } from '../../packages/shared-core/src/index';
import { t, tData } from '../../localization/runtime';
import { data } from './gameData';
import { DAY, HOUR } from './time';
import { esc, cost, displayUnit, fmtEta } from './format';
import { isGrantOnlyTech } from './techCoverage';
import { LIVE_FORMATS, type LiveFormats } from './liveTimers';

/** Ветки дерева: ключ, имя, короткое имя для плитки телефона и строка «что в ветке». */
export const TECH_BRANCHES: ReadonlyArray<{ key: string; label: string; short: string; desc: string }> = [
  { key: 'industry', label: 'tech.branch.industry', short: 'tech.branch.industry.short', desc: 'tech.branch.industry.desc' },
  { key: 'space', label: 'tech.branch.space', short: 'tech.branch.space', desc: 'tech.branch.space.desc' },
  { key: 'ground', label: 'tech.branch.ground', short: 'tech.branch.ground', desc: 'tech.branch.ground.desc' },
  { key: 'shuttle', label: 'tech.branch.shuttle', short: 'tech.branch.shuttle', desc: 'tech.branch.shuttle.desc' },
  { key: 'missile', label: 'tech.branch.missile', short: 'tech.branch.missile', desc: 'tech.branch.missile.desc' },
  // automation / C2 — «Хранитель» lives here
  { key: 'command', label: 'tech.branch.command', short: 'tech.branch.command.short', desc: 'tech.branch.command.desc' },
];
export const branchLabel = (key: string): string =>
  t(TECH_BRANCHES.find((b) => b.key === key)?.label ?? key);
// Делегирует общему cost(): те же SVG-чипы, что в баре и карточках, и тот же
// показ нехватки — второй аргумент красит дефицит прямо в модалке технологии.
export const techCost = (c: Record<string, number>, have?: Record<string, number>): string =>
  Object.keys(c).length ? cost(c, have) : '';
export const TECH_FX_LABEL: Record<string, string> = {
  productionBonus: 'tech.fx.production',
  fleetSpeedBonus: 'tech.fx.fleet-speed',
  combatDamageBonus: 'tech.fx.damage',
  radarRangeBonus: 'tech.fx.radar',
  armyUpkeep: 'tech.fx.army-upkeep',
};
/** Урон теха с областью (`damageScope`, BAL-6) бьёт только в своём канале огня, и строка
 *  эффекта называет канал: «+8% урон в космосе», а не «+8% урон». */
export const DAMAGE_SCOPE_LABEL: Record<string, string> = {
  space: 'tech.fx.damage-space',
  ground: 'tech.fx.damage-ground',
  shuttle: 'tech.fx.damage-shuttle',
  missile: 'tech.fx.damage-missile',
};
/** «ч:мм:сс» игрового времени — тот же формат, что у обратного отсчёта до нового дня
 *  в статус-баре. Часы отбрасываются, когда их нет: «38:12» читается лучше «0:38:12». */
export function fmtClock(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(total / 3600);
  const m = String(Math.floor((total % 3600) / 60)).padStart(2, '0');
  const sec = String(total % 60).padStart(2, '0');
  return h > 0 ? `${h}:${m}:${sec}` : `${m}:${sec}`;
}

/** Живые сроки окна (`liveTimers.ts`): часы шапки, срок в строке темы целыми часами (как
 *  было), число часов на кнопке досье. */
export const TECH_LIVE: LiveFormats = {
  ...LIVE_FORMATS,
  clock: fmtClock,
  hup: (ms) => fmtEta(Math.ceil(ms / HOUR)),
  h: (ms) => String(Math.ceil(ms / HOUR)),
};

type TechDefLike = (typeof data.technologies)[string];
type TechCond = TechDefLike['conditions'][number];
export function techCondText(c: TechCond): string {
  switch (c.type) {
    case 'has_scientist':
      return t('tech.req.scientist', {
        b: c.scientist
          ? tData(data.scientists[c.scientist]?.name ?? c.scientist)
          : c.branch
            ? branchLabel(c.branch)
            : t('tech.req.scientist.any'),
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
      if (k === 'heroSlots') return t('tech.fx.hero-slots', { n: v });
      if (k === 'controlLimit') return t('tech.fx.control-limit', { n: v });
      const label =
        k === 'combatDamageBonus' && td.damageScope
          ? DAMAGE_SCOPE_LABEL[td.damageScope]
          : TECH_FX_LABEL[k];
      return `+${Math.round((v as number) * 100)}% ${t(label ?? k)}`;
    });
  // Открытые юниты и здания — одной строкой «открывает: А, Б» (UIX-10.7): слово не
  // повторяется перед каждым. У юнита нет `name` — его подпись даёт displayUnit() (см. has_unit).
  // Одинаковые имена пишутся один раз: у «Верфей пустоты» оба открытых здания зовутся
  // «ангар крепости», и различить их игрок всё равно не может.
  const grants = new Set([
    ...(td.unlocks?.units ?? []).map((u) => esc(displayUnit(u))),
    ...(td.unlocks?.buildings ?? []).map((b) => esc(tData(data.buildings[b]?.name ?? b))),
  ]);
  if (grants.size) fx.push(t('tech.grants', { x: [...grants].join(', ') }));
  for (const a of td.unlocks?.abilities ?? [])
    fx.push(t('tech.grants.ability', { x: a === 'steward' ? t('tech.grants.steward') : esc(a) }));
  return fx.join(' · ');
}


/** Состояние узла в порядке проверок ядра (`technologyLock`): prereq → день → условия.
 *  `res` — идёт, `queued` — стоит в очереди (RQ-1). */
export type TechNodeState = 'done' | 'res' | 'queued' | 'chain' | 'gate' | 'cond' | 'avail';

/** Всё, что окно знает о науке игрока, — снимок на одну перерисовку. */
export interface TechModel {
  state: GameState;
  me: string;
  seat: GameState['players'][string] | undefined;
  /** Узлы ЭТОГО матча без наградных (`isGrantOnlyTech`). */
  techs: Record<string, TechDefLike>;
  done: ReadonlySet<string>;
  active: ReadonlyArray<{ technology: string; startedAt: number; completesAt: number }>;
  queue: readonly string[];
  slots: number;
  freeSlot: boolean;
  res: Record<string, number>;
  /** Ворота дней включены режимом. */
  dayGates: boolean;
  gateOf(td: { dayGate?: number }): number;
  nodeState(id: string): TechNodeState;
  /** Тему можно поставить в очередь — ответ ядра (`queueableTechnology`). */
  canQueue(id: string): boolean;
  price(id: string): Record<string, number>;
  hours(id: string): number;
  affordable(id: string): boolean;
  /** Узлы ветки в порядке показа (ярус, день, id). */
  branchIds(branch: string): string[];
  /** Совет учёных: id и описание из каталога. */
  council: ReadonlyArray<{ id: string; def: (typeof data.scientists)[string] | undefined }>;
  /** Учёный совета, который ведёт ветку: своя ветка или своя линия в ней (BAL-19). */
  leadOf(branch: string): string | undefined;
}

export const branchOf = (td: { branch?: string }): string => td.branch ?? 'space';

export function techModel(state: GameState, me: string): TechModel {
  const seat = state.players[me];
  // Наградные «boon»-узлы — не исследования (BAL-12, `techCoverage.ts`); и только узлы ЭТОГО
  // матча — режим может убрать узел целиком (PVR-6.17, `techInMatch`).
  const techs = Object.fromEntries(
    Object.entries(data.technologies).filter(
      ([id, def]) => !isGrantOnlyTech(id, def) && techInMatch(state, id, data),
    ),
  );
  const dayGates = !!techRulesOf(state).dayGates;
  const gateOf = (td: { dayGate?: number }): number => (dayGates ? (td.dayGate ?? 0) : 0);
  const done = new Set(seat?.technologies?.completed ?? []);
  const activeRaw = seat?.technologies?.active;
  const active = Array.isArray(activeRaw) ? activeRaw : activeRaw ? [activeRaw] : [];
  const res = (seat?.resources ?? {}) as Record<string, number>;
  const started = state.startedAt ?? 0;
  // Число слотов — ФОРМУЛА ЯДРА, а не её копия (CONV-5).
  const slots = clampResearchSlots(BASE_RESEARCH_SLOTS + scientistSlotBonus(seat, data));
  const queue = seat?.technologies?.queue ?? [];
  const price = (id: string): Record<string, number> => matchCost(state, techs[id]?.cost ?? {});
  const council = (seat?.scientists ?? []).map((c) => ({ id: c.id, def: data.scientists[c.id] }));
  const nodeState = (id: string): TechNodeState => {
    const td = techs[id]!;
    if (done.has(id)) return 'done';
    if (active.some((a) => a.technology === id)) return 'res';
    if (queue.includes(id)) return 'queued';
    if ((td.prerequisites ?? []).some((p) => !done.has(p))) return 'chain';
    if (gateOf(td) > 0 && state.time - started < gateOf(td) * DAY) return 'gate';
    if ((td.conditions ?? []).some((c) => !techCondOk(state, me, c))) return 'cond';
    return 'avail';
  };
  const ownsLine = (sci: string, branch: string): boolean =>
    Object.values(techs).some(
      (td) =>
        branchOf(td) === branch &&
        (td.conditions ?? []).some((c) => c.type === 'has_scientist' && c.scientist === sci),
    );
  return {
    state,
    me,
    seat,
    techs,
    done,
    active,
    queue,
    slots,
    freeSlot: active.length < slots,
    res,
    dayGates,
    gateOf,
    nodeState,
    canQueue: (id) => queueableTechnology(state, me, data, id) === null,
    price,
    hours: (id) => matchHours(state, techs[id]?.researchTimeHours ?? 0),
    affordable: (id) => Object.entries(price(id)).every(([k, v]) => (res[k] ?? 0) >= v),
    branchIds: (branch) =>
      Object.keys(techs)
        .filter((id) => branchOf(techs[id]!) === branch)
        .sort(
          (x, y) =>
            techs[x]!.tier - techs[y]!.tier ||
            gateOf(techs[x]!) - gateOf(techs[y]!) ||
            (x < y ? -1 : 1),
        ),
    council,
    leadOf: (branch) =>
      (council.find((c) => c.def?.branch === branch) ?? council.find((c) => ownsLine(c.id, branch)))?.id,
  };
}

/** Почему узел заперт — коротко и с ЛЕКАРСТВОМ: «после «X»», «с дня N», условие. */
export function techLockText(m: TechModel, id: string): string {
  const td = m.techs[id]!;
  const missing = (td.prerequisites ?? []).find((p) => !m.done.has(p));
  if (missing) return t('tech.queue.wait.prerequisite', { x: esc(tData(m.techs[missing]?.name ?? missing)) });
  if (m.nodeState(id) === 'gate') return t('tech.from-day', { n: m.gateOf(td) + 1 });
  const unmet = (td.conditions ?? []).find((c) => !techCondOk(m.state, m.me, c));
  return unmet ? esc(techCondText(unmet)) : t('tech.action.unmet');
}
