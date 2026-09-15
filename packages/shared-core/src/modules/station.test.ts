import { describe, it, expect } from 'vitest';
import { createKernel } from '../kernel/kernel';
import { stationModule } from './station';
import { constructionModule } from './construction';
import {
  createInitialState,
  type Fleet,
  type GameState,
  type Planet,
  type Player,
} from '../state/gameState';
import { parseGameData, type GameData } from '../data/schemas';
import type { Action, ApplyResult, Context } from '../action/types';
import { deepFreeze } from '../util/clone';
import { visibleState } from '../state/visibility';

const data: GameData = parseGameData({
  version: '0.1.0',
  resources: ['metal'],
  units: { cruiser: { faction: 'x', stats: { attack: 5, defense: 5, speed: 6, hp: 40 } } },
  factions: {},
  buildings: { radar: { name: 'Radar', radarRange: 300 } },
  events: {},
  sectorKinds: {
    // `stationable` НЕ задан у местности — значит разрешено (дефолт true): решение
    // владельца «на всех, кроме тех мест, где уже есть планета».
    empty: { capturable: false, buildable: false, orbit: false },
    asteroid: { capturable: true, buildable: true, orbit: false },
    nebula: { capturable: true, buildable: false, orbit: false },
    void_station: { capturable: true, buildable: true, orbit: false, stationable: false },
    planet: { capturable: true, buildable: true, orbit: true, stationable: false },
  },
});
const ctx = (now = 0): Context => ({ now, data });

function player(id: string, metal = 500): Player {
  return { id, name: id, faction: 'x', status: 'active', resources: { metal } };
}
function node(id: string, owner: string | null, x: number, kind: string, extra: Partial<Planet> = {}): Planet {
  return {
    id, owner, position: { x, y: 0 }, links: [], kind,
    resources: {}, buildings: [], garrison: [], traits: [], ...extra,
  };
}
function fleet(id: string, owner: string, location: string): Fleet {
  return { id, owner, location, movement: null, units: [{ unit: 'cruiser', count: 1 }], traits: [] };
}
function deploy(planetId: unknown, playerId = 'p1'): Action {
  return { id: `s:${playerId}:1`, type: 'station.deploy', playerId, payload: { planetId }, issuedAt: 0 };
}
function okApply(r: ApplyResult): ApplyResult & { ok: true } {
  if (!r.ok) throw new Error(`apply failed: ${r.code}`);
  return r;
}
function errCode(r: ApplyResult): string {
  if (r.ok) throw new Error('expected rejection, got ok');
  return r.code;
}

/**
 * Доска под решение владельца 2026-09-15: крепость ставится на ЗАХВАЧЕННОЙ территории,
 * на всех видах кроме планеты и уже стоящей крепости.
 *
 *   V — астероиды, ЗАХВАЧЕНЫ p1      → крепость можно
 *   N — туманность, захвачена p1     → тоже можно (застраиваемость вида ни при чём)
 *   P — планета p1                   → нельзя: там уже мир
 *   X — астероиды ЧУЖИЕ (p2)         → нельзя: не твоя территория
 *   E — пустота, ничья               → нельзя: незахватываемое ничьим не станет
 */
function world(): GameState {
  const base = createInitialState({ seed: 'station', version: { data: '0.1.0', manifest: '1' } });
  return {
    ...base,
    players: { p1: player('p1'), p2: player('p2') },
    planets: {
      V: node('V', 'p1', 0, 'asteroid'),
      N: node('N', 'p1', 100, 'nebula'),
      P: node('P', 'p1', 200, 'planet'),
      X: node('X', 'p2', 300, 'asteroid'),
      E: node('E', null, 400, 'empty'),
    },
    fleets: { f1: fleet('f1', 'p1', 'V') },
  };
}

describe('station — космическая крепость на захваченной территории', () => {
  const kernel = createKernel([stationModule]);

  it('превращает захваченную местность во владение своего вида и берёт плату', () => {
    const r = okApply(kernel.applyAction(world(), deploy('V'), ctx()));
    const v = r.state.planets.V!;
    expect(v.kind).toBe('void_station');
    expect(v.owner).toBe('p1'); // владелец не менялся — он и ставил
    expect(r.state.players.p1?.resources.metal).toBe(500 - 120); // STATION_COST
    expect(r.events.map((e) => e.type)).toContain('station.deployed');
  });

  it('НЕЗАСТРАИВАЕМАЯ местность тоже годится — крепость и есть способ её застроить', () => {
    // Туманность `buildable: false`: сегодня на ней нельзя возвести ничего, и ровно
    // поэтому крепость там осмысленна. Если бы правило смотрело на `buildable`, механика
    // работала бы только там, где и так можно строить, то есть была бы бесполезна.
    const r = okApply(kernel.applyAction(world(), deploy('N'), ctx()));
    expect(r.state.planets.N?.kind).toBe('void_station');
  });

  it('на ПЛАНЕТЕ нельзя: там уже есть мир', () => {
    expect(errCode(kernel.applyAction(world(), deploy('P'), ctx()))).toBe('E_NOT_STATIONABLE');
  });

  it('на УЖЕ СТОЯЩЕЙ крепости нельзя — второй раз строить нечего', () => {
    const owned = okApply(kernel.applyAction(world(), deploy('V'), ctx()));
    expect(errCode(kernel.applyAction(owned.state, deploy('V'), ctx()))).toBe(
      'E_NOT_STATIONABLE',
    );
  });

  it('на ЧУЖОЙ территории нельзя', () => {
    expect(errCode(kernel.applyAction(world(), deploy('X'), ctx()))).toBe('E_FORBIDDEN');
  });

  it('на НИЧЕЙНОЙ территории нельзя — сперва захвати', () => {
    // Пустота незахватываема, значит своей не станет никогда: правило «на захваченной»
    // закрывает её само, без отдельного запрета на вид.
    expect(errCode(kernel.applyAction(world(), deploy('E'), ctx()))).toBe('E_FORBIDDEN');
  });

  it('ФЛОТ на узле больше НЕ нужен — владение и есть доказательство, что ты там был', () => {
    const st = world();
    st.fleets = {};
    expect(okApply(kernel.applyAction(st, deploy('V'), ctx())).state.planets.V?.kind).toBe(
      'void_station',
    );
  });

  it('отбивает кривую нагрузку и несуществующий узел', () => {
    const st = world();
    expect(errCode(kernel.applyAction(st, deploy(42), ctx()))).toBe('E_BAD_PAYLOAD');
    expect(errCode(kernel.applyAction(st, deploy('ZZ'), ctx()))).toBe('E_NO_PLANET');
  });

  it('отбивает, когда казна не тянет', () => {
    const st = world();
    st.players.p1 = player('p1', 50); // < 120
    expect(errCode(kernel.applyAction(st, deploy('V'), ctx()))).toBe('E_INSUFFICIENT');
  });

  it('не мутирует входное состояние', () => {
    const st = deepFreeze(world());
    okApply(kernel.applyAction(st, deploy('V'), ctx()));
    expect(st.planets.V?.kind).toBe('asteroid');
  });
});

describe('station — buildings + radar in the void (the payoff)', () => {
  it('lets you build a radar on the deployed station (buildings for empty-space provinces)', () => {
    const kernel = createKernel([stationModule, constructionModule]);
    const deployed = okApply(kernel.applyAction(world(), deploy('V'), ctx()));
    const build: Action = {
      id: 's:p1:2', type: 'building.construct', playerId: 'p1',
      payload: { planetId: 'V', building: 'radar' }, issuedAt: 0,
    };
    const r = kernel.applyAction(deployed.state, build, ctx()); // owned now → construction accepts it
    expect(r.ok).toBe(true);
  });

  it('a radar on a void station restores sight (blind ship sees again)', () => {
    // p1 owns only a void station S with a radar; enemy node E is 100 units away,
    // inside the radar inner-identify half (300 × 0.5 = 150) → revealed. Without the
    // station's radar p1 (no other sight source) would see nothing of E.
    const base = createInitialState({ seed: 'see', version: { data: '0.1.0', manifest: '1' } });
    const st: GameState = {
      ...base,
      players: { p1: player('p1'), p2: player('p2') },
      planets: {
        S: node('S', 'p1', 0, 'void_station', { buildings: [{ type: 'radar', level: 1, hp: 0 }] }),
        E: node('E', 'p2', 100, 'planet', { garrison: [{ unit: 'cruiser', count: 2 }] }),
      },
      fleets: {},
    };
    const view = visibleState(st, 'p1', data);
    expect(view.planets.E?.owner).toBe('p2'); // identified through the void radar
    expect(view.planets.E?.garrison).toHaveLength(1);
  });
});
