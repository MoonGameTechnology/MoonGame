import { describe, expect, it } from 'vitest';
import { kfmt } from './format';
import {
  chipDead,
  chipShort,
  flowDigits,
  flowPrefix,
  flowRounded,
  flowShown,
  flowSign,
  stockBleeds,
} from './resourceChip';

describe('flowRounded', () => {
  // Правило 1: медленная утечка обязана остаться видимой.
  it('keeps a sub-1 drain visible as a tenth', () => {
    expect(flowRounded(-0.4)).toBe(-0.4);
    expect(flowRounded(-0.44)).toBe(-0.4);
    expect(flowRounded(0.25)).toBe(0.3);
  });

  it('rounds a rate of one or more to a whole number', () => {
    expect(flowRounded(1.4)).toBe(1);
    expect(flowRounded(-12.6)).toBe(-13);
    expect(flowRounded(1)).toBe(1);
  });

  // Ноль остаётся нулём — правило 2 опирается именно на это.
  it('leaves a still resource at zero', () => {
    expect(flowRounded(0)).toBe(0);
  });

  // А вот дренаж настолько малый, что не дотягивает и до десятой, честно схлопывается.
  it('collapses a rate below half a tenth', () => {
    expect(flowRounded(0.04)).toBe(0);
  });
});

describe('chipDead', () => {
  // Правило 2: «И», а не «ИЛИ».
  it('dims only an empty and still resource', () => {
    expect(chipDead(0, 0)).toBe(true);
  });

  it('keeps an empty resource lit while it flows', () => {
    expect(chipDead(0, 0.4)).toBe(false);
    expect(chipDead(0, -2)).toBe(false);
  });

  it('keeps a stocked resource lit even with no flow', () => {
    expect(chipDead(500, 0)).toBe(false);
  });
});

describe('chipShort', () => {
  it('flags a resource named in the arrears', () => {
    expect(chipShort(['energy', 'food'], 'food')).toBe(true);
  });

  it('leaves a paid resource alone', () => {
    expect(chipShort(['energy'], 'food')).toBe(false);
    expect(chipShort([], 'food')).toBe(false);
  });
});

describe('flowShown', () => {
  // Правило 4: нулевой поток не пишется.
  it('hides a zero rate on desktop', () => {
    expect(flowShown(false, 0)).toBe(false);
  });

  it('prints a live rate on desktop', () => {
    expect(flowShown(false, 3)).toBe(true);
    expect(flowShown(false, -0.4)).toBe(true);
  });

  // Правило 6: телефон не печатает скорость никогда.
  it('never prints a rate on a phone', () => {
    expect(flowShown(true, 3)).toBe(false);
    expect(flowShown(true, -0.4)).toBe(false);
    expect(flowShown(true, 0)).toBe(false);
  });
});

describe('flowSign / flowPrefix', () => {
  it('marks a gain up and with a plus', () => {
    expect(flowSign(3)).toBe('up');
    expect(flowPrefix(3)).toBe('+');
  });

  it('marks a drain down and without a sign of its own', () => {
    expect(flowSign(-3)).toBe('dn');
    expect(flowPrefix(-3)).toBe('');
  });

  // Ноль до подписи не доходит (правило 4), но класс у него «вниз» — как в старом коде.
  it('treats zero as the down case', () => {
    expect(flowSign(0)).toBe('dn');
    expect(flowPrefix(0)).toBe('');
  });
});

describe('flowDigits', () => {
  // Правило 5: сокращение только там, где нечего терять.
  it('shortens a large rate', () => {
    expect(flowDigits(1500, kfmt)).toBe('1.5k');
    expect(flowDigits(12, kfmt)).toBe('12');
  });

  it('keeps the tenth of a slow rate instead of letting kfmt eat it', () => {
    expect(flowDigits(-0.4, kfmt)).toBe('-0.4');
    expect(kfmt(-0.4)).toBe('0'); // ровно тот лживый «0», от которого спасает правило
  });
});

describe('stockBleeds', () => {
  it('paints the stock red on a phone while the resource drains', () => {
    expect(stockBleeds(true, -2)).toBe(true);
  });

  it('leaves the stock alone on a gain or a standstill', () => {
    expect(stockBleeds(true, 2)).toBe(false);
    expect(stockBleeds(true, 0)).toBe(false);
  });

  it('never paints the stock on desktop — the rate is printed there instead', () => {
    expect(stockBleeds(false, -2)).toBe(false);
  });
});
