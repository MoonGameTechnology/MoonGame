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
 * 5. **Молчание SDK — тоже сбой** (AUD-28). Запись, на которую SDK не ответил за
 *    {@link CLOUD_SEND_TIMEOUT_MS}, считается несостоявшейся: раньше она держала писатель
 *    «занятым» до конца сессии, и облако не получало больше ни одной записи. Опоздавший
 *    ответ ничего не меняет; повтор той же записи безвреден — облаку нужен последний снимок.
 * 6. **Окно — по монотонным часам** (AUD-28). По часам стены перевод времени назад на час
 *    откладывал следующую запись на час: окно отсчитывалось от «будущей» отметки.
 *
 * Промис записи не отклоняется никогда: облако — копия, источник прогресса — локальное
 * хранилище, и сбой облака не повод ронять покупку или расчёт забега.
 */

/** Минимальный промежуток между записями в SDK. */
export const CLOUD_MIN_INTERVAL_MS = 6000;
/** Сколько сбоев подряд повторяются сами. */
export const CLOUD_MAX_FAILURES = 3;
/** Сколько ждать ответа SDK на одну запись, прежде чем счесть её сбоем. */
export const CLOUD_SEND_TIMEOUT_MS = 20_000;

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
  const now = options.now ?? (() => performance.now());
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
    // Исход записи — один: ответ SDK или срок, что раньше. Второй ничего не меняет.
    let over = false;
    const finish = (error?: unknown, failed = false): void => {
      if (over) return;
      over = true;
      stopDeadline();
      if (!failed) {
        failures = 0;
        settle();
      } else {
        options.onError?.(error);
        failures += 1;
        // Повтор — только если новее ничего не пришло: свежий снимок и так уйдёт.
        if (failures < CLOUD_MAX_FAILURES && !pending) {
          pending = { ...batch, flush: false };
        } else {
          if (pending) pending.done.push(...batch.done);
          else settle();
        }
      }
      inFlight = false;
      pump();
    };
    const stopDeadline = setTimer(
      () => finish(new Error('E_CLOUD_SEND_TIMEOUT'), true),
      CLOUD_SEND_TIMEOUT_MS,
    );
    options.send(batch.snapshot, batch.flush).then(
      () => finish(),
      (error: unknown) => finish(error, true),
    );
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
