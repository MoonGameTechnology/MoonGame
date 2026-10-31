/**
 * Чёрный ящик отрисовки: что было с кадрами в прошлых запусках.
 *
 * Зависание, после которого помогает только перезапуск, стирает всё, что жило в памяти
 * страницы: отчёт об отрисовке (Настройки → Графика) после него пуст и не говорит, что
 * случилось. Ящик держит в хранилище остановки кадров и последний снимок состояния, а
 * следующие запуски показывают их в отчёте.
 *
 * 1. **Остановка — кадр, пришедший позже {@link STALL_MS}** при видимой странице. Скрытая
 *    вкладка и уход в фон остановкой не считаются: там кадров не бывает по воле браузера.
 *    Пауза за меню (правило 9 `simClock.ts`, 200 мс) короче порога.
 * 2. **Род остановки различает пульс страницы** — таймер раз в {@link PULSE_MS}. Пульс стоял
 *    больше половины остановки — главный поток был занят своей работой (`main`): долгий
 *    расчёт или рисование на процессоре. Пульс шёл, а кадра не было — поток был свободен, и
 *    браузер ждал видеочип или композитор (`gpu`). Так отчёт отличает тормоз самой игры от
 *    очереди видеочипа, которую бюджеты кадра не видят.
 * 3. **Идущую остановку пульс записывает, не дожидаясь кадра** (`open`). Остановка видеочипа
 *    может не кончиться до перезапуска: кадр, который бы её закрыл, тогда не придёт никогда.
 * 4. **Запусков хранится {@link SESSIONS_KEPT}, остановок в запуске — {@link STALLS_KEPT}
 *    последних.** Игрок открывает отчёт не сразу после зависания, а между ними бывает ещё
 *    перезапуск; ящик при этом не растёт без меры. Последний запуск с зависанием — остановкой
 *    не короче {@link FREEZE_MS} — держится сверх них, пока среди последних нет своего: после
 *    зависания игру перезапускают и не раз, и три чистых запуска меню вытесняли его из отчёта
 *    (отчёт владельца 2026-10-31).
 * 5. **Повреждённая запись — пустой ящик**, а не сбой загрузки страницы.
 */

/** Кадр позже этого — остановка, мс. */
export const STALL_MS = 1000;
/** Шаг пульса страницы, мс. */
export const PULSE_MS = 250;
/** Снимок состояния пишется не чаще этого, мс: ящик знает, что было незадолго до обрыва. */
export const SNAPSHOT_MS = 5000;
export const SESSIONS_KEPT = 3;
/** Остановка не короче этого — зависание: запуск с ним держится сверх последних (правило 4), мс.
 *  Секунда-другая на старте бывает и у здорового запуска. */
export const FREEZE_MS = 5000;
export const STALLS_KEPT = 10;
/** Начало первой ошибки кадра, символов: её текст, а не стек. */
export const ERROR_CHARS = 160;

/** Чья остановка: главного потока страницы или видеочипа (правило 2). */
export type StallKind = 'main' | 'gpu';

export interface Stall {
  /** Начало — последний кадр перед остановкой, мс от начала запуска. */
  at: number;
  ms: number;
  kind: StallKind;
  /** Остановка ещё шла при последней записи (правило 3). */
  open?: true;
  /** Масштаб камеры и подготовка карты за заставкой в последнем кадре перед остановкой. */
  scale: number;
  preparing: boolean;
}

/** Потери контекста холстов: потеряно и восстановлено. */
export interface ContextEvents {
  lost: number;
  restored: number;
}

/** Что было на экране при последней записи. Ни мира, ни аккаунта — только отрисовка. */
export interface Snapshot {
  /** Карта партии; пусто — не в партии. */
  map: string;
  nodes: number;
  scale: number;
  fps: number;
  preparing: boolean;
  /** Куча JS, МБ; `null` — браузер её не сообщает. */
  heapMb: number | null;
  mapCanvas: ContextEvents;
  background: ContextEvents;
  frameErrors: number;
}

export interface BlackBoxSession {
  build: string;
  /** Начало запуска и его последняя запись, мс эпохи. */
  startedAt: number;
  lastAt: number;
  /** Страница ушла сама (`pagehide`). Нет — запуск оборвался: его закрыли силой или он завис. */
  closed: boolean;
  /** Последние остановки по порядку (правило 4) и все за запуск. */
  stalls: Stall[];
  stallCount: number;
  worstMs: number;
  firstError: string | null;
  last: Snapshot | null;
}

/** Род остановки длиной `gapMs`, если пульс молчал самое большее `pulseGapMs` подряд. */
export function stallKind(gapMs: number, pulseGapMs: number): StallKind {
  return pulseGapMs * 2 >= gapMs ? 'main' : 'gpu';
}

/** Разрыв между кадрами — остановка: длинный, и страница всё это время была на виду. */
export function isStall(gapMs: number, visibleThroughout: boolean): boolean {
  return visibleThroughout && gapMs >= STALL_MS;
}

/** Новый запуск впереди прошлых: из них остаются последние и последний с зависанием
 *  (правило 4). */
export function startSession(
  previous: readonly BlackBoxSession[],
  build: string,
  now: number,
): BlackBoxSession[] {
  const fresh: BlackBoxSession = {
    build,
    startedAt: now,
    lastAt: now,
    closed: false,
    stalls: [],
    stallCount: 0,
    worstMs: 0,
    firstError: null,
    last: null,
  };
  const recent = previous.slice(0, SESSIONS_KEPT - 1);
  const frozen = (s: BlackBoxSession): boolean => s.worstMs >= FREEZE_MS;
  const older = recent.some(frozen) ? undefined : previous.slice(SESSIONS_KEPT - 1).find(frozen);
  return older ? [fresh, ...recent, older] : [fresh, ...recent];
}

/** Остановка в запуске: идущая с тем же началом обновляется, новая встаёт в конец. */
export function withStall(session: BlackBoxSession, stall: Stall): BlackBoxSession {
  const tail = session.stalls[session.stalls.length - 1];
  const same = tail?.open && tail.at === stall.at;
  const stalls = [...(same ? session.stalls.slice(0, -1) : session.stalls), stall].slice(
    -STALLS_KEPT,
  );
  return {
    ...session,
    stalls,
    stallCount: session.stallCount + (same ? 0 : 1),
    worstMs: Math.max(session.worstMs, stall.ms),
  };
}

/** Первая ошибка кадра запоминается началом своего текста; следующие только считает снимок. */
export function withError(session: BlackBoxSession, message: string): BlackBoxSession {
  return session.firstError === null
    ? { ...session, firstError: message.slice(0, ERROR_CHARS) }
    : session;
}

const isObject = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null;
const isNumber = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);

function validSession(v: unknown): v is BlackBoxSession {
  return (
    isObject(v) &&
    typeof v.build === 'string' &&
    isNumber(v.startedAt) &&
    isNumber(v.lastAt) &&
    typeof v.closed === 'boolean' &&
    Array.isArray(v.stalls) &&
    v.stalls.every(
      (s) =>
        isObject(s) && isNumber(s.at) && isNumber(s.ms) && (s.kind === 'main' || s.kind === 'gpu'),
    ) &&
    isNumber(v.stallCount) &&
    isNumber(v.worstMs) &&
    (v.firstError === null || typeof v.firstError === 'string') &&
    (v.last === null || isObject(v.last))
  );
}

/** Запуски из хранилища; повреждённая запись — ни одного (правило 5). */
export function parseSessions(raw: string | null): BlackBoxSession[] {
  if (!raw) return [];
  try {
    const parsed: unknown = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter(validSession).slice(0, SESSIONS_KEPT + 1) : [];
  } catch {
    return [];
  }
}
