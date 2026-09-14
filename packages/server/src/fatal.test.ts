/**
 * RESIL-3 — падение процесса называет себя.
 *
 * До кирпича ни в одном из двух хостов не было ни `unhandledRejection`, ни
 * `uncaughtException`: контейнер молча перезапускался, а в логе оставался голый стек.
 */
import { describe, expect, it, vi } from 'vitest';
import { FATAL_EXIT_CODE, fatalLine, installFatalHandlers, type FatalHost } from './fatal';

/** Поддельный процесс: обработчики складываются, чтобы тест мог их дёрнуть. */
function fakeHost() {
  const handlers = new Map<string, (err: unknown) => void>();
  const lines: string[] = [];
  const exits: number[] = [];
  const host: FatalHost = {
    on: (event, handler) => handlers.set(event, handler),
    write: (line) => lines.push(line),
    exit: (code) => exits.push(code),
  };
  return { host, handlers, lines, exits };
}

describe('RESIL-3 — фатал процесса', () => {
  it('ОБА ВИДА СМЕРТИ ПЕРЕХВАЧЕНЫ: и бросок, и отклонение промиса', () => {
    const f = fakeHost();
    installFatalHandlers(f.host);
    expect([...f.handlers.keys()].sort()).toEqual(['uncaughtException', 'unhandledRejection']);
  });

  it('СНАЧАЛА СТРОКА, ПОТОМ СМЕРТЬ: имя причины и стек — и только затем выход', () => {
    const f = fakeHost();
    installFatalHandlers(f.host);
    const err = new Error('база отвалилась');
    f.handlers.get('unhandledRejection')!(err);
    expect(f.lines).toHaveLength(1);
    expect(f.lines[0]).toContain('[fatal] unhandledRejection');
    expect(f.lines[0]).toContain('база отвалилась');
    expect(f.lines[0]).toContain('fatal.test.ts'); // стек, а не одно сообщение
    expect(f.exits).toEqual([FATAL_EXIT_CODE]); // жить дальше не пытаемся
  });

  it('ВТОРОЙ ФАТАЛ НЕ ПЕРЕБИВАЕТ ПЕРВЫЙ: наружу уезжает НАСТОЯЩАЯ причина', () => {
    const f = fakeHost();
    installFatalHandlers(f.host);
    f.handlers.get('uncaughtException')!(new Error('первая'));
    f.handlers.get('unhandledRejection')!(new Error('вторая, уже по дороге к выходу'));
    expect(f.lines).toHaveLength(1);
    expect(f.lines[0]).toContain('первая');
    expect(f.exits).toEqual([FATAL_EXIT_CODE]);
  });

  it('НЕ-ОШИБКА ТОЖЕ ЧИТАЕТСЯ: `throw "строка"` не превращается в [object Object]', () => {
    expect(fatalLine('uncaughtException', 'сорвалось')).toBe(
      '[fatal] uncaughtException: сорвалось\n',
    );
    expect(fatalLine('unhandledRejection', { code: 'E_DB' })).toContain('[object Object]');
  });

  it('ГЛОБАЛЬ БЕРЁТСЯ ТОЛЬКО ПО УМОЛЧАНИЮ: без аргумента вешается на сам процесс', () => {
    const spy = vi.spyOn(process, 'on').mockImplementation(() => process);
    installFatalHandlers();
    const events = spy.mock.calls.map((c) => c[0]);
    expect(events).toContain('uncaughtException');
    expect(events).toContain('unhandledRejection');
    spy.mockRestore();
  });
});
