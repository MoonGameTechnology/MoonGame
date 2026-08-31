import { describe, it, expect } from 'vitest';
import {
  diploConcernsMe,
  stanceKey,
  stanceThread,
  offerAudience,
  offerUnread,
  declineHeard,
} from './diploAudience';

const ME = 'p1';
const FOE = 'p2';
const THIRD = 'p3';

describe('diploAudience — кого касается событие', () => {
  it('слышно, только если я одна из сторон (правило 1)', () => {
    expect(diploConcernsMe(ME, FOE, ME)).toBe(true);
    expect(diploConcernsMe(FOE, ME, ME)).toBe(true);
    expect(diploConcernsMe(FOE, THIRD, ME)).toBe(false);
  });

  it('безымянные стороны — не я, значит молчим (fail-secure)', () => {
    expect(diploConcernsMe(undefined, null, ME)).toBe(false);
  });
});

describe('diploAudience — текст смены стойки', () => {
  it('у войны свой ключ, у остальных общий (правило 2)', () => {
    expect(stanceKey('war')).toBe('log.diplo.war');
    for (const st of ['peace', 'pact', 'alliance']) {
      expect(stanceKey(st), st).toBe('log.diplo.stance');
    }
  });

  it('незнакомая стойка не выдаётся за войну', () => {
    expect(stanceKey(undefined)).toBe('log.diplo.stance');
    expect(stanceKey('WAR')).toBe('log.diplo.stance');
  });
});

describe('diploAudience — адрес треда', () => {
  // Сторож РАСХОЖДЕНИЯ 2 из шапки: тред адресуется по `b`, а не по собеседнику.
  // Тест фиксирует текущее поведение — включая случай, где `b` это сам игрок.
  it('тред ключуется по `b`, автор — `a` (текущее поведение)', () => {
    expect(stanceThread(ME, FOE)).toEqual({ key: FOE, from: ME });
  });

  it('когда стойку меняют МНЕ, тред уходит на моё же место — расхождение задокументировано', () => {
    expect(stanceThread(FOE, ME)).toEqual({ key: ME, from: FOE });
  });
});

describe('diploAudience — предложения', () => {
  it('входящее слышит адресат (правила 3–4)', () => {
    expect(offerAudience(FOE, ME, ME, false)).toBe('incoming');
    expect(offerAudience(FOE, ME, ME, true)).toBe('incoming');
  });

  it('своё исходящее объявляется человеку и молчит у бота (правило 4)', () => {
    expect(offerAudience(ME, FOE, ME, false)).toBe('sent');
    expect(offerAudience(ME, FOE, ME, true)).toBe('silent');
  });

  it('чужое предложение мимо меня — молчим', () => {
    expect(offerAudience(FOE, THIRD, ME, false)).toBe('silent');
    expect(offerAudience(FOE, THIRD, ME, true)).toBe('silent');
  });

  it('непрочитанным считается только входящее (правило 3)', () => {
    expect(offerUnread('incoming')).toBe(true);
    expect(offerUnread('sent')).toBe(false);
    expect(offerUnread('silent')).toBe(false);
  });
});

describe('diploAudience — отказ', () => {
  it('читает только предлагавший (правило 5)', () => {
    expect(declineHeard(ME, ME)).toBe(true);
    expect(declineHeard(FOE, ME)).toBe(false);
    expect(declineHeard(undefined, ME)).toBe(false);
  });
});
