import { describe, it, expect } from 'vitest';
import { createKernel } from '../kernel/kernel';
import { autoMergeModule } from './autoMerge';
import { fleetOpsModule } from './fleetOps';
import { movementModule } from './movement';
import {
  createInitialState,
  type Fleet,
  type GameState,
  type Hero,
  type Planet,
  type Player,
} from '../state/gameState';
import { parseGameData, type GameData } from '../data/schemas';
import type { Action, ApplyResult, Context } from '../action/types';

// Автослияние на прибытии (заказ владельца 2026-10-03): долетевший флот вливается в
// свой, стоящий в узле, без приказа `fleet.merge`.

const data: GameData = parseGameData({
  version: '0.1.0',
  resources: ['metal'],
  units: {
    cruiser: { faction: 'x', domain: 'space', stats: { attack: 5, defense: 5, speed: 6, hp: 40 } },
    hero: {
      faction: 'x',
      domain: 'space',
      traits: ['hero'],
      stats: { attack: 2, defense: 2, speed: 6, hp: 60 },
    },
    gun: {
      faction: 'x',
      domain: 'space',
      traits: ['immobile'],
      stats: { attack: 9, defense: 9, speed: 0, hp: 80 },
    },
  },
  factions: {},
  buildings: {},
  events: {},
});
const ctx: Context = { now: 0, data };
const HOUR = 3_600_000;
const kernel = createKernel([movementModule, fleetOpsModule, autoMergeModule]);

function player(id: string, extra: Partial<Player> = {}): Player {
  return { id, name: id, faction: 'x', status: 'active', resources: {}, ...extra };
}
function planet(id: string, x: number, links: string[]): Planet {
  return {
    id,
    owner: 'p1',
    position: { x, y: 0 },
    resources: {},
    buildings: [],
    garrison: [],
    traits: [],
    links,
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
  };
}
function hero(id: string, fleetId: string): Hero {
  return {
    id,
    owner: 'p1',
    name: id,
    location: 'A',
    cooldowns: {},
    grade: 'main',
    archetype: 'commander',
    abilities: [],
    passives: [],
    home: 'A',
    alive: true,
    fleetId,
  };
}
/** Мир: узлы A и B рядом; на A стоят `stationed`, флот `M` (2 крейсера) стоит на B. */
function world(stationed: Fleet[], players: Player[] = [player('p1')]): GameState {
  const s = createInitialState({ seed: 'automerge', version: { data: '0.1.0', manifest: '1' } });
  const fleets: Record<string, Fleet> = { M: fleet('M', 'p1', 'B', [['cruiser', 2]]) };
  for (const f of stationed) fleets[f.id] = f;
  return {
    ...s,
    players: Object.fromEntries(players.map((p) => [p.id, p])),
    planets: { A: planet('A', 0, ['B']), B: planet('B', 10, ['A']) },
    fleets,
    battles: {},
  };
}
function ok(r: ApplyResult) {
  if (!r.ok) throw new Error(`apply failed: ${r.code}`);
  return r;
}
const move = (fleetId: string, to: string): Action => ({
  id: `a:mv:${fleetId}:${to}`,
  type: 'fleet.move',
  playerId: 'p1',
  payload: { fleetId, to },
  issuedAt: 0,
});
/** Отправить `M` на A и дать ему долететь. */
function arrive(st: GameState, prep?: (s: GameState) => void) {
  const sent = ok(kernel.applyAction(st, move('M', 'A'), ctx)).state;
  prep?.(sent);
  const adv = kernel.advanceTo(sent, { now: 4 * HOUR, data });
  if (!adv.ok) throw new Error(`advance failed: ${adv.code}`);
  return adv;
}

describe('autoMerge — долетевший флот вливается в свой, стоящий в узле', () => {
  it('сливается сам, без приказа; стоявший сохраняет id и метки', () => {
    const rally = fleet('R', 'p1', 'A', [['cruiser', 1]]);
    rally.traits = ['rally'];
    const adv = arrive(world([rally]));
    expect(adv.state.fleets.M).toBeUndefined();
    expect(adv.state.fleets.R?.units).toEqual([{ unit: 'cruiser', count: 3 }]);
    expect(adv.state.fleets.R?.traits).toEqual(['rally']);
    expect(adv.events).toContainEqual(
      expect.objectContaining({ type: 'fleet.merged', payload: expect.objectContaining({ from: 'M', into: 'R' }) }),
    );
  });

  it('стоявших несколько — в первого по id', () => {
    const adv = arrive(world([fleet('Z', 'p1', 'A', [['cruiser', 1]]), fleet('K', 'p1', 'A', [['cruiser', 1]])]));
    expect(adv.state.fleets.M).toBeUndefined();
    expect(adv.state.fleets.K?.units[0]?.count).toBe(3);
    expect(adv.state.fleets.Z?.units[0]?.count).toBe(1);
  });

  it('заказанное слияние (MRG-1) сильнее: флот уходит в ту цель, что назвал игрок', () => {
    const st = world([fleet('K', 'p1', 'A', [['cruiser', 1]]), fleet('Z', 'p1', 'A', [['cruiser', 1]])]);
    const adv = arrive(st, (s) => {
      s.fleets.M!.mergeInto = 'Z';
    });
    expect(adv.state.fleets.Z?.units[0]?.count).toBe(3);
    expect(adv.state.fleets.K?.units[0]?.count).toBe(1);
  });

  it('пустой узел — флот просто прибывает', () => {
    const adv = arrive(world([]));
    expect(adv.state.fleets.M?.location).toBe('A');
  });

  it('чужой флот не сливает', () => {
    const adv = arrive(world([fleet('E', 'p2', 'A', [['cruiser', 1]])], [player('p1'), player('p2')]));
    expect(adv.state.fleets.M?.location).toBe('A');
    expect(adv.state.fleets.E?.units[0]?.count).toBe(1);
  });

  it('орудия крепости — не флот: с ними не сливается', () => {
    const adv = arrive(world([fleet('G', 'p1', 'A', [['gun', 3]])]));
    expect(adv.state.fleets.M?.location).toBe('A');
    expect(adv.state.fleets.G?.units).toEqual([{ unit: 'gun', count: 3 }]);
  });

  it('два героя в один флот не сводятся', () => {
    const st = world([fleet('H', 'p1', 'A', [['hero', 1]])]);
    st.fleets.M!.units.push({ unit: 'hero', count: 1 });
    st.heroes = { h1: hero('h1', 'H'), h2: hero('h2', 'M') };
    const adv = arrive(st);
    expect(adv.state.fleets.M?.location).toBe('A');
    expect(adv.state.fleets.H).toBeDefined();
  });

  it('герой без пары едет в стоявший флот вместе с кораблями', () => {
    const st = world([fleet('S', 'p1', 'A', [['cruiser', 1]])]);
    st.heroes = { h1: hero('h1', 'M') };
    const adv = arrive(st);
    expect(adv.state.fleets.M).toBeUndefined();
    expect(adv.state.heroes?.h1?.fleetId).toBe('S');
  });

  it('у флота цепочка приказов — не сливается, её ведёт драйвер по id', () => {
    const adv = arrive(world([fleet('S', 'p1', 'A', [['cruiser', 1]])]), (s) => {
      s.orders = { M: { steps: [{ kind: 'wait', hours: 1 }] } };
    });
    expect(adv.state.fleets.M?.location).toBe('A');
  });

  it('стоявший в бою — не сливается', () => {
    const busy = fleet('S', 'p1', 'A', [['cruiser', 1]]);
    busy.battleId = 'b1';
    const adv = arrive(world([busy]));
    expect(adv.state.fleets.M?.location).toBe('A');
  });

  it('флоты NPC-мест не сливаются: сценарий знает их по id', () => {
    const adv = arrive(world([fleet('S', 'p1', 'A', [['cruiser', 1]])], [player('p1', { npc: 'neutral' })]));
    expect(adv.state.fleets.M?.location).toBe('A');
  });
});
