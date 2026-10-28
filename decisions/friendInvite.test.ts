import { describe, expect, it } from 'vitest';
import { inviteMatches, inviteStep } from './friendInvite';

const row = (matchId: string, status = 'ongoing') => ({ matchId, status });

describe('куда позвать друга (FRIENDS-2)', () => {
  it('только идущие свои партии: закончившаяся никого не примет', () => {
    const live = inviteMatches([row('m-1'), row('m-2', 'ended'), row('m-3')]);
    expect(live.map((m) => m.matchId)).toEqual(['m-1', 'm-3']);
  });

  it('одна партия — зовём сразу, без вопроса', () => {
    expect(inviteStep([row('m-1')])).toEqual({ kind: 'send', match: row('m-1') });
  });

  it('несколько — спрашиваем, порядок сервера сохраняется', () => {
    const step = inviteStep([row('m-2'), row('m-1')]);
    expect(step.kind === 'pick' && step.matches.map((m) => m.matchId)).toEqual(['m-2', 'm-1']);
  });

  it('ни одной — честно «звать некуда»', () => {
    expect(inviteStep([])).toEqual({ kind: 'none' });
  });
});
