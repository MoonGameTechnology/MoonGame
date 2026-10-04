import { describe, expect, it } from 'vitest';
import {
  buildStateFromMap,
  parseMatchMap,
  type GameState,
} from '../packages/shared-core/src/index';
import { shippedGameData } from '../data/bundle';
import mapJson from '../data/maps/pve-4.json';
import pve3 from '../data/maps/pve-3.json';
import pve5 from '../data/maps/pve-5.json';
import pve6 from '../data/maps/pve-6.json';
import { chapterChain, extractionCandidates, rendezvousOf } from './chapterChain';

// Главная цепочка глав IV (PVR-7.5: связь → архив → извлечение → вывод), VI (PVR-8.5: доки →
// эвакуация → очаги → главные силы) и V (PVR-9.7: звено сети → очаги). Шаги, текущий шаг, куда
// вести камеру и сколько сделано; в мире без сценария цепочки нет.

const data = shippedGameData();
const HOUR = 3_600_000;
const NEED = 4 * HOUR;
const start = (): GameState => buildStateFromMap(parseMatchMap(mapJson), data);
const ids = (s: GameState) =>
  chapterChain(s, 'p1', NEED, data)!.map((st) => [st.id, st.done, st.active]);

describe('цепочка главы IV', () => {
  it('в главах без сценария цепочки нет', () => {
    expect(chapterChain(buildStateFromMap(parseMatchMap(pve3), data), 'p1', NEED, data)).toBeNull();
  });

  it('на старте: четыре шага, текущий — связь, цели — точка встречи, архив, зона вывода', () => {
    const s = start();
    expect(rendezvousOf(s)).toEqual({ at: 'rendezvous', ally: 'ally' });
    const chain = chapterChain(s, 'p1', NEED, data)!;
    expect(chain.map((st) => [st.id, st.target])).toEqual([
      ['contact', 'rendezvous'],
      ['archive', 'archive'],
      ['extract', 'archive'],
      ['deliver', 'staging'],
    ]);
    expect(ids(s)).toEqual([
      ['contact', false, true],
      ['archive', false, false],
      ['extract', false, false],
      ['deliver', false, false],
    ]);
  });

  it('шаги закрываются по миру: связь, очищенный архив, доля работы, носитель в пути', () => {
    let s: GameState = { ...start(), missionFacts: { contacted: { p1: ['rendezvous'] } } };
    expect(ids(s)[1]).toEqual(['archive', false, true]);
    s = { ...s, planets: { ...s.planets, archive: { ...s.planets.archive!, owner: 'p1' } } };
    s = { ...s, extraction: { ...s.extraction!, fleetId: 'p1_1', owner: 'p1', doneMs: NEED / 4 } };
    const chain = chapterChain(s, 'p1', NEED, data)!;
    expect(chain[2]).toMatchObject({ id: 'extract', active: true, progress: 0.25 });
    s = { ...s, extraction: { ...s.extraction!, carrier: 'p1_1', doneMs: NEED } };
    // Носитель есть — «вывод» ведёт камеру к нему, а не к зоне.
    expect(chapterChain(s, 'p1', NEED, data)![3]).toMatchObject({
      id: 'deliver',
      active: true,
      target: 'staging',
    });
    s = { ...s, fleets: { ...s.fleets, p1_1: { ...s.fleets.p1_1!, location: 'approach' } } };
    expect(chapterChain(s, 'p1', NEED, data)![3]!.target).toBe('approach');
    s = { ...s, extraction: { ...s.extraction!, deliveredAt: s.time } };
    expect(chapterChain(s, 'p1', NEED, data)!.every((st) => st.done && !st.active)).toBe(true);
  });

  it('кандидаты на извлечение — свои флоты у архива, не в пути и не в бою', () => {
    let s = start();
    expect(extractionCandidates(s, 'p1')).toEqual([]);
    s = {
      ...s,
      fleets: {
        ...s.fleets,
        p1_1: { ...s.fleets.p1_1!, location: 'archive' },
        p1_2: { ...s.fleets.p1_2!, location: 'archive', battleId: 'b1' },
      },
    };
    expect(extractionCandidates(s, 'p1')).toEqual(['p1_1']);
    s = { ...s, extraction: { ...s.extraction!, carrier: 'p1_1' } };
    expect(extractionCandidates(s, 'p1')).toEqual([]);
  });
});

// Глава VI (PVR-8.5): найти доки → вывести людей → подавить очаги → разгромить главные силы.
// Счёт результатов — у судьи контракта (`operationStatus`), цепочка его только показывает.
describe('цепочка главы VI', () => {
  const DOCKS = 'quarantine_docks';
  /** Мир главы VI с начатым штурмом: врага судья знает по `pve.npcPlayerId`. */
  const six = (): GameState =>
    ({
      ...buildStateFromMap(parseMatchMap(pve6), data),
      pve: { npcPlayerId: 'swarm' },
    }) as unknown as GameState;
  const view = (s: GameState) =>
    chapterChain(s, 'p1', NEED, data)!.map((st) => [
      st.id,
      st.done,
      st.active,
      st.target ?? null,
      st.count ?? null,
    ]);
  /** Транспорты вышли из доков к игроку — как по прибытии его флота. */
  const released = (s: GameState): GameState => {
    const docks = s.planets[DOCKS]!;
    const evac = docks.awaitingFleets![0]!;
    return {
      ...s,
      planets: { ...s.planets, [DOCKS]: { ...docks, awaitingFleets: undefined } },
      fleets: { ...s.fleets, [evac.id]: { ...evac, location: DOCKS } },
    };
  };

  it('на старте: доки, эвакуация, очаги, главные силы; связи шагом нет', () => {
    expect(view(six())).toEqual([
      ['docks', false, true, DOCKS, null],
      ['evacuate', false, false, null, { done: 0, total: 3 }],
      ['production', false, false, 'complex', { done: 0, total: 3 }],
      ['forces', false, false, null, { done: 0, total: 3 }],
    ]);
  });

  it('порог эвакуации виден с начала главы: довести 3 из 4', () => {
    expect(chapterChain(six(), 'p1', NEED, data)![1]!.rule).toEqual({ need: 3, of: 4 });
  });

  it('штурм не начат — цепочки ещё нет, и связь главы IV её не подменяет', () => {
    const s = buildStateFromMap(parseMatchMap(pve6), data);
    expect(s.operation).toBeDefined();
    expect(chapterChain(s, 'p1', NEED, data)).toBeNull();
  });

  it('эвакуация ведёт к докам, пока люди ждут, а после выхода — к базе', () => {
    const s: GameState = { ...six(), missionFacts: { found: { p1: [DOCKS] } } };
    expect(view(s).slice(0, 2)).toEqual([
      ['docks', true, false, DOCKS, null],
      ['evacuate', false, true, DOCKS, { done: 0, total: 3 }],
    ]);
    expect(chapterChain(released(s), 'p1', NEED, data)![1]!.target).toBe('forward_base');
  });

  it('счёт — судьи: доставленные, очаги без Роя (кто бы ни взял), разгромленные соединения', () => {
    const s = released(six());
    s.missionFacts = { found: { p1: [DOCKS] }, evacuated: { p1: 3 } };
    s.planets.north_foundry = { ...s.planets.north_foundry!, owner: 'ally' };
    s.operation!.forces.swarm_host!.brokenAt = 5;
    expect(view(s).slice(1)).toEqual([
      ['evacuate', true, false, 'forward_base', { done: 3, total: 3 }],
      ['production', false, true, 'complex', { done: 1, total: 3 }],
      ['forces', false, false, null, { done: 1, total: 3 }],
    ]);
  });

  it('потеря транспортов видна в пороге: возможных стало меньше', () => {
    const s = six();
    s.planets[DOCKS]!.awaitingFleets![0]!.units = [{ unit: 'evac_transport', count: 2 }];
    expect(chapterChain(s, 'p1', NEED, data)![1]!.rule).toEqual({ need: 3, of: 2 });
  });
});

describe('цепочка главы V', () => {
  /** Мир главы V с начатым штурмом: врага судья знает по `pve.npcPlayerId`. */
  const five = (): GameState =>
    ({
      ...buildStateFromMap(parseMatchMap(pve5), data),
      pve: { npcPlayerId: 'swarm' },
    }) as unknown as GameState;
  const view = (s: GameState) =>
    chapterChain(s, 'p1', NEED, data)!.map((st) => [
      st.id,
      st.done,
      st.active,
      st.target ?? null,
      st.count ?? null,
    ]);
  /** Игрок (или союзник: обзор общий) опознал флот Роя с такими кораблями. */
  const sighted = (s: GameState, unit: string): GameState => ({
    ...s,
    swarmIntel: {
      p1: { seen: { owner: 'swarm', location: 'w_link', at: s.time, units: [{ unit, count: 1 }] } },
    },
  });
  const owned = (s: GameState, owner: string | null, ...ids: string[]): GameState => {
    for (const id of ids) s.planets[id] = { ...s.planets[id]!, owner };
    return s;
  };

  it('на старте: звено и очаги; ни эвакуации, ни главных сил, ни связи шагом', () => {
    expect(view(five())).toEqual([
      ['link', false, true, 'w_link', null],
      ['production', false, false, 'focus_west', { done: 0, total: 3 }],
    ]);
  });

  it('звено найдено, когда опознан ретранслятор; простой флот Роя звеном не считается', () => {
    expect(view(sighted(five(), 'frigate'))[0]).toEqual(['link', false, true, 'w_link', null]);
    expect(view(sighted(five(), 'swarm_relay'))).toEqual([
      ['link', true, false, 'w_link', null],
      ['production', false, true, 'focus_west', { done: 0, total: 3 }],
    ]);
  });

  it('звено победу не запирает: очаги считаются и без него', () => {
    expect(view(owned(five(), 'p1', 'focus_west'))[1]).toEqual([
      'production',
      false,
      false,
      'focus_center',
      { done: 1, total: 3 },
    ]);
  });

  it('очаг без Роя засчитан, кто бы его ни взял; отбитый Роем снова открыт', () => {
    let s = owned(sighted(five(), 'swarm_relay'), 'ally', 'focus_east');
    s = owned(s, 'p1', 'focus_west', 'focus_center');
    expect(view(s)[1]).toEqual(['production', true, false, null, { done: 3, total: 3 }]);
    expect(chapterChain(s, 'p1', NEED, data)!.every((st) => st.done && !st.active)).toBe(true);
    s = owned(s, 'swarm', 'focus_center');
    expect(view(s)[1]).toEqual(['production', false, true, 'focus_center', { done: 2, total: 3 }]);
  });
});
