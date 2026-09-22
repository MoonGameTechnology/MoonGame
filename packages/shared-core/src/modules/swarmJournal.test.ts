import { describe, it, expect } from 'vitest';
import { createKernel } from '../kernel/kernel';
import { swarmJournalModule } from './swarmJournal';
import type { GameModule } from '../kernel/module';
import { createInitialState, type GameState, type Player } from '../state/gameState';
import { parseGameData, type GameData } from '../data/schemas';
import type { Action, Context, MatchConfig } from '../action/types';

// PVR-4.5 — журнал пишется ТОЛЬКО из того, что игрок наблюдал: его удар отразили.

const data: GameData = parseGameData({
  version: '0.1.0',
  resources: ['metal'],
  units: {},
  technologies: {},
  factions: { swarm: { name: 'Swarm' }, vanguard: { name: 'Vanguard' } },
  buildings: {},
  events: {},
  modes: { plain: { name: 'Plain' } },
});

const bell: GameModule = {
  id: 'test-bell',
  version: '1.0.0',
  setup(api) {
    api.onAction('test.repelled', (action, h) => h.emit('shuttle.repelled', action.payload));
  },
};

const kernel = createKernel([swarmJournalModule, bell]);
const ctx = (now: number): Context => ({ now, data, config: { timeScale: 1 } as MatchConfig });
const player = (id: string, faction: string): Player => ({
  id,
  name: id,
  faction,
  status: 'active',
  resources: {},
});

function world(): GameState {
  const base = createInitialState({ seed: 'j', version: { data: '0.1.0', manifest: '1' } });
  return {
    ...base,
    players: {
      p1: player('p1', 'vanguard'),
      p2: player('p2', 'vanguard'),
      swarm: player('swarm', 'swarm'),
    },
  };
}

let seq = 0;
const repelled = (over: Record<string, unknown> = {}): Action => ({
  id: `t:p1:${++seq}`,
  issuedAt: 0,
  type: 'test.repelled',
  playerId: 'p1',
  payload: { strikeId: 's1', owner: 'p1', targetId: 'f1', targetOwner: 'swarm', damage: 5, downed: 1, ...over },
});

function apply(s: GameState, a: Action, at = s.time): GameState {
  const r = kernel.applyAction(s, a, ctx(at));
  if (!r.ok) throw new Error(r.code);
  return r.state;
}

describe('PVR-4.5 — журнал записывает только проявленное', () => {
  it('отражённый удар заводит запись игрока', () => {
    const s = apply(world(), repelled(), 10);
    expect(s.swarmJournal?.p1).toMatchObject({ firstAt: 10, lastAt: 10, sorties: 1, firstDamage: 5 });
  });

  it('отражение БЕЗ урона игроку ничего не показало', () => {
    expect(apply(world(), repelled({ damage: 0 }), 10).swarmJournal).toBeUndefined();
  });

  it('отразил не Рой — запись не про адаптацию Роя', () => {
    expect(apply(world(), repelled({ targetOwner: 'p2' }), 10).swarmJournal).toBeUndefined();
  });

  it('первый замер не переписывается, последний — обновляется', () => {
    let s = apply(world(), repelled({ damage: 4 }), 10);
    s = apply(s, repelled({ strikeId: 's2', damage: 12 }), 40);
    expect(s.swarmJournal?.p1).toMatchObject({
      firstAt: 10,
      lastAt: 40,
      sorties: 2,
      firstDamage: 4,
      lastDamage: 12,
    });
  });

  it('журнал у каждого игрока СВОЙ', () => {
    let s = apply(world(), repelled(), 10);
    s = apply(s, { ...repelled({ owner: 'p2' }), playerId: 'p2' }, 20);
    expect(Object.keys(s.swarmJournal ?? {}).sort()).toEqual(['p1', 'p2']);
    expect(s.swarmJournal?.p2?.sorties).toBe(1);
  });

  it('состояние сериализуемо — снимок забега унесёт журнал с собой', () => {
    const s = apply(world(), repelled(), 10);
    expect(JSON.parse(JSON.stringify(s)).swarmJournal).toEqual(s.swarmJournal);
  });
});
