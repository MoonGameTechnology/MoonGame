// Разведчик провинцию не берёт (решение владельца 2026-10-16).
//
// Что здесь закрепляется. На дуэли duel-1 партию решали дешёвые разведчики: они
// облетали пустые провинции и брали их прилётом. Правило: флот, в котором живы только
// корабли с трейтом `recon`, пустую провинцию не берёт — ни прилётом, ни с орбиты, что
// бы ни лежало в трюме. Десант с такого флота занимает пустой мир высадкой, как
// защищённый: войска сходят на землю и становятся гарнизоном. Один боевой корабль в
// отряде делает его обычным флотом.
import { describe, expect, it } from 'vitest';
import { createKernel } from '../kernel/kernel';
import { movementModule } from './movement';
import { captureOnArrivalModule } from './captureOnArrival';
import { ASSAULT_LANDING_HOURS, combatModule } from './combat';
import { orbitalModule } from './orbital';
import { interceptModule } from './intercept';
import { createInitialState, type Fleet, type GameState, type Planet } from '../state/gameState';
import { parseGameData, type GameData } from '../data/schemas';
import { isReconFleet } from '../state/recon';
import type { Action, AdvanceResult, ApplyResult, Context } from '../action/types';

const data: GameData = parseGameData({
  version: '0.1.0',
  resources: ['metal'],
  units: {
    probe: {
      faction: 'x',
      traits: ['recon'],
      stats: { attack: 1, defense: 1, speed: 10, hp: 6, cargoCapacity: 2 },
    },
    fighter: { faction: 'x', stats: { attack: 10, defense: 0, speed: 10, hp: 20 } },
    militia: { faction: 'x', domain: 'ground', stats: { attack: 3, defense: 0, speed: 1, hp: 10 } },
  },
  factions: {},
  buildings: {},
  events: {},
  sectorKinds: { planet: { capturable: true, buildable: true, orbit: true } },
});
const HOUR = 3_600_000;
const ctx = (now: number): Context => ({ now, data });

function planet(id: string, owner: string | null, x: number, garrison: string[] = []): Planet {
  return {
    id,
    owner,
    kind: 'planet',
    position: { x, y: 0 },
    resources: {},
    buildings: [],
    garrison: garrison.map((unit) => ({ unit, count: 1 })),
    traits: [],
  };
}
function fleet(id: string, location: string, units: string[], landing: string[] = []): Fleet {
  return {
    id,
    owner: 'p1',
    location,
    movement: null,
    units: units.map((unit) => ({ unit, count: 1 })),
    landing: landing.map((unit) => ({ unit, count: 1 })),
    traits: [],
  };
}
function state(planets: Planet[], fleets: Fleet[]): GameState {
  const s = createInitialState({ seed: 'recon', version: { data: '0.1.0', manifest: '1' } });
  return {
    ...s,
    planets: Object.fromEntries(planets.map((p) => [p.id, p])),
    fleets: Object.fromEntries(fleets.map((f) => [f.id, f])),
  };
}
const act = (type: string, payload: Record<string, unknown>): Action => ({
  id: `${type}:${JSON.stringify(payload)}`,
  type,
  playerId: 'p1',
  payload,
  issuedAt: 0,
});
const okApply = (r: ApplyResult): ApplyResult & { ok: true } => {
  if (!r.ok) throw new Error(`apply failed: ${r.code}`);
  return r;
};
const okAdvance = (r: AdvanceResult): AdvanceResult & { ok: true } => {
  if (!r.ok) throw new Error(`advance failed: ${r.code}`);
  return r;
};

/** Флот F летит из A в пустую ничью B (30 единиц, скорость 10 → 3 ч). */
function arrive(units: string[], landing: string[] = []): AdvanceResult & { ok: true } {
  const a = planet('A', 'p1', 0);
  const b = planet('B', null, 30);
  a.links = ['B'];
  b.links = ['A'];
  const kernel = createKernel([movementModule, captureOnArrivalModule]);
  const dep = okApply(
    kernel.applyAction(
      state([a, b], [fleet('F', 'A', units, landing)]),
      act('fleet.move', { fleetId: 'F', to: 'B' }),
      ctx(0),
    ),
  );
  return okAdvance(kernel.advanceTo(dep.state, ctx(3 * HOUR)));
}

describe('разведчик провинцию не берёт — прилёт', () => {
  it('флот из одних разведчиков пустую провинцию не берёт', () => {
    const r = arrive(['probe']);
    expect(r.state.planets.B!.owner).toBeNull();
    expect(r.events.some((e) => e.type === 'planet.captured')).toBe(false);
  });

  it('и с десантом в трюме прилётом не берёт', () => {
    expect(arrive(['probe'], ['militia']).state.planets.B!.owner).toBeNull();
  });

  it('боевой корабль в отряде делает флот обычным: провинция берётся', () => {
    expect(arrive(['probe', 'fighter']).state.planets.B!.owner).toBe('p1');
  });
});

describe('разведчик провинцию не берёт — с орбиты', () => {
  const kernel = createKernel([orbitalModule, combatModule, interceptModule]);
  const assault = act('fleet.assault', { fleetId: 'F' });
  const at = (units: string[], landing: string[] = [], garrison: string[] = []): GameState => {
    const f = fleet('F', 'P', units, landing);
    f.orbit = 'near';
    return state([planet('P', 'p2', 0, garrison)], [f]);
  };

  it('без десанта пустой мир не занимает: отказ E_RECON_NO_CAPTURE', () => {
    const r = kernel.applyAction(at(['probe']), assault, ctx(0));
    expect(r.ok).toBe(false);
    expect(!r.ok && r.code).toBe('E_RECON_NO_CAPTURE');
  });

  it('с десантом занимает пустой мир высадкой: войска становятся гарнизоном', () => {
    const started = okApply(kernel.applyAction(at(['probe'], ['militia']), assault, ctx(0)));
    expect(started.state.planets.P!.owner).toBe('p2'); // сразу — только высадка
    const landed = okAdvance(kernel.advanceTo(started.state, ctx(ASSAULT_LANDING_HOURS * HOUR)));
    expect(landed.state.planets.P!.owner).toBe('p1');
    expect(landed.state.planets.P!.garrison).toEqual([{ unit: 'militia', count: 1 }]);
    expect(landed.state.fleets.F!.landing ?? []).toEqual([]);
  });

  it('на защищённом мире отказ прежний: E_NO_TROOPS', () => {
    const r = kernel.applyAction(at(['probe'], [], ['militia']), assault, ctx(0));
    expect(!r.ok && r.code).toBe('E_NO_TROOPS');
  });

  it('с боевым кораблём в отряде пустой мир занимается сразу, как прежде', () => {
    const r = okApply(kernel.applyAction(at(['probe', 'fighter']), assault, ctx(0)));
    expect(r.state.planets.P!.owner).toBe('p1');
  });
});

describe('isReconFleet', () => {
  it('мёртвый стек не считается; пустой флот и неизвестный юнит — не разведка', () => {
    const units = (list: Array<[string, number]>) => ({
      units: list.map(([unit, count]) => ({ unit, count })),
    });
    expect(
      isReconFleet(
        units([
          ['probe', 2],
          ['fighter', 0],
        ]),
        data,
      ),
    ).toBe(true);
    expect(isReconFleet(units([['probe', 0]]), data)).toBe(false);
    expect(isReconFleet(units([['ghost', 1]]), data)).toBe(false);
  });
});
