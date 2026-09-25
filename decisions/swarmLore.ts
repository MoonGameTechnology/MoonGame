/**
 * Что игрок знает о природе Роя (решение владельца 2026-09-24: «на первой миссии в досье о
 * Рое не должно быть информации — её расскажет учёный после прохождения первой миссии»).
 *
 * Досье в забеге есть с самого начала, но раздела «О Рое» в первой главе нет: сводка,
 * журнал адаптаций и силы — это то, что игрок видит сам, а природу Роя ему рассказывают.
 * Рассказывает учёный в комиксе конца главы I (`chapterComics.ts`, момент `outro`); его
 * реплики — ровно те подписи, что стояли в разделе, {@link SWARM_LORE_KEYS}. Раздел
 * открывается первой пройденной главой — даже если арта комикса ещё нет, знание не
 * должно зависеть от картинки.
 *
 * Вне Sector Zero (обычная PvE-партия) рассказчика нет, и раздел виден всегда.
 */
import type { SectorZeroProgress } from './sectorZeroProgress';

/** Подписи раздела «О Рое» — они же реплики учёного в комиксе конца главы I. */
export const SWARM_LORE_KEYS = [
  'swarm.intel.lore',
  'swarm.intel.network',
  'swarm.intel.economy',
  'swarm.intel.brood',
  'swarm.brood.desc',
] as const;

/** Показывать ли раздел «О Рое». `run` — идёт ли забег Sector Zero. */
export function swarmLoreKnown(
  progress: Pick<SectorZeroProgress, 'chaptersWon'>,
  run: boolean,
): boolean {
  return !run || progress.chaptersWon.length > 0;
}
