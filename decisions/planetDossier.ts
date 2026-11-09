/**
 * Окно «i» мира — только сведения (заказ владельца 2026-11-08, кирпич UIX-10.12): «При нажатии
 * на планету у нас есть два дублирующих функционал интерфейса… Через восклицательный надо
 * вырезать. И там поместить как можно больше информации о планете». Стройка, очереди и
 * конвейеры живут в окне «Построить»; здесь — что про мир известно, и одна кнопка шпионажа.
 *
 * Правила подачи (макет версии 5, согласован владельцем):
 *
 * 1. **Постройки свёрнуты.** Строка «Постройки N ▸», внутри каждая группа («Экономика»,
 *    «Оборона», «Инфраструктура» — те же группы, что в окне «Построить») раскрывается
 *    отдельно. Пустая группа не показывается.
 * 2. **Нули не пишутся.** В полосе дохода ресурс без движения не стоит: «+0 энергии» — шум.
 * 3. **Полоска здоровья меняет цвет при ранении,** а не только длину: целый отряд зелёный,
 *    раненый жёлтый, тяжело раненый красный (порог красного — `TILE_HP_LOW_PCT`, как у
 *    плиток состава).
 * 4. **Снимок разведки называет свой возраст.** Чужой мир в тумане показан последним
 *    снимком; «разведка 3ч назад» говорит, насколько ему верить.
 */
import { TILE_HP_LOW_PCT } from './unitTile';

/** Группы построек в порядке показа — порядок окна «Построить» (`BUILD_CATEGORIES`). */
export const DOSSIER_GROUPS = ['economy', 'defense', 'infra'] as const;
export type DossierGroup = (typeof DOSSIER_GROUPS)[number];

/** Разложить постройки по группам (правило 1): порядок групп фиксирован, порядок внутри —
 *  как у мира, пустые группы выпадают. */
export function groupBuildings<T extends { type: string }>(
  buildings: readonly T[],
  groupOf: (type: string) => DossierGroup,
): Array<{ group: DossierGroup; items: T[] }> {
  return DOSSIER_GROUPS.map((group) => ({
    group,
    items: buildings.filter((b) => groupOf(b.type) === group),
  })).filter((g) => g.items.length > 0);
}

/** Меньше этого в час — «нуль» для полосы дохода: число печатается с одним знаком. */
const INCOME_EPSILON = 0.05;

/** Ресурсы полосы дохода в заданном порядке, без нулей (правило 2). */
export function incomeCells(
  net: Readonly<Record<string, number>>,
  order: readonly string[],
): Array<{ res: string; perHour: number }> {
  return order
    .map((res) => ({ res, perHour: net[res] ?? 0 }))
    .filter((c) => Math.abs(c.perHour) >= INCOME_EPSILON);
}

/** Цвет полоски здоровья (правило 3). */
export type HpTone = 'full' | 'hurt' | 'low';

export function hpTone(pct: number): HpTone {
  if (pct >= 100) return 'full';
  return pct < TILE_HP_LOW_PCT ? 'low' : 'hurt';
}

/** Сколько целых часов снимку разведки (правило 4); `null` — время снимка неизвестно
 *  (снимок сохранён до того, как его стали помечать). Будущее время — нуль. */
export function scanAgeHours(
  takenAt: number | undefined,
  now: number,
  hourMs: number,
): number | null {
  if (takenAt === undefined) return null;
  return Math.max(0, Math.floor((now - takenAt) / hourMs));
}
