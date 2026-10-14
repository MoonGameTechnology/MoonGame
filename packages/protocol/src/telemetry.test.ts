import { describe, expect, it } from 'vitest';
import { parseTelemetryBatch, TELEMETRY_MAX_EVENTS, TELEMETRY_MAX_PROPS } from './telemetry';

const ev = (over: Record<string, unknown> = {}) => ({
  id: 'ev-00000001',
  e: 'session_started',
  t: 1_700_000_000_000,
  ...over,
});
const batch = (over: Record<string, unknown> = {}) => ({
  v: 1,
  install: 'install-0001',
  session: 'session-0001',
  build: 'abc1234',
  events: [ev()],
  ...over,
});

describe('parseTelemetryBatch', () => {
  it('accepts a well-formed batch as is', () => {
    const body = batch({ events: [ev({ p: { step: 'map', n: 3, first: true } })] });
    expect(parseTelemetryBatch(body)).toEqual({ ok: true, batch: body, dropped: 0 });
  });

  it.each([
    ['not an object', 'x'],
    ['an array', []],
    ['wrong version', batch({ v: 2 })],
    ['an extra envelope field', batch({ accountId: 'acc-1' })],
    ['a short install id', batch({ install: 'x' })],
    ['a session id with odd characters', batch({ session: 'session 0001' })],
    ['a build with spaces', batch({ build: 'a b' })],
    ['no events', batch({ events: [] })],
    ['too many events', batch({ events: Array.from({ length: TELEMETRY_MAX_EVENTS + 1 }, () => ev()) })],
  ])('refuses the whole batch: %s', (_name, body) => {
    expect(parseTelemetryBatch(body)).toEqual({ ok: false });
  });

  it.each([
    ['an unknown event name', ev({ e: 'drop_table' })],
    ['an extra event field', ev({ actor: 'forged' })],
    ['a negative time', ev({ t: -1 })],
    ['nested props', ev({ p: { a: { b: 1 } } })],
    ['a prop name that is not camel/snake', ev({ p: { 'Bad-Key': 1 } })],
    ['a long prop value', ev({ p: { a: 'x'.repeat(121) } })],
    ['a control character', ev({ p: { a: 'line\nbreak' } })],
    ['a non-finite number', ev({ p: { a: Number.POSITIVE_INFINITY } })],
    [
      'too many props',
      ev({ p: Object.fromEntries(Array.from({ length: TELEMETRY_MAX_PROPS + 1 }, (_, i) => [`k${i}`, 1])) }),
    ],
  ])('drops and counts a bad event: %s', (_name, bad) => {
    const res = parseTelemetryBatch(batch({ events: [ev(), bad] }));
    expect(res).toEqual({ ok: true, batch: batch({ events: [ev()] }), dropped: 1 });
  });
});
