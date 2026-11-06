/**
 * Где вылет челноков и его база (SHU-1.2, SHU-4.4, SHU-6.4) — выведено из расписания, а
 * не хранится. Отдельным модулем состояния, потому что читателей два: модуль челноков
 * (ПВО, перехват, повороты) и туман (`visibility.ts`: чужой вылет в обзоре и на радаре).
 * Одна функция на обоих — иначе туман показывал бы эскадру не там, где по ней бьёт ПВО.
 */
import type { GameState, ShuttleStrike, StrikeBase } from './gameState';
import { fleetPositionAt } from './fleetPosition';

/** Позиция базы вылета — мира или носителя. Носитель ДВИЖЕТСЯ, поэтому позиция
 *  всегда берётся текущая, а не запомненная при вылете: запомненная разъехалась бы
 *  с носителем ровно так же, как хранимая позиция флота разъезжается с расписанием. */
export function basePosition(
  base: StrikeBase,
  state: GameState,
  now: number,
): { x: number; y: number } | null {
  if (base.kind === 'planet') {
    return state.planets[base.id]?.position ?? null;
  }
  const fleet = state.fleets[base.id];
  return fleet ? fleetPositionAt(state, fleet, now) : null;
}

/** Где база вылета сейчас — а погибший корабль там, где его видели в последний раз
 *  (`baseAt`, SHU-6.4). Мир с карты не пропадает, корабль уносит позицию с собой: без
 *  этой точки у эскадры, летящей к нему, не стало бы ни места на карте, ни точки, откуда
 *  искать, где сесть. */
export function homePosition(
  strike: ShuttleStrike,
  state: GameState,
  now: number,
): { x: number; y: number } | null {
  return basePosition(strike.base, state, now) ?? strike.baseAt ?? null;
}

/** Где сейчас летящий удар: линейная интерполяция между портом и точкой удара по доле
 *  пройденного времени. Позиции у челнока нет в состоянии намеренно — она ВЫВОДИТСЯ,
 *  как позиция флота на лейне: хранимая копия разъехалась бы с расписанием.
 *
 *  У ПОГОНИ (SHU-4.4) начало отрезка другое: не база, а `strike.at` — точка ПОСЛЕДНЕГО
 *  пересчёта. Между пересчётами эскадра идёт к нынешнему прицелу ровно так же линейно,
 *  поэтому мимо `at` она не «прыгает» раз в час, а ползёт: замерший на карте значок
 *  соврал бы и игроку, и обороне. Развилка стоит ЗДЕСЬ, в одной функции, а не у каждого
 *  читателя: зональное ПВО, перехват и трасса спрашивают «где вылет» одинаково и обязаны
 *  получать один ответ.
 *
 *  ВИСЯЩИЙ ПАТРУЛЬ (SHU-6.2) стоит ровно над своей точкой: по нему ПВО и перехват бьют
 *  так же, как по летящему вылету, и это не отдельное правило, а та же развилка.
 *
 *  ПЕРЕЛЁТ (SHU-6.4) — обратная нога от точки взлёта к новой базе, и отдельной ветки у
 *  него нет. Корабль, к которому летят, погиб — нога кончается там, где его видели в
 *  последний раз (`homePosition`). */
export function strikePosition(
  strike: ShuttleStrike,
  state: GameState,
  now: number,
): { x: number; y: number } | null {
  if (strike.leg === 'patrol') return { ...strike.to };
  if (strike.at) {
    const chase = strike.arrivesAt - strike.departedAt;
    const k = chase <= 0 ? 1 : Math.min(1, Math.max(0, (now - strike.departedAt) / chase));
    return {
      x: strike.at.x + (strike.to.x - strike.at.x) * k,
      y: strike.at.y + (strike.to.y - strike.at.y) * k,
    };
  }
  const home = homePosition(strike, state, now);
  if (!home) return null;
  const [a, b] = strike.leg === 'out' ? [home, strike.to] : [strike.to, home];
  const span = strike.arrivesAt - strike.departedAt;
  const t = span <= 0 ? 1 : Math.min(1, Math.max(0, (now - strike.departedAt) / span));
  return { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t };
}
