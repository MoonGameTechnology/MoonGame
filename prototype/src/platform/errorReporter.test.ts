import { describe, expect, it } from 'vitest';
import { createErrorReporter } from './errorReporter';

function harness() {
  const sent: Record<string, unknown>[] = [];
  const timers: (() => void)[] = [];
  const reporter = createErrorReporter({
    emit: (p) => sent.push(p),
    later: (fn) => timers.push(fn),
    ownPage: () => 'https://play.example/',
  });
  const tick = () => timers.splice(0).forEach((fn) => fn());
  return { reporter, sent, tick };
}

const boom = () => {
  const e = new TypeError('token=SECRET nick=neo');
  e.stack = 'TypeError: token=SECRET nick=neo\n    at Kn (https://play.example/?join=m1:1:20345)';
  return e;
};

describe('error reporter', () => {
  it('a thrown error becomes one event with type and place, without the message', () => {
    const h = harness();
    h.reporter.report('error', boom());
    h.tick();
    expect(h.sent).toEqual([{ kind: 'error', name: 'TypeError', where: 'app:1:20345', n: 1 }]);
    expect(JSON.stringify(h.sent)).not.toContain('SECRET');
  });

  it('ten identical errors are one event with a counter', () => {
    const h = harness();
    for (let i = 0; i < 10; i += 1) h.reporter.report('error', boom());
    h.tick();
    expect(h.sent).toEqual([{ kind: 'error', name: 'TypeError', where: 'app:1:20345', n: 10 }]);
    h.reporter.report('error', boom()); // уже отправлено — повтор не шлём
    h.tick();
    expect(h.sent).toHaveLength(1);
  });

  it('the place from an ErrorEvent wins over the stack', () => {
    const h = harness();
    h.reporter.report('error', boom(), { url: 'https://cdn.example/sdk.js', line: 7, col: 8 });
    h.tick();
    expect(h.sent[0]?.where).toBe('ext:7:8');
  });

  it('a rejection with a string reason is NonError with no place', () => {
    const h = harness();
    h.reporter.report('rejection', 'nope');
    h.reporter.flush();
    expect(h.sent).toEqual([{ kind: 'rejection', name: 'NonError', where: '?', n: 1 }]);
  });

  it('no more than five different reports per load', () => {
    const h = harness();
    for (let i = 0; i < 9; i += 1)
      h.reporter.report('error', null, { url: 'https://play.example/', line: 1, col: i });
    h.tick();
    expect(h.sent).toHaveLength(5);
  });

  it('a hostile error object does not break the reporter', () => {
    const h = harness();
    const evil = {
      get stack(): string {
        throw new Error('trap');
      },
    };
    expect(() => h.reporter.report('error', evil)).not.toThrow();
  });
});
