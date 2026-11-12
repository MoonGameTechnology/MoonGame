/**
 * Строки списка шпионов во вкладке «Шпионаж» (заказ владельца 2026-11-10): фото с
 * уровнем, имя, местоположение, чем занят, таймер и одна кнопка. Где шпион и что он
 * делает, решает ядро (`state.spies`); здесь только что показать.
 *
 * 1. **Одна кнопка на строку.** Шпион, который отдыхает в столице или ожидает на мире,
 *    получает «Дать задание». Шпион в пути к заданию или на задании получает «Отменить
 *    задание». Возвращающийся домой, вербуемый взамен погибшего и залёгший на дно (у
 *    игрока нет столицы, решение владельца 2026-11-10) кнопки не получают: заданий они не
 *    берут, а отменять у них нечего.
 * 2. **Таймер только у того, что кончится само.** Путь, возвращение, вербовка и
 *    операция с концом показывают отсчёт до `arrivesAt`. Пост контрразведчика и
 *    разведчика длится до отзыва: у него таймера нет.
 * 3. **Имя по номеру и поколению.** Шпиону с номером `id` поколения `gen` достаётся
 *    позывной `callsignIndex(id, gen)` из `SPY_CALLSIGNS`. Шпионов в сети не больше
 *    `SPY_SLOTS`, поэтому у двух живых шпионов позывные не совпадают никогда, а новичок
 *    на месте погибшего получает новый.
 * 4. **По номеру.** Строки идут по `id`, чтобы шпион не прыгал по списку, меняя занятие.
 */
import type { SpyOp } from '../packages/shared-core/src/index';

/** Что шпион делает: операция ядра или переход. */
export type SpyDoing = SpyOp | 'relocate';

/** Чем занят шпион (поле `state` записи ядра). */
export type SpyStatus = 'rest' | 'travel' | 'wait' | 'work' | 'return' | 'recruit' | 'hidden';

/** То, что строке нужно из записи шпиона ядра. */
export interface SpyRecordView {
  id: number;
  gen?: number;
  state: SpyStatus;
  /** Где стоит; в пути — куда летит. */
  location: string;
  op?: SpyDoing;
  /** Конец пути, работы, возвращения или вербовки. */
  arrivesAt?: number;
}

/** Сколько позывных в списке, и самый большой размер сети шпионов. */
export const SPY_CALLSIGNS = 32;
export const SPY_SLOTS = 8;

/** Правило 3. */
export function callsignIndex(id: number, gen = 0): number {
  return (((id - 1 + SPY_SLOTS * gen) % SPY_CALLSIGNS) + SPY_CALLSIGNS) % SPY_CALLSIGNS;
}

/** Кнопка строки. */
export type RosterAction = 'assign' | 'cancel' | null;

export interface RosterRow {
  id: number;
  callsign: number;
  status: SpyStatus;
  location: string;
  task: SpyDoing | null;
  /** Конец отсчёта; `null` — без таймера. */
  until: number | null;
  action: RosterAction;
}

/** Срок, дальше которого таймер не показывается: пост «до отзыва» ядро держит
 *  значением `Number.MAX_SAFE_INTEGER`. */
const ENDLESS = Number.MAX_SAFE_INTEGER / 2;

function actionOf(status: SpyStatus): RosterAction {
  if (status === 'rest' || status === 'wait') return 'assign';
  if (status === 'travel' || status === 'work') return 'cancel';
  return null;
}

/** Правила 1–4. */
export function spyRoster(spies: readonly SpyRecordView[] | undefined): RosterRow[] {
  return [...(spies ?? [])]
    .sort((a, b) => a.id - b.id)
    .map((s) => {
      const timed = s.state !== 'rest' && s.state !== 'wait' && s.state !== 'hidden' && s.arrivesAt !== undefined && s.arrivesAt < ENDLESS;
      return {
        id: s.id,
        callsign: callsignIndex(s.id, s.gen),
        status: s.state,
        location: s.location,
        task: s.state === 'travel' || s.state === 'work' ? (s.op ?? null) : null,
        until: timed ? s.arrivesAt! : null,
        action: actionOf(s.state),
      };
    });
}
