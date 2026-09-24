/**
 * Органы Роя у не-Роя (решение владельца 2026-09-24): «у людей почему-то есть ресурс
 * биомасса» → «при захвате не-роем наземные юниты сражаются с постройками; постройки
 * имеют хп, а наземные юниты — урон по зданиям». Правило — `util/infestation.ts`;
 * добыча и содержание — `economy.ts`, ворота стройки и зачистка — `construction.ts`.
 */
import { describe, expect, it } from 'vitest';
import { createKernel } from '../kernel/kernel';
import { economyModule } from './economy';
import { constructionModule } from './construction';
import { parseGameData, type GameData } from '../data/schemas';
import { createInitialState, type GameState, type Planet, type Player } from '../state/gameState';
import type { Context } from '../action/types';
import { MS_PER_HOUR } from '../util/time';

const data: GameData = parseGameData({
  version: '0.1.0',
  resources: ['metal', 'biomass'],
  units: {
    militia: {
      faction: 'vanguard',
      domain: 'ground',
      stats: { attack: 4, defense: 8, speed: 44, hp: 14, buildingDamage: 1 },
    },
    lander: {
      faction: 'swarm',
      domain: 'ground',
      stats: { attack: 8, defense: 5, speed: 1, hp: 16 },
    },
  },
  factions: {
    vanguard: { name: 'Vanguard' },
    swarm: { name: 'Swarm', traits: ['consume_biomass'] },
  },
  buildings: {
    biomass_pit: {
      name: 'Biomass Pit',
      cost: { metal: 10 },
      produces: { biomass: 30 },
      hp: 15,
      traits: ['infected'],
    },
    synapse: {
      name: 'Synapse',
      cost: { metal: 10 },
      upkeep: { metal: 8 },
      hp: 20,
      traits: ['infected'],
    },
    mine: { name: 'Mine', cost: { metal: 10 }, produces: { metal: 10 } },
  },
  events: {},
});
const ctx = (now: number): Context => ({ now, data, config: { timeScale: 1 } });
const kernel = createKernel([economyModule, constructionModule]);

function player(id: string, faction: string): Player {
  return { id, name: id, faction, status: 'active', resources: { metal: 100 } };
}
function world(
  owner: string,
  garrison: Planet['garrison'],
  buildings: Planet['buildings'],
): GameState {
  const planet: Planet = {
    id: 'w',
    owner,
    position: { x: 0, y: 0 },
    links: [],
    resources: {},
    buildings,
    garrison,
    traits: [],
    kind: 'planet',
  };
  return {
    ...createInitialState({ seed: 'inf', version: { data: '0.1.0', manifest: '1' } }),
    players: { human: player('human', 'vanguard'), swarm: player('swarm', 'swarm') },
    planets: { w: planet },
  };
}
const pit = (hp = 15) => ({ type: 'biomass_pit', level: 1, hp });
const advance = (st: GameState, hours: number): GameState => {
  const r = kernel.advanceTo(st, ctx(st.time + hours * MS_PER_HOUR));
  if (!r.ok) throw new Error(r.code);
  return r.state;
};

describe('органы Роя работают только у Роя', () => {
  it('яма биомассы у людей биомассы не даёт, у Роя — даёт', () => {
    const human = advance(world('human', [], [pit()]), 1);
    expect(human.players.human?.resources.biomass ?? 0).toBe(0);
    const swarm = advance(world('swarm', [], [pit()]), 1);
    expect(swarm.players.swarm?.resources.biomass).toBeCloseTo(30);
  });

  it('содержание органа платит только Рой: людям он не стоит ничего', () => {
    const synapse = [{ type: 'synapse', level: 1, hp: 20 }];
    expect(advance(world('human', [], synapse), 24).players.human?.resources.metal).toBe(100);
    expect(advance(world('swarm', [], synapse), 24).players.swarm?.resources.metal).toBeCloseTo(92);
  });

  it('обычная постройка работает у всех', () => {
    const human = advance(world('human', [], [{ type: 'mine', level: 1, hp: 0 }]), 1);
    expect(human.players.human?.resources.metal).toBeCloseTo(110);
  });

  it('строить и растить орган Роя может только Рой', () => {
    const order = (st: GameState, who: string, type: string) =>
      kernel.applyAction(
        st,
        {
          id: 'a',
          type,
          playerId: who,
          payload: { planetId: 'w', building: 'biomass_pit' },
          issuedAt: 0,
        },
        ctx(st.time),
      );
    expect(order(world('human', [], []), 'human', 'building.construct')).toMatchObject({
      ok: false,
      code: 'E_SWARM_ONLY',
    });
    expect(order(world('swarm', [], []), 'swarm', 'building.construct').ok).toBe(true);
    expect(order(world('human', [], [pit()]), 'human', 'building.upgrade')).toMatchObject({
      ok: false,
      code: 'E_SWARM_ONLY',
    });
  });
});

describe('зачистка: наземный гарнизон не-Роя сносит органы Роя', () => {
  const militia = (count: number) => [{ unit: 'militia', count }];

  it('урон по зданиям снимает прочность по часам и сносит постройку на нуле', () => {
    // 2 ополченца × 1 в час = 2 в час: за 5 часов яма (15) теряет 10.
    const after5 = advance(world('human', militia(2), [pit()]), 5);
    expect(after5.planets.w?.buildings[0]?.hp).toBeCloseTo(5);
    const r = kernel.advanceTo(after5, ctx(after5.time + 3 * MS_PER_HOUR));
    if (!r.ok) throw new Error(r.code);
    expect(r.state.planets.w?.buildings).toEqual([]);
    // Снос объявлен как зачистка — клиент пишет в журнал «гарнизон зачистил», а не «разрушено».
    expect(r.events).toContainEqual(
      expect.objectContaining({
        type: 'building.destroyed',
        payload: { planetId: 'w', building: 'biomass_pit', owner: 'human', cleared: true },
      }),
    );
  });

  it('органы гибнут по очереди, обычные постройки зачистка не трогает', () => {
    const st = world('human', militia(10), [
      { type: 'mine', level: 1, hp: 0 },
      pit(),
      { type: 'synapse', level: 1, hp: 20 },
    ]);
    const after = advance(st, 2); // 20 урона: яма (15) снесена, дигестер теряет 5
    expect(after.planets.w?.buildings.map((b) => [b.type, b.hp])).toEqual([
      ['mine', 0],
      ['synapse', 15],
    ]);
  });

  it('пока на мире идёт бой, гарнизон занят боем — зачистки нет', () => {
    const st = world('human', militia(2), [pit()]);
    st.battles = { b: { id: 'b', location: 'w', phase: 'ground', sides: [], round: 0 } };
    expect(advance(st, 5).planets.w?.buildings[0]?.hp).toBe(15);
  });

  it('у Роя его органы никто не зачищает; без урона по зданиям — тоже', () => {
    expect(advance(world('swarm', militia(5), [pit()]), 10).planets.w?.buildings).toHaveLength(1);
    expect(
      advance(world('human', [{ unit: 'lander', count: 5 }], [pit()]), 10).planets.w?.buildings,
    ).toHaveLength(1);
  });
});
