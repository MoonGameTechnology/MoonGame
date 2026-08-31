/**
 * Фильтр браузера матчей: режим, карта, число игроков (BRW-2).
 *
 * Заказ владельца — над списком серверов три контрола: «Режим» (Все/PVP/PVE), «Карта»
 * (мультивыбор галочками) и «Игроков» (ползунок мин-макс). Здесь только РЕШЕНИЕ:
 * подходит ли строка и из чего собрать сами контролы. Разметку строит хозяин
 * (`renderMatches`), как у соседних `matchRow.ts` / `browserFallback.ts`.
 *
 * 1. **Фильтр — это поиск сессии, а не правда о ленте.** Он считает только вкладку
 *    «Доступные» (решение владельца): на «Активных» и в «Архиве» игрок ищет СВОИ матчи,
 *    и спрятать их фильтром, выставленным для поиска новой партии, значит потерять
 *    собственную партию. Вкладку модуль не знает — её выбирает хозяин, зовущий предикат.
 * 2. **Пустой набор карт — «все», а не «ни одной».** Свежий заход открывает панель с
 *    невыбранными галочками; прочитать это буквально значит показать игроку пустоту
 *    вместо ленты — и он решит, что сервер пуст.
 * 3. **Неизвестный режим НЕ отсеивается никаким фильтром.** Пустой `kind` — это «сервер
 *    не назвал вид» (BRW-1: так же читается отсутствующий `entryOpen`), а не «не
 *    подходит». Правило не теоретическое: прото-хост зовёт `new MatchRegistry(accounts)`
 *    без каталога, поэтому `kind` не считается вовсе — при fail-closed чтении фильтры
 *    PVP и PVE отдавали бы сегодня пустой список.
 * 4. **Перевёрнутый ползунок — не ошибка.** Двуручный ползунок легко перетащить концами
 *    друг через друга; `min > max` меняется местами, а не превращает ленту в пустоту.
 * 5. **«Сколько игроков» — это ВМЕСТИМОСТЬ, а не занятые кресла.** Игрок ищет партию на
 *    восьмерых, а не партию, где уже сидят восемь: `seated` меняется каждую минуту, и
 *    фильтр по нему выбрасывал бы строки прямо под курсором.
 * 6. **Контролы собираются ИЗ ЛЕНТЫ.** Каталога карт в read-model нет, и заводить его
 *    ради фильтра не нужно: список карт и границы ползунка выводятся из того же ответа
 *    сервера, что и сам список.
 * 7. **Выбор переживает перезагрузку, но НИКОГДА не остаётся невидимым** (BRW-3). Лента
 *    у другого сервера — или у того же назавтра — другая, а галочки и границы ползунка
 *    строятся из НЕЁ. Поэтому сохранённое состояние приводится к сегодняшней ленте:
 *    карты, которых в ней нет, выбрасываются, диапазон зажимается в её границы. Иначе
 *    фильтр, которого игрок не видит в панели, вычистил бы список, и причина пустого
 *    экрана была бы ему недоступна.
 * 8. **Приведение fail-open.** Если от выбора ничего не осталось — ни одной знакомой
 *    карты, диапазон мимо ленты, — берётся ВЕСЬ доступный набор, а не пустой. Показать
 *    лишнее не страшно; показать пустоту без объяснимой причины — потерять игрока.
 *    Битое или чужое содержимое хранилища читается так же: молча даём умолчание, экран
 *    не роняем (в `localStorage` может лежать что угодно — это ввод, а не наше поле).
 */

/** Значения сегмента «Режим». */
export type ModeFilter = 'all' | 'pvp' | 'pve';

/** Состояние трёх контролов. Пустой `maps` — «все карты» (правило 2). */
export interface FilterState {
  mode: ModeFilter;
  maps: Set<string>;
  players: { min: number; max: number };
}

/** Поля строки ленты, которые смотрит фильтр. `kind` необязателен (правило 3). */
export interface FilterRow {
  mapId: string;
  kind?: 'pvp' | 'pve';
  players: { seated: number; capacity: number };
}

/** Карты, встречающиеся в ленте: без повторов, в стабильном порядке (правило 6). */
export function mapsOf(rows: readonly FilterRow[]): string[] {
  return [...new Set(rows.map((r) => r.mapId))].sort();
}

/** Границы ползунка «Игроков» — от наименьшей вместимости в ленте до наибольшей
 *  (правила 5, 6). Пустая лента даёт нули, а не `±Infinity` от `Math.min()`. */
export function playerBounds(rows: readonly FilterRow[]): { min: number; max: number } {
  if (rows.length === 0) return { min: 0, max: 0 };
  const caps = rows.map((r) => r.players.capacity);
  return { min: Math.min(...caps), max: Math.max(...caps) };
}

/** Подходит ли строка под фильтр. */
export function matchesFilter(row: FilterRow, f: FilterState): boolean {
  // Правило 3: вид известен и не тот — мимо; вида НЕТ — строка проходит любой фильтр.
  if (f.mode !== 'all' && row.kind !== undefined && row.kind !== f.mode) return false;
  // Правило 2: пустой набор — «все».
  if (f.maps.size > 0 && !f.maps.has(row.mapId)) return false;
  // Правила 4 и 5: концы ползунка нормализуются, считается вместимость.
  const lo = Math.min(f.players.min, f.players.max);
  const hi = Math.max(f.players.min, f.players.max);
  return row.players.capacity >= lo && row.players.capacity <= hi;
}

/** Ключ хранилища выбора — рядом с `void.server` / `void.nick` (BRW-3). */
export const FILTER_STORE_KEY = 'void.filter';

/** Фильтр «ничего не выбрано»: все режимы, все карты, весь диапазон ленты. */
function defaultFilter(rows: readonly FilterRow[]): FilterState {
  return { mode: 'all', maps: new Set(), players: playerBounds(rows) };
}

/** Привести выбор к сегодняшней ленте (правила 7, 8). */
export function clampFilter(f: FilterState, rows: readonly FilterRow[]): FilterState {
  const known = new Set(mapsOf(rows));
  const bounds = playerBounds(rows);
  const lo = Math.max(bounds.min, Math.min(f.players.min, f.players.max));
  const hi = Math.min(bounds.max, Math.max(f.players.min, f.players.max));
  return {
    mode: f.mode,
    maps: new Set([...f.maps].filter((m) => known.has(m))),
    // Пустое пересечение — не «ничего не подходит», а «выбор устарел»: раскрываем целиком.
    players: lo <= hi ? { min: lo, max: hi } : bounds,
  };
}

/** Выбор → строка для `localStorage` (`Set` в JSON не сериализуется сам). */
export function serializeFilter(f: FilterState): string {
  return JSON.stringify({ mode: f.mode, maps: [...f.maps], players: f.players });
}

/** Строка из `localStorage` → выбор, приведённый к ленте. Любой мусор — умолчание. */
export function restoreFilter(raw: string | null, rows: readonly FilterRow[]): FilterState {
  const base = defaultFilter(rows);
  if (!raw) return base;
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return base;
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) return base;
  const o = parsed as { mode?: unknown; maps?: unknown; players?: unknown };
  const mode: ModeFilter = o.mode === 'pvp' || o.mode === 'pve' ? o.mode : 'all';
  const maps = Array.isArray(o.maps) ? o.maps.filter((m): m is string => typeof m === 'string') : [];
  const p = typeof o.players === 'object' && o.players !== null ? (o.players as Record<string, unknown>) : {};
  const min = typeof p.min === 'number' && Number.isFinite(p.min) ? p.min : base.players.min;
  const max = typeof p.max === 'number' && Number.isFinite(p.max) ? p.max : base.players.max;
  return clampFilter({ mode, maps: new Set(maps), players: { min, max } }, rows);
}
