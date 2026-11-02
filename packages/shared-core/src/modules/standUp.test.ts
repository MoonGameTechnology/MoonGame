/**
 * ФЛОТ, ВСТАВШИЙ У МИРА НЕ ПРИЛЁТОМ, СХОДИТСЯ С ВРАГОМ (баг владельца 2026-11-02: «прилетел
 * на вражескую планету, там был вражеский корабль, а бой начался только по моему приказу»).
 *
 * Бой заводило только движение. Корабль, поднятый с верфи на орбиту под чужим флотом, или
 * гарнизон, взлетевший рядом с ним, стоял с врагом мирно. В одиночной игре дыру прикрывал
 * покадровый драйвер клиента, а сервер играл по правилу ядра — и боя не было вовсе.
 */
import { describe, it, expect } from 'vitest';
import { createKernel } from '../kernel/kernel';
import { combatModule } from './combat';
import { constructionModule } from './construction';
import { autoRallyModule } from './autoRally';
import { fleetOpsModule } from './fleetOps';
import { diplomacyModule } from './diplomacy';
import {
  createInitialState,
  type Fleet,
  type GameState,
  type Planet,
  type Player,
} from '../state/gameState';
import { setStance } from '../state/diplomacy';
import { parseGameData, type GameData } from '../data/schemas';
import type { Action, AdvanceResult, ApplyResult, Context } from '../action/types';

const data: GameData = parseGameData({
  version: '0.1.0',
  resources: ['metal'],
  units: {
    cruiser: {
      faction: 'x',
      domain: 'space',
      stats: { attack: 5, defense: 5, speed: 5, hp: 400 },
      cost: { metal: 10 },
      buildTimeHours: 0, // готов в том же продвижении часов
    },
  },
  factions: {},
  buildings: {
    shipyard: { name: 'Shipyard', cost: { metal: 100 }, buildTimeHours: 4, enablesShipConstruction: true },
  },
  events: {},
});

const HOUR = 3_600_000;
const ctx = (now: number): Context => ({ now, data });
const kernel = createKernel([combatModule, constructionModule, fleetOpsModule, autoRallyModule, diplomacyModule]);

function player(id: string): Player {
  return { id, name: id, faction: 'x', status: 'active', resources: { metal: 1000 } };
}
function planet(owner: string, garrison: Planet['garrison'] = []): Planet {
  return {
    id: 'A',
    owner,
    position: { x: 0, y: 0 },
    resources: {},
    buildings: [{ type: 'shipyard', level: 1, hp: 100 }],
    garrison,
    traits: [],
  };
}
/** Флот `p1` стоит на орбите мира `A`, хозяин которого — `p2`. По умолчанию — война. */
function world(garrison: Planet['garrison'] = [], peace = false): GameState {
  const s = createInitialState({ seed: 'standup', version: { data: '0.1.0', manifest: '1' } });
  const guest: Fleet = {
    id: 'G',
    owner: 'p1',
    location: 'A',
    movement: null,
    units: [{ unit: 'cruiser', count: 2 }],
    traits: [],
    battleId: null,
  };
  const out: GameState = {
    ...s,
    players: { p1: player('p1'), p2: player('p2') },
    planets: { A: planet('p2', garrison) },
    fleets: { G: guest },
  };
  if (peace) setStance(out, 'p1', 'p2', 'peace');
  return out;
}
const act = (type: string, payload: unknown): Action => ({
  id: `a:${type}`,
  type,
  playerId: 'p2',
  payload,
  issuedAt: 0,
});
function ok(r: ApplyResult | AdvanceResult): GameState {
  if (!r.ok) throw new Error(`failed: ${r.code}`);
  return r.state;
}
/** Флот `p2` у мира `A` — тот, что встал. */
const host = (s: GameState): Fleet => Object.values(s.fleets).find((f) => f.owner === 'p2')!;

describe('флот, вставший у мира не прилётом, сходится с врагом', () => {
  it('корабль с верфи под чужим флотом на орбите сразу вступает в бой', () => {
    let s = ok(kernel.applyAction(world(), act('unit.build', { planetId: 'A', unit: 'cruiser' }), ctx(0)));
    s = ok(kernel.advanceTo(s, ctx(HOUR / 2)));

    const built = host(s);
    expect(built.battleId).toBeTruthy();
    expect(s.fleets.G?.battleId).toBe(built.battleId);
    // Кто встал, тот атакующий — то же правило, что у прибывшего.
    const battle = s.battles[built.battleId!]!;
    expect(battle.sides.find((x) => x.owner === 'p2')?.role).toBe('attacker');
  });

  it('гарнизон, поднятый во флот рядом с врагом, вступает в бой', () => {
    const s = ok(
      kernel.applyAction(world([{ unit: 'cruiser', count: 1 }]), act('fleet.launch', { planetId: 'A' }), ctx(0)),
    );
    const launched = host(s);
    expect(launched.battleId).toBeTruthy();
    expect(s.fleets.G?.battleId).toBe(launched.battleId);
  });

  it('в мире с хозяином верфи боя нет: сводит только вражда', () => {
    let s = ok(kernel.applyAction(world([], true), act('unit.build', { planetId: 'A', unit: 'cruiser' }), ctx(0)));
    s = ok(kernel.advanceTo(s, ctx(HOUR / 2)));
    expect(host(s).units[0]?.count).toBe(1);
    expect(Object.keys(s.battles)).toHaveLength(0);
  });

  it('без модуля боя корабль просто встаёт на орбиту', () => {
    const bare = createKernel([constructionModule, fleetOpsModule, autoRallyModule, diplomacyModule]);
    let s = ok(bare.applyAction(world(), act('unit.build', { planetId: 'A', unit: 'cruiser' }), ctx(0)));
    s = ok(bare.advanceTo(s, ctx(HOUR / 2)));
    expect(host(s).battleId ?? null).toBeNull();
  });
});
