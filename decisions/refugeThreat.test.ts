import { describe, expect, it } from 'vitest';
import { refugeGuardOffer, refugeThreats } from './refugeThreat';
import type { Fleet, GameState } from '../packages/shared-core/src/index';

// Доклад союзника (PVR-8.4, §8.7): «Основное соединение противника меняет курс. Идёт к
// докам» — только о том, что сторона видит, и только о месте, которое она знает.

const fleet = (id: string, to: string | null, over: Partial<Fleet> = {}): Fleet => ({
  id,
  owner: 'swarm',
  location: to ? null : 'complex',
  movement: to
    ? { from: 'complex', to: 'rim', departedAt: 0, arrivesAt: 9, destination: to }
    : null,
  units: [{ unit: 'drone', count: 3 }],
  traits: [],
  ...over,
});

/** Охрана идёт к докам, резерв — к комплексу; доки игрок знает. */
function world(over: Partial<GameState> = {}): GameState {
  return {
    fleets: {
      guard: fleet('guard', 'docks'),
      reserve: fleet('reserve', 'complex'),
      wave: fleet('wave', 'docks'),
    },
    operation: {
      production: ['complex'],
      forces: {
        guard: { fleets: ['guard'], hp: 100 },
        reserve: { fleets: ['reserve'], hp: 100 },
      },
      breakAt: 0.2,
      evacuate: 3,
    },
    missionFacts: { found: { p1: ['docks'] } },
    ...over,
  } as unknown as GameState;
}

const threats = (s: GameState, reported: string[] = [], sees = (_f: Fleet): boolean => true) =>
  refugeThreats(s, 'p1', sees, new Set(reported));

describe('доклад об угрозе месту эвакуации (PVR-8.4)', () => {
  it('видимое главное соединение идёт к известным докам — доклад; волна — нет', () => {
    expect(threats(world())).toEqual([{ fleetId: 'guard', at: 'docks' }]);
  });

  it('курс читается по концу пути, а не по ближнему узлу; последний переход — тоже курс', () => {
    const s = world();
    s.fleets.reserve = fleet('reserve', null, {
      location: null,
      movement: { from: 'rim', to: 'docks', departedAt: 0, arrivesAt: 9 },
    });
    expect(threats(s).map((t) => t.fleetId)).toEqual(['guard', 'reserve']);
  });

  it('невидимый флот не докладывается: доклад — по доступным сведениям', () => {
    expect(threats(world(), [], (f) => f.id !== 'guard')).toEqual([]);
  });

  it('о неизвестных доках не докладывают', () => {
    expect(threats(world({ missionFacts: {} }))).toEqual([]);
    expect(threats(world({ missionFacts: { found: { ally: ['docks'] } } }))).toEqual([]);
  });

  it('каждый флот — один раз; разгромленное соединение — уже не основные силы', () => {
    expect(threats(world(), ['guard'])).toEqual([]);
    const s = world();
    s.operation!.forces.guard!.brokenAt = 5;
    expect(threats(s)).toEqual([]);
  });

  it('влитый в соединение флот докладывается как часть основных сил', () => {
    const s = world();
    s.operation!.forces.reserve!.fleets = ['reserve', 'reserve-2'];
    s.fleets['reserve-2'] = fleet('reserve-2', 'docks');
    expect(threats(s, ['guard'])).toEqual([{ fleetId: 'reserve-2', at: 'docks' }]);
  });

  it('стоящий флот и уничтоженный флот угрозой не считаются; без контракта — пусто', () => {
    const s = world();
    s.fleets.guard = fleet('guard', null);
    delete s.fleets.reserve;
    expect(threats(s)).toEqual([]);
    expect(threats(world({ operation: undefined }))).toEqual([]);
  });
});

describe('предложение союзника охранять доки (PVR-8.5, §8.7)', () => {
  const offer = (s: GameState, sees = (_f: Fleet): boolean => true) =>
    refugeGuardOffer(s, 'p1', 'ally', sees);

  it('видимая угроза доклада — союзник предлагает охранять доки', () => {
    expect(offer(world())).toEqual({ at: 'docks' });
  });

  it('угрозы не видно или доки неизвестны — предложения нет', () => {
    expect(offer(world(), (f) => f.id !== 'guard')).toBeNull();
    expect(offer(world({ missionFacts: {} }))).toBeNull();
  });

  it('союзник уже охраняет доки по приказу — предлагать нечего; занят другим — предлагает', () => {
    const guarding = world({
      allyOps: { ally: { by: 'p1', kind: 'guard', planet: 'docks', issuedAt: 0 } },
    });
    expect(offer(guarding)).toBeNull();
    const elsewhere = world({
      allyOps: { ally: { by: 'p1', kind: 'attack', planet: 'rim', issuedAt: 0 } },
    });
    expect(offer(elsewhere)).toEqual({ at: 'docks' });
  });
});
