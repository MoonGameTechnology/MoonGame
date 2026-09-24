/**
 * Запись в облачное хранилище площадки — с оглядкой на квоту (`YAG-2.2`).
 *
 * У `player.setData` квота — 100 запросов за 5 минут (§1.1 роадмапа площадки), и чтение
 * `getData` тратит её же. Игра же сохраняет по СОБЫТИЯМ — расчёт забега, покупка, заточка,
 * конец волны, — и в плотные минуты событий бывает больше, чем запросов. Поэтому запись
 * не идёт в SDK на каждое событие:
 *
 * 1. **Последний снимок вытесняет неотправленный.** Облаку нужен последний прогресс, а
 *    не история: пять покупок за три секунды — это одна запись, а не пять.
 * 2. **Не чаще раза в {@link CLOUD_MIN_INTERVAL_MS}.** Не больше 51 записи за 5 минут
 *    (раз в 6 с плюс первая) — половина квоты: вторая остаётся на чтение и на повторы.
 * 3. **Уход со страницы — сразу** (`flush`): таймер после выгрузки страницы не сработает,
 *    и последний прогресс остался бы только на этом устройстве.
 * 4. **Сбой — повтор в следующее окно, но не вечно.** После {@link CLOUD_MAX_FAILURES}
 *    подряд запись ждёт следующего события: офлайн не должен выжигать квоту повторами.
 *
 * Промис записи не отклоняется никогда: облако — копия, источник прогресса — локальное
 * хранилище, и сбой облака не повод ронять покупку или расчёт забега.
 */

/** Минимальный промежуток между записями в SDK. */
export const CLOUD_MIN_INTERVAL_MS = 6000;
/** Сколько сбоев подряд повторяются сами. */
export const CLOUD_MAX_FAILURES = 3;

export interface CloudWriterOptions {
  /** Отправить снимок в SDK. Отклонение — сбой записи. */
  send: (snapshot: string, flush: boolean) => Promise<void>;
  onError?: (error: unknown) => void;
  /** Часы и таймер — снаружи, чтобы тест вёл время сам. */
  now?: () => number;
  setTimer?: (run: () => void, ms: number) => () => void;
}

export interface CloudWriter {
  /** Поставить снимок в запись. Промис — когда он (или более поздний) ушёл или брошен. */
  save(snapshot: string, flush?: boolean): Promise<void>;
}

interface Batch {
  snapshot: string;
  flush: boolean;
  done: (() => void)[];
}

export function createCloudWriter(options: CloudWriterOptions): CloudWriter {
  const now = options.now ?? (() => Date.now());
  const setTimer =
    options.setTimer ??
    ((run, ms) => {
      const id = setTimeout(run, ms);
      return () => clearTimeout(id);
    });
  let pending: Batch | null = null;
  let inFlight = false;
  let lastSentAt = -Infinity;
  let failures = 0;
  let cancelTimer: (() => void) | null = null;

  const pump = (): void => {
    if (inFlight || !pending) return;
    const wait = pending.flush ? 0 : lastSentAt + CLOUD_MIN_INTERVAL_MS - now();
    if (wait > 0) {
      cancelTimer ??= setTimer(() => {
        cancelTimer = null;
        pump();
      }, wait);
      return;
    }
    cancelTimer?.();
    cancelTimer = null;
    const batch = pending;
    pending = null;
    inFlight = true;
    lastSentAt = now();
    const settle = (): void => {
      for (const done of batch.done) done();
    };
    options
      .send(batch.snapshot, batch.flush)
      .then(
        () => {
          failures = 0;
          settle();
        },
        (error: unknown) => {
          options.onError?.(error);
          failures += 1;
          // Повтор — только если новее ничего не пришло: свежий снимок и так уйдёт.
          if (failures < CLOUD_MAX_FAILURES && !pending) {
            pending = { ...batch, flush: false };
          } else {
            if (pending) pending.done.push(...batch.done);
            else settle();
          }
        },
      )
      .finally(() => {
        inFlight = false;
        pump();
      });
  };

  return {
    save(snapshot, flush = false) {
      return new Promise<void>((resolve) => {
        pending = {
          snapshot,
          flush: flush || (pending?.flush ?? false),
          done: [...(pending?.done ?? []), resolve],
        };
        pump();
      });
    },
  };
}
