import { describe, expect, it } from 'vitest';
import {
  buildStateFromMap,
  parseMatchMap,
  type GameState,
} from '../packages/shared-core/src/index';
import { shippedGameData } from '../data/bundle';
import mapJson from '../data/maps/pve-5.json';
import { allyCaptiveOrders, captiveAtRisk, captiveCandidates } from './captive';

// Пленный главы V глазами игрока и союзного бота (PVR-9.5): кнопка погрузки, предупреждение
// до удара и приказы союзника, взявшего убежище. Правила погрузки и доставки — у ядра.

const data = shippedGameData();
const start = (): GameState => buildStateFromMap(parseMatchMap(mapJson), data);

/** Убежище взято стороной `by`, у него стоит флот `fleetId` этой стороны. */
function taken(by: string, fleetId: string): GameState {
  const s = start();
  s.planets.hideout!.owner = by;
  s.planets.hideout!.garrison = [];
  s.captive = { ...s.captive!, takenBy: by, takenAt: s.time };
  s.fleets[fleetId] = {
    id: fleetId,
    owner: by,
    location: 'hideout',
    movement: null,
    traits: [],
    units: [{ unit: 'cruiser', count: 1 }],
  };
  return s;
}

describe('кнопка погрузки', () => {
  it('до штурма кандидатов нет', () => {
    const s = start();
    s.fleets.p1_1 = { ...s.fleets.p1_1!, location: 'hideout' };
    expect(captiveCandidates(s, 'p1')).toEqual([]);
  });

  it('взят — свои флоты у убежища, не в пути и не в бою, с кораблём', () => {
    let s = taken('p1', 'strike');
    expect(captiveCandidates(s, 'p1')).toEqual(['strike']);
    s.fleets.moving = {
      ...s.fleets.strike!,
      id: 'moving',
      movement: { from: 'hideout', to: 'w_rocks', departedAt: s.time, arrivesAt: s.time + 1 },
    };
    s.fleets.fighting = { ...s.fleets.strike!, id: 'fighting', battleId: 'b1' };
    s.fleets.empty = { ...s.fleets.strike!, id: 'empty', units: [{ unit: 'cruiser', count: 0 }] };
    s.fleets.elsewhere = { ...s.fleets.strike!, id: 'elsewhere', location: 'w_rocks' };
    expect(captiveCandidates(s, 'p1')).toEqual(['strike']);
    // Чужой флот у убежища — не кнопка игрока.
    s = taken('p1', 'strike');
    s.fleets.strike = { ...s.fleets.strike!, owner: 'ally' };
    expect(captiveCandidates(s, 'p1')).toEqual([]);
  });

  it('на борту, доставлен или потерян — кнопки нет', () => {
    for (const patch of [{ carrier: 'strike', loadedAt: 0 }, { deliveredAt: 0 }, { lostAt: 0 }]) {
      const s = taken('p1', 'strike');
      s.captive = { ...s.captive!, ...patch };
      expect(captiveCandidates(s, 'p1'), JSON.stringify(patch)).toEqual([]);
    }
  });

  it('взял союзник на связи — кнопка есть и у игрока: пленный общий', () => {
    const s = taken('ally', 'escort');
    s.fleets.mine = { ...s.fleets.escort!, id: 'mine', owner: 'p1' };
    expect(captiveCandidates(s, 'p1')).toEqual(['mine']);
  });
});

describe('предупреждение до удара', () => {
  it('пока пленный в убежище, уничтожение убежища губит его; другой мир — нет', () => {
    const s = start();
    expect(captiveAtRisk(s, 'hideout')).toBe(true);
    expect(captiveAtRisk(s, 'focus_west')).toBe(false);
  });

  it('на борту, доставлен, потерян или пленного нет — предупреждать не о чем', () => {
    for (const patch of [{ carrier: 'p1_1' }, { deliveredAt: 1 }, { lostAt: 1 }]) {
      const s = start();
      s.captive = { ...s.captive!, ...patch };
      expect(captiveAtRisk(s, 'hideout'), JSON.stringify(patch)).toBe(false);
    }
    const none = start();
    delete none.captive;
    expect(captiveAtRisk(none, 'hideout')).toBe(false);
  });
});

describe('союзник, взявший убежище, сам довозит пленного', () => {
  it('грузит на флот у убежища и держит его', () => {
    const s = taken('ally', 'escort');
    const { actions, held } = allyCaptiveOrders(s, 'ally');
    expect(actions).toEqual([
      expect.objectContaining({
        playerId: 'ally',
        type: 'captive.load',
        payload: { fleetId: 'escort' },
      }),
    ]);
    expect(held).toEqual(['escort']);
  });

  it('на борту — ведёт носитель в безопасную зону; в пути и в бою приказов не дублирует', () => {
    const s = taken('ally', 'escort');
    s.captive = { ...s.captive!, carrier: 'escort', loadedAt: s.time };
    expect(allyCaptiveOrders(s, 'ally').actions).toEqual([
      expect.objectContaining({
        type: 'fleet.move',
        payload: { fleetId: 'escort', to: 'staging' },
      }),
    ]);
    s.fleets.escort = { ...s.fleets.escort!, battleId: 'b1' };
    expect(allyCaptiveOrders(s, 'ally')).toEqual({ actions: [], held: ['escort'] });
  });

  it('пока десант союзника дерётся за убежище, корабли над ним ждут исхода', () => {
    const s = start();
    s.fleets.escort = {
      id: 'escort',
      owner: 'ally',
      location: 'hideout',
      movement: null,
      traits: [],
      units: [{ unit: 'cruiser', count: 1 }],
    };
    expect(allyCaptiveOrders(s, 'ally')).toEqual({ actions: [], held: [] });
    s.battles.b1 = {
      id: 'b1',
      location: 'hideout',
      phase: 'ground',
      round: 0,
      sides: [
        {
          ref: { kind: 'beachhead', planetId: 'hideout', owner: 'ally' },
          owner: 'ally',
          role: 'attacker',
        },
        { ref: { kind: 'garrison', planetId: 'hideout' }, owner: 'covenant', role: 'defender' },
      ],
    };
    expect(allyCaptiveOrders(s, 'ally')).toEqual({ actions: [], held: ['escort'] });
    // Чужой штурм союзника не держит.
    expect(allyCaptiveOrders(s, 'p1')).toEqual({ actions: [], held: [] });
  });

  it('своего флота у убежища нет — посылает ближайший свободный и ждёт его', () => {
    const s = taken('ally', 'escort');
    delete s.fleets.escort;
    // Оба флота союзника стоят дома, путь равный — первый по id.
    expect(allyCaptiveOrders(s, 'ally')).toEqual({
      actions: [
        expect.objectContaining({
          playerId: 'ally',
          type: 'fleet.move',
          payload: { fleetId: 'ally_1', to: 'hideout' },
        }),
      ],
      held: ['ally_1'],
    });
    // Уже в пути к убежищу — приказ не повторяется, флот занят.
    const leg = { from: 'ally_base', to: 'ally_field', departedAt: 0, arrivesAt: 1 };
    s.fleets.ally_2 = {
      ...s.fleets.ally_2!,
      location: null,
      movement: { ...leg, destination: 'hideout' },
    };
    expect(allyCaptiveOrders(s, 'ally')).toEqual({ actions: [], held: ['ally_2'] });
    // Кораблей нет — посылать некого.
    for (const id of ['ally_1', 'ally_2']) delete s.fleets[id];
    expect(allyCaptiveOrders(s, 'ally')).toEqual({ actions: [], held: [] });
  });

  it('взятое игроком союзник не перехватывает; без пленного — ничего', () => {
    const s = taken('p1', 'strike');
    s.fleets.escort = { ...s.fleets.strike!, id: 'escort', owner: 'ally' };
    expect(allyCaptiveOrders(s, 'ally')).toEqual({ actions: [], held: [] });
    const none = start();
    delete none.captive;
    expect(allyCaptiveOrders(none, 'ally')).toEqual({ actions: [], held: [] });
  });

  it('доставленный и потерянный пленный союзника не занимает', () => {
    for (const patch of [{ deliveredAt: 1 }, { lostAt: 1 }]) {
      const s = taken('ally', 'escort');
      s.captive = { ...s.captive!, carrier: 'escort', ...patch };
      expect(allyCaptiveOrders(s, 'ally'), JSON.stringify(patch)).toEqual({
        actions: [],
        held: [],
      });
    }
  });
});
