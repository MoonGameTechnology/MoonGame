import { describe, expect, it } from 'vitest';
import {
  counterLine,
  spyAddressee,
  spyRepaint,
  type SpyEvent,
} from './spyLog';

describe('правило 1 — кому адресовано событие', () => {
  it.each(['stolen', 'failed'] as SpyEvent[])('%s читает исполнитель', (k) => {
    expect(spyAddressee(k)).toBe('actor');
  });
  it('замеченную операцию читает жертва', () => {
    expect(spyAddressee('detected')).toBe('victim');
  });
});

describe('правило 4 — пойманного зовут по имени, неустановленного нет', () => {
  it('вор пойман — имя называется', () => {
    expect(counterLine('p2')).toEqual({ key: 'log.spy.caught', named: true });
  });
  it.each([undefined, null, ''])('вор не установлен (%s) — имени нет', (spy) => {
    expect(counterLine(spy)).toEqual({ key: 'log.spy.leak', named: false });
  });
  it('раскрытый агент убит — строка об этом говорит (SPY-7)', () => {
    expect(counterLine('p2', true)).toEqual({ key: 'log.spy.caught.killed', named: true });
    expect(counterLine(undefined, true)).toEqual({ key: 'log.spy.leak.killed', named: false });
  });
});

describe('правило 5 — ростер перерисовывается в разные моменты', () => {
  it('кража — ПОСЛЕ проверки адресата: строка разведки только твоя', () => {
    expect(spyRepaint('stolen')).toBe('after');
  });
  it('обнаружение — ДО проверки: расположение бота двигается независимо от адресата', () => {
    expect(spyRepaint('detected')).toBe('before');
  });
  it('провал ростер не трогает', () => {
    expect(spyRepaint('failed')).toBe('never');
  });
});
