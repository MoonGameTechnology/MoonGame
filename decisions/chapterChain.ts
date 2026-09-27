/**
 * Главная цепочка главы IV (`docs/sector-zero-map-concepts.md` §6.1, кирпич PVR-7.5):
 * **связь с союзником → архив → извлечение накопителя → доставка в зону вывода**. Это не
 * дополнительные задачи пула: цепочка решает исход главы, поэтому показывается отдельно от
 * них и ничего не платит.
 *
 * Чистое решение для панели задач, чипа и меток: шаги, какой из них текущий, куда вести
 * камеру и сколько сделано. Мир без сценария (главы I–III, партия) цепочки не имеет — `null`.
 */
import type { GameState, PlayerId } from '../packages/shared-core/src/index';
import { contactedAllies, getStance } from '../packages/shared-core/src/index';

export type ChapterStepId = 'contact' | 'archive' | 'extract' | 'deliver';

export interface ChapterStep {
  id: ChapterStepId;
  /** Ключ подписи шага: `chain.<id>`. */
  key: string;
  done: boolean;
  /** Текущий шаг — первый невыполненный. */
  active: boolean;
  /** Куда вести камеру: провинция цели шага. */
  target?: string;
  /** Доля работы (извлечение), 0…1. */
  progress?: number;
}

/** Место встречи этого мира (первое по id — карта объявляет одно). */
export function rendezvousOf(state: GameState): { at: string; ally: PlayerId } | null {
  for (const id of Object.keys(state.planets).sort()) {
    const ally = state.planets[id]!.rendezvous;
    if (ally) return { at: id, ally };
  }
  return null;
}

/**
 * Цепочка главы глазами игрока `me`. `needMs` — сколько работы нужно на извлечение в мс
 * матча (`extractionNeedMs` ядра: часы карты под темп): решение не знает темпа само.
 */
export function chapterChain(state: GameState, me: PlayerId, needMs: number): ChapterStep[] | null {
  const meet = rendezvousOf(state);
  const ex = state.extraction;
  if (!meet && !ex) return null;
  const steps: Omit<ChapterStep, 'active'>[] = [];
  if (meet) {
    steps.push({
      id: 'contact',
      key: 'chain.contact',
      done: contactedAllies(state, me).includes(meet.ally),
      target: meet.at,
    });
  }
  if (ex) {
    const owner = state.planets[ex.vault]?.owner ?? null;
    const cleared =
      ex.carrier !== undefined ||
      owner === null ||
      owner === me ||
      getStance(state, me, owner) === 'alliance';
    steps.push({ id: 'archive', key: 'chain.archive', done: cleared, target: ex.vault });
    const carried = ex.carrier !== undefined;
    steps.push({
      id: 'extract',
      key: 'chain.extract',
      done: carried,
      target: ex.vault,
      progress: carried ? 1 : needMs > 0 ? Math.min(1, ex.doneMs / needMs) : 0,
    });
    const carrierAt = ex.carrier ? (state.fleets[ex.carrier]?.location ?? undefined) : undefined;
    steps.push({
      id: 'deliver',
      key: 'chain.deliver',
      done: ex.deliveredAt !== undefined,
      // Пока носителя нет — зона вывода; есть — сам носитель (где он сейчас стоит).
      target: carrierAt ?? ex.zone,
    });
  }
  const firstOpen = steps.findIndex((st) => !st.done);
  return steps.map((st, i) => ({ ...st, active: i === firstOpen }));
}

/**
 * Какими флотами игрок может начать извлечение прямо сейчас: свои, стоят у архива, не в
 * пути и не в бою, с живым кораблём. Правила того же порядка, что у ядра
 * (`extraction.start`), — окончательный ответ даёт оно, здесь только кандидаты для кнопки.
 */
export function extractionCandidates(state: GameState, me: PlayerId): string[] {
  const ex = state.extraction;
  if (!ex || ex.carrier !== undefined || ex.deliveredAt !== undefined || ex.lostAt !== undefined)
    return [];
  return Object.values(state.fleets)
    .filter((f) => f.owner === me && f.location === ex.vault && !f.movement && !f.battleId)
    .filter((f) => f.units.some((u) => u.count > 0))
    .map((f) => f.id)
    .sort();
}
