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
 * 5. **Строка на СТЕК, и остаток считается, а не хранится (FSPLIT-1).** Игрок выбирает,
 *    сколько УВЕСТИ, но решение принимает по тому, сколько ОСТАНЕТСЯ — поэтому в строке
 *    стоит и то, и другое, а расходиться им негде: остаток выводится из тех же двух
 *    чисел. Строка именно на стек, а не на тип: один корпус летает и с начинкой, и
 *    голым (SM-0.3), и «увести два крейсера» ничего не значит, пока не сказано КАКИХ —
 *    поэтому рядом с именем стоят бирки модулей, а адрес кнопки — ключ стека.
 * 6. **Порядок строк сохраняется.** Строки прыгали бы между перерисовками, а окно
 *    перерисовывается на каждый шаг счётчика — палец попадал бы не в ту кнопку.
 * 7. **Шаг заперт на границе, а не молча упирается.** «−1» на нуле и любая прибавка на
 *    полном уводе гаснут: серая кнопка честно говорит, что предела достигли.
 * 8. **Десант делится тем же окном, но упирается в ТРЮМ (FSPLIT-2).** Вместимость даёт
 *    корпус, поэтому увести транспорты, бросив на них войска, — такой же перегруз, как
 *    забрать войска без транспортов. Обе половины показаны, и подтверждение гаснет ДО
 *    отказа сервера.
 */
import { t } from '../../localization/runtime';
import { esc } from './format';
import { canConfirmSplit, clampTake, shipTotals, type CargoSplit, type SplitSlot } from '../../decisions/splitPlan';

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

/** Одна строка отбора: сколько есть, сколько уводим, сколько останется (правило 5). */
export interface SplitRow {
  /** Адрес строки — ключ стека, а не имя типа (правило 5). */
  key: string;
  unit: string;
  modules?: string[];
  kind: 'ship' | 'landing';
  have: number;
  take: number;
  stay: number;
}

/** Строки окна по живым слотам флота (правила 5–6). */
export function splitRows(
  slots: readonly SplitSlot[],
  take: Readonly<Record<string, number>> = {},
): SplitRow[] {
  return slots.map((slot) => {
    const tk = clampTake(take[slot.key] ?? 0, slot.have);
    return {
      key: slot.key,
      unit: slot.unit,
      ...(slot.modules ? { modules: [...slot.modules] } : {}),
      kind: slot.kind,
      have: slot.have,
      take: tk,
      stay: slot.have - tk,
    };
  });
}

/** Чем окно рисует юнита: своей иконкой, своим локализованным именем и именами
 *  установленных модулей (бирки лоадаута — правило 5). */
export interface SplitDialogHooks {
  icon: (unit: string) => string;
  name: (unit: string) => string;
  moduleName: (module: string) => string;
}

/** Модель окна целиком. */
export interface SplitDialogModel {
  fleetId: string;
  rows: readonly SplitRow[];
  /** Трюм обеих половин (правило 8). */
  cargo: CargoSplit;
}

function rowHtml(r: SplitRow, hooks: SplitDialogHooks): string {
  const mods =
    r.modules && r.modules.length > 0
      ? `<span class="smods">${r.modules
          .map((m) => `<span class="smod">${esc(hooks.moduleName(m))}</span>`)
          .join('')}</span>`
      : '';
  return `<div class="srow">
      <span class="sname"><span class="bicon">${hooks.icon(r.unit)}</span>${esc(hooks.name(r.unit))}${mods}</span>
      <b class="scur">${r.stay}</b>
      <span class="sbtns">
        <button data-sx="dec" data-key="${esc(r.key)}" data-n="1" ${r.take <= 0 ? 'disabled' : ''}>−1</button>
        <button data-sx="inc" data-key="${esc(r.key)}" data-n="1" ${r.take >= r.have ? 'disabled' : ''}>+1</button>
        <button data-sx="inc" data-key="${esc(r.key)}" data-n="10" ${r.take >= r.have ? 'disabled' : ''}>+10</button>
        <button data-sx="all" data-key="${esc(r.key)}" ${r.take >= r.have ? 'disabled' : ''}>${t('split.all')}</button>
      </span>
      <b class="snew">→ ${r.take}</b>
    </div>`;
}

/** Разметка окна: строки состава, десант, трюм, сводка и два действия (правила 5–8). */
export function splitDialogHtml(m: SplitDialogModel, hooks: SplitDialogHooks): string {
  const ships = m.rows.filter((r) => r.kind === 'ship');
  const landing = m.rows.filter((r) => r.kind === 'landing');
  const slots: SplitSlot[] = m.rows.map((r) => ({
    key: r.key,
    unit: r.unit,
    ...(r.modules ? { modules: [...r.modules] } : {}),
    have: r.have,
    kind: r.kind,
  }));
  const take: Record<string, number> = {};
  for (const r of m.rows) take[r.key] = r.take;
  const { takeTotal, total } = shipTotals(slots, take);
  const valid = canConfirmSplit(slots, take, m.cargo);
  const c = m.cargo;
  const hold = landing.length
    ? `<div class="shead2">${t('split.section.landing')}</div>${landing.map((r) => rowHtml(r, hooks)).join('')}
    <div class="scargo${c.fits ? '' : ' bad'}">${t('split.hold', {
      a: `<b>${c.takenUsed}/${c.takenCapacity}</b>`,
      b: `<b>${c.keptUsed}/${c.keptCapacity}</b>`,
    })}${c.fits ? '' : ` — ${t('split.hold.over')}`}</div>`
    : '';
  return `<div class="sbox">
    <div class="shead">${t('split.title')} <b>${esc(m.fleetId)}</b></div>
    <div class="ssub">${t('split.note')}</div>
    <div class="srows">${ships.map((r) => rowHtml(r, hooks)).join('')}${hold}</div>
    <div class="sfoot">${t('split.preview', { a: `<b>${takeTotal}</b>`, b: `<b>${total - takeTotal}</b>` })}</div>
    <div class="sactions">
      <button data-sx="confirm" class="cbtn" ${valid ? '' : 'disabled'}>${t('split.confirm')}</button>
      <button data-sx="cancel" class="cbtn ghost">${t('ping.cancel')}</button>
    </div>
  </div>`;
}
