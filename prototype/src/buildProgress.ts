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
import type { GameData, GameState, QueuedConstruction } from '../../packages/shared-core/src/index';
import { acceptedConstructionHours, orderLane } from '../../packages/shared-core/src/index';
import type { ActiveBuild, BuildLane, ConstructionPayload } from './buildQueue';

/** Полезная нагрузка события стройки, если она вообще похожа на неё. */
export function constructionPayload(payload: unknown): ConstructionPayload | null {
  const p = payload as ConstructionPayload;
  return typeof p?.planetId === 'string' ? p : null;
}

/** К какой полосе очереди относится нагрузка: здания или полоса производственной
 *  постройки юнита (BLD-2.1) — по правилу ядра, а не своей копии. */
export function laneOfPayload(p: ConstructionPayload, data: Pick<GameData, 'units'>): BuildLane {
  return orderLane(data, p);
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
  data: Pick<GameData, 'units'>,
): ActiveBuild | null {
  let best: ActiveBuild | null = null;
  for (const event of state.scheduled) {
    if (event.type !== 'construction.complete') continue;
    const payload = constructionPayload(event.payload);
    if (!payload || payload.planetId !== planetId) continue;
    if (laneOfPayload(payload, data) !== lane) continue;
    if (!best || event.at < best.at || (event.at === best.at && event.seq < best.seq)) {
      best = { at: event.at, seq: event.seq, payload };
    }
  }
  return best;
}

/** Идущий и ждущие заказы той полосы мира, куда встанет этот юнит (BLD-2.1): у каждой
 *  производственной постройки своя очередь, и пехоте не впереди крейсер. */
export function unitLaneOrders(
  state: GameState,
  planetId: string,
  unit: string,
  data: Pick<GameData, 'units'>,
): { active: ActiveBuild | null; queued: QueuedConstruction[] } {
  const lane = orderLane(data, { kind: 'unit', unit });
  return {
    active: activeConstruction(state, planetId, lane, data),
    queued: (state.planets[planetId]?.buildQueue ?? []).filter((q) => orderLane(data, q) === lane),
  };
}

/**
 * Принятый срок заказа — из его нагрузки; старое расписание использует базовый
 * срок каталога и свой общий множитель часов. Неизвестное — ноль, то есть «готово».
 */
export function buildDurationHours(
  p: ConstructionPayload,
  data: GameData,
  match: Pick<GameState, 'pricing'> = {},
): number {
  return acceptedConstructionHours(match, data, p);
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
  match: Pick<GameState, 'pricing'> = {},
): number {
  return barPct(active.at, buildDurationHours(active.payload, data, match) * hourMs, now);
}

/**
 * Та же полоса, но от ГОТОВЫХ чисел «когда закончится» и «сколько всего длится» —
 * живой патчер боковой панели держит их в data-атрибутах и своей копии формулы иметь
 * не должен (REFM-77). Длительности нет (ноль, минус, NaN) — «готово», а не NaN в
 * ширине элемента.
 */
export function barPct(at: number, dur: number, now: number): number {
  if (!(dur > 0)) return 100;
  return Math.max(0, Math.min(100, 100 - ((at - now) / dur) * 100));
}

/** Остаток до завершения в игровых часах (никогда не отрицательный). */
export function hoursLeft(at: number, now: number, hourMs: number): number {
  return Math.max(0, (at - now) / hourMs);
}
