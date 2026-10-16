/**
 * Страница «Матчи»: числа на вкладках, места в строке и какие контролы фильтра нужны
 * (UIX-17.1).
 *
 * Заказ владельца 2026-10-16: «страницу "матчи" переделать, улучшить». Список стоял под
 * полями адреса и позывного, формой новой партии и фильтром в три строки: на телефоне до
 * первой строки нужно было листать. Строка матча была одной лентой через точку —
 * «PVP conquest · День 1 · 1/2 игроков · ×1 · до 500 очк. · идёт · вход ещё 1д 6ч», — и
 * свободные места в ней приходилось высчитывать. Здесь решения страницы; разметку строит
 * `prototype/src/matchBrowser.ts`, что вместо списка — `browserFallback.ts`.
 *
 * 1. **Число на вкладке — сколько строк она покажет.** На «Доступных» это число после
 *    фильтра: игрок видит, сколько матчей нашёл, и пустой список с «0» на ярлыке не
 *    выглядит поломкой. Ленты нет — числа нет: «0» значило бы «пусто», а сервер мог просто
 *    не ответить.
 * 2. **Места — точками, пока их не больше восьми.** Свободное кресло видно сразу, без
 *    вычитания. Двадцать и пятьдесят точек не читаются и не влезают в строку телефона —
 *    там только число.
 * 3. **Контрол фильтра без выбора не показывается.** Одна карта в ленте — список карт
 *    выбирать не из чего; одна вместимость — ползунку некуда ехать; ни у одной строки нет
 *    вида — кнопки PvP и PvE ничего не меняют (неизвестный вид проходит любой фильтр,
 *    `matchFilter.ts`, правило 3). Скрытый контрол список не сужает: сохранённый выбор
 *    приводится к ленте (там же, правило 7). Нет ни одного — нет и панели.
 */

/** Вкладки страницы. */
export type MatchesTab = 'available' | 'active' | 'archived';

/**
 * Числа на ярлыках вкладок (правило 1). `lists` — лента сервера, `null` — её нет;
 * `availableShown` — сколько строк «Доступных» осталось после фильтра. `null` у вкладки —
 * число не пишется.
 */
export function tabCounts(
  lists: Partial<Record<MatchesTab, readonly unknown[]>> | null,
  availableShown: number,
): Record<MatchesTab, number | null> {
  if (!lists) return { available: null, active: null, archived: null };
  return {
    available: availableShown,
    active: lists.active?.length ?? 0,
    archived: lists.archived?.length ?? 0,
  };
}

/** Больше стольких мест — только число (правило 2). */
export const SEAT_PIPS_MAX = 8;

/**
 * Места строки точками: `true` — кресло занято, `false` — свободно; `null` — точками не
 * рисуется, только число (правило 2). Занятых не бывает больше, чем кресел.
 */
export function seatPips(seated: number, capacity: number): boolean[] | null {
  if (!Number.isInteger(capacity) || capacity < 1 || capacity > SEAT_PIPS_MAX) return null;
  const taken = Math.max(0, Math.min(Math.floor(seated), capacity));
  return Array.from({ length: capacity }, (_, i) => i < taken);
}

/** Что известно о ленте «Доступных» для панели фильтра. */
export interface FilterFeed {
  /** Разных карт в ленте. */
  maps: number;
  /** Наименьшая и наибольшая вместимость в ленте. */
  players: { min: number; max: number };
  /** Есть ли в ленте строка, у которой сервер назвал вид (PvP или PvE). */
  kinds: boolean;
}

/** Какие контролы панели фильтра показать (правило 3). */
export interface FilterControls {
  mode: boolean;
  maps: boolean;
  players: boolean;
  /** Хоть один контрол есть — панель видна. */
  any: boolean;
}

/** Контролы, у которых есть из чего выбирать (правило 3). */
export function filterControls(feed: FilterFeed): FilterControls {
  const mode = feed.kinds;
  const maps = feed.maps > 1;
  const players = feed.players.max > feed.players.min;
  return { mode, maps, players, any: mode || maps || players };
}
