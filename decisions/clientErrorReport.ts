/**
 * Что из упавшей у игрока ошибки уходит в телеметрию (PTM-1.3,
 * `docs/playtest-telemetry-roadmap.md`).
 *
 * 1. **Текст сообщения не уходит никогда.** В нём бывает что угодно: адрес с токеном,
 *    ник, кусок сохранения. Уходят только тип (`name`) и место (`where`).
 * 2. **Тип — из короткого списка.** Чужой код может назвать ошибку как угодно, а имя
 *    попадает в журнал как есть. Всё, чего нет в списке, — просто `Error`; не-ошибка в
 *    `reject(...)` — `NonError`.
 * 3. **Место — строка и колонка, без адреса.** Сборка однофайловая и минифицирована,
 *    поэтому координаты верхнего кадра однозначно указывают место в ней. Адрес страницы
 *    несёт путь партии (`/game/<id>`) и запрос, он не нужен: кадр СВОЕЙ страницы — `app`,
 *    любой другой (расширение браузера, SDK площадки) — `ext`. Кадра нет — `?`.
 * 4. **Одинаковые склеиваются, разных не больше пяти за загрузку.** Ошибка в кадровом
 *    цикле повторяется шестьдесят раз в секунду; отчёт о ней нужен один, со счётчиком.
 */

export type ErrorKind = 'error' | 'rejection';

export interface ErrorProps {
  [key: string]: string | number;
  kind: ErrorKind;
  name: string;
  where: string;
}

const KNOWN_NAMES: ReadonlySet<string> = new Set([
  'Error',
  'TypeError',
  'ReferenceError',
  'RangeError',
  'SyntaxError',
  'EvalError',
  'URIError',
  'AggregateError',
  'SecurityError',
  'NotAllowedError',
  'AbortError',
  'QuotaExceededError',
  'NetworkError',
  'InvalidStateError',
  'NotFoundError',
  'NotSupportedError',
  'DataCloneError',
  'TimeoutError',
]);

/** Тип ошибки по правилу 2. */
export function errorName(value: unknown): string {
  if (typeof value !== 'object' || value === null) return 'NonError';
  const name = (value as { name?: unknown }).name;
  return typeof name === 'string' && KNOWN_NAMES.has(name) ? name : 'Error';
}

/** Верхний кадр стека в формате V8 (`at f (url:1:2)`, `at url:1:2`) или Firefox/Safari
 *  (`f@url:1:2`). */
export function topFrame(stack: string): { url: string; line: number; col: number } | null {
  for (const raw of stack.split('\n')) {
    const text = raw.trim();
    if (!text.startsWith('at ') && !text.includes('@')) continue; // строка сообщения
    const m = /(\S+):(\d+):(\d+)\)?$/.exec(text);
    if (m) return { url: m[1]!.replace(/^.*[(@]/, ''), line: Number(m[2]), col: Number(m[3]) };
  }
  return null;
}

/** Место по правилу 3. `ownPage` — адрес документа без хвоста (`origin + pathname`). */
export function errorWhere(
  frame: { url: string; line: number; col: number } | null,
  ownPage: string,
): string {
  if (frame === null || frame.line <= 0) return '?';
  const bare = frame.url.replace(/[?#].*$/, '');
  return `${bare === ownPage ? 'app' : 'ext'}:${frame.line}:${frame.col}`;
}

/** Склейка по правилу 4: что сделать с очередной ошибкой. */
export type ErrorStep =
  | { kind: 'new'; key: string }
  | { kind: 'repeat'; key: string }
  | { kind: 'over-budget' };

export const ERROR_BUDGET = 5;

export function errorStep(seen: ReadonlySet<string>, props: ErrorProps): ErrorStep {
  const key = `${props.kind}|${props.name}|${props.where}`;
  if (seen.has(key)) return { kind: 'repeat', key };
  return seen.size >= ERROR_BUDGET ? { kind: 'over-budget' } : { kind: 'new', key };
}
