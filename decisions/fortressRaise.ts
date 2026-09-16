// FORT-0.2: МОЖНО ЛИ ПОСТАВИТЬ ЗДЕСЬ КОСМИЧЕСКУЮ КРЕПОСТЬ — и если нет, то почему.
//
// ЗАЧЕМ ОТДЕЛЬНЫЙ МОДУЛЬ, А НЕ `if` В ПАНЕЛИ. Правило кнопки обязано быть ТЕМ ЖЕ, что
// правило редьюсера, иначе интерфейс начинает обещать то, что сервер отклоняет. В этом
// репозитории такое уже случалось и записано прямо в `main.ts`: три собственных
// `?? BUILDABLE` развели клиентский гейт стройки с данными (ORB-4), и кнопка звала строить
// там, где ядро отвечало отказом. Поэтому здесь НЕ переписывается ни одна проверка —
// `isStationable` и `STATION_COST` берутся у ядра, а клиентского своего тут только одно:
// перевод отказа в причину, которую можно показать игроку.
//
// Лежит в `/decisions`, а не в `prototype/src`, по правилу CLAUDE.md: кнопку рисуют оба
// клиента, и собери каждый своё правило — они разойдутся, причём молча.
import { isStationable, STATION_COST } from '../packages/shared-core/src/index';
import type { GameData, Planet, ResourceBag } from '../packages/shared-core/src/index';

/** Почему крепость поставить нельзя. `null` в {@link FortressRaise} — значит можно. */
export type FortressBlock =
  /** Узел не твой: крепость ставится только на ЗАХВАЧЕННОЙ территории. */
  | 'not-owned'
  /** Вид не принимает крепость: там уже мир либо уже крепость. */
  | 'kind'
  /** Казна не тянет. ЕДИНСТВЕННАЯ причина, которую стоит показывать кнопкой-калекой:
   *  остальные две значат «кнопки тут вообще быть не должно». */
  | 'cost';

export interface FortressRaise {
  /** Показывать ли кнопку вообще. Ложь при `not-owned`/`kind` — не место. */
  show: boolean;
  /** Можно ли нажать. */
  enabled: boolean;
  blocked: FortressBlock | null;
  /** Чем платить — из ядра, а не своей копией числа. */
  cost: ResourceBag;
}

/**
 * Решение по одному узлу. `treasury` — казна игрока (та же форма, что `Player.resources`).
 *
 * Разделение `show` и `enabled` содержательное, а не косметическое: «сюда крепость не
 * ставят» и «денег не хватило» — разные сообщения игроку. Первое значит «смотри в другое
 * место», второе — «подожди и накопи», и кнопка-калека со вторым полезна, а с первым
 * была бы мусором в панели.
 */
export function fortressRaise(
  node: Pick<Planet, 'kind' | 'owner'>,
  viewerId: string,
  treasury: ResourceBag,
  data: GameData,
): FortressRaise {
  const cost = STATION_COST;
  if (node.owner !== viewerId) return { show: false, enabled: false, blocked: 'not-owned', cost };
  if (!isStationable(data, node)) return { show: false, enabled: false, blocked: 'kind', cost };
  const afford = Object.entries(cost).every(([res, need]) => (treasury[res] ?? 0) >= need);
  return { show: true, enabled: afford, blocked: afford ? null : 'cost', cost };
}
