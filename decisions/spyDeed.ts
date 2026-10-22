/**
 * Итог саботажа и кражи ресурсов для журнала исполнителя (SPY-9). Само правило — что
 * сломать и сколько унести — в ядре (`espionageModule`, событие `espionage.succeeded`);
 * здесь только какую строку показать.
 *
 * 1. **Саботаж называет число.** Сколько построек повреждено и сколько из них снесено;
 *    ломать было нечего — отдельная строка, а не «повреждено 0».
 * 2. **Кража называет добычу.** Ресурс и сколько; пустая казна — отдельная строка.
 * 3. **Гибель агента не прячется.** Убитый агент — флаг `lost`, хост добавляет строку
 *    о поиске нового шпиона.
 */

/** Что ядро кладёт в `espionage.succeeded`. */
export interface SpyDeedPayload {
  kind?: unknown;
  hits?: unknown;
  loot?: unknown;
  agentLost?: unknown;
}

/** Ключ строки журнала и её подстановки (без `at` — имя мира подставляет хост). */
export interface SpyDeedLine {
  key: string;
  params: Record<string, number | string>;
  lost: boolean;
}

/** Правила 1–3. `null` — событие не саботаж и не кража. */
export function spyDeed(p: SpyDeedPayload): SpyDeedLine | null {
  const lost = p.agentLost === true;
  if (p.kind === 'sabotage') {
    const hits = Array.isArray(p.hits) ? (p.hits as { destroyed?: unknown }[]) : [];
    if (hits.length === 0) return { key: 'log.spy.sabotage.none', params: {}, lost };
    const d = hits.filter((h) => h?.destroyed === true).length;
    return { key: 'log.spy.sabotage', params: { n: hits.length, d }, lost };
  }
  if (p.kind === 'theft') {
    const loot = p.loot as { resource?: unknown; amount?: unknown } | null | undefined;
    if (!loot || typeof loot.resource !== 'string' || typeof loot.amount !== 'number') {
      return { key: 'log.spy.theft.none', params: {}, lost };
    }
    return { key: 'log.spy.theft', params: { res: loot.resource, amount: loot.amount }, lost };
  }
  return null;
}
