import { describe, expect, it } from 'vitest';
import { matchCreationAllowed } from './matchCreation';

describe('server permission to create a session', () => {
  it('requires an explicit boolean grant from a successful response', () => {
    expect(matchCreationAllowed({ status: 200, body: { canCreate: true } })).toBe(true);
  });
  it.each([null, { status: 401, body: { canCreate: true } },
    { status: 403, body: { canCreate: true } }, { status: 503, body: { canCreate: true } },
    { status: 404, body: {} }, ...[null, [], true, {}, { canCreate: false },
      { canCreate: 'true' }, { canCreate: 1 }, Object.create({ canCreate: true }) as unknown]
      .map(body => ({ status: 200, body }))])('denies unknown or refused capabilities: %j', reply => {
    expect(matchCreationAllowed(reply)).toBe(false);
  });
});
