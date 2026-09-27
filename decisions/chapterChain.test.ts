import { describe, expect, it } from 'vitest';
import {
  buildStateFromMap,
  parseMatchMap,
  type GameState,
} from '../packages/shared-core/src/index';
import { shippedGameData } from '../data/bundle';
import mapJson from '../data/maps/pve-4.json';
import pve3 from '../data/maps/pve-3.json';
import { chapterChain, extractionCandidates, rendezvousOf } from './chapterChain';

// Главная цепочка главы IV (PVR-7.5): связь → архив → извлечение → вывод. Шаги, текущий шаг,
// куда вести камеру и сколько сделано; в мире без сценария цепочки нет.

const data = shippedGameData();
const HOUR = 3_600_000;
const NEED = 4 * HOUR;
const start = (): GameState => buildStateFromMap(parseMatchMap(mapJson), data);
const ids = (s: GameState) => chapterChain(s, 'p1', NEED)!.map((st) => [st.id, st.done, st.active]);

describe('цепочка главы IV', () => {
  it('в главах без сценария цепочки нет', () => {
    expect(chapterChain(buildStateFromMap(parseMatchMap(pve3), data), 'p1', NEED)).toBeNull();
  });

  it('на старте: четыре шага, текущий — связь, цели — точка встречи, архив, зона вывода', () => {
    const s = start();
    expect(rendezvousOf(s)).toEqual({ at: 'rendezvous', ally: 'ally' });
    const chain = chapterChain(s, 'p1', NEED)!;
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
    const chain = chapterChain(s, 'p1', NEED)!;
    expect(chain[2]).toMatchObject({ id: 'extract', active: true, progress: 0.25 });
    s = { ...s, extraction: { ...s.extraction!, carrier: 'p1_1', doneMs: NEED } };
    // Носитель есть — «вывод» ведёт камеру к нему, а не к зоне.
    expect(chapterChain(s, 'p1', NEED)![3]).toMatchObject({
      id: 'deliver',
      active: true,
      target: 'staging',
    });
    s = { ...s, fleets: { ...s.fleets, p1_1: { ...s.fleets.p1_1!, location: 'approach' } } };
    expect(chapterChain(s, 'p1', NEED)![3]!.target).toBe('approach');
    s = { ...s, extraction: { ...s.extraction!, deliveredAt: s.time } };
    expect(chapterChain(s, 'p1', NEED)!.every((st) => st.done && !st.active)).toBe(true);
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
