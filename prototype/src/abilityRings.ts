/**
 * ABIL-RING — радиусы способностей героя на карте, одной чистой моделью.
 *
 * Способность, у которой есть `radius`, действует не «примерно вокруг героя», а по
 * ровной окружности, и игрок обязан видеть ту же границу, по которой считает ядро.
 * До сих пор такой круг рисовался ТОЛЬКО во время прицеливания — а уже наложенная аура
 * (rally / bulwark, 2 часа) и висящий скан не показывались никак: бонус шёл, увидеть
 * его край было нельзя.
 *
 * Здесь только арифметика — где и какого размера круги. Цвет, пунктир и сам холст
 * остаются у хозяина, а положение героя приходит колбэками: оно зависит от живой
 * интерполяции флота, которая живёт в `main.ts`.
 *
 * Два честных правила, ради которых модель отдельная:
 *
 *  1. **Только СВОИ.** Чужие ауры в проекции тумана игроку не приходят, и рисовать их
 *     было бы выдумкой. `state.heroes` у зрителя содержит только его героев.
 *  2. **Только ЖИВЫЕ.** Срок хранится в `until` (мс игрового времени); просроченный
 *     круг обязан исчезнуть в тот же кадр, а не висеть до следующего каста.
 */
import type { GameState } from '../../packages/shared-core/src/index';

export type AbilityRingKind = 'aura' | 'reveal';

/** Один круг: центр в МИРОВЫХ координатах, радиус в тех же единицах, что в данных. */
export interface AbilityRing {
  x: number;
  y: number;
  radius: number;
  kind: AbilityRingKind;
}

/** Как модель узнаёт, где что стоит. Обе функции возвращают `null`, если позиции нет
 *  (герой в резерве, узел ещё не известен) — такой круг просто не рисуется. */
export interface RingAnchors {
  /** Мировая позиция героя (его корабля), или `null` — герой не развёрнут. */
  hero(heroId: string): { x: number; y: number } | null;
  /** Мировая позиция узла карты, или `null` — узел неизвестен. */
  node(planetId: string): { x: number; y: number } | null;
}

/**
 * Круги способностей моих героев на момент `now`. Порядок детерминирован (герои по
 * отсортированному id, эффекты — в порядке хранения), чтобы кадр не мерцал при
 * перерисовке и снимок экрана был воспроизводим.
 */
export function abilityRings(
  state: Pick<GameState, 'heroes'>,
  me: string,
  now: number,
  at: RingAnchors,
): AbilityRing[] {
  const heroes = state.heroes;
  if (!heroes) return [];
  const out: AbilityRing[] = [];
  for (const heroId of Object.keys(heroes).sort()) {
    const hero = heroes[heroId]!;
    if (hero.owner !== me || hero.alive !== true) continue;
    // Аура следует за героем: её центр — там, где он сейчас, а не где её наложили.
    const live = (hero.activeAuras ?? []).filter((a) => a.until > now && a.radius > 0);
    if (live.length) {
      const p = at.hero(heroId);
      if (p) for (const a of live) out.push({ x: p.x, y: p.y, radius: a.radius, kind: 'aura' });
    }
    // Скан, наоборот, прибит к узлу, над которым его бросили, и за героем не ходит.
    for (const r of hero.activeReveals ?? []) {
      if (r.until <= now || r.radius <= 0) continue;
      const p = at.node(r.center);
      if (p) out.push({ x: p.x, y: p.y, radius: r.radius, kind: 'reveal' });
    }
  }
  return out;
}
