import { describe, expect, it } from 'vitest';
import { errorName, errorStep, errorWhere, topFrame, ERROR_BUDGET, type ErrorProps } from './clientErrorReport';

const PAGE = 'https://play.example/';

describe('errorName', () => {
  it('keeps a known type and hides any other name', () => {
    expect(errorName(new TypeError('x'))).toBe('TypeError');
    const odd = new Error('x');
    odd.name = 'user@mail.example';
    expect(errorName(odd)).toBe('Error');
  });

  it('a rejection with a non-object reason is NonError', () => {
    expect(errorName('boom')).toBe('NonError');
    expect(errorName(undefined)).toBe('NonError');
  });
});

describe('topFrame + errorWhere', () => {
  it('V8 stack: our page becomes app:line:col, no address', () => {
    const stack = 'TypeError: secret token abc\n    at Kn (https://play.example/game/m-123?join=1:1:20345)\n    at x (https://play.example/:1:5)';
    expect(errorWhere(topFrame(stack), PAGE.replace(/\/$/, '/game/m-123'))).toBe('app:1:20345');
    expect(errorWhere(topFrame(stack), PAGE)).toBe('ext:1:20345');
  });

  it('a frame without a function name', () => {
    expect(topFrame('Error\n    at https://play.example/:2:7')).toEqual({ url: PAGE, line: 2, col: 7 });
  });

  it('Firefox/Safari stack', () => {
    expect(topFrame('Kn@https://play.example/:1:99\n')).toEqual({ url: PAGE, line: 1, col: 99 });
  });

  it('a foreign script is ext, a missing frame is ?', () => {
    expect(errorWhere({ url: 'chrome-extension://abc/x.js', line: 3, col: 4 }, PAGE)).toBe('ext:3:4');
    expect(errorWhere(null, PAGE)).toBe('?');
    expect(errorWhere(topFrame('just a message'), PAGE)).toBe('?');
  });
});

describe('errorStep', () => {
  const props = (where: string): ErrorProps => ({ kind: 'error', name: 'TypeError', where });

  it('the same error repeats instead of making a new report', () => {
    const seen = new Set<string>();
    const first = errorStep(seen, props('app:1:2'));
    expect(first.kind).toBe('new');
    if (first.kind === 'new') seen.add(first.key);
    expect(errorStep(seen, props('app:1:2')).kind).toBe('repeat');
  });

  it(`no more than ${ERROR_BUDGET} different errors per load`, () => {
    const seen = new Set(Array.from({ length: ERROR_BUDGET }, (_, i) => `error|TypeError|app:1:${i}`));
    expect(errorStep(seen, props('app:9:9')).kind).toBe('over-budget');
    expect(errorStep(seen, props('app:1:0')).kind).toBe('repeat');
  });
});
