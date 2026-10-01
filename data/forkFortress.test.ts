/**
 * КРЕПОСТЬ НА РАЗВИЛКЕ (FORT-6.1, решение владельца 2026-09-29).
 *
 * «Это и есть та же крепость. Только появляется новая точка постройки»: космическую
 * крепость ставят на ромб развилки дороги в СВОЕЙ провинции. Орудия встают на саму развилку
 * — и ловят каждого, кто идёт по тропе. Провинцию потом захватили — крепость осталась у
 * строителя («по своей сущности это космический юнит»). Орудия выбиты — развилка свободна.
 *
 * Карта та же, что у засады ROADS-3: у B тропа на восток с развилкой F к A и C, и
 * отдельная тропа на запад к D без развилки.
 *
 *            A (200,−150)
 *           /
 *   D —— B(0,0) — F(60,0)
 *           \
 *            C (200,150)
 *
 * Каталог шипнутый: ядро, орудия, вид площадки и её ростер — те, что уйдут в игру.
 */
import { describe, expect, it } from 'vitest';
import {
  captureOnArrivalModule,
  combatModule,
  conditionMet,
  constructionModule,
  createInitialState,
  createKernel,
  forkSiteId,
  forkTAtStart,
  interceptModule,
  movementModule,
  setStance,
  shuttleModule,
  stationModule,
  stewardModule,
  STATION_COST,
  victoryModule,
  visibleState,
  type Action,
  type Context,
  type Fleet,
  type GameState,
  type Planet,
} from '../packages/shared-core/src/index';
import { shippedGameData } from './bundle';

const data = shippedGameData();
const HOUR = 3_600_000;
const ctx = (now = 0): Context => ({ now, data });
const SITE = forkSiteId('B', 0);
const GUNS = `fleet:station:${SITE}`;

function world(owner: string | null, x: number, y: number, links: string[], extra: Partial<Planet> = {}): Planet {
  return {
    id: '', owner, kind: 'planet', position: { x, y }, links,
    resources: {}, buildings: [], garrison: [], traits: [], ...extra,
  };
}

function map(): GameState {
  const s = createInitialState({ seed: 'fork-fort', version: { data: data.version, manifest: '1' } });
  const xab = { x: 100, y: -75 };
  const xcb = { x: 100, y: 75 };
  const xdb = { x: -150, y: 0 };
  const planets: Record<string, Planet> = {
    A: { ...world('p2', 200, -150, ['B']), id: 'A', roads: { crossings: { B: xab }, trails: [{ exits: ['B'], fork: null }] } },
    B: {
      ...world('p1', 0, 0, ['A', 'C', 'D']),
      id: 'B',
      roads: {
        crossings: { A: xab, C: xcb, D: xdb },
        trails: [
          { exits: ['A', 'C'], fork: { x: 60, y: 0 } },
          { exits: ['D'], fork: null },
        ],
      },
    },
    C: { ...world(null, 200, 150, ['B']), id: 'C', roads: { crossings: { B: xcb }, trails: [{ exits: ['B'], fork: null }] } },
    D: { ...world('p3', -300, 0, ['B']), id: 'D', roads: { crossings: { B: xdb }, trails: [{ exits: ['B'], fork: null }] } },
  };
  const purse = Object.fromEntries(data.resources.map((r) => [r, 9000]));
  const rich = (id: string) => ({ id, name: id, faction: 'x', status: 'active' as const, resources: { ...purse } });
  const state: GameState = { ...s, players: { p1: rich('p1'), p2: rich('p2'), p3: rich('p3') }, planets, fleets: {} };
  setStance(state, 'p1', 'p2', 'war');
  setStance(state, 'p1', 'p3', 'war');
  setStance(state, 'p2', 'p3', 'war');
  return state;
}

const deploy = (planetId: string, trail: unknown, playerId = 'p1'): Action => ({
  id: `s:${playerId}:deploy`, type: 'station.deploy', playerId, payload: { planetId, trail }, issuedAt: 0,
});

function built(kernel = createKernel([stationModule])): GameState {
  const r = kernel.applyAction(map(), deploy('B', 0), ctx());
  if (!r.ok) throw new Error(`отказ ${r.code}`);
  return r.state;
}

function cruisers(id: string, owner: string, at: string, count: number): Fleet {
  return { id, owner, location: at, movement: null, units: [{ unit: 'cruiser', count }], landing: [], traits: [], battleId: null };
}

describe('крепость на развилке — новая точка постройки (FORT-6.1)', () => {
  it('встаёт на развилку своей провинции: площадка в точке развилки, орудия на дороге', () => {
    const st = built();
    const site = st.planets[SITE];
    expect(site, 'площадки нет').toBeDefined();
    expect(site).toMatchObject({ kind: 'fork_station', owner: 'p1', position: { x: 60, y: 0 }, links: [], fork: { province: 'B', trail: 0 } });
    expect(site!.buildings.map((b) => [b.type, b.level])).toEqual([['starfort', 1]]);
    // Провинция не превратилась ни во что: «не превращается — появляется».
    expect(st.planets.B).toMatchObject({ kind: 'planet', owner: 'p1', buildings: [] });
    const guns = st.fleets[GUNS];
    expect(guns, 'крепость без орудий').toBeDefined();
    expect(guns!.location, 'орудия стоят на дороге, а не на площадке').toBeNull();
    expect(guns!.edge).toEqual({ from: 'B', to: 'A', t: forkTAtStart(st, 'B', 'A') });
    expect(st.players.p1!.resources.metal).toBe(9000 - (STATION_COST.metal ?? 0));
  });

  it('только в СВОЕЙ провинции: чужая и ничейная отбиваются', () => {
    const kernel = createKernel([stationModule]);
    const code = (a: Action): string => {
      const r = kernel.applyAction(map(), a, ctx());
      return r.ok ? 'ok' : r.code;
    };
    expect(code(deploy('B', 0, 'p2'))).toBe('E_FORBIDDEN');
    expect(code(deploy('C', 0))).toBe('E_FORBIDDEN');
  });

  it('без развилки ставить некуда; кривая тропа — кривая нагрузка', () => {
    const kernel = createKernel([stationModule]);
    const code = (trail: unknown): string => {
      const r = kernel.applyAction(map(), deploy('B', trail), ctx());
      return r.ok ? 'ok' : r.code;
    };
    expect(code(1), 'тропа на D идёт без развилки').toBe('E_NOT_STATIONABLE');
    expect(code(7), 'такой тропы нет').toBe('E_NOT_STATIONABLE');
    for (const bad of [-1, 0.5, '0']) expect(code(bad), String(bad)).toBe('E_BAD_PAYLOAD');
  });

  it('одна развилка — одна крепость; на площадке не ставят «обычную» крепость', () => {
    const kernel = createKernel([stationModule]);
    const st = built(kernel);
    const again = kernel.applyAction(st, deploy('B', 0), ctx());
    expect(again.ok ? 'ok' : again.code).toBe('E_NOT_STATIONABLE');
    const onSite = kernel.applyAction(st, { ...deploy(SITE, undefined), payload: { planetId: SITE } }, ctx());
    expect(onSite.ok ? 'ok' : onSite.code).toBe('E_FORBIDDEN');
  });

  it('провинцию захватили — крепость осталась у строителя', () => {
    // Враг приходит с запада, по тропе без развилки, и берёт пустую B прилётом.
    const kernel = createKernel([stationModule, movementModule, combatModule, interceptModule, captureOnArrivalModule]);
    const st = built(kernel);
    const withRaider: GameState = { ...st, fleets: { ...st.fleets, R: cruisers('R', 'p3', 'D', 2) } };
    const moved = kernel.applyAction(
      withRaider,
      { id: 's:p3:1', type: 'fleet.move', playerId: 'p3', payload: { fleetId: 'R', to: 'B' }, issuedAt: 0 },
      ctx(),
    );
    if (!moved.ok) throw new Error(`отказ ${moved.code}`);
    const after = kernel.advanceTo(moved.state, ctx(20 * HOUR));
    if (!after.ok) throw new Error('advance отказ');
    expect(after.state.planets.B?.owner, 'контроль: провинцию действительно взяли').toBe('p3');
    expect(after.state.planets[SITE]?.owner).toBe('p1');
    expect(after.state.fleets[GUNS]?.owner).toBe('p1');
  });

  it('засада: флот, идущий по тропе, встречает орудия на развилке', () => {
    const kernel = createKernel([stationModule, movementModule, combatModule, interceptModule]);
    const st = built(kernel);
    const withRaider: GameState = { ...st, fleets: { ...st.fleets, R: cruisers('R', 'p2', 'A', 1) } };
    const moved = kernel.applyAction(
      withRaider,
      { id: 's:p2:1', type: 'fleet.move', playerId: 'p2', payload: { fleetId: 'R', to: 'C' }, issuedAt: 0 },
      ctx(),
    );
    if (!moved.ok) throw new Error(`отказ ${moved.code}`);
    const after = kernel.advanceTo(moved.state, ctx(10 * HOUR));
    if (!after.ok) throw new Error('advance отказ');
    const started = after.events.find((e) => e.type === 'battle.started');
    expect(started, 'мимо крепости прошли без боя').toBeDefined();
    const battle = Object.values(after.state.battles)[0] ?? null;
    const sides = battle?.sides.map((x) => (x.ref.kind === 'fleet' ? x.ref.fleetId : x.ref.kind)).sort();
    // Бой либо идёт, либо уже решён — в обоих случаях дрались именно орудия.
    if (battle) expect(sides).toEqual([GUNS, 'R'].sort());
    else expect(after.events.some((e) => e.type === 'battle.resolved')).toBe(true);
  });

  it('орудия выбиты — развилка свободна: площадка пуста, и крепость там можно поставить снова', () => {
    const kernel = createKernel([stationModule, constructionModule, movementModule, combatModule, interceptModule]);
    const st = built(kernel);
    const withRaider: GameState = { ...st, fleets: { ...st.fleets, R: cruisers('R', 'p2', 'A', 8) } };
    const moved = kernel.applyAction(
      withRaider,
      { id: 's:p2:1', type: 'fleet.move', playerId: 'p2', payload: { fleetId: 'R', to: 'C' }, issuedAt: 0 },
      ctx(),
    );
    if (!moved.ok) throw new Error(`отказ ${moved.code}`);
    const after = kernel.advanceTo(moved.state, ctx(40 * HOUR));
    if (!after.ok) throw new Error('advance отказ');
    expect(after.state.fleets[GUNS], 'восемь крейсеров не выбили одно орудие').toBeUndefined();
    expect(after.state.planets[SITE]).toMatchObject({ owner: null, buildings: [], kind: 'fork_station' });
    expect(after.events.some((e) => e.type === 'station.destroyed')).toBe(true);
    const again = kernel.applyAction(after.state, deploy('B', 0), ctx(40 * HOUR));
    expect(again.ok ? 'ok' : again.code).toBe('ok');
    if (again.ok) expect(again.state.planets[SITE]?.owner).toBe('p1');
  });

  it('на площадке строят радар и щит, а верфь — нет: корабли с неё не ушли бы никуда', () => {
    const kernel = createKernel([stationModule, constructionModule]);
    const st = built(kernel);
    const order = (building: string): string => {
      const r = kernel.applyAction(
        st,
        { id: `s:p1:${building}`, type: 'building.construct', playerId: 'p1', payload: { planetId: SITE, building }, issuedAt: 0 },
        ctx(),
      );
      return r.ok ? 'ok' : r.code;
    };
    expect(order('radar')).toBe('ok');
    expect(order('void_shield')).toBe('ok');
    expect(order('shipyard')).toBe('E_WRONG_SECTOR');
    expect(order('fort')).toBe('E_WRONG_SECTOR');
  });

  it('площадка — не территория: без миров игрок выбывает, и его крепость гаснет', () => {
    const kernel = createKernel([stationModule, constructionModule, victoryModule]);
    const st = built(kernel);
    // B ушла к p3 — у p1 осталась одна крепость на дороге.
    const landless: GameState = { ...st, planets: { ...st.planets, B: { ...st.planets.B!, owner: 'p3' } } };
    const after = kernel.advanceTo(landless, ctx(HOUR));
    if (!after.ok) throw new Error('advance отказ');
    expect(after.state.players.p1?.status, 'крепость держала игрока в партии').toBe('defeated');
    expect(after.state.planets[SITE]).toMatchObject({ owner: null, buildings: [] });
    expect(after.state.fleets[GUNS]).toBeUndefined();
    expect(after.state.match.scores?.p3?.controlledPlanets, 'площадку посчитали провинцией').toBe(2);
  });

  it('туман: площадку, которую зритель не видел ни разу, он не получает', () => {
    const st = built();
    expect(visibleState(st, 'p1', data).planets[SITE], 'своя крепость пропала из вида').toBeDefined();
    // p3 сидит далеко на западе: развилку он не видит и не видел.
    expect(visibleState(st, 'p3', data).planets[SITE]).toBeUndefined();
    // Провинции карты при этом видны всем — это и есть карта.
    expect(visibleState(st, 'p3', data).planets.A).toBeDefined();
  });
});

describe('крепость на развилке — доводка по ревью (замечания Codex на #1410)', () => {
  it('площадка не сектор: условие технологии «своих секторов» её не считает', () => {
    const st = built();
    // У p1 провинция B и площадка развилки — сектор один.
    expect(conditionMet({ type: 'own_sectors', min: 2 }, st, 'p1', data)).toBe(false);
    expect(conditionMet({ type: 'own_sectors', min: 1 }, st, 'p1', data)).toBe(true);
  });

  it('бой с орудиями развилки ставит стройку площадки на паузу, как бой на узле', () => {
    const kernel = createKernel([stationModule, constructionModule]);
    const st = built(kernel);
    const raider = cruisers('R', 'p2', 'A', 1);
    const fighting: GameState = {
      ...st,
      fleets: { ...st.fleets, R: raider },
      battles: {
        b1: {
          id: 'b1',
          location: 'B', // бой с орудиями на дороге носит место провинции-якоря
          phase: 'orbital',
          sides: [
            { ref: { kind: 'fleet', fleetId: GUNS }, owner: 'p1', role: 'defender' },
            { ref: { kind: 'fleet', fleetId: 'R' }, owner: 'p2', role: 'attacker' },
          ],
          round: 0,
        },
      },
    };
    const r = kernel.applyAction(
      fighting,
      { id: 's:p1:radar', type: 'building.construct', playerId: 'p1', payload: { planetId: SITE, building: 'radar' }, issuedAt: 0 },
      ctx(),
    );
    expect(r.ok ? 'ok' : r.code).toBe('E_BATTLE_HERE');
  });

  it('площадку нельзя назначить точкой удержания, а гибель крепости снимает старую точку', () => {
    const kernel = createKernel([stationModule, constructionModule, movementModule, combatModule, interceptModule, stewardModule]);
    const st = built(kernel);
    st.players.p1!.technologies = { completed: ['ai_stewardship'] } as never;
    const hold = kernel.applyAction(
      st,
      { id: 's:p1:hold', type: 'steward.holdpoint', playerId: 'p1', payload: { planetId: SITE, on: true }, issuedAt: 0 },
      ctx(),
    );
    expect(hold.ok ? 'ok' : hold.code).toBe('E_FORBIDDEN');
    // Точка, записанная до правила, уходит вместе с крепостью.
    const withPoint: GameState = {
      ...st,
      players: { ...st.players, p1: { ...st.players.p1!, stewardHoldPoints: [SITE] } },
      fleets: { ...st.fleets, R: cruisers('R', 'p2', 'A', 8) },
    };
    const moved = kernel.applyAction(
      withPoint,
      { id: 's:p2:1', type: 'fleet.move', playerId: 'p2', payload: { fleetId: 'R', to: 'C' }, issuedAt: 0 },
      ctx(),
    );
    if (!moved.ok) throw new Error(`отказ ${moved.code}`);
    const after = kernel.advanceTo(moved.state, ctx(40 * HOUR));
    if (!after.ok) throw new Error('advance отказ');
    expect(after.events.some((e) => e.type === 'station.destroyed')).toBe(true);
    expect(after.state.players.p1?.stewardHoldPoints).toBeUndefined();
  });

  it('десант на площадку развилки не летит: своя крепость — не мир', () => {
    const kernel = createKernel([stationModule, shuttleModule]);
    const st = built(kernel);
    const home = st.planets.B!;
    const staged: GameState = {
      ...st,
      planets: {
        ...st.planets,
        B: {
          ...home,
          buildings: [{ type: 'spaceport', level: 1, hp: data.buildings.spaceport!.hp }],
          hangar: [{ id: 'sq', units: [{ unit: 'landing_shuttle', count: 1 }], cargo: [{ unit: 'militia', count: 1 }] }],
        },
      },
    };
    const r = kernel.applyAction(
      staged,
      { id: 's:p1:drop', type: 'shuttle.strike', playerId: 'p1', payload: { planetId: 'B', squadronId: 'sq', targetPlanetId: SITE }, issuedAt: 0 },
      ctx(),
    );
    expect(r.ok ? 'ok' : r.code).toBe('E_NOT_CAPTURABLE');
  });
});
