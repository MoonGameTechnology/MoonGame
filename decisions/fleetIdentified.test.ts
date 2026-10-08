import { describe, expect, it } from 'vitest';
import { fleetIdentified } from './fleetIdentified';
import {
  fleetsSeenByPosition,
  identifiedNodes,
  visibleState,
} from '../packages/shared-core/src/state/visibility';
import { createInitialState, type GameState } from '../packages/shared-core/src/state/gameState';
import { parseGameData } from '../packages/shared-core/src/data/schemas';
import { setStance } from '../packages/shared-core/src/state/diplomacy';

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
 * Зритель `v` в союзе с `ally`. Корабль врага `q` стоит на дороге A—B рядом с ракетной
 * миной союзника; свой корабль зрителя — у далёкого F, узлов A и B он не опознаёт.
 */
function world(): GameState {
  const s = createInitialState({ seed: 'fleet-identified', version: { data: '1', manifest: '1' } });
  s.sight = { world: 0, fleet: 10, radarScale: 1 };
  for (const id of ['v', 'ally', 'q'])
    s.players[id] = { id, name: id, faction: 'x', status: 'active', resources: {} };
  for (const [id, x, links] of [
    ['A', 0, ['B']],
    ['B', 400, ['A', 'F']],
    ['F', 3000, ['B']],
  ] as const)
    s.planets[id] = {
      id,
      owner: null,
      position: { x, y: 0 },
      resources: {},
      buildings: [],
      garrison: [],
      traits: [],
      links: [...links],
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
    location: null,
    movement: null,
    edge: { from: 'A', to: 'B', t: 0.5 },
    units: [{ unit: 'rocket_mine', count: 1, modules: ['mine'] }],
    traits: [],
  };
  s.fleets.foe = {
    id: 'foe',
    owner: 'q',
    location: null,
    movement: null,
    edge: { from: 'A', to: 'B', t: 0.52 },
    units: [{ unit: 'ship', count: 1 }],
    traits: [],
  };
  setStance(s, 'v', 'ally', 'alliance');
  setStance(s, 'v', 'q', 'war');
  setStance(s, 'ally', 'q', 'war');
  return s;
}

/** Зрение клиента по миру, который он держит: круги по позиции и опознанные узлы. */
const localSight = (w: GameState) => () =>
  fleetsSeenByPosition(w, 'v', data).has('foe') ||
  identifiedNodes(w, 'v', data).has('A') ||
  identifiedNodes(w, 'v', data).has('B');

describe('fleetIdentified — чужой флот на карте клиента', () => {
  it('в сети флот из проекции опознан, хотя пересчёт по проекции его теряет (Codex, #1503)', () => {
    const view = visibleState(world(), 'v', data);
    // Сервер прислал флот: его видит мина союзника. Саму мину проекция прячет.
    expect(view.fleets.foe).toBeDefined();
    expect(view.fleets.allyMine).toBeUndefined();
    // Пересчёт по проекции глаза мины не находит — так карта и прятала флот.
    expect(localSight(view)()).toBe(false);
    expect(fleetIdentified({ net: true, spied: false, local: localSight(view) })).toBe(true);
  });

  it('окно шпионажа показывает флот, но не опознаёт его — и в сети тоже', () => {
    expect(fleetIdentified({ net: true, spied: true, local: () => false })).toBe(false);
    expect(fleetIdentified({ net: true, spied: true, local: () => true })).toBe(true);
  });

  it('соло решает зрением клиента по полному миру', () => {
    const full = world();
    expect(fleetIdentified({ net: false, spied: false, local: localSight(full) })).toBe(true);
    delete full.fleets.allyMine;
    expect(fleetIdentified({ net: false, spied: false, local: localSight(full) })).toBe(false);
  });
});
