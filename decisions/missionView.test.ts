import { describe, expect, it } from 'vitest';
import type { GameState, Planet, PlanetSnapshot } from '../packages/shared-core/src/index';
import type { MissionObjective } from './missionObjectives';
import { missionBriefs, missionReward, missionRows, missionTargets } from './missionView';
import { WARRANTS_PER_REWARD } from './sectorZeroProgress';

const planet = (id: string, owner: string | null, buildings: Array<[string, number]> = []): Planet => ({
  id,
  owner,
  position: { x: 0, y: 0 },
  resources: {},
  buildings: buildings.map(([type, hp]) => ({ type, level: 1, hp })),
  garrison: [],
  traits: [],
});
const seen = (owner: string | null, buildings: Array<[string, number]> = []): PlanetSnapshot => ({
  owner,
  garrison: [],
  buildings: buildings.map(([type, hp]) => ({ type, level: 1, hp })),
  at: 0,
});

function world(planets: Planet[], memory: Record<string, PlanetSnapshot> = {}): GameState {
  return {
    planets: Object.fromEntries(planets.map((p) => [p.id, p])),
    fog: { p1: memory },
  } as unknown as GameState;
}

const claim: MissionObjective = { id: 'mission.salvage', kind: 'control', targets: ['w1', 'w2'], reward: 3 };
const raze: MissionObjective = { id: 'mission.raze-biomass', kind: 'raze', targets: ['biomass_pit'], reward: 3 };
const recon: MissionObjective = { id: 'mission.recon', kind: 'scout', targets: [], count: 3, reward: 2 };

describe('награда задачи — в валютах, по курсу выплаты за забег', () => {
  it('единица награды — данные и Варранты', () => {
    expect(missionReward(3)).toEqual({ research: 3, warrants: 3 * WARRANTS_PER_REWARD });
    expect(missionReward(-1)).toEqual({ research: 0, warrants: 0 });
  });

  it('строка панели несёт номинал с учётом числа видимых задач', () => {
    // Четыре видимые задачи при базе три — номинал урезан так же, как на итогах.
    const rows = missionRows([claim, raze, recon, { ...recon, id: 'x' }], world([]), 'p1');
    expect(rows[0]!.reward.research).toBe(2); // round(3·3/4)
    expect(missionRows([claim], world([]), 'p1')[0]!.reward.research).toBe(3);
  });
});

describe('метки на карте — только туда, куда игроку идти', () => {
  it('захват: названные миры, которые ещё не взяты', () => {
    const s = world([planet('w1', 'p1'), planet('w2', 'swarm')]);
    expect(missionTargets(claim, s, 'p1')).toEqual(['w2']);
  });

  it('зачистка: только миры, где игрок ПОМНИТ стоящую постройку — разведку метка не выдаёт', () => {
    const s = world(
      [planet('hive', 'swarm', [['biomass_pit', 30]]), planet('far', 'swarm', [['biomass_pit', 30]])],
      { hive: seen('swarm', [['biomass_pit', 30]]) },
    );
    expect(missionTargets(raze, s, 'p1')).toEqual(['hive']);
  });

  it('зачистка: снесённая в памяти и свой мир — не метятся', () => {
    const s = world([planet('a', 'swarm', [['biomass_pit', 30]]), planet('b', 'p1')], {
      a: seen('swarm', [['biomass_pit', 0]]),
      b: seen('swarm', [['biomass_pit', 30]]),
    });
    expect(missionTargets(raze, s, 'p1')).toEqual([]);
  });

  it('разведка, волны и постройки — одной точки нет, меток нет', () => {
    expect(missionTargets(recon, world([]), 'p1')).toEqual([]);
  });

  it('выполненная задача меток не держит', () => {
    const s = world([planet('w1', 'p1'), planet('w2', 'p1')]);
    const [row] = missionRows([claim], s, 'p1');
    expect(row!.complete).toBe(true);
    expect(row!.targets).toEqual([]);
  });
});

describe('карточка главы в меню — задачи следующего забега', () => {
  it('подпись получает «сколько нужно», награда — номинал в валютах', () => {
    expect(missionBriefs([claim, recon])).toEqual([
      { id: 'mission.salvage', n: 2, reward: missionReward(3) },
      { id: 'mission.recon', n: 3, reward: missionReward(2) },
    ]);
  });
});
