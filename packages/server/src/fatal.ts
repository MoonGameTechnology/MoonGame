/**
 * RESIL-3 · Опознаваемая ПОСЛЕДНЯЯ СТРОКА процесса.
 *
 * Сторож `no-floating-promises` (`eslint.config.js`) делает необработанное отклонение
 * маловероятным, но не невозможным: остаётся код вне его охвата и чужие зависимости. Node
 * с 15-й версии на таком отклонении процесс УБИВАЕТ — и до этого кирпича смерть выглядела
 * как молчаливый перезапуск контейнера: в `moongame logs` голый стек без ответа на вопрос
 * «что именно». Опознать по нему причину нельзя, а разбор такого падения и так идёт в
 * спешке.
 *
 * 1. **Сначала строка, потом смерть.** Имя причины (`uncaughtException` /
 *    `unhandledRejection`) и стек целиком — одной строкой с префиксом `[fatal]`, тем же
 *    по смыслу, что `[detached]` у фонового промиса (`detach.ts`).
 * 2. **Жить дальше НЕ пытаемся.** Состояние после такого падения неизвестно, а матч
 *    поднимется из durable-снапшота: перезапуск обеспечивает `restart: unless-stopped` в
 *    compose. Fail-fast здесь честнее попытки доработать в неизвестном виде — и это тот же
 *    fail-secure, что у редьюсера, только на уровне процесса.
 * 3. **Второй фатал не перебивает первый.** Падение по дороге к выходу (а `exit` зовёт
 *    обработчики) написало бы поверх настоящей причины; наружу должна уехать ПЕРВАЯ.
 *
 * Процесс приходит параметром, а не берётся из глобали: иначе правило проверялось бы
 * только настоящим падением настоящего сервера, то есть не проверялось бы никогда.
 */

/** То, что фаталу нужно от процесса, — ровно три вещи. */
export interface FatalHost {
  on(event: 'unhandledRejection' | 'uncaughtException', handler: (err: unknown) => void): void;
  write(line: string): void;
  exit(code: number): void;
}

/** Один процесс не может умереть «частично»: выход всегда ненулевой (правило 2). */
export const FATAL_EXIT_CODE = 1;

/** Строка, по которой падение опознаётся в логе (правило 1). */
export function fatalLine(kind: string, err: unknown): string {
  const detail = err instanceof Error ? (err.stack ?? `${err.name}: ${err.message}`) : String(err);
  return `[fatal] ${kind}: ${detail}\n`;
}

/** Настоящий процесс в виде `FatalHost` — единственное место, где берётся глобаль. */
function nodeHost(): FatalHost {
  return {
    on: (event, handler) => {
      process.on(event, handler as (...args: unknown[]) => void);
    },
    write: (line) => {
      process.stderr.write(line);
    },
    exit: (code) => {
      process.exit(code);
    },
  };
}

/** Повесить фатал на хост. Зовётся КАК МОЖНО РАНЬШЕ: до первого, что может упасть. */
export function installFatalHandlers(host: FatalHost = nodeHost()): void {
  let dying = false;
  const die =
    (kind: 'unhandledRejection' | 'uncaughtException') =>
    (err: unknown): void => {
      if (dying) return; // правило 3
      dying = true;
      host.write(fatalLine(kind, err));
      host.exit(FATAL_EXIT_CODE);
    };
  host.on('uncaughtException', die('uncaughtException'));
  host.on('unhandledRejection', die('unhandledRejection'));
}
