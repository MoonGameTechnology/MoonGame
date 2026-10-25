import { describe, expect, it } from 'vitest';
import {
  isLoopbackAddress,
  isOperatorRequest,
  isMetricsReaderRequest,
  metricsReaderTokenFromEnv,
  MIN_OPERATOR_TOKEN_LENGTH,
  operatorTokenFromEnv,
} from './operatorAccess';

const TOKEN = 'x'.repeat(MIN_OPERATOR_TOKEN_LENGTH);
const READER = 'y'.repeat(MIN_OPERATOR_TOKEN_LENGTH);
const req = (remoteAddress: string | undefined, headers: Record<string, unknown> = {}) => ({
  remoteAddress,
  headers,
});

describe('isLoopbackAddress', () => {
  it('accepts IPv4 loopback, IPv6 loopback and the IPv4-mapped form', () => {
    for (const a of ['127.0.0.1', '127.1.2.3', '::1', '::ffff:127.0.0.1']) {
      expect(isLoopbackAddress(a)).toBe(true);
    }
  });
  it('refuses everything else, including the Docker bridge gateway', () => {
    for (const a of [undefined, '', '172.18.0.1', '10.0.0.5', '::ffff:172.18.0.1', '2001:db8::1', '1270.0.0.1']) {
      expect(isLoopbackAddress(a)).toBe(false);
    }
  });
});

describe('operatorTokenFromEnv', () => {
  it('ignores an unset or short token', () => {
    expect(operatorTokenFromEnv({})).toBeUndefined();
    expect(operatorTokenFromEnv({ METRICS_TOKEN: 'short' })).toBeUndefined();
  });
  it('returns a long enough token', () => {
    expect(operatorTokenFromEnv({ METRICS_TOKEN: TOKEN })).toBe(TOKEN);
  });
});

describe('isOperatorRequest', () => {
  it('lets a direct loopback peer in without a token', () => {
    expect(isOperatorRequest(req('127.0.0.1'), undefined)).toBe(true);
  });

  it('requires the configured operator credential even on loopback', () => {
    for (const address of ['127.0.0.1', '::1', '::ffff:127.0.0.1']) {
      expect(isOperatorRequest(req(address), TOKEN)).toBe(false);
      expect(isOperatorRequest(req(address, { authorization: 'Basic ignored' }), TOKEN)).toBe(false);
      expect(isOperatorRequest(req(address, { authorization: `Bearer ${TOKEN}` }), TOKEN)).toBe(true);
    }
  });

  it('refuses a public peer, with or without a configured token', () => {
    expect(isOperatorRequest(req('203.0.113.7'), undefined)).toBe(false);
    expect(isOperatorRequest(req('203.0.113.7'), TOKEN)).toBe(false);
  });

  it('refuses a loopback peer that forwarded someone else (a proxy on this host)', () => {
    expect(isOperatorRequest(req('127.0.0.1', { 'x-forwarded-for': '203.0.113.7' }), undefined)).toBe(false);
    // Spoofing the header the other way does not help a public peer either.
    expect(isOperatorRequest(req('203.0.113.7', { 'x-forwarded-for': '127.0.0.1' }), undefined)).toBe(false);
  });

  it('lets in any peer that presents the right token', () => {
    expect(isOperatorRequest(req('172.18.0.1', { authorization: `Bearer ${TOKEN}` }), TOKEN)).toBe(true);
  });

  it('refuses a wrong token even from loopback', () => {
    expect(isOperatorRequest(req('127.0.0.1', { authorization: 'Bearer nope' }), TOKEN)).toBe(false);
    expect(isOperatorRequest(req('127.0.0.1', { authorization: `Bearer ${TOKEN}` }), undefined)).toBe(false);
  });
});

describe('aggregate-only monitoring credential', () => {
  it('refuses short credentials and accidental reuse of the operator credential', () => {
    expect(metricsReaderTokenFromEnv({})).toBeUndefined();
    expect(metricsReaderTokenFromEnv({ METRICS_READER_TOKEN: READER, METRICS_TOKEN: TOKEN })).toBe(READER);
    expect(() => metricsReaderTokenFromEnv({ METRICS_READER_TOKEN: 'short' })).toThrow('E_METRICS_READER_CONFIG');
    expect(() => metricsReaderTokenFromEnv({ METRICS_READER_TOKEN: TOKEN, METRICS_TOKEN: TOKEN })).toThrow('E_METRICS_READER_CONFIG');
    expect(() => metricsReaderTokenFromEnv({ METRICS_READER_TOKEN: READER })).toThrow('E_METRICS_READER_CONFIG');
    expect(() => metricsReaderTokenFromEnv({ METRICS_READER_TOKEN: READER, METRICS_TOKEN: 'short' })).toThrow('E_METRICS_READER_CONFIG');
  });

  it('allows aggregates without granting operator access, including from forwarded loopback', () => {
    for (const address of ['172.18.0.1', '127.0.0.1']) {
      const request = req(address, { authorization: `Bearer ${READER}`, 'x-forwarded-for': '127.0.0.1' });
      expect(isMetricsReaderRequest(request, TOKEN, READER)).toBe(true);
      expect(isOperatorRequest(request, TOKEN)).toBe(false);
    }
  });

  it('does not fall back to loopback for an invalid, unset or retired token', () => {
    for (const token of ['wrong', READER]) {
      const request = req('127.0.0.1', { authorization: `Bearer ${token}` });
      expect(isMetricsReaderRequest(request, TOKEN, undefined)).toBe(false);
      expect(isMetricsReaderRequest(request, TOKEN, 'replacement-reader-token-for-this-fixture')).toBe(false);
    }
    expect(isMetricsReaderRequest(req('172.18.0.1'), TOKEN, READER)).toBe(false);
    expect(isMetricsReaderRequest(req('172.18.0.1', { authorization: `Bearer ${TOKEN}` }), TOKEN, READER)).toBe(true);
  });
});
