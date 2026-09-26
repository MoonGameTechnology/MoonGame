/**
 * Осады «Поглощения мира» над мирами игрока — что рисовать таймером на карте (PVR-4.7;
 * резолюция владельца 2026-09-25: «Поглощение после 4 ч осады»: «над осаждённым миром висит
 * таймер. За 4 часа игрок успевает ударить по Левиафану или сорвать осаду»).
 *
 * Осада живёт у героя (`Hero.siege`, модуль героев): мир погибнет в `until`, если флот героя
 * всё это время бомбардировал его. Здесь — только ответ для карты:
 *
 * 1. **Только миры зрителя.** Таймер — предупреждение «твой мир погибнет», и нужен он тому,
 *    чей мир под осадой. Чужие осады игроку не рисуются: мир Роя или соседа он не спасает.
 * 2. **Мёртвый герой осады не ведёт.** Смерть снимает запись в ядре сразу же; проверка здесь
 *    держит карту честной и на снимке, где запись ещё не успела уйти.
 * 3. **Отсчёт не уходит в минус**, доля пройденного — в [0, 1]: между сроком и его обработкой
 *    миром остаток отрицателен, игроку показывают ноль — «вот-вот».
 * 4. **Порядок — по сроку**, ближайшая гибель первой; равные сроки — по id мира. Так карта и
 *    любой список осад не зависят от раскладки объекта героев.
 */
import type { GameState, PlanetId, PlayerId } from '../packages/shared-core/src/index';

export interface DevourSiegeMark {
  /** Осаждённый мир. */
  target: PlanetId;
  /** Архетип героя (`data.heroes`) — по нему строится имя в тексте. */
  archetype: string | undefined;
  /** Сколько мира осталось до гибели, мс времени мира (правило 3). */
  leftMs: number;
  /** Доля осады, которую уже выдержали, 0..1 (правило 3). */
  progress: number;
}

export function devourSieges(state: GameState, viewer: PlayerId): DevourSiegeMark[] {
  const marks: DevourSiegeMark[] = [];
  for (const hero of Object.values(state.heroes ?? {})) {
    const siege = hero.siege;
    if (!siege || hero.alive === false || siege.victim !== viewer) continue; // правила 1–2
    const span = siege.until - siege.since;
    const leftMs = Math.max(0, siege.until - state.time);
    marks.push({
      target: siege.target,
      archetype: hero.archetype,
      leftMs,
      progress: span > 0 ? Math.min(1, Math.max(0, 1 - leftMs / span)) : 1,
    });
  }
  return marks.sort((a, b) => a.leftMs - b.leftMs || (a.target < b.target ? -1 : a.target > b.target ? 1 : 0));
}
