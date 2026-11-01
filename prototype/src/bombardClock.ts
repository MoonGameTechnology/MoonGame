/**
 * Таймер бомбардировки для карты, окна мира и метки флота: когда рухнет следующая
 * постройка мира под обстрелом. Правила — в `decisions/bombardTimer.ts`; здесь только
 * скорость обстрела и её кэш.
 *
 * Скорость — урон после хуков ядра: `fleetBombardPower` каждого обстреливающего флота,
 * пропущенный через те же конвейеры, что и сам обстрел (`damageHookQueries` →
 * `traceHooks`). Своей таблицы бонусов здесь нет, поэтому таймер не разойдётся с уроном.
 *
 * `traceHooks` копирует мир целиком, а на большой карте это дорого для слабого телефона.
 * Поэтому скорость кэшируется по миру: пересчёт — когда сменился состав обстрела (флоты,
 * их корпуса, постройки мира, хозяин) и не чаще раза в {@link RATE_TTL_MS} без перемен
 * (на случай новой технологии). Сам отсчёт живой: делит текущую прочность постройки на
 * сохранённую скорость, поэтому идёт каждую секунду без пересчёта.
 */
import {
  bombardersOf,
  buildingLevel,
  damageFromTraces,
  damageHookQueries,
  fleetBombardPower,
  hoursToMs,
  type Fleet,
  type GameState,
  type Planet,
} from '../../packages/shared-core/src/index';
import {
  bombardTimerShown,
  nextBuildingFall,
  type BuildingFall,
} from '../../decisions/bombardTimer';
import { data } from './gameData';
import { ctx, traceHooks } from './protoKernel';

/** Сколько живёт скорость без перемен в составе обстрела, мс реального времени. */
export const RATE_TTL_MS = 30_000;

interface RateMemo {
  key: string;
  at: number;
  rate: number;
}
const rateMemo = new Map<string, RateMemo>();

/** Отпечаток всего, от чего зависит скорость, кроме технологий (их ловит TTL). */
function rateKey(p: Planet, fleets: readonly Fleet[]): string {
  const ships = fleets
    .map(
      (f) =>
        `${f.id}@${f.owner}:` +
        f.units.map((u) => `${u.unit}x${u.count}/${Math.round(u.hp ?? -1)}`).join(','),
    )
    .join(';');
  return `${p.owner}|${p.buildings.map((b) => `${b.type}${b.level}`).join(',')}|${ships}`;
}

/** Урон обстрела мира за игровой час после хуков — сумма по флотам (правило 3). */
function bombardRate(s: GameState, p: Planet, fleets: readonly Fleet[]): number {
  const queries = fleets.flatMap((f) =>
    damageHookQueries(fleetBombardPower(f, data), {
      phase: 'bombard',
      location: p.id,
      attacker: f.owner,
      defender: p.owner,
      attackerFleet: f.id,
    }),
  );
  const traces = traceHooks(s, queries);
  if (!traces) return 0;
  let rate = 0;
  for (let i = 0; i + 2 < traces.length; i += 3) {
    rate += damageFromTraces([traces[i]!.value, traces[i + 1]!.value, traces[i + 2]!.value]);
  }
  return rate;
}

/**
 * Когда рухнет следующая постройка мира `planetId` — или `null`, если обстрела нет,
 * сносить нечего или смотрящий не сторона обстрела. `now` — реальные часы для кэша.
 */
export function bombardFall(
  s: GameState,
  planetId: string,
  me: string,
  now: number = performance.now(),
): BuildingFall | null {
  const p = s.planets[planetId];
  if (!p) return null;
  const fleets = bombardersOf(s, p.id, data);
  if (fleets.length === 0) {
    rateMemo.delete(p.id);
    return null;
  }
  if (
    !bombardTimerShown(
      me,
      p.owner,
      fleets.map((f) => f.owner),
    )
  )
    return null;
  const key = rateKey(p, fleets);
  let memo = rateMemo.get(p.id);
  if (!memo || memo.key !== key || now - memo.at > RATE_TTL_MS) {
    memo = { key, at: now, rate: bombardRate(s, p, fleets) };
    rateMemo.set(p.id, memo);
  }
  const buildings = p.buildings.map((b) => {
    const def = data.buildings[b.type];
    return { type: b.type, hp: b.hp, maxHp: def ? buildingLevel(def, b.level).hp : 0 };
  });
  return nextBuildingFall(buildings, memo.rate, hoursToMs(ctx(s.time, s), 1));
}

/** Миры с таймером для карты: где обстреливает мой флот или обстреливают мой мир. */
export function bombardFalls(
  s: GameState,
  me: string,
  now: number = performance.now(),
): Array<{ planetId: string; fall: BuildingFall; mine: boolean }> {
  const seen = new Set<string>();
  const out: Array<{ planetId: string; fall: BuildingFall; mine: boolean }> = [];
  // Каждый кадр карты: обход без копии массива, дешёвый отсев до правила ядра — флаг
  // обстрела стоит у считанных флотов.
  for (const id in s.fleets) {
    const f = s.fleets[id]!;
    if (!f.bombarding || !f.location || seen.has(f.location)) continue;
    const p = s.planets[f.location];
    if (!p || (f.owner !== me && p.owner !== me)) continue;
    seen.add(f.location);
    const fall = bombardFall(s, f.location, me, now);
    if (fall) out.push({ planetId: f.location, fall, mine: p.owner === me });
  }
  return out.sort((a, b) => (a.planetId < b.planetId ? -1 : 1));
}
