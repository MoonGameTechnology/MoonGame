import { describe, expect, it } from 'vitest';
import { guestGateHtml } from './guestGate';

describe('guestGateHtml', () => {
  it('offers «Войти» when the server takes sign-ins', () => {
    const html = guestGateHtml('☍', 'тело', true);
    expect(html).toContain('data-guest-signin');
    expect(html).toContain('тело');
  });

  it('names the reason without a dead button when sign-in is impossible', () => {
    const html = guestGateHtml('☍', 'тело', false);
    expect(html).not.toContain('data-guest-signin');
    expect(html).toContain('тело');
  });

  it('escapes the body', () => {
    expect(guestGateHtml('▤', '<b>', false)).toContain('&lt;b&gt;');
  });
});
