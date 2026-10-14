import { describe, expect, it } from 'vitest';
import {
  admittedEvents,
  appLoadedProps,
  entryTag,
  inviteTag,
  loginEvent,
  wsClosedProps,
} from './sessionAnalytics';

describe('inviteTag', () => {
  it('a short tag passes, anything else is dropped, not cleaned', () => {
    expect(inviteTag('?src=tg-oct')).toBe('tg-oct');
    expect(inviteTag('?src=TG')).toBeNull();
    expect(inviteTag('?src=neo%40mail.example')).toBeNull();
    expect(inviteTag(`?src=${'a'.repeat(33)}`)).toBeNull();
    expect(inviteTag('?join=m1')).toBeNull();
  });
});

describe('appLoadedProps', () => {
  it('whole milliseconds, entry and invite tag', () => {
    expect(
      appLoadedProps({ loadMs: 1234.567, entry: 'sector-zero', mobile: true, lang: 'en', search: '?src=reddit' }),
    ).toEqual({ loadMs: 1235, entry: 'sector-zero', mobile: true, lang: 'en', src: 'reddit' });
  });

  it('no invite → no src field; a strange entry → other', () => {
    expect(appLoadedProps({ loadMs: 10, entry: undefined, mobile: false, lang: 'ru', search: '' })).toEqual({
      loadMs: 10,
      entry: 'main',
      mobile: false,
      lang: 'ru',
    });
    expect(entryTag('<b>')).toBe('other');
  });
});

describe('loginEvent', () => {
  it('ok and created are a success, the rest is a failure with its code', () => {
    expect(loginEvent('ok')).toEqual({ event: 'login_ok', props: { created: false } });
    expect(loginEvent('created')).toEqual({ event: 'login_ok', props: { created: true } });
    expect(loginEvent('wrong-password')).toEqual({ event: 'login_failed', props: { code: 'wrong-password' } });
    expect(loginEvent('nick-rule')).toEqual({ event: 'login_failed', props: { code: 'nick-rule' } });
  });
});

describe('admittedEvents', () => {
  it('a first entry is ws_ready + match_joined', () => {
    expect(admittedEvents({ connectMs: 812.4, reconnect: false, firstEver: true })).toEqual([
      { event: 'ws_ready', props: { connectMs: 812, reconnect: false } },
      { event: 'match_joined', props: { firstTime: true } },
    ]);
  });

  it('a reconnect is not a new join', () => {
    expect(admittedEvents({ connectMs: 50, reconnect: true, firstEver: false })).toEqual([
      { event: 'ws_ready', props: { connectMs: 50, reconnect: true } },
    ]);
  });
});

describe('wsClosedProps', () => {
  it('keeps the close code and lifetime', () => {
    expect(wsClosedProps(1006, 60_000.7)).toEqual({ code: 1006, afterMs: 60_001 });
  });
});
