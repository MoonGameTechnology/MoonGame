/**
 * Заказ стройки: цена ждущего заказа для подписи и приказ, которым он уедет в ядро
 * (REFM-32).
 *
 * **Очередь больше не клиентская.** До BLD-1 она копилась здесь и ядру была неизвестна —
 * оттого в сети каждый тап заводил ЕЩЁ ОДНУ параллельную стройку, а экран показывал одну.
 * Теперь очередь живёт в состоянии мира (`planet.buildQueue`, `shared-core/modules/
 * construction.ts`), одна на соло и на сеть; туда же уехало правило «ждать только денег»
 * — держит голову ядро, а не клиент. Здесь осталось то, чем файл и был по существу:
 * ЦЕНА для подписи и ПОСТРОИТЕЛЬ приказа.
 *
 * Отсюда два правила, каждое из которых уже стоило ошибки:
 *
 *  · **цена юнита масштабируется на количество.** Ядро умножает цену на `count`
 *    (`scaleCost`), поэтому и подпись обязана: иначе очередь из пяти корветов
 *    показывала бы цену одного.
 *  · **у апгрейда индекс смещён на ОДИН, а не на два.** Здесь известен ТЕКУЩИЙ уровень
 *    постройки, и цена перехода с него лежит в `upgrades[level - 1]`. (В расчёте
 *    длительности, `buildProgress.ts`, известен ЦЕЛЕВОЙ уровень — там `level - 2`.
 *    Два соседних смещения на единицу, и оба легко перепутать.)
 */
import type { Action, GameData, GameState } from '../../packages/shared-core/src/index';
import { buildBuilding, buildUnit, upgradeBuilding } from './game';
import type { BuildKind, BuildLane, QueuedBuild } from './buildQueue';

/** Полоса очереди, в которую попадает заказ: юниты отдельно, здания и апгрейды вместе. */
export function laneOf(kind: BuildKind): BuildLane {
  return kind === 'unit' ? 'units' : 'buildings';
}


/** Хватает ли казны на мешок цен. Пустой мешок — хватает (платить нечего). */
export function afford(
  res: Record<string, number>,
  bag: Record<string, number> | undefined,
): boolean {
  for (const [r, n] of Object.entries(bag ?? {})) if ((res[r] ?? 0) < n) return false;
  return true;
}

/**
 * Цена ждущего заказа — ДЛЯ ПОКАЗА (строка «⏳ ждём: …»). Решение «пора ли пускать» на
 * неё НЕ опирается: его принимает ядро, у себя в очереди. `undefined` означает «цену
 * назвать нечем» — например, неизвестный id или уже максимальный уровень.
 */
export function queuedCost(
  state: GameState,
  data: GameData,
  planetId: string,
  q: QueuedBuild,
): Record<string, number> | undefined {
  if (q.kind === 'unit') {
    const per = data.units[q.id]?.cost;
    if (!per) return undefined;
    const n = q.count ?? 1;
    return n === 1 ? per : Object.fromEntries(Object.entries(per).map(([r, v]) => [r, v * n]));
  }
  if (q.kind === 'building') return data.buildings[q.id]?.cost;
  // Апгрейд: цена перехода с ТЕКУЩЕГО уровня постройки (см. шапку про смещение).
  const inst = state.planets[planetId]?.buildings.find((b) => b.type === q.id);
  return inst ? data.buildings[q.id]?.upgrades[inst.level - 1]?.cost : undefined;
}

/**
 * Приказ, которым голова очереди уедет в ядро. ОДИН построитель и на вопрос «можно ли
 * уже», и на само применение: иначе спрашивали бы про одно, а издавали другое.
 */
export function queuedAction(me: string, planetId: string, q: QueuedBuild): Action {
  return q.kind === 'unit'
    ? buildUnit(me, planetId, q.id, q.count)
    : q.kind === 'upgrade'
      ? upgradeBuilding(me, planetId, q.id)
      : buildBuilding(me, planetId, q.id);
}
