import { describe, it, expect } from 'vitest';
import { shippedGameData } from '../data/bundle';
import { trainingState } from '../packages/client/src/gameData';
import type { GameState } from '../packages/shared-core/src/index';
import {
  TRAINING_STAGES,
  fleetGone,
  fortified,
  garrisoned,
  inOrbit,
  owns,
  productionGrew,
  shipBuilt,
  squadronHome,
  techDone,
  trainingBaseline,
  trainingWon,
} from './trainingStages';

const data = shippedGameData();
const ME = 'p1';
const fresh = (): GameState => structuredClone(trainingState(data));

describe('этапы учебного полигона: засчёт по результату игры', () => {
  it('двенадцать этапов §14.4, без повторов', () => {
    expect(TRAINING_STAGES).toHaveLength(12);
    expect(new Set(TRAINING_STAGES).size).toBe(12);
  });

  it('на входе ни один этап с ростом не засчитан — база уже стоит, но это не дело игрока', () => {
    const s = fresh();
    const b = trainingBaseline(s, ME, data);
    expect(b.forts).toBe(1); // форт базы из карты
    expect(productionGrew(s, ME, b, data)).toBe(false);
    expect(shipBuilt(s, ME, b)).toBe(false);
    expect(techDone(s, ME, b)).toBe(false);
    expect(fortified(s, ME, b)).toBe(false);
    expect(trainingWon(s, ME)).toBe(false);
  });

  it('рост засчитывается от отметки: корабль, технология, постройка', () => {
    const s = fresh();
    const b = trainingBaseline(s, ME, data);
    s.fleets.p1_2!.units[0]!.count += 1;
    expect(shipBuilt(s, ME, b)).toBe(true);
    s.players[ME]!.technologies = { ...s.players[ME]!.technologies!, completed: ['orbital_defense_grid'] };
    expect(techDone(s, ME, b)).toBe(true);
    s.planets.base!.buildings.push({ type: 'mine', level: 1 } as never);
    expect(productionGrew(s, ME, b, data)).toBe(true);
  });

  it('чужое не засчитывается: форт и ПКО противника — не закрепление игрока', () => {
    const s = fresh();
    const b = trainingBaseline(s, ME, data);
    expect(s.planets.target!.buildings.some((x) => x.type === 'orbital_aa')).toBe(true);
    expect(fortified(s, ME, b)).toBe(false);
    s.planets.outpost!.owner = ME;
    s.planets.outpost!.buildings.push({ type: 'fort', level: 1 } as never, { type: 'orbital_aa', level: 1 } as never);
    expect(fortified(s, ME, b)).toBe(true);
    expect(garrisoned(s, ME, 'outpost')).toBe(true); // гарнизон поста остался на месте
    expect(garrisoned(s, ME, 'target')).toBe(false);
  });

  it('владение, уничтожение флота, орбита', () => {
    const s = fresh();
    expect(owns(s, ME, 'base')).toBe(true);
    expect(owns(s, ME, 'outpost')).toBe(false);
    expect(fleetGone(s, 'p2_patrol')).toBe(false);
    delete s.fleets.p2_patrol;
    expect(fleetGone(s, 'p2_patrol')).toBe(true);
    expect(inOrbit(s, ME, 'base')).toBe(true);
    expect(inOrbit(s, ME, 'outpost')).toBe(false);
  });

  it('эскадра «дома», только пока ни один вылет игрока не в воздухе', () => {
    const s = fresh();
    expect(squadronHome(s, ME)).toBe(true);
    s.strikes = [{ owner: ME } as never];
    expect(squadronHome(s, ME)).toBe(false);
  });

  it('победа — только своя и только в законченной партии', () => {
    const s = fresh();
    s.match = { ...s.match, status: 'ended', winner: 'p2' };
    expect(trainingWon(s, ME)).toBe(false);
    s.match = { ...s.match, winner: ME };
    expect(trainingWon(s, ME)).toBe(true);
  });
});
