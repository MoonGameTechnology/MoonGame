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
//
// Так и вышло (сообщение владельца 2026-09-24: «не получается построить»): FORT-5.1 добавил
// в редьюсер ворота технологии, а кнопка о них не знала — горела на неизученной крепости,
// и ядро отвечало «нужна технология». Сторож паритета гонял ядро БЕЗ модуля технологий,
// где ворота всегда открыты, поэтому расхождения не увидел. Теперь ворота здесь — тем же
// списком ядра (`technologiesUnlocking`), а паритет сверяется и с технологиями.
import {
  isStationable,
  STATION_CORE,
  STATION_COST,
  technologiesUnlocking,
} from '../packages/shared-core/src/index';
import type { GameData, Planet, ResourceBag } from '../packages/shared-core/src/index';

/** Почему крепость поставить нельзя. `null` в {@link FortressRaise} — значит можно. */
export type FortressBlock =
  /** Узел не твой: крепость ставится только на ЗАХВАЧЕННОЙ территории. */
  | 'not-owned'
  /** Вид не принимает крепость: там уже мир либо уже крепость. */
  | 'kind'
  /** Крепость не изучена (FORT-5.1): ядро отбивает `E_TECH_LOCKED`. Кнопка есть, но серая
   *  и называет технологию — это не «не место», а «сначала изучи». */
  | 'tech'
  /** Казна не тянет. Кнопка есть, но серая — «подожди и накопи». */
  | 'cost';

export interface FortressRaise {
  /** Показывать ли кнопку вообще. Ложь при `not-owned`/`kind` — не место. */
  show: boolean;
  /** Можно ли нажать. */
  enabled: boolean;
  blocked: FortressBlock | null;
  /** Чем платить — из ядра, а не своей копией числа. */
  cost: ResourceBag;
  /** Технологии, любая из которых открывает крепость, — чтобы назвать её игроку при
   *  `blocked: 'tech'`. Список ядра (`technologiesUnlocking`), а не своя строка. */
  needs: string[];
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
  completed: readonly string[] = [],
): FortressRaise {
  const cost = STATION_COST;
  const locks = technologiesUnlocking(data, 'building', STATION_CORE);
  if (node.owner !== viewerId) return { show: false, enabled: false, blocked: 'not-owned', cost, needs: locks };
  if (!isStationable(data, node)) return { show: false, enabled: false, blocked: 'kind', cost, needs: locks };
  // Ворота технологий — раньше казны: без технологии деньги не помогут, и «накопи» было бы
  // неправдой. Ядро спрашивает тот же список тем же правилом «любая из» (FORT-5.1).
  if (locks.length > 0 && !locks.some((id) => completed.includes(id))) {
    return { show: true, enabled: false, blocked: 'tech', cost, needs: locks };
  }
  const afford = Object.entries(cost).every(([res, need]) => (treasury[res] ?? 0) >= need);
  return { show: true, enabled: afford, blocked: afford ? null : 'cost', cost, needs: locks };
}
