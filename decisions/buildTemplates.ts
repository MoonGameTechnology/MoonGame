import { moduleAllowed, type GameData } from '../packages/shared-core/src/index';

/**
 * Шаблоны заказа в окне «Производство» (заказ владельца 2026-10-17): игрок сохраняет
 * собранный заказ — корпус, модули, число, боец челнока — и потом ставит его одним
 * нажатием, в этой партии или в следующей.
 *
 * Три правила, ради которых решение вынесено сюда и держится тестом:
 *
 *  · **хранилище — внешние данные (A05/A08).** Шаблоны лежат в `localStorage`, а его
 *    правит кто угодно с доступом к устройству. Разбор ВАЛИДИРУЮЩИЙ: неизвестный корпус
 *    выбрасывает шаблон, неизвестный модуль — только этот модуль, число зажимается в
 *    границы степпера. Мусор в хранилище не роняет окно.
 *  · **шаблон — намерение, а не обещание.** Партии разные: в одной у игрока нет этого
 *    корпуса (арсенал Сектора Зеро), в другой правило данных запретило модуль. Шаблон
 *    при этом не удаляется; на постановке он сводится к тому, что разрешено СЕЙЧАС
 *    ({@link fitTemplate}), а последнее слово всё равно у ядра (`unit.build`).
 *  · **дубль не копится.** Тот же заказ второй раз — не новый шаблон, а тот же.
 */

/** Сколько шаблонов держит окно: больше — список длиннее экрана телефона. */
export const MAX_TEMPLATES = 12;
/** Граница числа машин — та же, что у степпера заказа. */
export const MAX_TEMPLATE_COUNT = 20;

export interface BuildTemplate {
  /** Вкладка окна, на которой собран заказ. */
  tab: string;
  hull: string;
  modules: string[];
  count: number;
  /** Боец десантного челнока (SHU-5.2). */
  troop?: string;
}

export function sameTemplate(a: BuildTemplate, b: BuildTemplate): boolean {
  return (
    a.tab === b.tab &&
    a.hull === b.hull &&
    a.count === b.count &&
    a.troop === b.troop &&
    a.modules.length === b.modules.length &&
    a.modules.every((id, i) => id === b.modules[i])
  );
}

const clampCount = (n: unknown): number =>
  typeof n === 'number' && Number.isFinite(n)
    ? Math.max(1, Math.min(MAX_TEMPLATE_COUNT, Math.round(n)))
    : 1;

/** Шаблоны из сырого значения хранилища. Что угодно, кроме массива, — пустой список. */
export function parseTemplates(
  raw: string | null,
  data: GameData,
  tabs: readonly string[],
): BuildTemplate[] {
  let parsed: unknown;
  try {
    parsed = raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
  if (!Array.isArray(parsed)) return [];
  const out: BuildTemplate[] = [];
  for (const item of parsed) {
    if (out.length >= MAX_TEMPLATES) break;
    if (!item || typeof item !== 'object') continue;
    const r = item as Record<string, unknown>;
    if (typeof r.tab !== 'string' || !tabs.includes(r.tab)) continue;
    if (typeof r.hull !== 'string' || !Object.hasOwn(data.units, r.hull)) continue;
    const modules = Array.isArray(r.modules)
      ? r.modules.filter((m): m is string => typeof m === 'string' && Object.hasOwn(data.modules, m))
      : [];
    const tpl: BuildTemplate = { tab: r.tab, hull: r.hull, modules, count: clampCount(r.count) };
    if (typeof r.troop === 'string' && Object.hasOwn(data.units, r.troop)) tpl.troop = r.troop;
    if (!out.some((t) => sameTemplate(t, tpl))) out.push(tpl);
  }
  return out;
}

export type AddTemplateResult =
  | { ok: true; list: BuildTemplate[] }
  | { ok: false; reason: 'duplicate' | 'full' };

/** Новый шаблон встаёт ПЕРВЫМ: только что сохранённое ищут глазами сверху. */
export function addTemplate(list: readonly BuildTemplate[], tpl: BuildTemplate): AddTemplateResult {
  if (list.some((t) => sameTemplate(t, tpl))) return { ok: false, reason: 'duplicate' };
  if (list.length >= MAX_TEMPLATES) return { ok: false, reason: 'full' };
  return { ok: true, list: [{ ...tpl, modules: [...tpl.modules] }, ...list] };
}

export function removeTemplate(list: readonly BuildTemplate[], index: number): BuildTemplate[] {
  return list.filter((_, i) => i !== index);
}

/**
 * Шаблон, сведённый к тому, что можно заказать сейчас: `null` — корпуса в этой партии
 * нет (не в арсенале или его нет в ростере вкладки). Модули, которых нет в арсенале или
 * которые правило данных этому корпусу не разрешает, отбрасываются; остальное — как было.
 * `owned` — снимок арсенала партии; нет снимка — ограничений нет (как у ядра).
 */
export function fitTemplate(
  tpl: BuildTemplate,
  roster: readonly string[],
  data: GameData,
  owned?: { hulls: readonly string[]; modules: readonly string[] },
): BuildTemplate | null {
  const def = data.units[tpl.hull];
  if (!def || !roster.includes(tpl.hull)) return null;
  if (owned && !owned.hulls.includes(tpl.hull)) return null;
  const modules = tpl.modules.filter((id) => {
    const m = data.modules[id];
    return m !== undefined && moduleAllowed(tpl.hull, def, m) && (!owned || owned.modules.includes(id));
  });
  return { ...tpl, modules };
}
