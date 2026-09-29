import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { engageForecastCard, type EngageForecastInput } from './engageForecast';
import { parseGameData, previewBattle, type GameData } from '../packages/shared-core/src/index';

const data: GameData = parseGameData({
  version: '0.1.0',
  resources: ['metal'],
  units: {
    corvette: { faction: 'x', domain: 'space', stats: { attack: 10, defense: 6, hp: 30, speed: 60 } },
  },
  factions: {},
  buildings: {},
  events: {},
});

const pv = (
  outcome: EngageForecastInput['outcome'],
  roundsEst: number,
  own: number,
  foe: number,
): EngageForecastInput => ({
  outcome,
  roundsEst,
  attacker: { damageFraction: own },
  defender: { damageFraction: foe },
});

describe('карточка прогноза у цели «Атаки» (UIX-6.1)', () => {
  it('итог — словом, и цвет только дублирует его', () => {
    expect(engageForecastCard(pv('attacker', 3, 0.2, 1))).toMatchObject({
      verdict: 'win',
      verdictKey: 'engage.forecast.win',
      tone: 'positive',
    });
    expect(engageForecastCard(pv('defender', 5, 1, 0.3))).toMatchObject({
      verdict: 'loss',
      verdictKey: 'engage.forecast.loss',
      tone: 'negative',
    });
    expect(engageForecastCard(pv('stalemate', 240, 0.4, 0.4))).toMatchObject({
      verdict: 'draw',
      verdictKey: 'engage.forecast.draw',
      tone: 'neutral',
    });
  });

  it('часы до конца — это раунды прогноза, потери — целые проценты корпуса', () => {
    const card = engageForecastCard(pv('attacker', 4, 0.234, 0.996));
    expect(card.hours).toBe(4);
    expect(card.ownLossPct).toBe(23);
    expect(card.foeLossPct).toBe(100);
  });

  it('проценты не выходят за 0…100 и не бывают NaN', () => {
    const card = engageForecastCard(pv('attacker', -1, Number.NaN, 1.7));
    expect(card.hours).toBe(0);
    expect(card.ownLossPct).toBe(0);
    expect(card.foeLossPct).toBe(100);
  });

  it('принимает прогноз ядра как есть: превосходящий флот побеждает', () => {
    const card = engageForecastCard(
      previewBattle([{ unit: 'corvette', count: 20 }], [{ unit: 'corvette', count: 1 }], data),
    );
    expect(card.verdict).toBe('win');
    expect(card.ownLossPct).toBeLessThan(card.foeLossPct);
  });

  it('ключи слов и строки есть в обеих локалях', () => {
    for (const loc of ['ru', 'en']) {
      const src = readFileSync(new URL(`../localization/${loc}.ts`, import.meta.url), 'utf8');
      for (const key of [
        'engage.forecast.win',
        'engage.forecast.draw',
        'engage.forecast.loss',
        'engage.forecast.line',
      ])
        expect(src.includes(`'${key}'`), `${loc}: ${key}`).toBe(true);
    }
  });
});
