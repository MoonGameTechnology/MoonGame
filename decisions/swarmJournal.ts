/**
 * Журнал адаптаций — три уровня уверенности (PVR-4.5, правило §3.4).
 *
 * Чистое решение обоих клиентов: из того, что игрок НАБЛЮДАЛ, собирает строки и метит
 * каждую уверенностью. Без этого разделения игрок читает адаптацию как читерство ИИ —
 * «враг вдруг стал сильнее», без объяснения, чем это подтверждено.
 *
 * Три уровня — и ни один не заглядывает в состояние Роя:
 *
 *  · `fact` — игрок сам видел, как его удар отразили. Дата и число вылетов — его
 *    собственные замеры.
 *  · `hypothesis` — урон ПВО в последнем отражении выше, чем в первом. Это СРАВНЕНИЕ
 *    двух наблюдений игрока, а не уровень модуля: уровень клиенту не отдаётся вовсе.
 *  · `unknown` — отражений не было. Честное «не разведано» вместо выдуманного процента
 *    (§3.4: «Неизвестно» лучше выдуманного точного процента).
 *
 * Ни DOM, ни хранилища, ни текста — только ключи (`/decisions/README.md`).
 */
import type { SwarmRepelRecord } from '../packages/shared-core/src/index';

export type JournalTier = 'fact' | 'hypothesis' | 'unknown';

export interface JournalRow {
  tier: JournalTier;
  /** Ключ подписи. Текст — в `/localization`. */
  key: string;
  /** Подстановки для подписи (число вылетов, время первого контакта). */
  vars?: Record<string, number>;
}

/**
 * Строки журнала по наблюдениям игрока.
 *
 * Порядок фиксирован: факт, затем гипотеза. Он не меняется от данных, потому что
 * порядок строк — это тоже интерфейс: журнал перечитывают после каждого боя, и
 * переставленная строка читается как новая.
 */
export function swarmJournal(seen: SwarmRepelRecord | undefined): JournalRow[] {
  if (!seen || seen.sorties <= 0) return [{ tier: 'unknown', key: 'swarm.journal.unknown' }];
  const rows: JournalRow[] = [
    { tier: 'fact', key: 'swarm.journal.intercept', vars: { n: seen.sorties, at: seen.firstAt } },
  ];
  // Строго больше: равный урон это не «усилился», а «тот же самый», и объявлять
  // гипотезу на нём значило бы кричать при каждом втором вылете.
  if (seen.lastDamage > seen.firstDamage) {
    rows.push({
      tier: 'hypothesis',
      key: 'swarm.journal.stronger',
      vars: { from: seen.firstDamage, to: seen.lastDamage },
    });
  }
  return rows;
}
