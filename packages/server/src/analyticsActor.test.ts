import { describe, expect, it } from 'vitest';
import { analyticsActor, analyticsActorFromEnv, journalRecord } from './analyticsActor';

const SALT = 'a'.repeat(32);

describe('analyticsActor', () => {
  it('one account → one stable pseudonym; different accounts → different ones', () => {
    const actor = analyticsActor(SALT);
    expect(actor('acc-1')).toBe(actor('acc-1'));
    expect(actor('acc-1')).not.toBe(actor('acc-2'));
    expect(actor('acc-1')).toMatch(/^[0-9a-f]{16}$/);
  });

  it('the pseudonym does not contain the account id', () => {
    expect(analyticsActor(SALT)('acc-1')).not.toContain('acc-1');
  });

  it('another salt gives another pseudonym (rotation cuts the link)', () => {
    expect(analyticsActor(SALT)('acc-1')).not.toBe(analyticsActor('b'.repeat(32))('acc-1'));
  });

  it('a missing or short salt disables pseudonyms instead of making guessable ones', () => {
    expect(analyticsActorFromEnv({})).toBeUndefined();
    expect(analyticsActorFromEnv({ ANALYTICS_SALT: 'short' })).toBeUndefined();
    expect(analyticsActorFromEnv({ ANALYTICS_SALT: SALT })?.('acc-1')).toBe(
      analyticsActor(SALT)('acc-1'),
    );
  });
});

describe('journalRecord', () => {
  const actorOf = analyticsActor(SALT);

  it('a join becomes actor + seat; the raw account id is gone', () => {
    const rec = journalRecord('m1', { kind: 'join', playerId: 'p1', accountId: 'acc-1' }, actorOf);
    expect(rec).toEqual({ match: 'm1', kind: 'join', playerId: 'p1', actor: actorOf('acc-1') });
    expect(JSON.stringify(rec)).not.toContain('acc-1');
  });

  it('without a salt the join carries no actor and still no account id', () => {
    const rec = journalRecord(
      'm1',
      { kind: 'join', playerId: 'p1', accountId: 'acc-1' },
      undefined,
    );
    expect(rec).toEqual({ match: 'm1', kind: 'join', playerId: 'p1' });
  });

  it('other observations pass through with their match id', () => {
    expect(journalRecord('m1', { kind: 'leave', playerId: 'p1' }, actorOf)).toEqual({
      match: 'm1',
      kind: 'leave',
      playerId: 'p1',
    });
  });
});
