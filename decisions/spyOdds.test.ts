import { describe, expect, it } from 'vitest';
import { parseGameData } from '../packages/shared-core/src/index';
import { knownBureau, oddsPct, spyOdds } from './spyOdds';

const data = parseGameData({
  version: '0.1.0',
  resources: ['credits'],
  units: {},
  factions: {},
  buildings: {
    bureau: { name: 'Bureau', cost: {}, spyDetectBonus: 0.1, levels: [{ spyDetectBonus: 0.2 }] },
    mine: { name: 'Mine', cost: {} },
  },
  events: {},
});

describe('spyOdds — шанс на кнопке операции (SPY-19)', () => {
  it('правила 1–2: на базе 60% успеха и 35% риска', () => {
    const o = spyOdds(1, 0);
    expect(oddsPct(o.success)).toBe(60);
    expect(oddsPct(o.risk)).toBe(35);
  });

  it('правило 4: известное бюро цели поднимает риск, но не шанс', () => {
    const o = spyOdds(1, 0.1);
    expect(oddsPct(o.success)).toBe(60);
    expect(oddsPct(o.risk)).toBe(45);
  });

  it('правило 3: своя волна поднимает и успех, и риск', () => {
    const o = spyOdds(2, 0);
    expect(oddsPct(o.success)).toBe(70);
    expect(o.risk).toBeGreaterThan(spyOdds(1, 0).risk);
    expect(spyOdds(9, 0)).toEqual(spyOdds(3, 0)); // не больше трёх агентов на мире
  });

  it('правило 5: раскрытие не выходит за единицу', () => {
    expect(spyOdds(1, 5).risk).toBe(1);
  });

  it('правило 4: сильнейшее известное бюро, без бюро — ноль', () => {
    expect(knownBureau([], data)).toBe(0);
    expect(knownBureau([{ type: 'mine', level: 1 }], data)).toBe(0);
    expect(knownBureau([{ type: 'bureau', level: 1 }, { type: 'mine', level: 1 }], data)).toBe(0.1);
  });
});
