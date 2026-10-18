import { describe, expect, it } from 'vitest';
import { createKernel } from '../kernel/kernel';
import { constructionModule } from '../modules/construction';
import { technologyModule } from '../modules/technology';
import {
  createInitialState,
  type GameState,
  type MatchPricing,
  type Planet,
  type Player,
} from '../state/gameState';
import { parseGameData, type GameData } from '../data/schemas';
import type { Action, ApplyResult, Context } from '../action/types';
import { matchCost, matchHours, matchStart } from './pricing';

// Цены партии (резолюция владельца 2026-10-18): карта основной игры закрепляет
// множители, и ядро списывает, планирует и возвращает по ним; партия без них — по каталогу.
const data: GameData = parseGameData({
  version: '0.1.0',
  resources: ['metal', 'credits'],
  units: {},
  factions: {},
  buildings: {
    mine: { name: 'Mine', cost: { metal: 50 }, buildTimeHours: 4, produces: { metal: 10 } },
    fort: {
      name: 'Fort',
      cost: { metal: 20, credits: 5 },
      buildTimeHours: 1,
      hp: 30,
      upgrades: [{ cost: { metal: 40 }, buildTimeHours: 2, hp: 60 }],
    },
  },
  events: {},
  technologies: { drills: { name: 'Drills', cost: { metal: 10, credits: 10 }, researchTimeHours: 3 } },
});

const HOUR = 3_600_000;
const PRICING: MatchPricing = { cost: { metal: 3, credits: 2 }, hours: 2 };
const ctx = (now: number): Context => ({ now, data });

function stateWith(resources: Record<string, number>, pricing?: MatchPricing): GameState {
  const s = createInitialState({ seed: 'price', version: { data: '0.1.0', manifest: '1' } });
  const p1: Player = { id: 'p1', name: 'p1', faction: 'x', status: 'active', resources };
  const a: Planet = {
    id: 'A',
    owner: 'p1',
    position: { x: 0, y: 0 },
    resources: {},
    buildings: [],
    garrison: [],
    traits: [],
  };
  return { ...s, players: { p1 }, planets: { A: a }, ...(pricing ? { pricing } : {}) };
}
const act = (type: string, payload: unknown): Action => ({ id: `s:p1:${type}`, type, playerId: 'p1', payload, issuedAt: 0 });
function ok(r: ApplyResult) {
  if (!r.ok) throw new Error(`apply failed: ${r.code}`);
  return r;
}
const completesAt = (s: GameState, type: string): number | undefined =>
  s.scheduled.find((e) => e.type === type)?.at;

describe('цены партии — правило пересчёта', () => {
  it('без цен партии — тот же объект каталога и тот же срок', () => {
    const cost = { metal: 50 };
    expect(matchCost({}, cost)).toBe(cost);
    expect(matchHours({}, 4)).toBe(4);
  });

  it('множитель по ресурсу, вверх до целого; ресурс без множителя — ×1', () => {
    const s = { pricing: { cost: { metal: 3, credits: 1.5 } } };
    expect(matchCost(s, { metal: 55, credits: 15, food: 7 })).toEqual({ metal: 165, credits: 23, food: 7 });
  });

  it('битый множитель читается как ×1, а не как бесплатная покупка', () => {
    const s = { pricing: { cost: { metal: 0, credits: Number.NaN }, hours: -2 } };
    expect(matchCost(s, { metal: 10, credits: 10 })).toEqual({ metal: 10, credits: 10 });
    expect(matchHours(s, 4)).toBe(4);
  });

  it('стартовый запас растёт своим множителем, остальное — как было', () => {
    const pricing = { start: { metal: 2, credits: 2 } };
    expect(matchStart(pricing, { metal: 320, credits: 260, food: 120 })).toEqual({
      metal: 640,
      credits: 520,
      food: 120,
    });
    expect(matchStart(undefined, { metal: 320 })).toEqual({ metal: 320 });
  });
});

describe('цены партии — ядро списывает, планирует и возвращает по ним', () => {
  const kernel = createKernel([constructionModule, technologyModule]);

  it('стройка: цена ×множитель, срок ×множитель', () => {
    const st = stateWith({ metal: 1000 }, PRICING);
    const r = ok(kernel.applyAction(st, act('building.construct', { planetId: 'A', building: 'mine' }), ctx(0)));
    expect(r.state.players.p1?.resources.metal).toBe(1000 - 150);
    expect(completesAt(r.state, 'construction.complete')).toBe(8 * HOUR);
  });

  it('без цен партии — цена и срок каталога (Sector Zero, старые сохранения)', () => {
    const st = stateWith({ metal: 1000 });
    const r = ok(kernel.applyAction(st, act('building.construct', { planetId: 'A', building: 'mine' }), ctx(0)));
    expect(r.state.players.p1?.resources.metal).toBe(950);
    expect(completesAt(r.state, 'construction.complete')).toBe(4 * HOUR);
  });

  it('не хватает на цену партии — отказ, хотя на цену каталога хватило бы', () => {
    const st = stateWith({ metal: 100 }, PRICING);
    const r = kernel.applyAction(st, act('building.construct', { planetId: 'A', building: 'mine' }), ctx(0));
    expect(r.ok ? 'ok' : r.code).toBe('E_INSUFFICIENT');
  });

  it('улучшение — по цене и сроку партии', () => {
    const st = stateWith({ metal: 1000, credits: 0 }, PRICING);
    st.planets.A!.buildings = [{ type: 'fort', level: 1, hp: 30 }];
    const r = ok(kernel.applyAction(st, act('building.upgrade', { planetId: 'A', building: 'fort' }), ctx(0)));
    expect(r.state.players.p1?.resources.metal).toBe(1000 - 120);
    expect(completesAt(r.state, 'construction.complete')).toBe(4 * HOUR);
  });

  it('отмена на полпути возвращает половину ЗАПЛАЧЕННОГО, а не половину каталога', () => {
    const st = stateWith({ metal: 1000 }, PRICING);
    const ordered = ok(kernel.applyAction(st, act('building.construct', { planetId: 'A', building: 'mine' }), ctx(0)));
    const seq = ordered.state.scheduled.find((e) => e.type === 'construction.complete')!.seq;
    const cancelled = ok(
      kernel.applyAction(ordered.state, act('construction.cancel', { planetId: 'A', seq }), ctx(4 * HOUR)),
    );
    expect(cancelled.state.players.p1?.resources.metal).toBe(850 + 75);
    expect(cancelled.state.planets.A?.pausedConstruction?.[0]?.remainingHours).toBe(4);
  });

  it('исследование: цена и срок партии', () => {
    const st = stateWith({ metal: 100, credits: 100 }, PRICING);
    const r = ok(kernel.applyAction(st, act('technology.research', { technology: 'drills' }), ctx(0)));
    expect(r.state.players.p1?.resources).toEqual({ metal: 70, credits: 80 });
    expect(completesAt(r.state, 'technology.complete')).toBe(6 * HOUR);
  });
});
