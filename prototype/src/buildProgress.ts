/**
 * Ход стройки: что строится ПРЯМО СЕЙЧАС и насколько оно продвинулось (REFM-31).
 *
 * Источник истины — расписание ядра (`state.scheduled`): каждая стройка живёт там
 * будущим событием `construction.complete`. Клиент ничего не досчитывает сам, он лишь
 * выбирает голову и переводит её в проценты.
 *
 * Три правила, которые стоит проверять тестом, а не глазами:
 *
 *  · **голова выбирается по паре `(at, seq)`, а не по времени.** Две стройки, назначенные
 *    на один игровой миг, различает только порядковый номер события — без него «текущей»
 *    оказывалась бы то одна, то другая, и полоса прогресса прыгала бы между ними.
 *  · **уровни апгрейда смещены на два.** `upgrades[0]` — это переход на УРОВЕНЬ 2,
 *    поэтому длительность апгрейда на уровень L лежит в `upgrades[L - 2]`. Ошибка на
 *    единицу здесь даёт не падение, а тихо неверную полосу.
 *  · **нулевая длительность — это «готово», а не деление на ноль.** Данные могут не
 *    назвать время стройки; полоса обязана показать 100%, а не NaN.
 */
import type { GameData, GameState } from '../../packages/shared-core/src/index';
import type { ActiveBuild, BuildLane, ConstructionPayload } from './buildQueue';

/** Полезная нагрузка события стройки, если она вообще похожа на неё. */
export function constructionPayload(payload: unknown): ConstructionPayload | null {
  const p = payload as ConstructionPayload;
  return typeof p?.planetId === 'string' ? p : null;
}

/** К какой полосе очереди относится нагрузка: юниты и всё остальное (здания). */
export function laneOfPayload(p: ConstructionPayload): BuildLane {
  return p.kind === 'unit' ? 'units' : 'buildings';
}

/**
 * Стройка, идущая на этом мире в этой полосе прямо сейчас: ближайшее по времени
 * событие завершения, а при равенстве времён — с меньшим порядковым номером (`seq`).
 * Пара `(at, seq)` — тот же порядок, в котором ядро исполняет расписание, поэтому
 * «текущая» стройка у клиента и у ядра всегда одна и та же.
 */
export function activeConstruction(
  state: GameState,
  planetId: string,
  lane: BuildLane,
): ActiveBuild | null {
  let best: ActiveBuild | null = null;
  for (const event of state.scheduled) {
    if (event.type !== 'construction.complete') continue;
    const payload = constructionPayload(event.payload);
    if (!payload || payload.planetId !== planetId) continue;
    if (laneOfPayload(payload) !== lane) continue;
    if (!best || event.at < best.at || (event.at === best.at && event.seq < best.seq)) {
      best = { at: event.at, seq: event.seq, payload };
    }
  }
  return best;
}

/**
 * Сколько часов занимает эта стройка по данным. Апгрейд на уровень L берёт
 * `upgrades[L - 2]`: нулевой элемент описывает переход на второй уровень (см. шапку).
 * Неизвестное — ноль часов, и полоса честно покажет «готово».
 */
export function buildDurationHours(p: ConstructionPayload, data: GameData): number {
  if (p.kind === 'unit' && p.unit) return data.units[p.unit]?.buildTimeHours ?? 0;
  if (p.kind === 'upgrade' && p.building && typeof p.level === 'number') {
    return data.buildings[p.building]?.upgrades[p.level - 2]?.buildTimeHours ?? 0;
  }
  if (p.building) return data.buildings[p.building]?.buildTimeHours ?? 0;
  return 0;
}

/**
 * Насколько стройка продвинулась, 0..100. Считается от ОСТАТКА до завершения, потому
 * что расписание хранит именно момент конца; начало восстанавливается вычитанием
 * длительности. Значение зажато в границы: подвинувшиеся часы (сеть отдала снимок из
 * прошлого) не должны рисовать отрицательную или переполненную полосу.
 */
export function progressPct(
  active: ActiveBuild,
  now: number,
  data: GameData,
  hourMs: number,
): number {
  const duration = buildDurationHours(active.payload, data) * hourMs;
  if (duration <= 0) return 100; // длительности нет — показываем «готово», а не NaN
  return Math.max(0, Math.min(100, 100 - ((active.at - now) / duration) * 100));
}

/** Остаток до завершения в игровых часах (никогда не отрицательный). */
export function hoursLeft(at: number, now: number, hourMs: number): number {
  return Math.max(0, (at - now) / hourMs);
}
