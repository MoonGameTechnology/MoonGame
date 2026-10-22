import { describe, expect, it } from 'vitest';
import { corpMemberActions, type CorpMemberRole } from './corpMembers';

const m = (accountId: string, role: CorpMemberRole) => ({ accountId, role });

describe('права над участником корпорации (CORP-3)', () => {
  it('заявку принимают и отклоняют глава и офицеры, участник — нет', () => {
    expect(corpMemberActions('head', 'me', m('r', 'recruit'))).toEqual(['accept', 'decline']);
    expect(corpMemberActions('officer', 'me', m('r', 'recruit'))).toEqual(['accept', 'decline']);
    expect(corpMemberActions('member', 'me', m('r', 'recruit'))).toEqual([]);
  });

  it('главу и себя не трогает никто', () => {
    expect(corpMemberActions('officer', 'me', m('h', 'head'))).toEqual([]);
    expect(corpMemberActions('head', 'me', m('me', 'head'))).toEqual([]);
    expect(corpMemberActions('officer', 'me', m('me', 'officer'))).toEqual([]);
  });

  it('глава меняет роль, передаёт главенство и исключает', () => {
    expect(corpMemberActions('head', 'me', m('a', 'member'))).toEqual(['officer', 'transfer', 'kick']);
    expect(corpMemberActions('head', 'me', m('b', 'officer'))).toEqual(['member', 'transfer', 'kick']);
  });

  it('офицер исключает только участников, участник — никого', () => {
    expect(corpMemberActions('officer', 'me', m('a', 'member'))).toEqual(['kick']);
    expect(corpMemberActions('officer', 'me', m('b', 'officer'))).toEqual([]);
    expect(corpMemberActions('member', 'me', m('a', 'member'))).toEqual([]);
    expect(corpMemberActions('recruit', 'me', m('a', 'member'))).toEqual([]);
  });
});
