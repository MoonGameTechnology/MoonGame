/**
 * СБИТАЯ КРЕПОСТЬ ПЕРЕХОДИТ ПОКОРЁЖЕННОЙ (FORT-5.13; решение владельца 22 — §0.7).
 *
 * До этого кирпича крепость нельзя было РАЗРУШИТЬ — её можно было только отнять, причём
 * даром. Пока орудия живы, узел не берут прилётом; как только их выбили, захватчик
 * занимал узел и получал чужую крепость ЦЕЛОЙ: все постройки плюс заново выданный по
 * уровню ядра расчёт. Вложение защитника переходило победителю в полном объёме, и
 * сильный бесплатно забирал базу у слабого.
 *
 * Бой здесь настоящий, а не подделанное событие: орудия ставятся стороной орбитальной
 * фазы против заведомо превосходящего флота, и уровень проверяется ПОСЛЕ того, как они
 * действительно погибли.
 */
import { describe, expect, it } from 'vitest';
import {
  captureOnArrivalModule,
  combatModule,
  createInitialState,
  createKernel,
  orbitalModule,
  stationModule,
  type Context,
  type Fleet,
  type GameState,
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
const arrival = (at: number, fleetId = 'R') => ({
  id: `e:${fleetId}:${at}`, at, type: 'fleet.arrived', payload: { fleetId, at: 'A' }, seq: 0,
});

/** Крепость уровня `level`, на которую сейчас прилетит превосходящий флот. */
function underFire(level: number): GameState {
  const s = createInitialState({ seed: 'fbt', version: { data: data.version, manifest: '1' } });
  return {
    ...s,
    players: {
      p1: { id: 'p1', name: 'p1', faction: 'x', status: 'active', resources: {} },
      p2: { id: 'p2', name: 'p2', faction: 'x', status: 'active', resources: {} },
    },
    planets: {
      A: {
        id: 'A', owner: 'p1', kind: 'void_station', position: { x: 0, y: 0 }, links: [],
        resources: {}, buildings: [{ type: CORE, level, hp: 300 }], garrison: [], traits: [],
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
  } as GameState;
}

/** Довести бой до конца. */
function fought(st: GameState): GameState {
  const r = kernel.advanceTo(st, ctx(200 * HOUR));
  if (!r.ok) throw new Error('advance отказ');
  return r.state;
}
const coreLevel = (st: GameState): number | undefined =>
  st.planets.A?.buildings.find((b) => b.type === CORE)?.level;

describe('сбитая крепость — решение владельца 22', () => {
  it('гибель расчёта РОНЯЕТ уровень крепости', () => {
    const after = fought(underFire(4));
    expect(after.fleets[GUNS_FLEET], 'расчёт обязан был погибнуть — тест ничего не мерил').toBeUndefined();
    expect(coreLevel(after)).toBe(3);
    expect(after.planets.A?.buildings.some((b) => b.type === CORE), 'ядро снесло целиком').toBe(true);
  });

  it('ЗАХВАТЧИКУ достаётся МЕНЬШИЙ расчёт, чем был у защитника', () => {
    // Смысл решения: трофей не бесплатный. Проверяется через настоящий захват прилётом —
    // иначе упавший уровень остался бы числом, которого никто не читает.
    const after = fought(underFire(4));
    const taken = kernel.advanceTo(
      { ...after, scheduled: [arrival(200 * HOUR + 1)], scheduleSeq: 2 },
      ctx(201 * HOUR),
    );
    if (!taken.ok) throw new Error('advance отказ');
    expect(taken.state.planets.A?.owner, 'узел не перешёл — дальше мерить нечего').toBe('p2');
    expect(taken.state.fleets[GUNS_FLEET]?.units[0]?.count, 'трофей достался прежней силы').toBe(3);
  });

  it('расчёт НЕ воскресает сразу — иначе узел не взяли бы никогда', () => {
    // Позвать сверку прямо на гибели значило бы вернуть орудия в тот же миг, посреди боя,
    // и `captureOnArrival` снова увидел бы чужой отряд.
    const after = fought(underFire(3));
    expect(after.fleets[GUNS_FLEET]).toBeUndefined();
  });

  it('НИЖЕ ПЕРВОГО уровень не падает — крепость делением не исчезает', () => {
    const after = fought(underFire(1));
    expect(coreLevel(after)).toBe(1);
  });

  it('контроль: гибель ЧУЖОГО флота на том же узле крепость не трогает', () => {
    // Слушатель ходит по детерминированному id отряда. Спутай он его с обычным флотом —
    // любая потеря в системе роняла бы уровень крепости.
    const st = underFire(4);
    // Крепости на узле нет вовсе — гибнет ОБЫЧНЫЙ свой флот. Ядро при этом стоит.
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
    expect(coreLevel(after), 'чужая гибель уронила уровень крепости').toBe(4);
  });
});
