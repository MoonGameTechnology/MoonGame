import { describe, expect, it } from 'vitest';
import { parseGameData, type GameData } from '../packages/shared-core/src/index';
import { isLander, landerCost, landerTroopCandidates, orderableTroops } from './landerTroops';

const data: GameData = parseGameData({
  version: '0.1.0',
  resources: ['metal', 'credits'],
  units: {
    militia: {
      faction: 'x',
      domain: 'ground',
      kind: 'infantry',
      stats: { attack: 4, defense: 8, hp: 14, speed: 44 },
      cost: { metal: 10 },
    },
    tank: {
      faction: 'x',
      domain: 'ground',
      kind: 'vehicle',
      stats: { attack: 22, defense: 14, hp: 46, speed: 40 },
      cost: { metal: 50, credits: 5 },
    },
    rover: {
      faction: 'x',
      domain: 'ground',
      kind: 'vehicle',
      stats: { attack: 22, defense: 4, hp: 20, speed: 40 },
    },
    conscript: {
      faction: 'x',
      domain: 'ground',
      kind: 'infantry',
      traits: ['issued'],
      stats: { attack: 30, defense: 1, hp: 5, speed: 40 },
    },
    bunker: {
      faction: 'x',
      domain: 'ground',
      kind: 'infantry',
      traits: ['immobile'],
      stats: { attack: 40, defense: 40, hp: 90, speed: 0 },
    },
    lander: {
      faction: 'x',
      domain: 'space',
      traits: ['shuttle', 'lander'],
      stats: { attack: 0, defense: 1, hp: 24, speed: 60, strikeRange: 300, fuel: 4 },
      cost: { metal: 30 },
    },
  },
  factions: {},
  buildings: {},
  events: {},
});

describe('боец десантного челнока (SHU-5.2)', () => {
  it('ДЕСАНТНЫЙ ЧЕЛНОК УЗНАЁТСЯ ПО ТРЕЙТУ, а не по имени', () => {
    expect(isLander(data.units.lander)).toBe(true);
    expect(isLander(data.units.tank)).toBe(false);
    expect(isLander(undefined)).toBe(false);
  });

  it('КАНДИДАТЫ — заказываемые наземные, от самого ударного; равенство — по id', () => {
    // conscript (`issued`) и bunker (`immobile`) ядро не строит — их нет и в списке.
    expect(landerTroopCandidates(data)).toEqual(['rover', 'tank', 'militia']);
  });

  it('НЕХВАТКА ДЕНЕГ НЕ ИСКЛЮЧАЕТ БОЙЦА, запрет ядра — исключает', () => {
    const codes: Record<string, string | null> = {
      rover: 'E_NO_FACTORY',
      tank: 'E_INSUFFICIENT',
      militia: null,
    };
    expect(orderableTroops(['rover', 'tank', 'militia'], (g) => codes[g] ?? null)).toEqual([
      'tank',
      'militia',
    ]);
  });

  it('ЦЕНА — челнок ПЛЮС боец', () => {
    expect(landerCost(data, 'lander', 'tank')).toEqual({ metal: 80, credits: 5 });
  });
});
