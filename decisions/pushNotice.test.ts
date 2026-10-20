import { describe, expect, it } from 'vitest';
import {
  GENERIC_KEY,
  isAskMoment,
  kindsFrom,
  parsePushPayload,
  PUSH_KINDS,
  PUSH_TEXT_KEYS,
  pushNoticeText,
  pushOpenPath,
  pushSettingsState,
  pushTexts,
  shouldAskPush,
  toggleKind,
  vapidKeyBytes,
} from './pushNotice';

const ev = (type: string, payload: unknown) => ({ type, payload });
const TEXTS = {
  'push.attacked': 'ATTACKED',
  'push.more': '+{n}',
  [GENERIC_KEY]: 'NEWS',
};

describe('UIX-4.4 · push notice on the client', () => {
  it('the server key becomes the title, `more` — the line under it', () => {
    const p = parsePushPayload({ key: 'push.attacked', params: { place: 'w1' }, matchId: 'm1', more: 2 });
    expect(p).toEqual({ key: 'push.attacked', matchId: 'm1', more: 2 });
    expect(pushNoticeText(p, TEXTS)).toEqual({ title: 'ATTACKED', body: '+2' });
    expect(pushNoticeText({ ...p, more: 0 }, TEXTS).body).toBe('');
  });

  it('a body it cannot trust still shows something — the generic text, no match', () => {
    for (const raw of [null, 'x', { key: 'push.evil' }, { key: 'alert(1)', matchId: 'm1' }]) {
      const p = parsePushPayload(raw);
      expect(p.key).toBe(GENERIC_KEY);
      expect(pushNoticeText(p, TEXTS).title).toBe('NEWS');
    }
    const odd = parsePushPayload({ key: 'push.built', matchId: '../admin', more: -3 });
    expect(odd).toEqual({ key: 'push.built', matchId: '', more: 0 });
    expect(parsePushPayload({ key: 'push.built', matchId: 'm', more: 1.5 }).more).toBe(0);
  });

  it('a missing text shows the key itself, like everywhere else', () => {
    expect(pushNoticeText(parsePushPayload({ key: 'push.researched' }), {}).title).toBe(
      'push.researched',
    );
  });

  it('the page hands the worker every key it may need, on the chosen locale', () => {
    const texts = pushTexts((k) => `«${k}»`);
    expect(Object.keys(texts)).toEqual([...PUSH_TEXT_KEYS]);
    expect(texts['push.more']).toBe('«push.more»');
  });

  it('a tap opens the match by its address, inside the mounted client', () => {
    expect(pushOpenPath({ key: 'push.built', matchId: 'm-1', more: 0 })).toBe('/game/m-1');
    expect(pushOpenPath({ key: 'push.built', matchId: 'm-1', more: 0 }, '/dev')).toBe(
      '/dev/game/m-1',
    );
    expect(pushOpenPath({ key: GENERIC_KEY, matchId: '', more: 0 })).toBe('/');
  });

  it('the moment to ask: my calm news — not an attack, not someone else’s', () => {
    const me = 'p1';
    expect(isAskMoment([ev('battle.started', { defender: 'p1', attacker: 'p2' })], me)).toBe(false);
    expect(isAskMoment([ev('battle.resolved', { winners: [], losers: ['p1'] })], me)).toBe(true);
    expect(isAskMoment([ev('battle.resolved', { winners: ['p2'], losers: ['p3'] })], me)).toBe(false);
    expect(isAskMoment([ev('building.upgraded', { owner: 'p1' })], me)).toBe(true);
    expect(isAskMoment([ev('building.constructed', { owner: 'p3' })], me)).toBe(false);
    expect(isAskMoment([ev('technology.researched', { playerId: 'p1' })], me)).toBe(true);
    expect(isAskMoment([ev('fleet.arrived', { owner: 'p1' }), ev('battle.resolved', null)], me)).toBe(
      false,
    );
  });

  it('consent is asked once, after news, signed in, where push works', () => {
    const ok = { supported: true, signedIn: true, permission: 'default' as const, answered: false };
    expect(shouldAskPush(ok, true)).toBe(true);
    expect(shouldAskPush(ok, false)).toBe(false);
    expect(shouldAskPush({ ...ok, answered: true }, true)).toBe(false);
    expect(shouldAskPush({ ...ok, signedIn: false }, true)).toBe(false);
    expect(shouldAskPush({ ...ok, supported: false }, true)).toBe(false);
    expect(shouldAskPush({ ...ok, permission: 'denied' }, true)).toBe(false);
    expect(shouldAskPush({ ...ok, permission: 'granted' }, true)).toBe(false);
  });

  it('switches keep the server order and never repeat; junk in storage means every kind', () => {
    expect(toggleKind(['researched'], 'attacked', true)).toEqual(['attacked', 'researched']);
    expect(toggleKind(['attacked', 'battle'], 'attacked', false)).toEqual(['battle']);
    expect(toggleKind(['battle'], 'battle', true)).toEqual(['battle']);
    expect(kindsFrom(null)).toEqual([...PUSH_KINDS]);
    expect(kindsFrom(['built', 'x', 'built'])).toEqual(['built']);
    expect(kindsFrom([])).toEqual([]);
  });

  it('the settings show what the player can actually do', () => {
    const base = { supported: true, signedIn: true, permission: 'granted' as const, subscribed: true };
    expect(pushSettingsState(base)).toBe('on');
    expect(pushSettingsState({ ...base, subscribed: false })).toBe('off');
    expect(pushSettingsState({ ...base, permission: 'default' })).toBe('off');
    expect(pushSettingsState({ ...base, permission: 'denied' })).toBe('blocked');
    expect(pushSettingsState({ ...base, signedIn: false })).toBe('guest');
    expect(pushSettingsState({ ...base, supported: false })).toBe('unsupported');
  });

  it('the VAPID key is base64url without padding', () => {
    expect([...vapidKeyBytes('AQID_-8')]).toEqual([1, 2, 3, 255, 239]);
  });
});
