/**
 * ОРУДИЯ КРЕПОСТИ (FORT-5.4; решения владельца 9, 16, 19 — §0.7 роадмапа).
 *
 * «Крепость как будто космический юнит: прилетит вражеский флот — вступит в бой». Сделано
 * неподвижным отрядом, который ядро держит на узле, а не новым видом стороны в бою: отряд
 * попадает в орбитальную фазу существующим движком.
 *
 * Тест проверяет не «юнит заведён в каталоге», а четыре следствия, каждое из которых
 * может отвалиться молча:
 *   1. отряд появляется с крепостью и РАСТЁТ с её уровнем (сила идёт от ядра);
 *   2. узел не забирают прилётом, пока орудия живы, — крепость приходится штурмовать;
 *   3. орудия нельзя увести приказом — иначе «неподвижность» была бы на словах;
 *   4. на радаре крепость читается как БОЛЬШОЙ объект (решение 19).
 *
 * Плюс запрет заказа: орудия — тело сооружения, а не корабль, и на верфи крепости они
 * заказывались бы как обычный корпус, домен-то космический.
 */
import { describe, expect, it } from 'vitest';
import {
  captureOnArrivalModule,
  constructionModule,
  createInitialState,
  createKernel,
  movementModule,
  stationModule,
  visibleState,
  type Action,
  type Context,
  type Fleet,
  type GameState,
  type Planet,
} from '../packages/shared-core/src/index';
import { shippedGameData } from './bundle';

const data = shippedGameData();
const GUNS = 'fortress_guns';
const ctx = (now = 0): Context => ({ now, data });

function node(kind: string, owner: string | null = 'p1'): Planet {
  return {
    id: 'A', owner, kind, position: { x: 0, y: 0 }, links: [],
    resources: {}, buildings: [], garrison: [], traits: [],
  };
}
function world(extra: Partial<GameState> = {}): GameState {
  const s = createInitialState({ seed: 'fg', version: { data: data.version, manifest: '1' } });
  return {
    ...s,
    players: {
      p1: { id: 'p1', name: 'p1', faction: 'x', status: 'active', resources: { metal: 9000, credits: 9000 } },
      p2: { id: 'p2', name: 'p2', faction: 'x', status: 'active', resources: { metal: 9000 } },
    },
    planets: {
      A: node('asteroid'),
      // Узел наблюдателя НЕ связан лейном с крепостью: опознание идёт по прыжкам, и
      // сосед видел бы её в подробностях, а нам нужна именно грубая отметка радара.
      B: {
        ...node('planet', 'p2'), id: 'B', links: [], position: { x: 200, y: 0 },
        buildings: [{ type: 'radar', level: 1, hp: 100 }],
      },
    },
    ...extra,
  };
}
const act = (type: string, payload: Record<string, unknown>, playerId = 'p1'): Action => ({
  id: `s:${playerId}:1`, type, playerId, payload, issuedAt: 0,
});
const GUNS_FLEET = 'fleet:station:A';

/** Поднять крепость на своём узле и вернуть состояние после этого. */
function raised(kernel = createKernel([stationModule])): GameState {
  const r = kernel.applyAction(world(), act('station.deploy', { planetId: 'A' }), ctx());
  if (!r.ok) throw new Error(`отказ ${r.code}`);
  return r.state;
}

describe('орудия крепости — решения владельца 9/16/19', () => {
  it('появляются ВМЕСТЕ с крепостью и принадлежат хозяину узла', () => {
    const st = raised();
    const guns = st.fleets[GUNS_FLEET];
    expect(guns, 'крепость без орудий — бестелесная').toBeDefined();
    expect(guns!.owner).toBe('p1');
    expect(guns!.location).toBe('A');
    expect(guns!.units).toEqual([{ unit: GUNS, count: 1 }]);
  });

  it('СИЛА ИДЁТ ОТ УРОВНЯ ЯДРА: прокачка добавляет орудия', () => {
    // Второй лестницы прокачки нет — в стеке ровно `level` орудий, поэтому корпус и урон
    // растут сами. Разойдись это с ядром, крепость пятого уровня дралась бы как первого.
    const kernel = createKernel([stationModule, constructionModule]);
    let st = raised(kernel);
    let now = 0;
    for (const level of [2, 3]) {
      const up = kernel.applyAction(st, act('building.upgrade', { planetId: 'A', building: 'starfort' }), ctx(now));
      if (!up.ok) throw new Error(`прокачка до ${level}: отказ ${up.code}`);
      now += 100 * 3_600_000;
      const done = kernel.advanceTo(up.state, ctx(now));
      if (!done.ok) throw new Error('advance отказ');
      st = done.state;
      expect(st.planets.A?.buildings.find((b) => b.type === 'starfort')?.level, `уровень ${level}`).toBe(level);
      expect(st.fleets[GUNS_FLEET]?.units[0]?.count, `орудий на уровне ${level}`).toBe(level);
    }
  });

  it('УЗЕЛ НЕ БЕРУТ ПРИЛЁТОМ, пока орудия живы — крепость надо штурмовать', () => {
    // Половина замысла, которая достаётся даром: `captureOnArrival` отказывается брать
    // узел, где стоит чужой отряд с юнитами. Крепость и есть такой отряд.
    const kernel = createKernel([stationModule, captureOnArrivalModule]);
    const st = raised(kernel);
    const raider: Fleet = {
      id: 'R', owner: 'p2', location: 'A', movement: null,
      units: [{ unit: 'cruiser', count: 3 }], landing: [], traits: [], battleId: null,
    };
    // Прилёт эмулируем тем же событием, которое слушает модуль захвата.
    const withRaider: GameState = {
      ...st,
      fleets: { ...st.fleets, R: raider },
      scheduled: [{ id: 'e:0', at: 1, type: 'fleet.arrived', payload: { fleetId: 'R', at: 'A' }, seq: 0 }],
      scheduleSeq: 1,
    };
    const after = kernel.advanceTo(withRaider, ctx(10));
    if (!after.ok) throw new Error('advance отказ');
    expect(after.state.planets.A?.owner, 'крепость отдали без боя').toBe('p1');

    // Контроль: без орудий тот же прилёт узел ЗАБИРАЕТ. Иначе тест был бы зелёным и на
    // сломанном захвате, и ничего бы не доказывал.
    const noGuns: GameState = { ...withRaider, fleets: { R: raider } };
    const taken = kernel.advanceTo(noGuns, ctx(10));
    if (!taken.ok) throw new Error('advance отказ');
    expect(taken.state.planets.A?.owner, 'контроль: пустой узел обязан переходить').toBe('p2');
  });

  it('орудия НЕЛЬЗЯ увести приказом — неподвижность не на словах', () => {
    // Лейн между узлами тут НУЖЕН: без него приказ отбился бы раньше — «нет маршрута», —
    // и про неподвижность не сказал бы ничего. Доказывает только отказ ПО СКОРОСТИ.
    const kernel = createKernel([stationModule, movementModule]);
    const st = raised(kernel);
    const linked: GameState = {
      ...st,
      planets: {
        ...st.planets,
        A: { ...st.planets.A!, links: ['B'] },
        B: { ...st.planets.B!, links: ['A'] },
      },
    };
    const r = kernel.applyAction(linked, act('fleet.move', { fleetId: GUNS_FLEET, to: 'B' }), ctx());
    expect(r.ok).toBe(false);
    expect(r.ok ? '' : r.code).toBe('E_FLEET_IMMOBILE');

    // Контроль: по тому же лейну обычный флот уходит. Значит отказ выше — про орудия, а
    // не про карту.
    const mobile: GameState = {
      ...linked,
      fleets: {
        ...linked.fleets,
        M: { id: 'M', owner: 'p1', location: 'A', movement: null, units: [{ unit: 'cruiser', count: 1 }], landing: [], traits: [], battleId: null },
      },
    };
    expect(kernel.applyAction(mobile, act('fleet.move', { fleetId: 'M', to: 'B' }), ctx()).ok).toBe(true);
  });

  it('на радаре крепость — БОЛЬШОЙ объект (решение 19)', () => {
    // Корзина `L` начинается с 13, и ни один корабль в игре её в одиночку не даёт
    // (максимум 6). Крепость даёт — в этом и смысл решения.
    const st = raised();
    const seen = visibleState(st, 'p2', data);
    const contact = seen.signatures?.find((c) => c.location === 'A');
    expect(contact, 'крепость не засветилась на радаре вовсе').toBeDefined();
    expect(contact!.size).toBe('L');
  });

  it('орудия НЕ ЗАКАЗЫВАЮТ на верфи — это тело сооружения, а не корабль', () => {
    const kernel = createKernel([constructionModule]);
    const st = raised(createKernel([stationModule]));
    const yard: GameState = {
      ...st,
      planets: { ...st.planets, A: { ...st.planets.A!, buildings: [...st.planets.A!.buildings, { type: 'shipyard', level: 1, hp: 25 }] } },
    };
    const r = kernel.applyAction(yard, act('unit.build', { planetId: 'A', unit: GUNS }), ctx());
    expect(r.ok).toBe(false);
    expect(r.ok ? '' : r.code).toBe('E_NOT_BUILDABLE');
  });
});
