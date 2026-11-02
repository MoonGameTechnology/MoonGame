/**
 * Таймер бомбардировки для карты, окна мира и метки флота: через сколько ударит следующий
 * залп обстрела. Правила — в `decisions/bombardTimer.ts`; здесь только выбор флотов.
 *
 * Залп бьёт по часам флота (`Fleet.bombardNextAt`, модуль `orbital`), поэтому отсчёт —
 * простое чтение мира: ни прогноза урона, ни кэша.
 */
import { bombardersOf, type Fleet, type GameState } from '../../packages/shared-core/src/index';
import { bombardTimerShown, nextVolleyIn } from '../../decisions/bombardTimer';
import { data } from './gameData';

/** Флоты, которые сейчас обстреливают мир, если смотрящий — сторона обстрела. */
function shownBombarders(s: GameState, planetId: string, me: string): Fleet[] | null {
  const p = s.planets[planetId];
  if (!p) return null;
  const fleets = bombardersOf(s, p.id, data);
  if (fleets.length === 0) return null;
  return bombardTimerShown(
    me,
    p.owner,
    fleets.map((f) => f.owner),
  )
    ? fleets
    : null;
}

/** Мс мира до ближайшего залпа по миру `planetId`, или `null`, если таймера нет. */
export function bombardVolleyIn(s: GameState, planetId: string, me: string): number | null {
  const fleets = shownBombarders(s, planetId, me);
  return fleets
    ? nextVolleyIn(
        fleets.map((f) => f.bombardNextAt),
        s.time,
      )
    : null;
}

/** Мс мира до следующего залпа этого флота — только пока он и правда обстреливает мир. */
export function fleetVolleyIn(s: GameState, f: Fleet, me: string): number | null {
  if (!f.bombarding || !f.location) return null;
  const fleets = shownBombarders(s, f.location, me);
  return fleets?.some((g) => g.id === f.id) ? nextVolleyIn([f.bombardNextAt], s.time) : null;
}

/** Миры с таймером для карты: где обстреливает мой флот или обстреливают мой мир. */
export function bombardVolleys(
  s: GameState,
  me: string,
): Array<{ planetId: string; leftMs: number; mine: boolean }> {
  const seen = new Set<string>();
  const out: Array<{ planetId: string; leftMs: number; mine: boolean }> = [];
  // Каждый кадр карты: обход без копии массива, дешёвый отсев до правила ядра — флаг
  // обстрела стоит у считанных флотов.
  for (const id in s.fleets) {
    const f = s.fleets[id]!;
    if (!f.bombarding || !f.location || seen.has(f.location)) continue;
    const p = s.planets[f.location];
    if (!p || (f.owner !== me && p.owner !== me)) continue;
    seen.add(f.location);
    const leftMs = bombardVolleyIn(s, f.location, me);
    if (leftMs !== null) out.push({ planetId: f.location, leftMs, mine: p.owner === me });
  }
  return out.sort((a, b) => (a.planetId < b.planetId ? -1 : 1));
}
