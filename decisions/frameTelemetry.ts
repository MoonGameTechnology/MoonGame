/**
 * Долгие кадры в телеметрии клиента: что сэмпл `perf` говорит о рывках (шаг 2 дорожной
 * карты плавности).
 *
 * Сэмпл раз в 30 с несёт FPS, пинг и память, а FPS — сглаженное среднее: застывший на
 * четверть секунды кадр его почти не двигает, хотя игрок видит именно этот кадр. Поэтому за
 * окно между сэмплами копятся две вещи.
 *
 * 1. **Долгие кадры — по интервалам между кадрами.** Интервал дольше {@link LONG_FRAME_MS}
 *    игрок видит как застывшую картинку, и это меряется в любом браузере. Порог тот же,
 *    с которого браузер заводит запись Long Animation Frame. Считаются те же разрывы, что
 *    и в FPS (`saneGap`): секунда и больше неотличима от вкладки в фоне, поэтому такое
 *    зависание кадром не считается — его видно только по записи из пункта 2. Окно без
 *    единого кадра (вкладка всё окно в фоне) полей о кадрах не шлёт вовсе, а не шлёт нули:
 *    «ноль долгих кадров» должно значить «было гладко», а не «ничего не рисовали».
 * 2. **Причина — по Long Animation Frames** (Chromium: Chrome, Edge, Android WebView; в
 *    Safari и Firefox этих полей нет). Из окна берётся самая долгая блокировка главного
 *    потока: сколько она длилась, сколько в ней заняли скрипты и сколько стиль, раскладка
 *    и отрисовка, и кто вызвал самый долгий скрипт — `FrameRequestCallback` (кадр игры),
 *    `….onmessage` (снимок сервера), `….onpointermove` (ввод). Имени функции нет: бандл
 *    минифицирован, и оно ничего не скажет. Остаток после скриптов и раскладки — работа
 *    браузера вне скриптов, например сборка мусора между задачами. Если долгие кадры есть,
 *    а блокировки нет, кадр держал не главный поток: растеризация, видеокарта или сам
 *    браузер.
 *
 * Имя вызывающего уходит на сервер, поэтому режется до печатного ASCII и
 * {@link LOAF_BY_MAX} знаков, а адрес теряет запрос и якорь: у встроенного скрипта это
 * адрес страницы, а в нём бывает ссылка входа.
 */

import type { ClientPerfMessage } from '../packages/protocol/src/index';

/** Интервал кадра дольше этого — видимый рывок. */
export const LONG_FRAME_MS = 50;

/** Предел длины имени вызывающего в сэмпле (и в проверке на сервере). */
export const LOAF_BY_MAX = 80;

/** Что нужно от записи Long Animation Frame — структурно, без типов браузера. */
export interface LongFrameEntry {
  startTime: number;
  duration: number;
  /** Начало стиля и раскладки; 0 — кадр до них не дошёл. */
  styleAndLayoutStart: number;
  /** Скрипты длиннее 5 мс внутри кадра. */
  scripts: ReadonlyArray<{ duration: number; invoker: string }>;
}

/** Самая долгая блокировка главного потока за окно. */
export interface FrameBlock {
  ms: number;
  scriptMs: number;
  layoutMs: number;
  /** Кто вызвал самый долгий скрипт; пусто — скриптов длиннее 5 мс не было. */
  by: string;
}

/** Окно между двумя сэмплами. */
export interface FrameWindow {
  longFrames: number;
  /** Самый долгий интервал; 0 — в окне не было ни одного кадра. */
  worstFrameMs: number;
  block: FrameBlock | null;
}

export const FRAME_WINDOW_EMPTY: FrameWindow = { longFrames: 0, worstFrameMs: 0, block: null };

/** Поля сэмпла `perf` о кадрах — как их объявляет протокол. */
export type FramePerfFields = Pick<
  ClientPerfMessage,
  'longFrames' | 'worstFrameMs' | 'loafMs' | 'loafScriptMs' | 'loafLayoutMs' | 'loafBy'
>;

/**
 * Окно после ещё одного кадра. `dt` — уже правдоподобный разрыв (`saneGap`). Обычный кадр
 * окна не меняет и возвращает тот же объект: кадр идёт 60 раз в секунду, и мусора от
 * телеметрии быть не должно.
 */
export function countFrame(w: FrameWindow, dt: number): FrameWindow {
  const long = dt > LONG_FRAME_MS;
  if (!long && dt <= w.worstFrameMs) return w;
  return {
    longFrames: w.longFrames + (long ? 1 : 0),
    worstFrameMs: Math.max(w.worstFrameMs, dt),
    block: w.block,
  };
}

/** Окно после записи Long Animation Frame: остаётся самая долгая. */
export function noteBlock(w: FrameWindow, e: LongFrameEntry): FrameWindow {
  if (w.block !== null && w.block.ms >= e.duration) return w;
  let scriptMs = 0;
  let top: { duration: number; invoker: string } | null = null;
  for (const script of e.scripts) {
    scriptMs += script.duration;
    if (top === null || script.duration > top.duration) top = script;
  }
  const layoutMs =
    e.styleAndLayoutStart > 0 ? Math.max(0, e.startTime + e.duration - e.styleAndLayoutStart) : 0;
  return {
    ...w,
    block: { ms: e.duration, scriptMs, layoutMs, by: top === null ? '' : invokerName(top.invoker) },
  };
}

/** Поля сэмпла из окна, в целых миллисекундах. */
export function framePerfFields(w: FrameWindow): FramePerfFields {
  const out: FramePerfFields = {};
  if (w.worstFrameMs > 0) {
    out.longFrames = w.longFrames;
    out.worstFrameMs = Math.round(w.worstFrameMs);
  }
  if (w.block !== null) {
    out.loafMs = Math.round(w.block.ms);
    out.loafScriptMs = Math.round(w.block.scriptMs);
    out.loafLayoutMs = Math.round(w.block.layoutMs);
    if (w.block.by !== '') out.loafBy = w.block.by;
  }
  return out;
}

/** Имя вызывающего для сервера: без запроса и якоря, печатный ASCII, не длиннее предела. */
export function invokerName(raw: string): string {
  const bare = raw.split(/[?#]/, 1)[0] ?? '';
  return bare.replace(/[^\x20-\x7E]/g, '').slice(0, LOAF_BY_MAX);
}
