/**
 * УСКОРЕНИЕ ОЧЕРЕДЕЙ ЗА ВРЕМЯ (TEC-3, `docs/time-economy-roadmap.md`): сколько игрок вправе
 * ускорить в партии, сколько это стоит и чем очередь сдвигается.
 *
 * 1. **Бюджет K.** За каждый прошедший игровой час партии можно ускорить не больше
 *    `K − 1` часа (`util/timeValue.ts`): платящий идёт не больше чем в K раз быстрее
 *    бесплатного. Бюджет общий для всех очередей игрока.
 * 2. **Цена растёт в пределах игровых суток партии.** Первый час — по курсу
 *    (`sovereignsPerHour`), каждый следующий в те же сутки дороже на `escalation`.
 *    Цена считается непрерывно: купить 2 часа разом или двумя покупками по часу — одно и то
 *    же, нарезка выгоды не даёт. Сутки сменились — рост начинается заново.
 * 3. **Платят целыми ◆, округление вверх.** Кошелёк хранит целые Суверены.
 * 4. **Последние минуты бесплатны.** Остаток очереди не больше `freeFinishMinutes` игровых
 *    минут заканчивается сразу, без ◆ и без бюджета: мелкое ожидание не продаётся.
 *
 * Очередь сдвигает ЕЁ владелец — стройка и исследования дают возможности (capability)
 * `construction.hasten` и `technology.hasten` по контракту {@link QueueHasten}. Модуль
 * ускорения их не импортирует: нет владельца — нет и ускорения этой очереди.
 */
import { hoursToMs, type Context } from '../action/types';
import type { HandlerContext } from '../kernel/module';
import type { TimeValueDef } from '../data/timeValueSchema';
import type { GameState } from '../state/gameState';
import { speedupBudgetHours } from './timeValue';

/** Учёт ускорения игрока в партии. Лежит у игрока (`Player.speedup`), чужим не виден. */
export interface SpeedupState {
  /** Сколько игровых часов ускорено за всю партию. */
  usedHours: number;
  /** Номер игровых суток партии, к которым относится `dayHours`. */
  day: number;
  /** Сколько часов ускорено в эти сутки — от этого растёт цена (правило 2). */
  dayHours: number;
}

/** Какую очередь ускорить: заказ стройки по номеру или идущее исследование. */
export type QueueRef = { kind: 'construction'; seq: number } | { kind: 'research'; technology: string };

/** Контракт владельца очереди. Остаток — в игровых часах; `null` — такой очереди у игрока
 *  нет или её нельзя ускорить. `hasten` сдвигает её завершение раньше на `hours`. */
export interface QueueHasten {
  remaining(h: HandlerContext, playerId: string, ref: QueueRef): number | null;
  hasten(h: HandlerContext, playerId: string, ref: QueueRef, hours: number): boolean;
}

const DAY_HOURS = 24;

/** Сколько игровых часов прошло с начала партии. */
export function matchElapsedHours(state: GameState, ctx: Context): number {
  const span = ctx.now - (state.startedAt ?? 0);
  return span > 0 ? span / hoursToMs(ctx, 1) : 0;
}

/** Номер игровых суток партии (0 — первые). */
export function matchDay(state: GameState, ctx: Context): number {
  return Math.floor(matchElapsedHours(state, ctx) / DAY_HOURS);
}

/** Сколько часов игрок ещё может ускорить сейчас (правило 1). */
export function speedupLeftHours(
  state: GameState,
  playerId: string,
  def: TimeValueDef,
  ctx: Context,
): number {
  const used = state.players[playerId]?.speedup?.usedHours ?? 0;
  return Math.max(0, speedupBudgetHours(matchElapsedHours(state, ctx), def) - used);
}

/** Сколько часов уже ускорено в текущие сутки партии. */
function hoursToday(state: GameState, playerId: string, ctx: Context): number {
  const s = state.players[playerId]?.speedup;
  return s && s.day === matchDay(state, ctx) ? s.dayHours : 0;
}

/**
 * Цена ускорения на `hours` в ◆ (правила 2–3): `курс × ∫ (1 + рост·x) dx` от уже купленного
 * за сутки до него плюс `hours`, округлено вверх до целого.
 */
export function speedupPrice(
  state: GameState,
  playerId: string,
  hours: number,
  def: TimeValueDef,
  ctx: Context,
): number {
  if (!(hours > 0)) return 0;
  const before = hoursToday(state, playerId, ctx);
  const area = hours + def.escalation * (hours * before + (hours * hours) / 2);
  return Math.ceil(def.sovereignsPerHour * area - 1e-9);
}

/** Записать ускорение на `hours` в учёт игрока. */
export function recordSpeedup(state: GameState, playerId: string, hours: number, ctx: Context): void {
  const player = state.players[playerId];
  if (!player || !(hours > 0)) return;
  const day = matchDay(state, ctx);
  const today = hoursToday(state, playerId, ctx);
  player.speedup = {
    usedHours: (player.speedup?.usedHours ?? 0) + hours,
    day,
    dayHours: today + hours,
  };
}

/** Остаток очереди закончится бесплатно (правило 4). */
export function finishesFree(remainingHours: number, def: TimeValueDef): boolean {
  return remainingHours > 0 && remainingHours * 60 <= def.freeFinishMinutes;
}
