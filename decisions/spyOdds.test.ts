import { describe, expect, it } from 'vitest';
import { parseGameData } from '../packages/shared-core/src/index';
import { hasOdds, joinsWave, knownBureau, knownDevelopment, oddsPct, spyOdds } from './spyOdds';

const data = parseGameData({
  version: '0.1.0',
  resources: ['credits'],
  units: {},
  factions: {},
  buildings: {
    bureau: { name: 'Bureau', cost: {}, spyDetectBonus: 0.1, levels: [{ spyDetectBonus: 0.2 }] },
    mine: { name: 'Mine', cost: {}, buildTimeHours: 1 },
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

  it('правило 6: у перехода и поста контрразведки нет броска — нет и строки шанса', () => {
    expect(hasOdds('relocate')).toBe(false);
    expect(hasOdds('counter')).toBe(false);
    for (const op of ['recon', 'research', 'theft', 'delay', 'disrupt', 'sabotage'] as const)
      expect(hasOdds(op)).toBe(true);
  });

  it('правило 7: переезд и пост в волну не входят', () => {
    expect(joinsWave('relocate')).toBe(false);
    expect(joinsWave('counter')).toBe(false);
    expect(joinsWave(undefined)).toBe(false);
    expect(joinsWave('sabotage')).toBe(true);
  });

  it('правило 8: кража с самого развитого известного мира — +20% к успеху, риск по исходу', () => {
    const rich = [{ type: 'mine', level: 1 }];
    const dev = knownDevelopment('theft', rich, [rich], data);
    expect(dev).toBe(1);
    const o = spyOdds(1, 0, dev);
    expect(oddsPct(o.success)).toBe(80);
    // 0.8 × 0.25 + 0.2 × 0.5: развитость двигает успех, но не раскрытие
    expect(oddsPct(o.risk)).toBe(30);
  });

  it('правило 8: доля — от самого развитого известного мира владельца; саботажу бонуса нет', () => {
    const poor = [{ type: 'mine', level: 1 }];
    const rich = [{ type: 'mine', level: 1 }, { type: 'mine', level: 1 }, { type: 'mine', level: 1 }, { type: 'mine', level: 1 }];
    expect(knownDevelopment('research', poor, [poor, rich], data)).toBe(0.25);
    expect(oddsPct(spyOdds(1, 0, 0.25).success)).toBe(65);
    expect(knownDevelopment('sabotage', rich, [rich], data)).toBe(0);
  });

  it('правило 8: постройки цели неизвестны или пусты — бонуса нет', () => {
    expect(knownDevelopment('theft', null, [[{ type: 'mine', level: 1 }]], data)).toBe(0);
    expect(knownDevelopment('theft', [], [], data)).toBe(0);
  });
});
