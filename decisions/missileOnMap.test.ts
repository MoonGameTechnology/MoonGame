import { describe, expect, it } from 'vitest';
import { missileOnMap } from './missileOnMap';
import {
  missileVisible,
  sightCircles,
  visibleState,
} from '../packages/shared-core/src/state/visibility';
import { createInitialState, type GameState } from '../packages/shared-core/src/state/gameState';
import { parseGameData } from '../packages/shared-core/src/data/schemas';
import { setStance } from '../packages/shared-core/src/state/diplomacy';

const HOUR = 3_600_000;
const data = parseGameData({
  version: '1',
  resources: ['metal'],
  factions: {},
  buildings: {},
  events: {},
  units: {
    ship: { faction: 'x', stats: { hp: 100, attack: 1, defense: 1, speed: 100 }, signature: 1 },
    rocket_mine: {
      faction: 'neutral',
      stats: { hp: 20, attack: 0, defense: 0, speed: 0 },
      signature: 0.1,
      traits: ['immobile', 'issued', 'mine', 'rocketMine'],
    },
    missile: {
      faction: 'neutral',
      stats: { hp: 12, attack: 0, defense: 0, speed: 0 },
      signature: 13,
      traits: ['immobile', 'issued', 'missile'],
    },
  },
  modules: {
    mine: {
      name: 'Rocket Mine',
      slot: 'utility',
      tag: 'horizontal',
      rarity: 'legendary',
      rocketMine: {
        armHours: 0.25,
        cooldownHours: 1,
        scanHours: 1 / 60,
        maxActive: 6,
        radarRange: 120,
        radarLevel: 3,
        sightRange: 20,
        detectionRange: 20,
        speed: 240,
        minFlightHours: 1 / 60,
        damage: 80,
        blastRadius: 10,
        mineSignature: 0.1,
        cost: { metal: 20 },
      },
    },
  },
});

/**
 * Зритель `v` в союзе с `ally`. Ракету врага `q` видит только ракетная мина союзника у M:
 * свой корабль зрителя стоит у далёкого F, и ни его глаз, ни мина рядом с ним нет.
 */
function world(missileAt: { x: number; y: number }): GameState {
  const s = createInitialState({ seed: 'missile-on-map', version: { data: '1', manifest: '1' } });
  s.sight = { world: 0, fleet: 10, radarScale: 1 };
  for (const id of ['v', 'ally', 'q'])
    s.players[id] = { id, name: id, faction: 'x', status: 'active', resources: {} };
  for (const [id, x] of [
    ['M', 0],
    ['F', 1000],
  ] as const)
    s.planets[id] = {
      id,
      owner: null,
      position: { x, y: 0 },
      resources: {},
      buildings: [],
      garrison: [],
      traits: [],
      links: [id === 'M' ? 'F' : 'M'],
    };
  s.fleets.picket = {
    id: 'picket',
    owner: 'v',
    location: 'F',
    movement: null,
    units: [{ unit: 'ship', count: 1 }],
    traits: [],
  };
  s.fleets.allyMine = {
    id: 'allyMine',
    owner: 'ally',
    location: 'M',
    movement: null,
    units: [{ unit: 'rocket_mine', count: 1, modules: ['mine'] }],
    traits: [],
  };
  s.fleets['fleet:missile:0:1'] = {
    id: 'fleet:missile:0:1',
    owner: 'q',
    location: null,
    movement: null,
    edge: null,
    flight: { from: missileAt, to: { x: missileAt.x + 50, y: 0 }, departedAt: 0, arrivesAt: HOUR },
    units: [{ unit: 'missile', count: 1, modules: ['mine'] }],
    traits: [],
  };
  setStance(s, 'v', 'ally', 'alliance');
  setStance(s, 'v', 'q', 'war');
  setStance(s, 'ally', 'q', 'war');
  return s;
}
const ID = 'fleet:missile:0:1';
const solo = (s: GameState) => ({ net: false, fogOff: false, circles: () => sightCircles(s, 'v', data) });

describe('missileOnMap — ракета на карте клиента (SM-3.7b)', () => {
  it('в сети ракета из проекции видна, хотя пересчёт по проекции её теряет (Codex, #1503)', () => {
    const full = world({ x: 5, y: 0 });
    const view = visibleState(full, 'v', data);
    // Сервер отдал ракету: её видит мина союзника. Саму мину проекция прячет — она видна
    // лишь вблизи, а корабль зрителя далеко.
    expect(view.fleets[ID]).toBeDefined();
    expect(view.fleets.allyMine).toBeUndefined();
    // Пересчёт по проекции глаза мины не находит — ровно так клиент терял ракету.
    expect(missileVisible(view, view.fleets[ID]!, 'v', data)).toBe(false);
    // В сети ответ — присутствие в мире, даже с кругами проекции, где глаза мины нет.
    const net = { net: true, fogOff: false, circles: () => sightCircles(view, 'v', data) };
    expect(missileOnMap(view, view.fleets[ID]!, 'v', data, net)).toBe(true);
    // Круги в сети даже не считаются.
    const lazy = {
      ...net,
      circles: () => {
        throw new Error('в сети круги не нужны');
      },
    };
    expect(missileOnMap(view, view.fleets[ID]!, 'v', data, lazy)).toBe(true);
  });

  it('соло решает правилом ядра по полному миру', () => {
    // Мина союзника видит ракету рядом — видна и в соло, где мир полный.
    const near = world({ x: 5, y: 0 });
    expect(missileOnMap(near, near.fleets[ID]!, 'v', data, solo(near))).toBe(true);
    // Вдали от всех глаз — не видна.
    const far = world({ x: 500, y: 0 });
    expect(missileOnMap(far, far.fleets[ID]!, 'v', data, solo(far))).toBe(false);
    // Выключенный туман песочницы открывает её, как любой флот.
    expect(missileOnMap(far, far.fleets[ID]!, 'v', data, { ...solo(far), fogOff: true })).toBe(true);
  });
});
