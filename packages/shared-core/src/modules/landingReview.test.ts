/**
 * Замечания Codex на #1409 (MSB-9, высадка штурмом). Здесь — правила боя и флота; подкрепление
 * челноком закреплено рядом со своим модулем (`shuttleDrop.test.ts`), выводок на высадке —
 * в `fleetBrood.test.ts`.
 *
 *  1. Посадка на борт не уводит трюм в минус и не рождает бойцов.
 *  2. Флот на высадке не сливается: трюм заморожен до конца высадки.
 *  3. После захвата ВСЕ враги нового хозяина на земле вступают в новый бой.
 *  4. Мир и продолжение штурма — только берегами завершённого боя; берег без боя остаётся.
 */
import { describe, expect, it } from 'vitest';
import { createKernel } from '../kernel/kernel';
import type { GameModule } from '../kernel/module';
import { ASSAULT_LANDING_HOURS, combatModule } from './combat';
import { orbitalModule } from './orbital';
import { interceptModule } from './intercept';
import { diplomacyModule } from './diplomacy';
import { fleetOpsModule } from './fleetOps';
import {
  createInitialState,
  type Battle,
  type Fleet,
  type GameState,
  type Planet,
  type Player,
  type UnitStack,
} from '../state/gameState';
import { parseGameData, type GameData } from '../data/schemas';
import { setStance } from '../state/diplomacy';
import type { Action, AdvanceResult, ApplyResult, Context, DomainEvent } from '../action/types';

const data: GameData = parseGameData({
  version: '0.1.0',
  resources: ['metal'],
  units: {
    fighter: { faction: 'x', stats: { attack: 10, defense: 0, speed: 10, hp: 20 }, line: 'front' },
    marine: { faction: 'x', domain: 'ground', stats: { attack: 10, defense: 4, speed: 1, hp: 20 } },
    militia: { faction: 'x', domain: 'ground', stats: { attack: 3, defense: 0, speed: 1, hp: 10 } },
    guard: { faction: 'x', domain: 'ground', stats: { attack: 40, defense: 40, speed: 1, hp: 900 } },
    bastion: { faction: 'x', domain: 'ground', stats: { attack: 40, defense: 40, speed: 1, hp: 300 } },
  },
  factions: {},
  buildings: {},
  events: {},
});
const HOUR = 3_600_000;
const LANDED = ASSAULT_LANDING_HOURS * HOUR;
const ctx = (now: number): Context => ({ now, data });
const stacks = (list: Array<[string, number]>): UnitStack[] => list.map(([unit, count]) => ({ unit, count }));
const seat = (id: string): Player => ({ id, name: id, faction: 'x', status: 'active', resources: {} });
const marines = (list: readonly UnitStack[] | undefined): number =>
  (list ?? []).filter((x) => x.unit === 'marine').reduce((n, x) => n + x.count, 0);

function fleet(id: string, owner: string, units: Array<[string, number]>, landing: UnitStack[]): Fleet {
  return { id, owner, location: 'P', movement: null, units: stacks(units), landing, traits: [], orbit: 'near' };
}
function world(fleets: Fleet[], garrison: Array<[string, number]>, players: string[] = ['p1', 'p2']): GameState {
  const s = createInitialState({ seed: 'land-review', version: { data: '0.1.0', manifest: '1' } });
  const planet: Planet = {
    id: 'P',
    owner: 'p2',
    position: { x: 0, y: 0 },
    resources: {},
    buildings: [],
    garrison: stacks(garrison),
    traits: [],
  };
  return {
    ...s,
    players: Object.fromEntries(players.map((id) => [id, seat(id)])),
    planets: { P: planet },
    fleets: Object.fromEntries(fleets.map((f) => [f.id, f])),
  };
}

// Прилёт без движения: `fleet.arrived` для флота, уже стоящего на узле.
const arrivalModule: GameModule = {
  id: 'test-arrival',
  version: '1.0.0',
  setup(api) {
    api.onAction('arrive', (a, h) => {
      const fleetId = (a.payload as { fleetId: string }).fleetId;
      h.emit('fleet.arrived', { fleetId, at: h.state.fleets[fleetId]?.location });
    });
  },
};
let seq = 0;
const act = (type: string, payload: Record<string, unknown>, playerId = 'p1'): Action => ({
  id: `a:${seq++}`,
  type,
  playerId,
  payload,
  issuedAt: 0,
});
const assault = (fleetId: string, playerId = 'p1') => act('fleet.assault', { fleetId }, playerId);

function okApply(r: ApplyResult) {
  if (!r.ok) throw new Error(`apply failed: ${r.code}`);
  return r;
}
function rej(r: ApplyResult): string {
  if (r.ok) throw new Error('expected rejection, got ok');
  return r.code;
}
function okAdvance(r: AdvanceResult) {
  if (!r.ok) throw new Error(`advance failed: ${r.code}`);
  return r;
}
const payloads = (events: DomainEvent[], type: string) =>
  events.filter((e) => e.type === type).map((e) => e.payload as Record<string, unknown>);

describe('посадка на борт не уводит трюм в минус (замечание Codex на #1409)', () => {
  it('носитель союзника со свободным трюмом −1 не рождает бойцов при захвате', () => {
    const kernel = createKernel([orbitalModule, combatModule, interceptModule]);
    const a = fleet('A', 'p1', [['fighter', 1]], stacks([['marine', 2]]));
    const c = fleet('C', 'p3', [['fighter', 1]], stacks([['marine', 2]]));
    // Звено в ангаре держит место, а вместимости у носителя нет: свободный трюм −1.
    c.hangar = [{ id: 'sq', units: stacks([['fighter', 1]]) }];
    const st = world([a, c], [['militia', 1]], ['p1', 'p2', 'p3']);
    setStance(st, 'p1', 'p3', 'alliance');
    const one = okApply(kernel.applyAction(st, assault('A'), ctx(0)));
    const two = okApply(kernel.applyAction(one.state, assault('C', 'p3'), ctx(0)));
    const r = okAdvance(kernel.advanceTo(two.state, ctx(LANDED + HOUR)));
    const p = r.state.planets.P!;
    expect(p.owner).toBe('p1');
    // Было 2 + 2 на земле — столько и осталось. Прежде `fit` уходил в −1, и союзник
    // получал на одного бойца больше, чем стоял на берегу.
    expect(marines(p.garrison)).toBe(4);
    expect(marines(r.state.fleets.C?.landing)).toBe(0);
  });
});

describe('флот на высадке не сливается (замечание Codex на #1409)', () => {
  const kernel = createKernel([orbitalModule, combatModule, interceptModule, fleetOpsModule, arrivalModule]);
  const started = () => {
    const a = fleet('A', 'p1', [['fighter', 1]], stacks([['marine', 2]]));
    // Ветераны той же выслуги: слияние усреднило бы их заслугу с заявленными бойцами.
    const b = fleet('B', 'p1', [['fighter', 1]], [{ unit: 'marine', count: 6, damageDealt: 600 }]);
    return okApply(kernel.applyAction(world([a, b], [['militia', 5]]), assault('A'), ctx(0))).state;
  };

  it('приказ слияния в обе стороны отбивается `E_FLEET_BUSY`', () => {
    const s = started();
    expect(s.fleets.A?.assaultLanding).toBeDefined();
    expect(rej(kernel.applyAction(s, act('fleet.merge', { from: 'B', into: 'A' }), ctx(0)))).toBe('E_FLEET_BUSY');
    expect(rej(kernel.applyAction(s, act('fleet.merge', { from: 'A', into: 'B' }), ctx(0)))).toBe('E_FLEET_BUSY');
  });

  it('созревшее намерение слияния ждёт конца высадки и не трогает заявленный трюм', () => {
    const s = structuredClone(started());
    s.fleets.B!.mergeInto = 'A';
    const r = okApply(kernel.applyAction(s, act('arrive', { fleetId: 'B' }), ctx(0)));
    expect(r.state.fleets.B).toBeDefined();
    expect(r.state.fleets.B?.mergeInto).toBe('A');
    expect(r.state.fleets.A?.landing).toEqual(stacks([['marine', 2]]));
  });
});

/**
 * Мир `P` хозяина `p0` под штурмом. Бой собран прямо в состоянии (как в
 * `combatJointAssault.test.ts`); берега `idle` стоят на земле БЕЗ боя — так остаётся плацдарм
 * после перемирия или ничьей.
 */
function siege(
  garrison: Array<[string, number]>,
  fighting: Array<[string, Array<[string, number]>]>,
  idle: Array<[string, Array<[string, number]>]>,
  idleFirst: boolean,
): GameState {
  const s = createInitialState({ seed: 'land-review-siege', version: { data: '0.1.0', manifest: '1' } });
  const owners = ['p0', ...fighting.map(([o]) => o), ...idle.map(([o]) => o)];
  const shore = (list: typeof fighting) => list.map(([owner, units]) => ({ owner, units: stacks(units) }));
  const planet: Planet = {
    id: 'P',
    owner: 'p0',
    position: { x: 0, y: 0 },
    resources: {},
    buildings: [],
    garrison: stacks(garrison),
    traits: [],
    beachheads: idleFirst ? [...shore(idle), ...shore(fighting)] : [...shore(fighting), ...shore(idle)],
  };
  const sides: Battle['sides'] = fighting.map(([owner]) => ({
    ref: { kind: 'beachhead' as const, planetId: 'P', owner },
    owner,
    role: 'attacker' as const,
  }));
  sides.push({ ref: { kind: 'garrison', planetId: 'P' }, owner: 'p0', role: 'defender' });
  const out: GameState = {
    ...s,
    players: Object.fromEntries(owners.map((id) => [id, seat(id)])),
    planets: { P: planet },
    battles: { b1: { id: 'b1', location: 'P', phase: 'ground', sides, round: 0 } },
    scheduled: [{ id: 'evt:0', at: 0, type: 'combat.tick', payload: { battleId: 'b1' }, seq: 0 }],
    scheduleSeq: 1,
  };
  // Штурмующие этого боя воюют с хозяином и не воюют между собой.
  for (const [o] of fighting) setStance(out, o, 'p0', 'war');
  for (let i = 0; i < owners.length; i++)
    for (let j = i + 1; j < owners.length; j++)
      if (owners[i] !== 'p0') setStance(out, owners[i]!, owners[j]!, 'peace');
  // Берега без боя — после перемирия с хозяином.
  for (const [o] of idle) setStance(out, o, 'p0', 'peace');
  return out;
}
const siegeKernel = createKernel([combatModule, diplomacyModule]);
function run(s: GameState) {
  return okAdvance(siegeKernel.advanceTo(s, ctx(400 * HOUR)));
}

describe('захват и продолжение штурма — берегами завершённого боя (замечания Codex на #1409)', () => {
  it('берег без боя мир не получает, даже стоя в списке первым', () => {
    const s = siege([['marine', 1]], [['p1', [['marine', 6]]]], [['p3', [['marine', 2]]]], true);
    const r = run(s);
    expect(r.state.planets.P?.owner).toBe('p1');
  });

  it('гарнизон жив, один берег выбит — бой продолжают уцелевшие берега этого боя', () => {
    // Расклад из `combatJointAssault`: p1 падает первым, p2 переживает обмен и дожимает мир.
    const s = siege(
      [['bastion', 1]],
      [
        ['p1', [['marine', 1]]],
        ['p2', [['marine', 20]]],
      ],
      [['p3', [['marine', 2]]]],
      true,
    );
    const r = run(s);
    expect(r.state.planets.P?.owner).toBe('p2');
    expect(payloads(r.events, 'battle.started').map((p) => p.attacker)).not.toContain('p3');
  });

  it('берега боя выбиты — берег без боя остаётся на земле и в бой не втягивается', () => {
    const s = siege([['guard', 3]], [['p1', [['marine', 1]]]], [['p3', [['marine', 2]]]], true);
    const r = run(s);
    expect(r.state.planets.P?.owner).toBe('p0');
    expect(r.state.planets.P?.beachheads?.map((b) => b.owner)).toEqual(['p3']);
    expect(payloads(r.events, 'battle.started')).toEqual([]);
  });

  it('после захвата в бою ВСЕ враги нового хозяина на земле вступают в новый бой', () => {
    const s = siege([['marine', 1]], [['p1', [['marine', 6]]]], [
      ['p3', [['guard', 1]]],
      ['p4', [['guard', 1]]],
    ], false);
    // Берега без боя мирны с прежним хозяином, но воюют с новым.
    setStance(s, 'p3', 'p1', 'war');
    setStance(s, 'p4', 'p1', 'war');
    const r = run(s);
    expect(payloads(r.events, 'battle.started').map((p) => [p.attacker, p.defender])).toContainEqual(['p3', 'p1']);
    expect(payloads(r.events, 'battle.joined').map((p) => p.owner)).toContain('p4');
  });
});

describe('гарнизон пал за время высадки (замечание Codex на #1409)', () => {
  it('десант берёт мир, и ВСЕ враги нового хозяина на земле продолжают штурм', () => {
    const kernel = createKernel([orbitalModule, combatModule, interceptModule, diplomacyModule]);
    const a = fleet('A', 'p1', [['fighter', 1]], stacks([['marine', 2]]));
    const st = world([a], [['militia', 5]], ['p1', 'p2', 'p3', 'p4']);
    const started = okApply(kernel.applyAction(st, assault('A'), ctx(0)));
    const s = structuredClone(started.state);
    s.planets.P!.garrison = []; // скажем, добит обстрелом
    s.planets.P!.beachheads = [
      { owner: 'p3', units: stacks([['guard', 1]]) },
      { owner: 'p4', units: stacks([['guard', 1]]) },
    ];
    for (const o of ['p3', 'p4']) {
      setStance(s, o, 'p2', 'peace');
      setStance(s, o, 'p1', 'war');
    }
    setStance(s, 'p3', 'p4', 'peace');
    const r = okAdvance(kernel.advanceTo(s, ctx(LANDED)));
    // Мир сперва берёт десант; дальше его могут и отбить — важен первый захват.
    expect(payloads(r.events, 'planet.captured')[0]?.owner).toBe('p1');
    expect(payloads(r.events, 'battle.started').map((p) => p.attacker)).toEqual(['p3']);
    expect(payloads(r.events, 'battle.joined').map((p) => p.owner)).toEqual(['p4']);
  });
});
