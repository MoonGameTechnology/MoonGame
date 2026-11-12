import { describe, expect, it } from 'vitest';
import { SPY_JOURNEY_EVENTS, spyJourneyKey } from './spyJourney';

describe('spyJourney — строки журнала о пути шпиона', () => {
  it('правило 1: только владельцу шпиона', () => {
    for (const type of SPY_JOURNEY_EVENTS) {
      expect(spyJourneyKey(type, { owner: 'p1' }, 'p1')).not.toBeNull();
      expect(spyJourneyKey(type, { owner: 'p2' }, 'p1')).toBeNull();
    }
  });

  it('правило 3: раскрытый на ожидании — ушёл, убит или перевербован', () => {
    expect(spyJourneyKey('espionage.caught', { owner: 'p1' }, 'p1')).toBe('log.spy.blown');
    expect(spyJourneyKey('espionage.caught', { owner: 'p1', agentLost: true }, 'p1')).toBe('log.spy.blown.killed');
    expect(spyJourneyKey('espionage.caught', { owner: 'p1', agentLost: true, agentTurned: true }, 'p1')).toBe(
      'log.spy.blown.turned',
    );
  });

  it('правило 4: передислокация звучит своей строкой, операция — прежней', () => {
    expect(spyJourneyKey('espionage.sent', { owner: 'p1', op: 'relocate' }, 'p1')).toBe('log.spy.relocate');
    expect(spyJourneyKey('espionage.sent', { owner: 'p1', op: 'recon' }, 'p1')).toBeNull();
  });
});
