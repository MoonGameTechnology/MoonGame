import type { GameState } from '../packages/shared-core/src/index';
import { observedSwarm } from '../packages/shared-core/src/state/swarmIntel';

/** Caller supplies resolved sight, never coarse radar coverage. Hidden live fleets
 * must not influence either the remembered composition or its status. */
export function swarmDossier(state: GameState, viewer: string, identified: ReadonlySet<string>) {
  const current = observedSwarm(state, viewer, identified);
  const contacts = { ...state.swarmIntel?.[viewer], ...current };
  return Object.keys(contacts).sort().map(id => ({
    id, ...contacts[id]!, live: Object.hasOwn(current, id),
  }));
}

/**
 * Сводка досье одной строкой — она же видна, когда досье СВЁРНУТО (заказ владельца
 * 2026-09-23: «досье Роя можно свернуть»). Свёрнутая панель обязана отвечать на главный
 * вопрос без раскрытия: сколько сил Роя мы знаем и сколько из них видно прямо сейчас.
 */
export function swarmDossierSummary(contacts: ReadonlyArray<{ live: boolean }>): {
  seen: number;
  live: number;
} {
  return { seen: contacts.length, live: contacts.filter((c) => c.live).length };
}

/**
 * Порядок карточек сил: сначала то, что на радаре СЕЙЧАС, затем по свежести последнего
 * наблюдения, при равенстве — по id (детерминированно, чтобы карточки не прыгали между
 * кадрами). Раньше порядок был алфавитным по id флота — то есть случайным для игрока:
 * свежая угроза могла оказаться в самом низу под давно ушедшим отрядом.
 */
export function orderContacts<T extends { id: string; live: boolean; at: number }>(
  contacts: readonly T[],
): T[] {
  return [...contacts].sort(
    (a, b) =>
      Number(b.live) - Number(a.live) || b.at - a.at || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0),
  );
}
