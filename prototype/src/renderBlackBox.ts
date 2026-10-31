/**
 * Чёрный ящик отрисовки в странице: пульс, остановки кадров и запись в хранилище. Правила —
 * `decisions/renderBlackBox.ts`; здесь только таймер, хранилище и события страницы.
 *
 * Кадр зовёт {@link blackBoxFrame} первым делом, сбой кадра — {@link blackBoxError}; отчёт об
 * отрисовке берёт запуски {@link blackBoxSessions}: нынешний первым, за ним прошлые.
 */
import {
  PULSE_MS,
  SNAPSHOT_MS,
  isStall,
  parseSessions,
  stallKind,
  startSession,
  withError,
  withStall,
  type BlackBoxSession,
  type Snapshot,
} from '../../decisions/renderBlackBox';
import { readRaw, writeRaw } from './prefs';

const KEY = 'void.renderBlackBox';

export interface BlackBoxHost {
  /** Сборка, как её показывает экран входа; пусто — браузерная. */
  build(): string;
  /** Что сейчас на экране: карта, камера, кадры, потери холстов. */
  snapshot(): Omit<Snapshot, 'heapMb'>;
}

let host: BlackBoxHost | null = null;
let sessions: BlackBoxSession[] = [];
/** Начало запуска по часам кадра: остановки отсчитываются от него. */
let startPerf = 0;
let lastFrame = 0;
let lastPulse = 0;
/** Самая долгая тишина пульса с последнего кадра. */
let pulseGap = 0;
/** Страница пряталась с последнего кадра: такой разрыв — не остановка. */
let hiddenSinceFrame = false;
let frameScale = 0;
let framePreparing = false;
let lastWrite = -Infinity;

const visible = (): boolean => document.visibilityState !== 'hidden';

function heapMb(): number | null {
  const memory = (performance as Performance & { memory?: { usedJSHeapSize?: number } }).memory;
  return typeof memory?.usedJSHeapSize === 'number'
    ? Math.round(memory.usedJSHeapSize / 1e6)
    : null;
}

/** Записать ящик со свежим снимком. */
function save(now: number): void {
  if (!host || !sessions[0]) return;
  lastWrite = now;
  sessions[0] = {
    ...sessions[0],
    lastAt: Date.now(),
    last: { ...host.snapshot(), heapMb: heapMb() },
  };
  writeRaw(KEY, JSON.stringify(sessions));
}

/** Остановка от последнего кадра до `now`: идущая (правило 3) или закрытая кадром. */
function noteStall(now: number, open: boolean): void {
  if (!sessions[0]) return;
  const ms = now - lastFrame;
  const kind = stallKind(ms, Math.max(pulseGap, now - lastPulse));
  sessions[0] = withStall(sessions[0], {
    // The first frame's timestamp may predate the start: the browser stamps the frame it began.
    at: Math.max(0, Math.round(lastFrame - startPerf)),
    ms: Math.round(ms),
    kind,
    ...(open ? { open: true as const } : {}),
    scale: frameScale,
    preparing: framePreparing,
  });
}

function pulse(): void {
  const now = performance.now();
  pulseGap = Math.max(pulseGap, now - lastPulse);
  lastPulse = now;
  if (!visible()) hiddenSinceFrame = true;
  // Кадра нет, а поток свободен: идущая остановка пишется раз в секунду, не дожидаясь кадра.
  if (lastFrame && isStall(now - lastFrame, !hiddenSinceFrame)) {
    if (now - lastWrite < 1000) return;
    noteStall(now, true);
    save(now);
  } else if (now - lastWrite >= SNAPSHOT_MS) save(now);
}

/** Начать запуск: прошлые запуски уходят назад, пульс и снимки идут. */
export function startBlackBox(h: BlackBoxHost): void {
  host = h;
  sessions = startSession(parseSessions(readRaw(KEY)), h.build(), Date.now());
  startPerf = lastPulse = performance.now();
  save(startPerf);
  // Стенд с поддельным DOM гоняет игру в Node: таймер без `unref` держал бы его живым.
  (setInterval(pulse, PULSE_MS) as unknown as { unref?: () => void }).unref?.();
  addEventListener('pagehide', () => {
    if (sessions[0]) sessions[0] = { ...sessions[0], closed: true };
    save(performance.now());
  });
  addEventListener('pageshow', (e) => {
    if ((e as PageTransitionEvent).persisted && sessions[0])
      sessions[0] = { ...sessions[0], closed: false };
  });
  document.addEventListener('visibilitychange', () => {
    hiddenSinceFrame = true;
  });
}

/** Начало кадра: разрыв с прошлым кадром проверяется на остановку (правило 1). */
export function blackBoxFrame(now: number, scale: number, preparing: boolean): void {
  if (!host) return;
  if (lastFrame && isStall(now - lastFrame, !hiddenSinceFrame && visible())) {
    noteStall(now, false);
    save(now);
  }
  lastFrame = now;
  pulseGap = 0;
  lastPulse = Math.max(lastPulse, now);
  hiddenSinceFrame = false;
  frameScale = Math.round(scale * 100) / 100;
  framePreparing = preparing;
}

/** Сбой кадра: первая ошибка запуска запоминается. */
export function blackBoxError(error: unknown): void {
  if (!sessions[0]) return;
  sessions[0] = withError(sessions[0], error instanceof Error ? error.message : String(error));
}

/** Запуски для отчёта об отрисовке: нынешний со свежим снимком, за ним прошлые. */
export function blackBoxSessions(): BlackBoxSession[] {
  if (host && sessions[0])
    sessions[0] = { ...sessions[0], last: { ...host.snapshot(), heapMb: heapMb() } };
  return sessions;
}
