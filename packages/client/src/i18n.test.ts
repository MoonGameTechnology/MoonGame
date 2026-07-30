import { describe, it, expect } from 'vitest';
import { t, tData, lookup, LOCALE } from './i18n';

// i18n — thin localization runtime for the PWA client (LOC-3). The keys/values
// themselves are covered by prototype/src/i18n.test.ts (the shared /localization
// gate, now scanning packages/client/src too); this only tests the runtime.

describe('i18n — t/lookup/tData', () => {
  it('resolves a known key', () => {
    expect(lookup('welcome.title')).toBe('VOID DOMINION');
    expect(t('welcome.title')).toBe('VOID DOMINION');
  });

  it('interpolates {vars}', () => {
    expect(t('client.net.order', { fleet: 'f1', planet: 'A' })).toContain('f1');
    expect(t('client.net.order', { fleet: 'f1', planet: 'A' })).toContain('A');
  });

  it('a missing key falls back to the key itself — visible, not blank', () => {
    expect(t('no.such.key')).toBe('no.such.key');
    expect(lookup('no.such.key')).toBeUndefined();
  });

  it('tData falls back to the source name on a miss', () => {
    expect(tData('Some Unknown Unit')).toBe('Some Unknown Unit');
  });

  it('LOCALE resolves to a known locale id', () => {
    expect(['ru', 'en']).toContain(LOCALE);
  });
});
