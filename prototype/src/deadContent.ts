/**
 * Диагноз «мёртвого контента» для харнеса замера (AI-BAL-10).
 *
 * Ноль построек за прогон — это симптом, а не диагноз, и лечится он по-разному:
 *
 *   • **вне репертуара бота** — сущности нет в исходнике `ai.ts`, бот её не заказывает
 *     никогда. Это сигнал про ПРИБОР: `radar` обслуживает туман, который
 *     тест-бот не читает (он видит состояние целиком), `starfort` без гарнизона ничего не
 *     держит. Балансной правкой такое «чинить» — значит крутить числа у того, что в
 *     измерении даже не участвует.
 *   • **умеет, но ни разу не заказал** — сущность в исходнике есть, условие постройки не
 *     наступило ни разу. Вот это уже сигнал про БАЛАНС: условие недостижимо, и чинить надо
 *     контент, а не бота. Показательна история `farm`/`power_plant`: бот поднимает их при
 *     отрицательном потоке еды/энергии, и пока `upkeep` считался в другой шкале, чем доход,
 *     дефицит был физически недостижим — обе постройки числились мёртвыми. BAL-3 привёл
 *     шкалы к одной, и они ожили (0 → 14/12 и 0 → 3/4 за 300 матчей). Ровно этот диагноз
 *     категория и должна была подсказать — а прежняя общая строка его прятала.
 *
 * Признак — упоминание id СТРОКОВЫМ ЛИТЕРАЛОМ в исходнике бота: `'radar'` или `"radar"`.
 * Именно литералом, а не подстрокой: `mine` встречается внутри `metal_mine` и `determine`,
 * и без границ по кавычкам признак объявил бы «в репертуаре» кого попало. Читаем сырой
 * текст, а не AST, — того же рода проверка, что и в `aiProfile.test.ts`: утверждение о
 * боте берётся из бота, поэтому не может разъехаться с ним молча.
 *
 * Функция ЧИСТАЯ и исходник принимает строкой: `prototype/src/**` собирается в браузерный
 * бандл, и `node:fs` здесь означал бы сломанную сборку клиента. Файл читает вызывающий —
 * харнес (`selfplay.mjs`) и тест.
 */
import type { GameData } from '../../packages/shared-core/src/index';

export interface DeadContentSplit {
  /** Бот не заказывает это никогда — прибор не покрывает механику. */
  offRepertoire: string[];
  /** Бот умеет, но условие не наступило ни разу — это про баланс. */
  unbuilt: string[];
}

/** Entries eligible for the harness's construction-usage diagnosis. Retired
 * buildings remain in saved worlds, but new orders are forbidden by design and
 * zero usage must not be reported as a balance or bot-coverage failure. Unit ids
 * stay eligible even if a retired building happens to share their identifier. */
export function deadContentCandidates(data: Pick<GameData, 'units' | 'buildings'>): string[] {
  return [
    ...new Set([
      ...Object.keys(data.units),
      ...Object.keys(data.buildings).filter((id) => !data.buildings[id]?.retired),
    ]),
  ];
}

/** Экранирование id для регулярного выражения: id приходят из данных, а не из кода. */
const escape = (id: string): string => id.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

export function splitDeadContent(ids: readonly string[], botSource: string): DeadContentSplit {
  const split: DeadContentSplit = { offRepertoire: [], unbuilt: [] };
  for (const id of ids) {
    const mentioned = new RegExp(`['"]${escape(id)}['"]`).test(botSource);
    (mentioned ? split.unbuilt : split.offRepertoire).push(id);
  }
  return split;
}
