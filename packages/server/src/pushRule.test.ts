import { describe, expect, it } from 'vitest';
import { groupedPush, pushNotices } from './pushRule';

const ev = (type: string, payload: unknown) => ({ type, payload });

describe('UIX-4.3 · push only for my own urgent news', () => {
  it('an attack on me is news; my own attack and a war elsewhere are not', () => {
    const events = [
      ev('battle.started', { location: 'w1', attacker: 'p2', defender: 'p1' }),
      ev('battle.started', { location: 'w2', attacker: 'p1', defender: 'p3' }),
      ev('battle.started', { location: 'w3', attacker: 'p2', defender: 'p3' }),
    ];
    expect(pushNotices(events, 'p1')).toEqual([
      { key: 'push.attacked', params: { place: 'w1' }, anchor: 'w1' },
    ]);
  });

  it('the end of my battle: won or lost; a draw and others’ battles stay silent', () => {
    const won = ev('battle.resolved', { location: 'w1', winners: ['p1'], losers: ['p2'] });
    const lost = ev('battle.resolved', { location: 'w2', winners: ['p3'], losers: ['p1'] });
    const draw = ev('battle.resolved', { location: 'w3', winners: [], losers: [] });
    const theirs = ev('battle.resolved', { location: 'w4', winners: ['p2'], losers: ['p3'] });
    expect(pushNotices([won, lost, draw, theirs], 'p1').map((n) => n.key)).toEqual([
      'push.battle-won',
      'push.battle-lost',
    ]);
  });

  it('my building and my research finished; someone else’s are not my news', () => {
    const events = [
      ev('building.constructed', { planetId: 'w1', building: 'mine', owner: 'p1' }),
      ev('building.upgraded', { planetId: 'w1', building: 'mine', level: 2, owner: 'p1' }),
      ev('building.constructed', { planetId: 'w5', building: 'mine', owner: 'p2' }),
      ev('technology.researched', { playerId: 'p1', technology: 'radar' }),
      ev('technology.researched', { playerId: 'p2', technology: 'radar' }),
    ];
    expect(pushNotices(events, 'p1')).toEqual([
      { key: 'push.built', params: { place: 'w1', building: 'mine' }, anchor: 'w1' },
      { key: 'push.built', params: { place: 'w1', building: 'mine' }, anchor: 'w1' },
      { key: 'push.researched', params: { technology: 'radar' } },
    ]);
  });

  it('arrivals, starts and malformed payloads are not pushed', () => {
    const events = [
      ev('fleet.arrived', { fleetId: 'f1', at: 'w1' }),
      ev('construction.started', { planetId: 'w1', owner: 'p1' }),
      ev('battle.started', null),
      ev('building.constructed', { owner: 'p1' }),
      ev('technology.researched', { playerId: 'p1' }),
    ];
    expect(pushNotices(events, 'p1')).toEqual([]);
  });

  it('a batch is one push: the most urgent leads, the rest is a number', () => {
    const events = [
      ev('technology.researched', { playerId: 'p1', technology: 'radar' }),
      ev('battle.resolved', { location: 'w2', winners: ['p1'], losers: ['p2'] }),
      ev('battle.started', { location: 'w1', attacker: 'p2', defender: 'p1' }),
    ];
    const push = groupedPush(pushNotices(events, 'p1'), 'm1');
    expect(push).toEqual({
      key: 'push.attacked',
      params: { place: 'w1' },
      anchor: 'w1',
      matchId: 'm1',
      more: 2,
    });
    expect(groupedPush([], 'm1')).toBeNull();
  });

  it('carries keys and ids only — no words the server would have to localize', () => {
    const push = groupedPush(
      pushNotices(
        [ev('building.constructed', { planetId: 'w1', building: 'mine', owner: 'p1' })],
        'p1',
      ),
      'm1',
    );
    expect(push?.key).toMatch(/^push\.[a-z-]+$/);
    expect(Object.values(push!.params).every((v) => /^[\w-]+$/.test(v))).toBe(true);
  });
});
