import { describe, expect, it } from 'vitest';
import { resumeOutcome } from './sessionResume';

describe('resumeOutcome (AC-0.2)', () => {
  it('2xx с токеном — сессия жива, токен её замена (правило 1)', () => {
    expect(resumeOutcome({ status: 200, body: { accountId: 'a', login: 'Ivan', token: 'T2' } })).toEqual({
      kind: 'live',
      token: 'T2',
    });
  });

  it('401 — сессии больше нет (правило 2)', () => {
    expect(resumeOutcome({ status: 401, body: { error: 'E_AUTH' } })).toEqual({ kind: 'gone' });
    expect(resumeOutcome({ status: 401, body: null })).toEqual({ kind: 'gone' });
  });

  it('обрыв, перегрузка и сбой сервера — «не знаю», а не «вышел» (правило 3)', () => {
    expect(resumeOutcome(null)).toEqual({ kind: 'unknown' });
    for (const status of [400, 403, 404, 429, 500, 503])
      expect(resumeOutcome({ status, body: { error: 'E_X' } })).toEqual({ kind: 'unknown' });
  });

  it('2xx без годного токена пропуском не считается (правило 3)', () => {
    for (const body of [null, {}, { token: '' }, { token: 42 }, 'T2'])
      expect(resumeOutcome({ status: 200, body })).toEqual({ kind: 'unknown' });
  });
});
