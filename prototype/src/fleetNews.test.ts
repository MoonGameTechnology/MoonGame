import { describe, it, expect } from 'vitest';
import { reorgHeard, reorgKey, destroyHeard, tradeHeard, tradeSide } from './fleetNews';

const ME = 'p1';
const FOE = 'p2';

describe('fleetNews — реорганизация флотов', () => {
  it('слияние и деление слышно только своё (правило 2)', () => {
    expect(reorgHeard(ME, ME)).toBe(true);
    expect(reorgHeard(FOE, ME)).toBe(false);
    expect(reorgHeard('p3', ME)).toBe(false);
  });

  it('безымянный владелец — не я, значит молчим (fail-secure)', () => {
    expect(reorgHeard(undefined, ME)).toBe(false);
    expect(reorgHeard(null, ME)).toBe(false);
  });

  it('у слияния и деления разные ключи, и перепутать их нельзя', () => {
    expect(reorgKey('merged')).toBe('log.fleet.merged');
    expect(reorgKey('split')).toBe('log.fleet.split');
  });
});

describe('fleetNews — гибель флота', () => {
  it('слышит владелец погибшего флота (правило 4)', () => {
    expect(destroyHeard({ fleetId: 'f', owner: ME }, ME)).toBe(true);
  });

  // Решение владельца 2026-10-06: чужое «флот уничтожен» — раскрытие информации. Прежде
  // соло объявляло гибель всем, включая драку ботов за туманом, а сеть — только владельцу.
  it('чужая гибель не слышна — как в сети', () => {
    expect(destroyHeard({ fleetId: 'f', owner: FOE }, ME)).toBe(false);
    expect(destroyHeard({ fleetId: 'f', owner: 'p3' }, ME)).toBe(false);
  });

  it('безымянный владелец — не я (fail-secure)', () => {
    expect(destroyHeard({ fleetId: 'f' }, ME)).toBe(false);
    expect(destroyHeard({ fleetId: 'f', owner: null }, ME)).toBe(false);
  });

  it('израсходованная мина — не гибель: после строки о подрыве журнал молчит (SM-3.6)', () => {
    expect(destroyHeard({ fleetId: 'm', owner: ME, spent: true }, ME)).toBe(false);
  });
});

describe('fleetNews — сделка на рынке', () => {
  it('слышна обеим сторонам сделки (правило 3)', () => {
    expect(tradeHeard(ME, FOE, ME)).toBe(true);
    expect(tradeHeard(FOE, ME, ME)).toBe(true);
  });

  it('чужая сделка не слышна — рынок анонимен для посторонних', () => {
    expect(tradeHeard(FOE, 'p3', ME)).toBe(false);
    expect(tradeHeard(undefined, null, ME)).toBe(false);
  });

  it('сделка сам с собой слышна один раз — это всё ещё моя сделка', () => {
    expect(tradeHeard(ME, ME, ME)).toBe(true);
  });

  it('сторона определяет СЛОВО, а не знак числа (правило 3)', () => {
    expect(tradeSide(ME, ME)).toBe('log.market.buy');
    expect(tradeSide(FOE, ME)).toBe('log.market.sell');
  });

  it('если покупатель не назван — это не моя покупка, значит продажа', () => {
    expect(tradeSide(undefined, ME)).toBe('log.market.sell');
    expect(tradeSide(null, ME)).toBe('log.market.sell');
  });
});
