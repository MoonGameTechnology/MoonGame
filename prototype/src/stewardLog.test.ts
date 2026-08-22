import { describe, expect, it } from 'vitest';
import {
  ACTIVE_POSTURE,
  decisionsField,
  diffFields,
  signed,
  stewardMine,
  stewardReport,
  type StewardEvent,
  type StewardSnapshot,
} from './stewardLog';

const снимок = (p: Partial<StewardSnapshot> = {}): StewardSnapshot => ({
  planets: 3,
  metal: 100,
  credits: 50,
  ...p,
});
const ГЛИФЫ = { metal: '⛁', credits: '⛃' };

describe('правило 1 — только про себя', () => {
  it('своё событие проходит', () => {
    expect(stewardMine('p1', 'p1')).toBe(true);
  });
  it('чужое не проходит', () => {
    expect(stewardMine('p2', 'p1')).toBe(false);
  });
  it('событие без владельца не проходит', () => {
    expect(stewardMine(undefined, 'p1')).toBe(false);
    expect(stewardMine(null, 'p1')).toBe(false);
  });
});

describe('правило 2 — поза меняет текст', () => {
  it('постановка: активная оборона против обороны', () => {
    expect(stewardReport('delegated', ACTIVE_POSTURE).key).toBe('log.steward.on.active');
    expect(stewardReport('delegated', 'defend').key).toBe('log.steward.on.defense');
    expect(stewardReport('delegated', undefined).key).toBe('log.steward.on.defense');
  });
  it('возврат: активная оборона против обороны', () => {
    expect(stewardReport('expired', ACTIVE_POSTURE).key).toBe('log.steward.handback.active');
    expect(stewardReport('expired', 'defend').key).toBe('log.steward.handback.defense');
  });
  it('снятие позой не интересуется — командование вернул сам игрок', () => {
    expect(stewardReport('recalled', ACTIVE_POSTURE).key).toBe('log.steward.off');
    expect(stewardReport('recalled', undefined).key).toBe('log.steward.off');
  });
});

describe('правило 3 — снимок берут при постановке и гасят при снятии и возврате', () => {
  it('постановка берёт', () => {
    expect(stewardReport('delegated', undefined).snapshot).toBe('take');
  });
  it.each(['recalled', 'expired'] as StewardEvent[])('%s гасит', (k) => {
    expect(stewardReport(k, undefined).snapshot).toBe('clear');
  });
});

describe('правила 4–6 — ночная разница', () => {
  it('без опорного снимка цифр нет вовсе', () => {
    expect(diffFields(null, снимок(), ГЛИФЫ)).toBeNull();
  });
  it('планеты показываются как «было→стало»', () => {
    const d = diffFields(снимок({ planets: 3 }), снимок({ planets: 5 }), ГЛИФЫ);
    expect(d).toMatchObject({ p0: '3', p1: '5' });
  });
  it('ресурсы идут со знаком и с ГЛИФОМ, без разметки', () => {
    const d = diffFields(снимок({ metal: 100, credits: 50 }), снимок({ metal: 130, credits: 20 }), ГЛИФЫ);
    expect(d?.bag).toBe('⛁+30 ⛃−30');
    expect(d?.bag).not.toMatch(/[<>]/); // никакого HTML — тост печатается textContent
  });
  it('нулевая разница показывается как +0, а не пропадает', () => {
    const d = diffFields(снимок(), снимок(), ГЛИФЫ);
    expect(d?.bag).toBe('⛁+0 ⛃+0');
  });
});

describe('правило 5 — знак пишется явно', () => {
  it.each([
    [5, '+5'],
    [0, '+0'],
    [-1, '−1'],
    [-42, '−42'],
  ])('%i → %s', (n, ожидание) => {
    expect(signed(n)).toBe(ожидание);
  });
  it('минус — типографский, а не дефис', () => {
    expect(signed(-3).charCodeAt(0)).toBe(0x2212);
  });
});

describe('правило 7 — о решениях говорят, только если они были', () => {
  it('решений не было — строки нет', () => {
    expect(decisionsField(0)).toBeNull();
  });
  it('решения были — число подставляется', () => {
    expect(decisionsField(4)).toEqual({ n: '4' });
  });
});
