/**
 * Клиентская очередь стройки: цена головы и приказ, которым она уедет в ядро (REFM-32).
 *
 * Очередь ЛОКАЛЬНА и ядру неизвестна: в сети стройку таймит сервер, а здесь она лишь
 * копится, пока голова не сможет уехать. Отсюда три правила, каждое из которых уже
 * стоило ошибки:
 *
 *  · **очередь ждёт ТОЛЬКО денег** (RULES-4). Единственный код, на котором она держит
 *    голову, — `E_INSUFFICIENT`. Любой другой отказ ожиданием не лечится, и голова
 *    обязана уехать в ядро, где игрок получит НАСТОЯЩУЮ причину вместо молчаливого
 *    зависания. Прежняя проверка «хватает ли по своему прайсу» была fail-OPEN против
 *    инварианта №4: неизвестный id и максимальный уровень давали цену `undefined`, а
 *    «хватает ли на undefined» — да; очередь считала голову готовой и дёргала ядро.
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
import type { BuildKind, BuildLane, PlanetBuildQueue, QueuedBuild } from './buildQueue';

/** Полоса очереди, в которую попадает заказ: юниты отдельно, здания и апгрейды вместе. */
export function laneOf(kind: BuildKind): BuildLane {
  return kind === 'unit' ? 'units' : 'buildings';
}

/** Пустая очередь мира — создаётся по первому обращению. */
export function emptyQueue(): PlanetBuildQueue {
  return { buildings: [], units: [] };
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
 * Цена головы очереди — ДЛЯ ПОКАЗА (строка «⏳ ждём: …»). Решение «пора ли пускать» на
 * неё НЕ опирается: его принимает ядро (см. `waitsForMoney`). `undefined` означает
 * «цену назвать нечем» — например, неизвестный id или уже максимальный уровень.
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

/** Единственный отказ, который лечится ожиданием: очередь копит деньги, и только их. */
export const WAIT_CODE = 'E_INSUFFICIENT';

/**
 * Держать ли голову в очереди по вердикту ядра. `null` (приказ проходит) и любой
 * НЕденежный отказ означают «пускать»: во втором случае игрок увидит настоящую причину
 * от ядра, а не зависшую навсегда очередь.
 */
export function waitsForMoney(verdict: string | null): boolean {
  return verdict === WAIT_CODE;
}
