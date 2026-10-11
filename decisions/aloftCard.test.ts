/**
 * ЭСКАДРА В ВОЗДУХЕ (SHU-6.14) — что показывает карточка и какие приказы предлагает.
 * Последний блок — сторож: каждая предложенная кнопка проходит через настоящий кернел,
 * а каждая скрытая там отбивается.
 */
import { describe, expect, it } from 'vitest';
import {
  createInitialState,
  createKernel,
  parseGameData,
  shuttleModule,
  type GameData,
  type GameState,
  type Planet,
  type ShuttleStrike,
} from '../packages/shared-core/src/index';
import { aloftCard } from './aloftCard';

const shuttle = (stats: Record<string, number>) => ({ faction: 'x', traits: ['shuttle'], stats });

const data: GameData = parseGameData({
  version: '0.1.0',
  resources: ['metal'],
  units: {
    interceptor: shuttle({
      attack: 4,
      defense: 3,
      speed: 100,
      hp: 10,
      strikeRange: 300,
      fuel: 3,
      patrolHours: 4,
      patrolRadius: 90,
    }),
    // Десантный челнок: патрулировать не умеет.
    lander: shuttle({ attack: 0, defense: 2, speed: 100, hp: 24, strikeRange: 300, fuel: 2 }),
    infantry: { faction: 'x', traits: ['ground'], stats: { attack: 1, defense: 1, speed: 0, hp: 5 } },
  },
  factions: {},
  buildings: {
    spaceport: { name: 'Spaceport', cost: {}, buildTimeHours: 0, hp: 30, shuttleBay: 6 },
  },
  events: {},
});

const strike = (over: Partial<ShuttleStrike> = {}): ShuttleStrike => ({
  id: 'st:1',
  owner: 'p1',
  base: { kind: 'planet', id: 'A' },
  squadronId: 'sq:1',
  units: [{ unit: 'interceptor', count: 2 }],
  target: { kind: 'planet', id: 'E' },
  to: { x: 200, y: 0 },
  departedAt: 0,
  arrivesAt: 7_200_000,
  leg: 'out',
  ...over,
});

const card = (st: ShuttleStrike, me = 'p1') =>
  aloftCard(st, { me, data, relocate: true, split: true });

describe('SHU-6.14 — карточка эскадры в воздухе', () => {
  it('ЧУЖОГО ВЫЛЕТА КАРТОЧКОЙ НЕ БЫВАЕТ: туман снимает его целиком (правило 1)', () => {
    expect(card(strike(), 'p2')).toBeNull();
  });

  it('СОСТАВ, СРОК И ПРИКАЗ СЛОВАМИ ИГРОКА: удар по миру, по флоту, десант (правило 7)', () => {
    const c = card(strike())!;
    expect(c).toMatchObject({
      strikeId: 'st:1',
      squadronId: 'sq:1',
      machines: 2,
      hull: null,
      until: 7_200_000,
      order: { kind: 'planet', id: 'E' },
    });
    expect(card(strike({ target: { kind: 'fleet', id: 'F9' } }))!.order).toEqual({
      kind: 'fleet',
      id: 'F9',
    });
    const lander = strike({
      units: [{ unit: 'lander', count: 1 }],
      cargo: [{ unit: 'infantry', count: 1 }],
    });
    expect(card(lander)!.order).toEqual({ kind: 'land', id: 'E' });
  });

  it('ПАТРУЛЬ: на пути к точке, над точкой — и удержание видно у обоих (правила 5, 7)', () => {
    const out = strike({ target: { kind: 'point' }, patrol: { hours: 4, radius: 90 } });
    expect(card(out)).toMatchObject({ order: { kind: 'patrol-out' }, hold: false });
    const on = strike({
      target: { kind: 'point' },
      leg: 'patrol',
      patrol: { hours: 4, radius: 90, hold: true },
    });
    expect(card(on)).toMatchObject({ order: { kind: 'patrol' }, hold: true });
  });

  it('УДАР ДЕРЖАТЬ НЕЧЕГО: у удара удержания нет — `null`, а не «выключено»', () => {
    expect(card(strike())!.hold).toBeNull();
  });

  it('ВОЗВРАЩАЕТСЯ — УДАР ПОЗАДИ: ни «Удара», ни «Патруля», ни «Домой»; перелёт и делёж есть (правило 3)', () => {
    const back = card(strike({ leg: 'back' }))!;
    expect(back).toMatchObject({
      order: { kind: 'home', base: { kind: 'planet', id: 'A' } },
      returning: true,
      canStrike: false,
      canPatrol: false,
      canRecall: false,
      canRelocate: true,
      canSplit: true,
      hold: null,
    });
    const ferry = card(strike({ leg: 'back', target: { kind: 'base' } }))!;
    expect(ferry.order).toEqual({ kind: 'relocate', base: { kind: 'planet', id: 'A' } });
  });

  it('ПАТРУЛЬ — ТОЛЬКО У ТЕХ, КТО УМЕЕТ ВИСЕТЬ: десантному челноку кнопки нет (правило 4)', () => {
    expect(card(strike())!.canPatrol).toBe(true);
    const lander = strike({
      units: [{ unit: 'lander', count: 1 }],
      cargo: [{ unit: 'infantry', count: 1 }],
    });
    expect(card(lander)!.canPatrol).toBe(false);
  });

  it('ПЕРЕЛЁТ И ДЕЛЁЖ — ОТВЕТЫ ВЫЗЫВАЮЩЕГО (правило 6)', () => {
    const c = aloftCard(strike(), { me: 'p1', data, relocate: false, split: false })!;
    expect(c.canRelocate).toBe(false);
    expect(c.canSplit).toBe(false);
  });

  it('ПОДБИТЫЙ БОРТ — КОРПУС В ПРОЦЕНТАХ, как у карточки в ангаре', () => {
    expect(card(strike({ damage: 5 }))!.hull).toBe(50);
  });
});

describe('SHU-6.14 — сторож: кнопка есть ⇔ ядро примет приказ', () => {
  const kernel = createKernel([shuttleModule]);
  const planet = (id: string, owner: string, x: number): Planet => ({
    id,
    owner,
    position: { x, y: 0 },
    resources: {},
    buildings: [{ type: 'spaceport', level: 1, hp: 30 }],
    garrison: [],
    traits: [],
  });
  function world(st: ShuttleStrike): GameState {
    const s = createInitialState({ seed: 'shu614', version: { data: '0.1.0', manifest: '1' } });
    return {
      ...s,
      players: {
        p1: { id: 'p1', name: 'p1', faction: 'x', status: 'active', resources: {} },
        p2: { id: 'p2', name: 'p2', faction: 'x', status: 'active', resources: {} },
      },
      planets: { A: planet('A', 'p1', 0), E: planet('E', 'p2', 200) },
      fleets: {},
      heroes: {},
      battles: {},
      diplomacy: { 'p1|p2': 'war' },
      strikes: [st],
    } as GameState;
  }
  const order = (s: GameState, type: string, payload: Record<string, unknown>) =>
    kernel.applyAction(
      s,
      { id: `a:${type}`, type, playerId: 'p1', payload, issuedAt: 0 },
      { now: s.time, data },
    ).ok;

  for (const [name, st] of [
    ['удар по миру', strike({ at: { x: 50, y: 0 } })],
    ['патруль над точкой', strike({ target: { kind: 'point' }, leg: 'patrol', to: { x: 100, y: 0 }, patrol: { hours: 4, radius: 90 } })],
    ['возврат домой', strike({ leg: 'back', to: { x: 200, y: 0 } })],
  ] as Array<[string, ShuttleStrike]>) {
    it(`${name}: «Удар», «Патруль» и «Домой» — как решит ядро`, () => {
      const s = world(st);
      const c = card(st)!;
      expect(order(s, 'shuttle.redirect', { strikeId: st.id, targetPlanetId: 'E' })).toBe(c.canStrike);
      expect(order(s, 'shuttle.redirect', { strikeId: st.id, at: { x: 120, y: 0 } })).toBe(c.canPatrol);
      expect(order(s, 'shuttle.recall', { strikeId: st.id })).toBe(c.canRecall);
      if (c.hold !== null) {
        expect(order(s, 'shuttle.hold', { strikeId: st.id, on: !c.hold })).toBe(true);
      }
    });
  }
});
