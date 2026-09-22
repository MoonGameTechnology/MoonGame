/**
 * КРЕПОСТЬ ГИБНЕТ, А НЕ ПЕРЕХОДИТ (FORT-5.13; решение владельца 22, 2026-09-22).
 *
 * До этого кирпича крепость нельзя было РАЗРУШИТЬ — её можно было только отнять, причём
 * даром. Пока орудия живы, узел не берут прилётом; как только их выбили, захватчик
 * занимал узел и получал чужую крепость ЦЕЛОЙ: все постройки плюс заново выданный по
 * уровню ядра расчёт. Вложение защитника переходило победителю в полном объёме.
 *
 * Теперь выбитые орудия означают гибель сооружения: постройки уходят вместе с ядром, а
 * узел возвращается к тому виду, каким был ДО конверсии. Победителю достаётся голое
 * место — хочет здесь крепость, строит свою.
 *
 * Бой здесь настоящий, а не подделанное событие: превосходящий флот прилетает на
 * крепость, раунды тикают, орудия гибнут — и только потом сверяется узел.
 */
import { describe, expect, it } from 'vitest';
import {
  captureOnArrivalModule,
  combatModule,
  createInitialState,
  createKernel,
  orbitalModule,
  stationModule,
  type Action,
  type Context,
  type Fleet,
  type GameState,
  type ScheduledEvent,
} from '../packages/shared-core/src/index';
import { shippedGameData } from './bundle';

const data = shippedGameData();
const ctx = (now = 0): Context => ({ now, data });
const kernel = createKernel([orbitalModule, combatModule, stationModule, captureOnArrivalModule]);
const GUNS_FLEET = 'fleet:station:A';
const CORE = 'starfort';
const HOUR = 3_600_000;

const raider = (units = 80): Fleet => ({
  id: 'R', owner: 'p2', location: 'A', movement: null, orbit: 'near',
  units: [{ unit: 'cruiser', count: units }], landing: [], traits: [], battleId: null,
});

/** Прилёт — то самое событие, которым бой и заводится: сторон руками не расставляем,
 *  иначе раунды некому было бы тикать, и «бой» стоял бы неподвижно. */
const arrival = (at: number, fleetId = 'R'): ScheduledEvent => ({
  id: `e:${fleetId}:${at}`, at, type: 'fleet.arrived', payload: { fleetId, at: 'A' }, seq: 0,
});

/** Крепость уровня `level`, на которую сейчас прилетит превосходящий флот.
 *  `priorKind` — память конверсии: чем узел был до того, как стал крепостью. */
function underFire(level: number, extraBuildings: string[] = [], priorKind = 'asteroid'): GameState {
  const s = createInitialState({ seed: 'fd', version: { data: data.version, manifest: '1' } });
  return {
    ...s,
    players: {
      p1: { id: 'p1', name: 'p1', faction: 'x', status: 'active', resources: {} },
      p2: { id: 'p2', name: 'p2', faction: 'x', status: 'active', resources: {} },
    },
    planets: {
      A: {
        id: 'A', owner: 'p1', kind: 'void_station', priorKind, position: { x: 0, y: 0 }, links: [],
        resources: {}, garrison: [], traits: [],
        buildings: [
          { type: CORE, level, hp: 300 },
          ...extraBuildings.map((type) => ({ type, level: 1, hp: 40 })),
        ],
      },
    },
    fleets: {
      [GUNS_FLEET]: {
        id: GUNS_FLEET, owner: 'p1', location: 'A', movement: null, battleId: null,
        units: [{ unit: 'fortress_guns', count: level }], landing: [], traits: [],
      },
      R: raider(),
    },
    scheduled: [arrival(1)],
    scheduleSeq: 1,
  } as unknown as GameState;
}

/** Довести бой до конца. */
function fought(st: GameState): GameState {
  const r = kernel.advanceTo(st, ctx(200 * HOUR));
  if (!r.ok) throw new Error('advance отказ');
  return r.state;
}

describe('гибель крепости — решение владельца 22', () => {
  it('выбитые орудия УНИЧТОЖАЮТ крепость вместе с её постройками', () => {
    const after = fought(underFire(4, ['radar', 'shipyard']));
    expect(after.fleets[GUNS_FLEET], 'расчёт обязан был погибнуть — тест ничего не мерил').toBeUndefined();
    expect(after.planets.A?.buildings, 'постройки пережили гибель крепости').toEqual([]);
  });

  it('узел ВОЗВРАЩАЕТСЯ к прежнему виду, а не остаётся крепостью', () => {
    // Память кладёт сама конверсия. Не вернуть вид значило бы навсегда стереть то, что
    // стояло под крепостью: астероидное поле заново не выдумать.
    const after = fought(underFire(2, [], 'asteroid'));
    expect(after.planets.A?.kind).toBe('asteroid');
    expect(after.planets.A?.priorKind, 'память конверсии пережила саму конверсию').toBeUndefined();
  });

  it('БЕЗ памяти о прежнем виде узел становится пустым пространством, а не крепостью', () => {
    // Так бывает у крепости, посеянной картой сразу как `void_station`: конверсии не
    // было, запоминать было нечего. Оставить `void_station` значило бы оставить на карте
    // бестелесную крепость, которую можно достроить заново бесплатно.
    const seeded = underFire(2);
    delete (seeded.planets.A as { priorKind?: string }).priorKind;
    expect(fought(seeded).planets.A?.kind).toBe('empty');
  });

  it('ВЛАДЕЛЕЦ узла не меняется гибелью — узел стал своим захватом, а не крепостью', () => {
    const after = fought(underFire(3));
    expect(after.planets.A?.owner).toBe('p1');
    // Но защищать его больше нечем: обычный прилёт теперь узел ЗАБИРАЕТ.
    const taken = kernel.advanceTo(
      { ...after, scheduled: [arrival(200 * HOUR + 1)], scheduleSeq: 2 },
      ctx(201 * HOUR),
    );
    if (!taken.ok) throw new Error('advance отказ');
    expect(taken.state.planets.A?.owner).toBe('p2');
    expect(taken.state.fleets[GUNS_FLEET], 'победителю достался готовый расчёт').toBeUndefined();
    expect(taken.state.planets.A?.buildings, 'победителю достались чужие постройки').toEqual([]);
  });

  it('на голом месте победитель строит СВОЮ крепость — и платит за неё', () => {
    // Смысл решения: трофея нет, есть место. Проверяется тем, что действие конверсии
    // на этом узле снова законно — то есть вид узла действительно вернулся жилым.
    const after = fought(underFire(2, [], 'nebula'));
    const mine: GameState = {
      ...after,
      players: { ...after.players, p1: { ...after.players.p1!, resources: { metal: 9000 } } },
    };
    const deploy: Action = {
      id: 's:p1:1', type: 'station.deploy', playerId: 'p1', payload: { planetId: 'A' }, issuedAt: 0,
    };
    const r = createKernel([stationModule]).applyAction(mine, deploy, ctx(300 * HOUR));
    expect(r.ok, r.ok ? '' : `отказ ${r.code}`).toBe(true);
    if (!r.ok) return;
    expect(r.state.planets.A?.kind).toBe('void_station');
    expect(r.state.planets.A?.priorKind, 'новая конверсия обязана запомнить вид заново').toBe('nebula');
    expect(r.state.players.p1?.resources.metal, 'крепость досталась даром').toBeLessThan(9000);
  });

  it('контроль: гибель ЧУЖОГО флота на том же узле крепость не трогает', () => {
    // Слушатель ходит по детерминированному id отряда. Спутай он его с обычным флотом —
    // любая потеря в системе сносила бы крепость.
    const st = underFire(4);
    const solo: GameState = {
      ...st,
      fleets: {
        R: raider(),
        V: {
          id: 'V', owner: 'p1', location: 'A', movement: null, orbit: 'near', battleId: null,
          units: [{ unit: 'scout_drone', count: 1 }], landing: [], traits: [],
        },
      },
    } as GameState;
    const after = fought(solo);
    expect(after.fleets.V, 'жертва выжила — контроль ничего не доказал').toBeUndefined();
    expect(after.planets.A?.kind, 'чужая гибель снесла крепость').toBe('void_station');
    expect(after.planets.A?.buildings.some((b) => b.type === CORE)).toBe(true);
  });
});
