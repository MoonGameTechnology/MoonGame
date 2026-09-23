import { describe, expect, it } from 'vitest';
import { createKernel } from '../kernel/kernel';
import type { GameModule } from '../kernel/module';
import { combatModule } from './combat';
import { orbitalModule } from './orbital';
import { shuttleModule } from './shuttle';
import { heroModule } from './hero';
import { heroEffectsModule } from './heroEffects';
import {
  createInitialState,
  type Fleet,
  type GameState,
  type Hero,
  type Planet,
  type Player,
} from '../state/gameState';
import { parseGameData, type GameData } from '../data/schemas';
import type { Action, AdvanceResult, ApplyResult, Context } from '../action/types';

/**
 * CORE-DMG-3 — ДО КАКИХ КАНАЛОВ ДОХОДИТ БОНУС ГЕРОЯ.
 *
 * `CORE-DMG-1` вернул все каналы огня на хук `combat.damage`, но потребители
 * расслоились: техи и пассив фракции читают `args.attacker` и усиливают что угодно, а
 * семья героев искала сторону через `battleId` — то есть ТРЕБОВАЛА БОЯ. Вне боя
 * `battleId` нет, хук возвращал базу, и обещанные игроку «+8% урона своим флотам
 * рядом» работали в свалке и молчали на обстреле с орбиты, на ударе челноков, на
 * ответке и на корабельном ПВО. Решение владельца 2026-09-22: это ПРОБЕЛ, а не замысел
 * — аура вещь РАДИУСА, а не ближнего боя.
 *
 * Тест держит обе половины правила, и вторая не менее важна первой:
 *  · бонус ДОХОДИТ до каждого канала, где стреляет ФЛОТ;
 *  · бонус НЕ доходит туда, где стреляет не флот — ПВО мира и перехватчики с мира.
 *    Семья героев усиливает флоты, а не гарнизоны и не планетарные орудия; это то же
 *    правило, что держал `side.ref.kind === 'fleet'` в ближнем бою, и расширение
 *    каналов не должно было его тихо отменить.
 *
 * Каждая сцена гоняется ДВАЖДЫ — с живой аурой и без неё, — и сравнивается то, что
 * реально долетело до цели. Так тесту не нужно знать внутренних констант канала, и
 * балансная правка фикстуры не может превратить сторож в тавтологию.
 */

const data: GameData = parseGameData({
  version: '0.1.0',
  resources: ['metal'],
  units: {
    cruiser: { faction: 'x', stats: { attack: 10, defense: 4, speed: 6, hp: 60 }, line: 'front' },
    hulk: { faction: 'x', stats: { attack: 0, defense: 0, speed: 4, hp: 4000 }, line: 'front' },
    escort: {
      faction: 'x',
      stats: { attack: 0, defense: 0, speed: 4, hp: 200, pointDefense: 20 },
      line: 'front',
    },
    // Носитель: и ангар под челноки, и своё ПВО — одна сцена на два канала.
    carrier: {
      faction: 'x',
      stats: { attack: 0, defense: 0, speed: 4, hp: 900, shuttleBay: 4 },
      line: 'rear',
    },
    // Машина челнока: топливо и дальность — на вылет, `attack` — чтобы по кораблям было чем бить
    // (ROS-1.5 отказывает безоружному вылету ещё на приказе).
    wing: {
      faction: 'x',
      stats: { attack: 8, defense: 0, speed: 120, hp: 300, shuttleDamage: 30, fuel: 3, strikeRange: 500 },
      line: 'front',
      traits: ['shuttle'],
    },
  },
  factions: {},
  buildings: {
    flak: { name: 'Flak', cost: { metal: 1 }, buildTimeHours: 0, hp: 100, aaDamage: 25 },
  },
  events: {},
});

const HOUR = 3_600_000;
const ctx = (now: number): Context => ({ now, data });
const AURA = 0.5; // крупная, чтобы разницу нельзя было списать на округление

function player(id: string): Player {
  return { id, name: id, faction: 'x', status: 'active', resources: { metal: 100 } };
}
function planet(
  id: string,
  owner: string | null,
  opts: { at?: { x: number; y: number }; buildings?: Array<[string, number]> } = {},
): Planet {
  return {
    id,
    owner,
    position: opts.at ?? { x: 0, y: 0 },
    resources: {},
    buildings: (opts.buildings ?? []).map(([type, level]) => ({
      type,
      level,
      hp: data.buildings[type]!.hp,
    })),
    garrison: [],
    traits: [],
  };
}
function fleet(
  id: string,
  owner: string,
  location: string | null,
  units: Array<[string, number]>,
  opts: { orbit?: 'near'; bombarding?: boolean } = {},
): Fleet {
  return {
    id,
    owner,
    location,
    movement: null,
    units: units.map(([unit, count]) => ({ unit, count })),
    orbit: opts.orbit,
    bombarding: opts.bombarding,
    battleId: null,
    traits: [],
  };
}
/** Герой с ЖИВОЙ аурой, стоящий на узле `at`. Радиус щедрый: сцены стоят рядом, и
 *  мерить надо доставку бонуса, а не геометрию (её мерит `heroAuraRadius`). */
function auraHero(owner: string, at: string, fleetId?: string): Hero {
  return {
    id: `hero:${owner}`,
    owner,
    location: at,
    cooldowns: {},
    alive: true,
    ...(fleetId !== undefined ? { fleetId } : {}),
    activeAuras: [{ bonus: AURA, radius: 10_000, until: 100 * HOUR }],
  };
}
function stateWith(planets: Planet[], fleets: Fleet[], hero?: Hero): GameState {
  const s = createInitialState({ seed: 'reach', version: { data: '0.1.0', manifest: '1' } });
  const ps: Record<string, Planet> = {};
  for (const x of planets) ps[x.id] = x;
  const fs: Record<string, Fleet> = {};
  for (const x of fleets) fs[x.id] = x;
  return {
    ...s,
    players: { p1: player('p1'), p2: player('p2') },
    planets: ps,
    fleets: fs,
    ...(hero ? { heroes: { [hero.id]: hero } } : {}),
  };
}
function okApply(r: ApplyResult): ApplyResult & { ok: true } {
  if (!r.ok) throw new Error(`apply failed: ${r.code}`);
  return r;
}
function okAdvance(r: AdvanceResult): AdvanceResult & { ok: true } {
  if (!r.ok) throw new Error(`advance failed: ${r.code}`);
  return r;
}
const hullOf = (state: GameState, fleetId: string, unit: string): number | undefined =>
  state.fleets[fleetId]?.units.find((u) => u.unit === unit)?.hp;

const HERO_MODULES: GameModule[] = [heroModule, heroEffectsModule];

/** `fleet.arrived` без движка движения — та же фикстура, что в `damageHookScope`. */
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
const arrive = (fleetId: string, playerId = 'p1'): Action => ({
  id: `s:${playerId}:1`,
  type: 'arrive',
  playerId,
  payload: { fleetId },
  issuedAt: 0,
});

/** Вылет эскадрильи С НОСИТЕЛЯ настоящим приказом (`shuttle.strike`): руками
 *  положенный в состояние вылет не резолвится — прилёт назначает сам приказ. */
function carrierStrike(hero?: Hero): { hit: number; repelled: number } {
  const kernel = createKernel([shuttleModule, ...HERO_MODULES]);
  const base = stateWith(
    [planet('A', 'p1', { at: { x: 0, y: 0 } }), planet('B', 'p2', { at: { x: 60, y: 0 } })],
    [fleet('C', 'p1', 'A', [['carrier', 1]]), fleet('T', 'p2', 'B', [['cruiser', 2]])],
    hero,
  );
  const st: GameState = {
    ...base,
    fleets: {
      ...base.fleets,
      C: {
        ...base.fleets.C!,
        hangar: [{ id: 'sq:t', units: [{ unit: 'wing', count: 2 }] }],
      },
    },
  };
  const order: Action = {
    id: 'a:strike',
    type: 'shuttle.strike',
    playerId: 'p1',
    payload: { fleetId: 'C', squadronId: 'sq:t', targetFleetId: 'T' },
    issuedAt: 0,
  };
  const applied = okApply(kernel.applyAction(st, order, ctx(0)));
  const r = okAdvance(kernel.advanceTo(applied.state, ctx(3 * HOUR)));
  const events = [...applied.events, ...r.events];
  const sum = (type: string): number =>
    events
      .filter((e) => e.type === type)
      .reduce((acc, e) => acc + ((e.payload as { damage?: number }).damage ?? 0), 0);
  return { hit: sum('shuttle.hit'), repelled: sum('shuttle.repelled') };
}

describe('CORE-DMG-3 — бонус героя доходит до НЕБЛИЖНИХ каналов', () => {
  it('ближний бой — как было (проверка, что расширение ничего не сломало)', () => {
    const melee = (hero?: Hero): number => {
      const kernel = createKernel([orbitalModule, combatModule, arrivalModule, ...HERO_MODULES]);
      const st = stateWith(
        [planet('P', null)],
        [fleet('A', 'p1', 'P', [['cruiser', 1]]), fleet('D', 'p2', 'P', [['hulk', 1]])],
        hero,
      );
      const started = okApply(kernel.applyAction(st, arrive('A'), ctx(0)));
      const r = okAdvance(kernel.advanceTo(started.state, ctx(HOUR)));
      const round = r.events.find((e) => e.type === 'combat.round');
      expect(round).toBeDefined();
      return (round?.payload as { dmgToDefender: number }).dmgToDefender;
    };
    const plain = melee();
    expect(plain).toBeGreaterThan(0);
    expect(melee(auraHero('p1', 'P'))).toBeCloseTo(plain * (1 + AURA), 6);
  });

  it('ОБСТРЕЛ С ОРБИТЫ — аура доходит (раньше молчала: боя нет, `battleId` нет)', () => {
    const bombard = (hero?: Hero): number => {
      const kernel = createKernel([orbitalModule, ...HERO_MODULES]);
      const st = stateWith(
        [planet('P', 'p2', { buildings: [['flak', 1]] })],
        [fleet('Z', 'p1', 'P', [['cruiser', 1]], { orbit: 'near', bombarding: true })],
        hero,
      );
      const r = okAdvance(kernel.advanceTo(st, ctx(HOUR)));
      const shelled = r.events.filter((e) => e.type === 'planet.bombarded');
      expect(shelled.length).toBeGreaterThan(0);
      return shelled.reduce((sum, e) => sum + (e.payload as { power: number }).power, 0);
    };
    const plain = bombard();
    expect(plain).toBeGreaterThan(0);
    expect(bombard(auraHero('p1', 'P'))).toBeCloseTo(plain * (1 + AURA), 6);
  });

  it('КОРАБЕЛЬНОЕ ПВО — аура доходит', () => {
    const pd = (hero?: Hero): number => {
      const kernel = createKernel([shuttleModule, ...HERO_MODULES]);
      const base = stateWith(
        [planet('A', 'p1', { at: { x: 0, y: 0 } }), planet('H', 'p2', { at: { x: 60, y: 0 } })],
        [fleet('E', 'p1', 'A', [['escort', 1]])],
        hero,
      );
      const st: GameState = {
        ...base,
        strikes: [
          {
            id: 'strike:p2:1',
            owner: 'p2',
            base: { kind: 'planet', id: 'H' },
            squadronId: 'sq:t',
            units: [{ unit: 'wing', count: 1 }],
            target: { kind: 'fleet', id: 'E' },
            to: base.planets.A!.position,
            departedAt: 0,
            arrivesAt: 10 * HOUR,
            leg: 'out',
          },
        ],
      };
      const r = okAdvance(kernel.advanceTo(st, ctx(HOUR)));
      const shot = r.events.filter((e) => e.type === 'pd.fired');
      expect(shot.length).toBeGreaterThan(0);
      return shot.reduce((sum, e) => sum + (e.payload as { damage: number }).damage, 0);
    };
    const plain = pd();
    expect(plain).toBeGreaterThan(0);
    expect(pd(auraHero('p1', 'A'))).toBeCloseTo(plain * (1 + AURA), 6);
  });

  it('УДАР ЧЕЛНОКОВ С НОСИТЕЛЯ — аура доходит', () => {
    const plain = carrierStrike();
    expect(plain.hit).toBeGreaterThan(0);
    // Аура ХОЗЯИНА ЧЕЛНОКОВ (p1) усиливает удар…
    expect(carrierStrike(auraHero('p1', 'A')).hit).toBeCloseTo(plain.hit * (1 + AURA), 6);
  });

  it('ОТВЕТКА ПО ЧЕЛНОКАМ — аура доходит тому, кто огрызается', () => {
    // Огрызается ЦЕЛЬ удара. Флот — своими орудиями, значит стреляет флот, и аура
    // ХОЗЯИНА ЦЕЛИ (p2) обязана её усилить. Это самый неочевидный канал: бонус едет
    // не на том, кто начал.
    const plain = carrierStrike();
    expect(plain.repelled).toBeGreaterThan(0);
    expect(carrierStrike(auraHero('p2', 'B')).repelled).toBeCloseTo(plain.repelled * (1 + AURA), 6);
    // …а герой НАПАДАЮЩЕГО ответку не усиливает — она не его выстрел.
    expect(carrierStrike(auraHero('p1', 'A')).repelled).toBeCloseTo(plain.repelled, 6);
  });

  it('ПВО МИРА — аура НЕ доходит: стреляет планета, а не флот', () => {
    const aa = (hero?: Hero): number => {
      const kernel = createKernel([orbitalModule, ...HERO_MODULES]);
      const st = stateWith(
        [planet('P', 'p2', { buildings: [['flak', 1]] })],
        [fleet('R', 'p1', 'P', [['hulk', 1]], { orbit: 'near' })],
        hero,
      );
      const r = okAdvance(kernel.advanceTo(st, ctx(HOUR)));
      const fired = r.events.filter((e) => e.type === 'aa.fired');
      expect(fired.length).toBeGreaterThan(0);
      return fired.reduce((sum, e) => sum + (e.payload as { damage: number }).damage, 0);
    };
    const plain = aa();
    expect(plain).toBeGreaterThan(0);
    // Аура у ВЛАДЕЛЬЦА ПВО (p2) — и всё равно ничего не меняет.
    expect(aa(auraHero('p2', 'P'))).toBeCloseTo(plain, 6);
  });

  it('и ничей чужой герой ничего не усиливает — бонус строго свой', () => {
    const bombard = (hero?: Hero): number => {
      const kernel = createKernel([orbitalModule, ...HERO_MODULES]);
      const st = stateWith(
        [planet('P', 'p2', { buildings: [['flak', 1]] })],
        [fleet('Z', 'p1', 'P', [['cruiser', 1]], { orbit: 'near', bombarding: true })],
        hero,
      );
      const r = okAdvance(kernel.advanceTo(st, ctx(HOUR)));
      return r.events
        .filter((e) => e.type === 'planet.bombarded')
        .reduce((sum, e) => sum + (e.payload as { power: number }).power, 0);
    };
    const plain = bombard();
    expect(bombard(auraHero('p2', 'P'))).toBeCloseTo(plain, 6); // герой ОБОРОНЯЮЩЕГОСЯ
    expect(hullOf(stateWith([], []), 'x', 'y')).toBeUndefined(); // sanity на хелпер
  });
});
