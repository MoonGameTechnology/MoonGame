import { describe, expect, it } from 'vitest';
import { parseGameData, type GameData } from '../packages/shared-core/src/index';
import { confidentGroundWin, forecastGround } from './groundForecast';

const data: GameData = parseGameData({
  version: '0.1.0',
  resources: ['metal'],
  units: {
    militia: { faction: 'x', domain: 'ground', kind: 'infantry', stats: { attack: 4, defense: 8, hp: 14, speed: 44 } },
    heavy: { faction: 'x', domain: 'ground', kind: 'infantry', stats: { attack: 8, defense: 20, hp: 34, speed: 40 } },
    tank: { faction: 'x', domain: 'ground', kind: 'vehicle', stats: { attack: 22, defense: 14, hp: 46, speed: 40 } },
  },
  factions: {},
  buildings: {},
  events: {},
});

const st = (unit: string, count: number) => ({ unit, count });

describe('прогноз наземного боя', () => {
  it('ПУСТАЯ ОБОРОНА — мир берётся без боя', () => {
    const f = forecastGround([st('militia', 1)], [], data);
    expect(f.winner).toBe('attacker');
    expect(f.rounds).toBe(0);
  });

  it('ПУСТАЯ АТАКА не берёт ничего — даже пустой мир', () => {
    expect(forecastGround([], [], data).winner).toBe('defender');
    expect(forecastGround([], [st('militia', 1)], data).winner).toBe('defender');
  });

  it('ПЕРЕВЕС РЕШАЕТ: десять танков против одного ополченца — победа атакующего', () => {
    const f = forecastGround([st('tank', 10)], [st('militia', 1)], data);
    expect(f.winner).toBe('attacker');
    expect(f.attackerSurvivors).toBe(10);
  });

  it('ГАРНИЗОН СИЛЬНЕЕ — отбивается: один ополченец против десяти тяжёлых', () => {
    expect(forecastGround([st('militia', 1)], [st('heavy', 10)], data).winner).toBe('defender');
  });

  it('прогноз НИЧЕГО НЕ МЕНЯЕТ во входных стеках — иначе он ломал бы состояние', () => {
    const att = [st('tank', 3)];
    const def = [st('militia', 9)];
    forecastGround(att, def, data);
    expect(att).toEqual([{ unit: 'tank', count: 3 }]);
    expect(def).toEqual([{ unit: 'militia', count: 9 }]);
  });

  it('УВЕРЕННОСТЬ СТРОЖЕ ПОБЕДЫ: обороне даётся фора за то, чего прогноз не видит', () => {
    // Прогноз не знает про укрепления, местность и тип планеты — их накидывает хук
    // `combat.damage` только обороняющемуся и только на земле. Поэтому «победил в
    // прогнозе» и «уверен» — разные ответы, и у края они расходятся.
    const att = [st('tank', 3)];
    const def = [st('heavy', 3)];
    expect(forecastGround(att, def, data).winner).toBe('attacker');
    expect(confidentGroundWin(att, def, data)).toBe(false);
  });

  it('при явном перевесе уверенность есть', () => {
    expect(confidentGroundWin([st('tank', 12)], [st('militia', 2)], data)).toBe(true);
  });
});
