import { describe, expect, it } from 'vitest';
import { ordnanceLogKey } from './ordnanceLog';

describe('ordnanceLogKey', () => {
  it('names a mine event by the mine and a hangar missile by the missile', () => {
    expect(ordnanceLogKey('rocketMine.hit', { owner: 'me' }, 'me')).toBe('mine.hit');
    expect(ordnanceLogKey('rocketMine.hit', { owner: 'me', mine: true }, 'me')).toBe('mine.hit');
    expect(ordnanceLogKey('rocketMine.hit', { owner: 'me', mine: false }, 'me')).toBe(
      'missile.hit',
    );
    expect(ordnanceLogKey('rocketMine.intercepted', { playerId: 'me', mine: false }, 'me')).toBe(
      'missile.intercepted',
    );
  });

  it('writes the missile launch and miss for the owner only', () => {
    expect(ordnanceLogKey('missile.launched', { owner: 'me' }, 'me')).toBe('missile.launched');
    expect(ordnanceLogKey('missile.missed', { owner: 'me' }, 'me')).toBe('missile.missed');
    expect(ordnanceLogKey('missile.missed', { owner: 'foe' }, 'me')).toBeNull();
    expect(ordnanceLogKey('rocketMine.hit', { owner: 'foe' }, 'me')).toBeNull();
  });

  it('stays silent on other events', () => {
    expect(ordnanceLogKey('fleet.moved', { owner: 'me' }, 'me')).toBeNull();
    expect(ordnanceLogKey('rocketMine.flight', { owner: 'me' }, 'me')).toBeNull();
    expect(ordnanceLogKey('time.advanced', undefined, 'me')).toBeNull();
    expect(ordnanceLogKey('missile.missed', undefined, 'me')).toBeNull();
  });
});
