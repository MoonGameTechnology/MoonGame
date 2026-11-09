/**
 * СПИСОК «◇ АВИАЦИЯ» — все свои эскадры одним списком (концепт «Управление эскадрой», заказ
 * владельца 2026-11-08), чтобы не искать их по карте.
 *
 * 1. **Группа — по тому, что эскадра делает:** «В полёте», «Готовы», «Перезарядка». Пустая
 *    группа не показывается.
 * 2. **«Перезарядка» — все, кто ждёт на стоянке:** перезарядку, топливо или конец боя базы.
 *    Отдельные группы под каждую причину дробили бы короткий список; причину называет
 *    строка состояния, та же, что в карточке эскадры.
 * 3. **Внутри группы сначала то, что скорее кончится:** вылет — по концу нынешней ноги,
 *    перезарядка — по оставшимся часам. Ждущие без срока (топливо, бой) стоят в конце.
 *    У готовых срока нет, их порядок — порядок обхода баз, одинаковый на всех клиентах.
 * 4. **Кнопка показывает число эскадр**, и на телефоне она видна, только когда эскадры есть
 *    и на карте ничего не выделено: выделение открывает свой лист на том же месте.
 */

import type { BaseBlock } from './hangarBadge';

/** Строка списка: эскадра в воздухе (адрес — id вылета) или на стоянке (id эскадры). */
export type AviationRow =
  | { kind: 'aloft'; strikeId: string; squadronId: string; ships: number; endsAt: number }
  | {
      kind: 'parked';
      squadronId: string;
      ships: number;
      block: BaseBlock;
      /** Часы до конца перезарядки базы; `null` — срока нет. */
      rearmHours: number | null;
    };

export type AviationGroupId = 'aloft' | 'ready' | 'waiting';

export interface AviationGroup {
  id: AviationGroupId;
  rows: AviationRow[];
}

const ORDER: readonly AviationGroupId[] = ['aloft', 'ready', 'waiting'];

function groupOf(row: AviationRow): AviationGroupId {
  if (row.kind === 'aloft') return 'aloft';
  return row.block === null ? 'ready' : 'waiting'; // правило 2
}

/** Срок, по которому строка встаёт в группе (правило 3); `Infinity` — срока нет. */
function soon(row: AviationRow): number {
  if (row.kind === 'aloft') return row.endsAt;
  if (row.block === 'rearming' && row.rearmHours !== null) return row.rearmHours;
  return row.block === null ? 0 : Infinity;
}

/** Группы списка в порядке правила 1, без пустых; строки — по правилу 3. */
export function aviationGroups(rows: readonly AviationRow[]): AviationGroup[] {
  return ORDER.map((id) => ({
    id,
    // Сортировка устойчива: при равном сроке остаётся порядок обхода баз.
    rows: rows.filter((r) => groupOf(r) === id).sort((a, b) => soon(a) - soon(b)),
  })).filter((g) => g.rows.length > 0);
}

/** Видна ли плавающая кнопка списка на телефоне (правило 4). */
export function aviationFabShown(count: number, selected: boolean): boolean {
  return count > 0 && !selected;
}
