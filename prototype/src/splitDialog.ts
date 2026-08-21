/**
 * Окно «Разделить»: когда оно живо и что показывает (REFM-159).
 *
 * Арифметика отбора живёт рядом, в `splitPlan.ts` (REFM-76). Здесь — две другие вещи,
 * которые до сих пор стояли прямо в кадре: ПРАВИЛО ЖИЗНИ окна и его разметка.
 *
 * Правило жизни — не мелочь и не защита от невозможного. План деления привязан к
 * ОДНОМУ флоту и к одному его состоянию, а мир под окном продолжает идти: флот летит,
 * вступает в бой, гибнет, игрок выбирает другой. Тот же приём, что `popoverLife.ts`
 * (REFM-84) для поповеров ряда команд, только основание здесь — конкретный флот.
 *
 * 1. **Нет плана — нет окна.** Закрытое окно не оживает само от того, что под ним
 *    оказался подходящий флот.
 * 2. **Выделение ушло на другой флот — окно закрывается.** Иначе игрок делит не тот
 *    флот, который видит выбранным; ошибиться тут стоит половины эскадры.
 * 3. **Флот исчез — делить нечего.** Погиб в бою или слился с другим.
 * 4. **Полетел или дерётся — окно гаснет.** Ядро делит только состыкованный флот вне
 *    боя, так что оставленное окно обещало бы приказ, который вернётся отказом. А в
 *    бою состав вдобавок меняется под пальцем.
 * 5. **Строка на тип, и остаток считается, а не хранится.** Игрок выбирает, сколько
 *    УВЕСТИ, но решение принимает по тому, сколько ОСТАНЕТСЯ — поэтому в строке стоит
 *    и то, и другое, а расходиться им негде: остаток выводится из тех же двух чисел.
 * 6. **Порядок типов сохраняется.** Строки прыгали бы между перерисовками, а окно
 *    перерисовывается на каждый шаг счётчика — палец попадал бы не в ту кнопку.
 * 7. **Шаг заперт на границе, а не молча упирается.** «−1» на нуле и любая прибавка на
 *    полном уводе гаснут: серая кнопка честно говорит, что предела достигли.
 */
import { t } from '../../localization/runtime';
import { esc } from './format';
import { canConfirm, splitTotals } from './splitPlan';

/** Что нужно знать, чтобы решить судьбу окна (правила 1–4). */
export interface SplitLifeInput {
  /** Флот, к которому привязан план; `null` — окна нет. */
  planFleetId: string | null;
  /** Кто выбран прямо сейчас. */
  selectedFleetId: string | null;
  /** Существует ли ещё флот плана. */
  fleetExists: boolean;
  /** Летит ли он. */
  moving: boolean;
  /** В бою ли он. */
  inBattle: boolean;
}

/** Живо ли окно деления (правила 1–4). */
export function splitDialogLives(i: SplitLifeInput): boolean {
  if (!i.planFleetId) return false;
  if (i.planFleetId !== i.selectedFleetId) return false;
  return i.fleetExists && !i.moving && !i.inBattle;
}

/** Одна строка состава: сколько есть, сколько уводим, сколько останется (правило 5). */
export interface SplitRow {
  unit: string;
  have: number;
  take: number;
  stay: number;
}

/** Строки окна по живому составу флота (правила 5–6). */
export function splitRows(
  counts: Readonly<Record<string, number>>,
  take: Readonly<Record<string, number>>,
): SplitRow[] {
  return Object.keys(counts).map((unit) => {
    const have = counts[unit] ?? 0;
    const tk = take[unit] ?? 0;
    return { unit, have, take: tk, stay: have - tk };
  });
}

/** Чем окно рисует юнита: своей иконкой и своим локализованным именем. */
export interface SplitDialogHooks {
  icon: (unit: string) => string;
  name: (unit: string) => string;
}

/** Модель окна целиком. */
export interface SplitDialogModel {
  fleetId: string;
  rows: readonly SplitRow[];
}

/** Разметка окна: строки состава, сводка и два действия (правила 5–7). */
export function splitDialogHtml(m: SplitDialogModel, hooks: SplitDialogHooks): string {
  const rows = m.rows
    .map(
      (r) => `<div class="srow">
      <span class="sname"><span class="bicon">${hooks.icon(r.unit)}</span>${esc(hooks.name(r.unit))}</span>
      <b class="scur">${r.stay}</b>
      <span class="sbtns">
        <button data-sx="dec" data-unit="${esc(r.unit)}" data-n="1" ${r.take <= 0 ? 'disabled' : ''}>−1</button>
        <button data-sx="inc" data-unit="${esc(r.unit)}" data-n="1" ${r.take >= r.have ? 'disabled' : ''}>+1</button>
        <button data-sx="inc" data-unit="${esc(r.unit)}" data-n="10" ${r.take >= r.have ? 'disabled' : ''}>+10</button>
        <button data-sx="all" data-unit="${esc(r.unit)}" ${r.take >= r.have ? 'disabled' : ''}>${t('split.all')}</button>
      </span>
      <b class="snew">→ ${r.take}</b>
    </div>`,
    )
    .join('');
  const counts: Record<string, number> = {};
  const take: Record<string, number> = {};
  for (const r of m.rows) {
    counts[r.unit] = r.have;
    take[r.unit] = r.take;
  }
  const { takeTotal, total } = splitTotals(counts, take);
  const valid = canConfirm(takeTotal, total);
  return `<div class="sbox">
    <div class="shead">${t('split.title')} <b>${esc(m.fleetId)}</b></div>
    <div class="ssub">${t('split.note')}</div>
    <div class="srows">${rows}</div>
    <div class="sfoot">${t('split.preview', { a: `<b>${takeTotal}</b>`, b: `<b>${total - takeTotal}</b>` })}</div>
    <div class="sactions">
      <button data-sx="confirm" class="cbtn" ${valid ? '' : 'disabled'}>${t('split.confirm')}</button>
      <button data-sx="cancel" class="cbtn ghost">${t('ping.cancel')}</button>
    </div>
  </div>`;
}
