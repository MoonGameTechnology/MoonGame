/**
 * УРОН ШАТТЛОВ МЕЖДУ ВЫЛЕТАМИ (SHU-5.3, резолюция владельца 2026-09-26, shuttles-roadmap §0.6).
 *
 * До кирпича недобитый урон вылета (`ShuttleStrike.damage`) пропадал на посадке: машина,
 * получившая полкорпуса, возвращалась как новая. Теперь:
 *
 * 1. **Недобитый урон переезжает на эскадру** (`Squadron.damage`) и уходит с ней в
 *    следующий вылет — второй такой же залп подбитую машину сбивает.
 * 2. **Эскадра чинится у ДОКА** тем же темпом, что корпус корабля (`shipRepair`): в
 *    порту своего мира и на борту флота, стоящего у дока. Без дока — не чинится.
 * 3. **Делёж и слияние** носят урон с собой: делится по числу бортов, при слиянии
 *    складывается.
 */
import { describe, expect, it } from 'vitest';
import { createKernel } from '../kernel/kernel';
import { shuttleModule } from './shuttle';
import { constructionModule } from './construction';
import {
  createInitialState,
  type Fleet,
  type GameState,
  type Planet,
  type Player,
} from '../state/gameState';
import { parseGameData, type GameData } from '../data/schemas';
import type { Action, Context } from '../action/types';

const data: GameData = parseGameData({
  version: '0.1.0',
  resources: ['metal'],
  units: {
    // Пять крейсеров — 100 огня, ответка челноку 5% от него: ровно полкорпуса страйкера.
    cruiser: {
      faction: 'x',
      domain: 'space',
      stats: { attack: 20, defense: 5, speed: 6, hp: 200, cargoCapacity: 4 },
    },
    striker: {
      faction: 'x',
      domain: 'space',
      traits: ['shuttle'],
      stats: {
        attack: 12,
        defense: 3,
        speed: 100,
        hp: 10,
        strikeRange: 180,
        fuel: 4,
        rearmRounds: 2,
        cargoSize: 1,
      },
    },
  },
  factions: {},
  buildings: {
    spaceport: { name: 'Spaceport', cost: {}, buildTimeHours: 0, hp: 30, shuttleBay: 12 },
    // Док: 10% полного корпуса в час.
    dock: { name: 'Dock', cost: {}, buildTimeHours: 0, hp: 30, shipRepair: 0.1 },
  },
  events: {},
});

const HOUR = 3_600_000;
const kernel = createKernel([constructionModule, shuttleModule]);
const at = (s: GameState): Context => ({ now: s.time, data });
const player = (id: string): Player => ({
  id,
  name: id,
  faction: 'x',
  status: 'active',
  resources: {},
});

function planet(id: string, owner: string | null, x: number, buildings: string[] = []): Planet {
  return {
    id,
    owner,
    position: { x, y: 0 },
    resources: {},
    buildings: buildings.map((type) => ({ type, level: 1, hp: data.buildings[type]!.hp })),
    garrison: [],
    traits: [],
  };
}

function fleet(id: string, owner: string, location: string, units: Array<[string, number]>): Fleet {
  return {
    id,
    owner,
    location,
    movement: null,
    units: units.map(([unit, count]) => ({ unit, count })),
    traits: [],
    battleId: null,
  };
}

/** Свой порт A(0) с одним страйкером, у B(100) — пять вражеских крейсеров. */
function world(homeBuildings: string[] = ['spaceport']): GameState {
  const s = createInitialState({ seed: 'shu53', version: { data: '0.1.0', manifest: '1' } });
  const home = planet('A', 'p1', 0, homeBuildings);
  home.hangar = [{ id: 'sq:1', units: [{ unit: 'striker', count: 1 }] }];
  return {
    ...s,
    players: { p1: player('p1'), p2: player('p2') },
    planets: { A: home, B: planet('B', 'p2', 100) },
    fleets: { E1: fleet('E1', 'p2', 'B', [['cruiser', 5]]) },
    heroes: {},
    battles: {},
  };
}

let seq = 0;
const act = (type: string, payload: Record<string, unknown>): Action => ({
  id: `a:${seq++}`,
  type,
  playerId: 'p1',
  payload,
  issuedAt: 0,
});
const strike = (): Action =>
  act('shuttle.strike', { planetId: 'A', squadronId: 'sq:1', targetFleetId: 'E1' });

function apply(state: GameState, action: Action): GameState {
  const r = kernel.applyAction(state, action, at(state));
  if (!r.ok) throw new Error(r.code);
  return r.state;
}
function advance(state: GameState, hours: number): GameState {
  const r = kernel.advanceTo(state, { now: state.time + hours * HOUR, data });
  if (!r.ok) throw new Error(r.code);
  return r.state;
}
/** Вылет туда и обратно: час до цели и два домой — полкорпуса летит вполскорости (SHU-5.7). */
const sortie = (s: GameState): GameState => advance(apply(s, strike()), 3);
const squad = (s: GameState, id = 'sq:1') => (s.planets.A?.hangar ?? []).find((q) => q.id === id);

describe('SHU-5.3 — урон шаттлов между вылетами', () => {
  it('ГОТОВО: подбитый страйкер возвращается подбитым, и второй такой же удар его сбивает', () => {
    let s = sortie(world());
    expect(squad(s)?.units).toEqual([{ unit: 'striker', count: 1 }]);
    expect(squad(s)?.damage).toBe(5);
    s = sortie(s);
    expect(s.planets.A?.hangar ?? []).toEqual([]);
  });

  it('у дока подбитый страйкер чинится со временем — и тогда второй удар он переживает', () => {
    let s = sortie(world(['spaceport', 'dock']));
    // Сел ровно в конце прогона, чинить ещё не начал.
    expect(squad(s)?.damage).toBe(5);
    s = advance(s, 2); // 10%/ч от корпуса 10 — минус 2
    expect(squad(s)?.damage).toBeCloseTo(3);
    s = advance(s, 3);
    expect(squad(s)?.damage).toBeUndefined();
    s = sortie(s);
    expect(squad(s)?.units).toEqual([{ unit: 'striker', count: 1 }]);
  });

  it('без дока эскадра не чинится', () => {
    const s = advance(sortie(world()), 24);
    expect(squad(s)?.damage).toBe(5);
  });

  it('эскадра на борту флота чинится, только пока флот стоит у своего дока', () => {
    const base = world(['spaceport', 'dock']);
    base.planets.C = planet('C', 'p1', 400);
    base.fleets.CR = {
      ...fleet('CR', 'p1', 'A', [['cruiser', 1]]),
      hangar: [{ id: 'sq:7', units: [{ unit: 'striker', count: 1 }], damage: 5 }],
    };
    expect(advance(base, 2).fleets.CR?.hangar?.[0]?.damage).toBeCloseTo(3);
    const away = { ...base, fleets: { ...base.fleets, CR: { ...base.fleets.CR!, location: 'C' } } };
    expect(advance(away, 2).fleets.CR?.hangar?.[0]?.damage).toBe(5);
  });

  it('делёж раздаёт урон по бортам, слияние складывает его обратно', () => {
    const s = world();
    s.planets.A!.hangar = [{ id: 'sq:1', units: [{ unit: 'striker', count: 4 }], damage: 8 }];
    const split = apply(
      s,
      act('shuttle.split', {
        planetId: 'A',
        squadronId: 'sq:1',
        units: [{ unit: 'striker', count: 1 }],
      }),
    );
    const [named, other] = split.planets.A!.hangar!;
    expect(named?.damage).toBe(6);
    expect(other?.damage).toBe(2);
    const merged = apply(
      split,
      act('shuttle.merge', { planetId: 'A', squadronId: other!.id, intoId: 'sq:1' }),
    );
    expect(merged.planets.A?.hangar).toEqual([
      { id: 'sq:1', units: [{ unit: 'striker', count: 4 }], damage: 8 },
    ]);
  });
});
