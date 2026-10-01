import { describe, it, expect } from 'vitest';
import { battleForecast, type ForecastSide } from './battleForecast';
import { engageForecastCard } from './engageForecast';
import { parseGameData, previewBattle, type GameData } from '../packages/shared-core/src/index';

const data: GameData = parseGameData({
  version: '0.1.0',
  resources: ['metal'],
  units: {
    corvette: {
      faction: 'x',
      domain: 'space',
      stats: { attack: 10, defense: 6, hp: 30, speed: 60 },
    },
  },
  factions: {},
  buildings: {},
  events: {},
});

const side = (
  mine: boolean,
  role: ForecastSide['role'],
  count: number,
  hp?: number,
): ForecastSide => ({
  mine,
  role,
  units: [{ unit: 'corvette', count, ...(hp !== undefined ? { hp } : {}) }],
});

describe('прогноз в окне боя (UIX-6.2)', () => {
  it('в бою двух сторон итог считается для меня, даже когда я обороняюсь', () => {
    const f = battleForecast([side(false, 'attacker', 1), side(true, 'defender', 20)], data);
    expect(f).toMatchObject({
      kind: 'card',
      card: { verdict: 'win', verdictKey: 'engage.forecast.win', tone: 'positive', hours: 1 },
    });
    if (f?.kind === 'card') {
      expect(f.card.ownLossPct).toBe(2);
      expect(f.card.foeLossPct).toBe(100);
    }
  });

  it('когда я нападаю, карточка та же, что у прицела «Атаки»', () => {
    const mine = [{ unit: 'corvette', count: 5 }];
    const foe = [{ unit: 'corvette', count: 4 }];
    expect(
      battleForecast(
        [
          { mine: true, role: 'attacker', units: mine },
          { mine: false, role: 'defender', units: foe },
        ],
        data,
      ),
    ).toEqual({ kind: 'card', card: engageForecastCard(previewBattle(mine, foe, data)) });
  });

  it('роль берётся у стороны: враг перешёл в атаку, и тот же бой проигран', () => {
    const defends = battleForecast([side(true, 'attacker', 4), side(false, 'defender', 5)], data);
    const attacks = battleForecast([side(true, 'attacker', 4), side(false, 'attacker', 5)], data);
    expect(defends).toMatchObject({ kind: 'card', card: { verdict: 'win', hours: 6 } });
    expect(attacks).toMatchObject({ kind: 'card', card: { verdict: 'loss', hours: 3 } });
  });

  it('считает от текущего состава: израненный флот проигрывает бой, который выиграл бы целым', () => {
    const fresh = battleForecast([side(true, 'attacker', 5), side(false, 'defender', 4)], data);
    const worn = battleForecast([side(true, 'attacker', 5, 5), side(false, 'defender', 4)], data);
    expect(fresh).toMatchObject({ kind: 'card', card: { verdict: 'win', hours: 3 } });
    expect(worn).toMatchObject({
      kind: 'card',
      card: { verdict: 'loss', hours: 1, ownLossPct: 100 },
    });
  });

  it('сторон больше двух: прогноза нет, и окно так и говорит', () => {
    expect(
      battleForecast(
        [side(true, 'attacker', 5), side(false, 'defender', 4), side(false, 'attacker', 3)],
        data,
      ),
    ).toEqual({ kind: 'many' });
  });

  it('меня в бою нет: вердикта нет вовсе', () => {
    expect(
      battleForecast([side(false, 'attacker', 5), side(false, 'defender', 4)], data),
    ).toBeNull();
    expect(
      battleForecast(
        [side(false, 'attacker', 5), side(false, 'defender', 4), side(false, 'attacker', 3)],
        data,
      ),
    ).toBeNull();
  });

  it('одна из сторон уже пуста: бой решён, считать нечего', () => {
    expect(
      battleForecast([side(true, 'attacker', 5), side(false, 'defender', 0)], data),
    ).toBeNull();
    expect(
      battleForecast([side(true, 'defender', 0), side(false, 'attacker', 2)], data),
    ).toBeNull();
  });

  it('не трогает состав, который ему дали', () => {
    const sides = [side(true, 'attacker', 5, 120), side(false, 'defender', 4)];
    const before = JSON.stringify(sides);
    battleForecast(sides, data);
    expect(JSON.stringify(sides)).toBe(before);
  });
});
