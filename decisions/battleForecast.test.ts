import { describe, it, expect } from 'vitest';
import { battleForecast, battleHostility, type ForecastSide } from './battleForecast';
import { engageForecastCard } from './engageForecast';
import {
  createInitialState,
  parseGameData,
  previewBattle,
  setStance,
  type GameData,
} from '../packages/shared-core/src/index';

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
  owner = mine ? 'me' : 'foe',
): ForecastSide => ({
  mine,
  role,
  owner,
  units: [{ unit: 'corvette', count, ...(hp !== undefined ? { hp } : {}) }],
});

describe('прогноз в окне боя (UIX-6.2)', () => {
  it('в бою двух сторон итог считается для меня, даже когда я обороняюсь', () => {
    const f = battleForecast([side(false, 'attacker', 1), side(true, 'defender', 20)], data);
    expect(f).toMatchObject({
      verdict: 'win',
      verdictKey: 'engage.forecast.win',
      tone: 'positive',
      hours: 1,
      ownLossPct: 2,
      foeLossPct: 100,
    });
  });

  it('когда я нападаю, карточка та же, что у прицела «Атаки»', () => {
    const mine = [{ unit: 'corvette', count: 5 }];
    const foe = [{ unit: 'corvette', count: 4 }];
    expect(
      battleForecast(
        [
          { mine: true, role: 'attacker', units: mine, owner: 'me' },
          { mine: false, role: 'defender', units: foe, owner: 'foe' },
        ],
        data,
      ),
    ).toEqual(engageForecastCard(previewBattle(mine, foe, data)));
  });

  it('роль берётся у стороны: враг перешёл в атаку, и тот же бой проигран', () => {
    const defends = battleForecast([side(true, 'attacker', 4), side(false, 'defender', 5)], data);
    const attacks = battleForecast([side(true, 'attacker', 4), side(false, 'attacker', 5)], data);
    expect(defends).toMatchObject({ verdict: 'win', hours: 6 });
    expect(attacks).toMatchObject({ verdict: 'loss', hours: 3 });
  });

  it('считает от текущего состава: израненный флот проигрывает бой, который выиграл бы целым', () => {
    const fresh = battleForecast([side(true, 'attacker', 5), side(false, 'defender', 4)], data);
    const worn = battleForecast([side(true, 'attacker', 5, 5), side(false, 'defender', 4)], data);
    expect(fresh).toMatchObject({ verdict: 'win', hours: 3 });
    expect(worn).toMatchObject({ verdict: 'loss', hours: 1, ownLossPct: 100 });
  });

  it('ТРИ СТОРОНЫ: вердикт — по всей цепочке, а не по первой гибели (UIX-6.3)', () => {
    // Все против всех. Первым падает слабый враг; бой на этом не кончается — мой флот
    // сходится со вторым врагом и добивает его.
    const f = battleForecast(
      [
        side(true, 'attacker', 12),
        side(false, 'defender', 2, undefined, 'foe1'),
        side(false, 'attacker', 6, undefined, 'foe2'),
      ],
      data,
    );
    expect(f).toMatchObject({ verdict: 'win', foeLossPct: 100 });
    expect(f!.ownLossPct).toBeGreaterThan(0);
    expect(f!.ownLossPct).toBeLessThan(100);
  });

  /** Враждебен только `foe`: союзник и сосед воюют с ним, но не со мной. */
  const onlyFoe: Parameters<typeof battleForecast>[2] = (a, b) =>
    a !== b && !(a !== 'foe' && b !== 'foe');

  it('союзник — не враг: он дерётся рядом, и его выживание победе не мешает', () => {
    const f = battleForecast(
      [
        side(true, 'attacker', 4),
        { ...side(false, 'attacker', 5, undefined, 'ally'), ally: true },
        side(false, 'defender', 8),
      ],
      data,
      onlyFoe,
    );
    expect(f).toMatchObject({ verdict: 'win', foeLossPct: 100 });
    // Один на один тот же враг мне не по зубам: победу дал союзник.
    expect(
      battleForecast([side(true, 'attacker', 4), side(false, 'defender', 8)], data),
    ).toMatchObject({ verdict: 'loss' });
  });

  // Решение владельца 2026-10-01: «если победа, то победа». Союз выиграл — это победа, и
  // гибель моих кораблей не делает её ничьей: потери стоят в карточке отдельной цифрой.
  it('моя сторона пала, а союзник победил — это победа, потери моих 100%', () => {
    const f = battleForecast(
      [
        side(true, 'attacker', 1),
        { ...side(false, 'attacker', 30, undefined, 'ally'), ally: true },
        side(false, 'defender', 4),
      ],
      data,
      onlyFoe,
    );
    expect(f).toMatchObject({ verdict: 'win', ownLossPct: 100, foeLossPct: 100 });
  });

  it('устоял сосед — не союзник и не враг: его победа не моя, ничья', () => {
    const f = battleForecast(
      [
        side(true, 'attacker', 1),
        side(false, 'attacker', 30, undefined, 'neutral'),
        side(false, 'defender', 4),
      ],
      data,
      onlyFoe,
    );
    expect(f).toMatchObject({ verdict: 'draw', ownLossPct: 100, foeLossPct: 100 });
  });

  it('враждебных мне в бою нет — вердикта нет', () => {
    expect(
      battleForecast(
        [side(true, 'attacker', 5), side(false, 'defender', 4, undefined, 'ally')],
        data,
        () => false,
      ),
    ).toBeNull();
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

describe('вражда сторон в прогнозе (UIX-6.3)', () => {
  it('враги — только при войне; ничейный враждебен всякому, кроме ничейного', () => {
    const s = createInitialState({ seed: 'h', version: { data: '0.1.0', manifest: '1' } });
    setStance(s, 'p1', 'p2', 'war');
    setStance(s, 'p1', 'p3', 'alliance');
    setStance(s, 'p1', 'p4', 'peace');
    const hostile = battleHostility(s);
    expect(hostile('p1', 'p2')).toBe(true);
    expect(hostile('p1', 'p3')).toBe(false);
    expect(hostile('p1', 'p4')).toBe(false);
    expect(hostile('p1', 'p1')).toBe(false);
    expect(hostile(null, 'p1')).toBe(true);
    expect(hostile(null, null)).toBe(false);
  });
});
