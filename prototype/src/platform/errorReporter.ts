/**
 * Ошибки браузера → событие `client_error` (PTM-1.3, `docs/playtest-telemetry-roadmap.md`).
 *
 * Что из ошибки уходит и как одинаковые склеиваются, решает
 * `decisions/clientErrorReport.ts`; здесь — проводка. Отчёт о новой ошибке ждёт несколько
 * секунд и уходит со счётчиком повторов за это время: ошибка кадрового цикла даёт одно
 * событие с `n: 60`, а не шестьдесят. Повторы после отправки не считаются — тип и место
 * уже известны. Сам отчёт ошибок не порождает: всё, что может бросить, обёрнуто.
 */
import {
  errorName,
  errorStep,
  errorWhere,
  topFrame,
  type ErrorKind,
  type ErrorProps,
} from '../../../decisions/clientErrorReport';

export const ERROR_REPORT_DELAY_MS = 5_000;

export interface ErrorReporterDeps {
  emit: (props: ErrorProps & { n: number }) => void;
  later: (fn: () => void, ms: number) => void;
  /** Адрес документа без запроса и якоря. */
  ownPage: () => string;
}

export interface ErrorReporter {
  /** `frame` — место из `ErrorEvent`, когда оно есть: оно точнее разбора стека. */
  report(kind: ErrorKind, value: unknown, frame?: { url: string; line: number; col: number }): void;
  /** Отправить ожидающие отчёты сейчас (страница уходит). */
  flush(): void;
}

export function createErrorReporter(deps: ErrorReporterDeps): ErrorReporter {
  const seen = new Set<string>();
  const pending = new Map<string, ErrorProps & { n: number }>();
  let armed = false;

  const flush = (): void => {
    armed = false;
    for (const props of pending.values()) deps.emit(props);
    pending.clear();
  };

  return {
    report(kind, value, frame) {
      try {
        const stack = (value as { stack?: unknown } | null)?.stack;
        const top = frame ?? (typeof stack === 'string' ? topFrame(stack) : null);
        const props: ErrorProps = { kind, name: errorName(value), where: errorWhere(top, deps.ownPage()) };
        const step = errorStep(seen, props);
        if (step.kind === 'over-budget') return;
        if (step.kind === 'repeat') {
          const known = pending.get(step.key);
          if (known) known.n += 1;
          return;
        }
        seen.add(step.key);
        pending.set(step.key, { ...props, n: 1 });
        if (!armed) {
          armed = true;
          deps.later(flush, ERROR_REPORT_DELAY_MS);
        }
      } catch {
        /* отчёт об ошибке не имеет права сам стать ошибкой */
      }
    },
    flush,
  };
}

/** Повесить отчёт на окно: `error` и `unhandledrejection`. */
export function installErrorReporter(reporter: ErrorReporter): void {
  window.addEventListener('error', (e) => {
    const frame = e.filename ? { url: e.filename, line: e.lineno, col: e.colno } : undefined;
    reporter.report('error', e.error ?? null, frame);
  });
  window.addEventListener('unhandledrejection', (e) => reporter.report('rejection', e.reason));
}
