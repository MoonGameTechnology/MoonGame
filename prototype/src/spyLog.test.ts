import { describe, expect, it } from 'vitest';
import {
  bootyKind,
  bootyText,
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

describe('правило 2 — успех называет добычу по виду', () => {
  it('казна и флоты называют ЖЕРТВУ', () => {
    expect(bootyText('treasury')).toEqual({ key: 'log.spy.what.treasury', field: 'who' });
    expect(bootyText('fleets')).toEqual({ key: 'log.spy.what.fleets', field: 'who' });
  });
  it('мир называет САМ МИР, а не владельца', () => {
    expect(bootyText('planet')).toEqual({ key: 'log.spy.what.world', field: 'at' });
  });
  it('незнакомый вид падает в «мир» — строка остаётся осмысленной', () => {
    expect(bootyText('из-будущего').key).toBe('log.spy.what.world');
  });
  it('ключи трёх видов попарно различны', () => {
    const k = ['treasury', 'fleets', 'planet'].map((x) => bootyText(x).key);
    expect(new Set(k).size).toBe(3);
  });
});

describe('правило 4 — контрразведка называет вид добычи без имени жертвы', () => {
  it.each([
    ['treasury', 'log.spy.kind.treasury'],
    ['fleets', 'log.spy.kind.fleets'],
    ['planet', 'log.spy.kind.world'],
    ['неизвестно', 'log.spy.kind.world'],
  ])('%s → %s', (kind, ожидание) => {
    expect(bootyKind(kind)).toBe(ожидание);
  });
  it('ключи контрразведки НЕ совпадают с ключами успеха — там нет подстановки жертвы', () => {
    for (const kind of ['treasury', 'fleets', 'planet'])
      expect(bootyKind(kind)).not.toBe(bootyText(kind).key);
  });
});

describe('правило 4 — пойманного зовут по имени, неустановленного нет', () => {
  it('вор пойман — имя называется', () => {
    expect(counterLine('p2')).toEqual({ key: 'log.spy.caught', named: true });
  });
  it.each([undefined, null, ''])('вор не установлен (%s) — имени нет', (spy) => {
    expect(counterLine(spy)).toEqual({ key: 'log.spy.leak', named: false });
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
