import { describe, it, expect } from 'vitest';
import { createKernel } from '../kernel/kernel';
import type { GameModule } from '../kernel/module';
import { combatModule } from './combat';
import { orbitalModule } from './orbital';
import { interceptModule } from './intercept';
import {
  createInitialState,
  type Fleet,
  type GameState,
  type Planet,
  type UnitStack,
} from '../state/gameState';
import { parseGameData, type GameData } from '../data/schemas';
import type { Action, AdvanceResult, ApplyResult, Context } from '../action/types';
import { previewBattle } from '../state/previewBattle';

/**
 * Урон по роду войск в живом штурме (решение владельца 2026-09-25, `util/groundTargets.ts`):
 * против наземных войск залп считается под состав цели, урон по пехоте ложится только на
 * пехоту, по технике — только на технику, а прогноз считает тем же правилом.
 */
const data: GameData = parseGameData({
  version: '0.1.0',
  resources: ['metal'],
  units: {
    fighter: { faction: 'x', stats: { attack: 0, defense: 0, speed: 10, hp: 20 }, line: 'front' },
    // Танк давит пехоту и почти не берёт броню.
    tank: {
      faction: 'x',
      domain: 'ground',
      kind: 'vehicle',
      stats: {
        attack: 20,
        defense: 10,
        attackVsInfantry: 20,
        attackVsVehicle: 2,
        defenseVsInfantry: 10,
        defenseVsVehicle: 1,
        speed: 1,
        hp: 50,
      },
    },
    // Противотанковая пехота: бьёт броню, по пехоте слаба.
    rifle: {
      faction: 'x',
      domain: 'ground',
      kind: 'infantry',
      stats: {
        attack: 4,
        defense: 4,
        attackVsInfantry: 4,
        attackVsVehicle: 12,
        defenseVsInfantry: 4,
        defenseVsVehicle: 12,
        speed: 1,
        hp: 10,
      },
    },
    // Безоружная пехота — мишень, которая не отвечает.
    dummy: {
      faction: 'x',
      domain: 'ground',
      kind: 'infantry',
      stats: { attack: 0, defense: 0, speed: 1, hp: 1000 },
    },
    // Безоружная техника.
    hulk: {
      faction: 'x',
      domain: 'ground',
      kind: 'vehicle',
      stats: { attack: 0, defense: 0, speed: 1, hp: 1000 },
    },
  },
  factions: {},
  buildings: {},
  events: {},
});
const HOUR = 3_600_000;
const combatFamily = [orbitalModule, combatModule, interceptModule];

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

const ctx = (now: number): Context => ({ now, data });
const stacks = (list: Array<[string, number]>): UnitStack[] =>
  list.map(([unit, count]) => ({ unit, count }));
const act = (type: string, fleetId: string): Action => ({
  id: `s:p1:${type}`,
  type,
  playerId: 'p1',
  payload: { fleetId },
  issuedAt: 0,
});
function okApply(r: ApplyResult) {
  if (!r.ok) throw new Error(`apply failed: ${r.code}`);
  return r;
}
function okAdvance(r: AdvanceResult) {
  if (!r.ok) throw new Error(`advance failed: ${r.code}`);
  return r;
}

function storm(landing: Array<[string, number]>, garrison: Array<[string, number]>) {
  const kernel = createKernel([...combatFamily, arrivalModule]);
  const s0 = createInitialState({ seed: 'gc', version: { data: '0.1.0', manifest: '1' } });
  const fleet: Fleet = {
    id: 'A',
    owner: 'p1',
    location: 'P',
    movement: null,
    units: stacks([['fighter', 1]]),
    landing: stacks(landing),
    traits: [],
  };
  const planet: Planet = {
    id: 'P',
    owner: 'p2',
    position: { x: 0, y: 0 },
    resources: {},
    buildings: [],
    garrison: stacks(garrison),
    traits: [],
  };
  const st: GameState = { ...s0, fleets: { A: fleet }, planets: { P: planet } };
  const arrived = okApply(kernel.applyAction(st, act('arrive', 'A'), ctx(0)));
  const started = okApply(kernel.applyAction(arrived.state, act('fleet.assault', 'A'), ctx(0)));
  return { kernel, started };
}

/** Урон ПЕРВОГО наземного раунда по обороне. */
function firstRound(landing: Array<[string, number]>, garrison: Array<[string, number]>) {
  const { kernel, started } = storm(landing, garrison);
  const r = okAdvance(kernel.advanceTo(started.state, ctx(HOUR)));
  const round = [...started.events, ...r.events].find(
    (e) => e.type === 'combat.round' && (e.payload as { phase?: string }).phase === 'ground',
  );
  expect(round).toBeDefined();
  return { round: round!.payload as { dmgToDefender: number; dmgToAttacker: number }, r };
}

describe('наземный бой: урон по роду войск', () => {
  it('танк бьёт пехоту уроном по пехоте, а броню — уроном по технике', () => {
    expect(firstRound([['tank', 2]], [['dummy', 1]]).round.dmgToDefender).toBe(40);
    expect(firstRound([['tank', 2]], [['hulk', 1]]).round.dmgToDefender).toBe(4);
  });

  it('павшие наземного боя засчитываются стрелку — `killedBy` (PVR-6.20)', () => {
    // Наземный залп идёт своим путём (`groundVolleys`), и учёт стрелка обязан видеть его:
    // иначе боевой счёт экспедиции терял бы всех павших в штурмах.
    const { r } = firstRound([['tank', 2]], [['rifle', 2]]); // 40 по пехоте ≥ 2 × 10
    const deaths = r.events
      .filter((e) => e.type === 'unit.died')
      .map((e) => e.payload as { owner?: string; killedBy?: string });
    expect(deaths.some((d) => d.owner === 'p2')).toBe(true);
    for (const d of deaths) expect(d.killedBy).toBe(d.owner === 'p2' ? 'p1' : 'p2');
  });

  it('ответный огонь обороны — тоже по роду войск атакующего', () => {
    // Два стрелка отвечают танкам обороной по технике (12), а не общей обороной (4).
    expect(firstRound([['tank', 1]], [['rifle', 2]]).round.dmgToAttacker).toBe(24);
  });

  it('смешанный отряд: залп делится по долям корпуса, и каждый род получает своё', () => {
    // Пул корпуса: 1000 пехоты + 1000 техники — доли по половине. Танк бьёт 0.5×20 по
    // пехоте и 0.5×2 по технике; урон по пехоте технику не трогает.
    const { round, r } = firstRound(
      [['tank', 1]],
      [
        ['dummy', 1],
        ['hulk', 1],
      ],
    );
    expect(round.dmgToDefender).toBeCloseTo(11, 9);
    const g = r.state.planets.P!.garrison;
    const hp = (unit: string) => g.find((s) => s.unit === unit)?.hp;
    // Сколько бы раундов ни прошло, пехота теряет вдесятеро больше техники: 10 против 1 за
    // раунд. Урон по пехоте на технику не перетекает.
    const dummyLoss = 1000 - hp('dummy')!;
    const hulkLoss = 1000 - hp('hulk')!;
    expect(hulkLoss).toBeGreaterThan(0);
    expect(dummyLoss / hulkLoss).toBeCloseTo(10, 9);
  });

  it('кап линии огня выбирает стрелков под состав цели: против брони вперёд выходит противотанковая пехота', () => {
    // 10 стрелков + 10 танков, кап 10: по технике стрелок (12) сильнее танка (2) — стреляют
    // стрелки, 10×12 = 120; по пехоте танк (20) сильнее стрелка (4) — стреляют танки, 200.
    expect(
      firstRound(
        [
          ['tank', 10],
          ['rifle', 10],
        ],
        [['hulk', 1]],
      ).round.dmgToDefender,
    ).toBe(120);
    expect(
      firstRound(
        [
          ['tank', 10],
          ['rifle', 10],
        ],
        [['dummy', 1]],
      ).round.dmgToDefender,
    ).toBe(200);
  });

  it('прогноз штурма считает тем же правилом, что и живой бой', () => {
    const landing: Array<[string, number]> = [
      ['tank', 3],
      ['rifle', 4],
    ];
    const garrison: Array<[string, number]> = [
      ['rifle', 6],
      ['tank', 1],
    ];
    const { kernel, started } = storm(landing, garrison);
    const end = okAdvance(kernel.advanceTo(started.state, ctx(200 * HOUR)));
    const pv = previewBattle(stacks(landing), stacks(garrison), data);
    const attackerWon = end.state.planets.P!.owner === 'p1';
    expect(pv.outcome).toBe(attackerWon ? 'attacker' : 'defender');
  });
});
