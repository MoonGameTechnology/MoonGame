import { describe, it, expect } from 'vitest';
import { createKernel } from '../kernel/kernel';
import { economyModule } from './economy';
import { taxModule, civicTax, isInhabited, inhabitedWorldCount, TAX_PER_HOUR, TAX_DIMINISH } from './tax';
import { createInitialState, type GameState, type Planet, type Player } from '../state/gameState';
import { parseGameData, type GameData } from '../data/schemas';
import type { AdvanceResult, Context } from '../action/types';

// FND-2 (game-vision-roadmap.md): port of the prototype's tuned `taxModule` — the
// second credits faucet the canonical path lacked (FND-1 added the passive
// baseOutput one). Civic tax on every inhabited world, diminishing per-world as
// the empire grows so total income still rises but sub-linearly.

const data: GameData = parseGameData({
  version: '0.1.0',
  resources: ['credits'],
  units: {},
  factions: {},
  buildings: {
    // RULES-2: прибавка ОБЪЯВЛЕНА зданием — код её только исполняет.
    tax_office: { name: 'Tax Office', cost: {}, creditsBonus: 0.25 },
    // близнец с другим числом: сторож ниже проверяет, что поведение следует ДАННЫМ
    tax_office_big: { name: 'Grand Exchange', cost: {}, creditsBonus: 1 },
    plain_hut: { name: 'Hut', cost: {} }, // бонуса не объявляет — значит его нет
  },
  events: {},
  sectorKinds: {
    asteroid: { scoreValue: 5, capturable: true, buildable: true, orbit: false }, // no orbit → not inhabited
    dead_world: {
      scoreValue: 0,
      capturable: true,
      buildable: true,
      orbit: true,
      allowedBuildings: ['metal_station'], // a roster restriction → not inhabited
    },
  },
  planetTypes: {},
});
const HOUR = 3_600_000;
const ctx = (now: number): Context => ({ now, data });

function player(id: string): Player {
  return { id, name: id, faction: 'x', status: 'active', resources: {} };
}
function world(id: string, owner: string | null, kind?: string, buildings: Planet['buildings'] = []): Planet {
  return {
    id,
    owner,
    position: { x: 0, y: 0 },
    kind,
    resources: {},
    buildings,
    garrison: [],
    traits: [],
  };
}
function okAdvance(r: AdvanceResult): AdvanceResult & { ok: true } {
  if (!r.ok) throw new Error(`advance failed: ${r.code}`);
  return r;
}
function stateWith(planets: Record<string, Planet>): GameState {
  const s = createInitialState({ seed: 'tax', version: { data: '0.1.0', manifest: '1' } });
  return { ...s, players: { p1: player('p1') }, planets };
}

describe('civicTax — anti-snowball diminishing returns (pure math)', () => {
  it('a lone world pays the full base rate', () => {
    expect(civicTax(1)).toBe(TAX_PER_HOUR);
    expect(civicTax(0)).toBe(TAX_PER_HOUR); // guard: never divides below 1
  });

  it('per-world tax strictly decreases as the empire grows', () => {
    expect(civicTax(2)).toBeLessThan(civicTax(1));
    expect(civicTax(10)).toBeLessThan(civicTax(2));
    expect(civicTax(5)).toBeCloseTo(TAX_PER_HOUR / (1 + TAX_DIMINISH * 4));
  });

  it('total civic income still rises with territory, but sub-linearly', () => {
    const total = (n: number): number => n * civicTax(n);
    expect(total(10)).toBeGreaterThan(total(5));
    expect(total(20)).toBeGreaterThan(total(10));
    expect(total(20)).toBeLessThan(20 * TAX_PER_HOUR); // strictly below the old flat line
  });
});

describe('isInhabited / inhabitedWorldCount', () => {
  it('a plain world (no kind data) defaults to inhabited', () => {
    expect(isInhabited(data, { kind: undefined })).toBe(true);
  });

  it('a no-orbit kind (asteroid) is not inhabited', () => {
    expect(isInhabited(data, { kind: 'asteroid' })).toBe(false);
  });

  it('a restricted-roster kind (dead world) is not inhabited', () => {
    expect(isInhabited(data, { kind: 'dead_world' })).toBe(false);
  });

  it('counts only the owner’s inhabited worlds', () => {
    const s = stateWith({
      a: world('a', 'p1'),
      b: world('b', 'p1', 'asteroid'), // not inhabited — excluded
      c: world('c', 'p2'), // someone else's
    });
    expect(inhabitedWorldCount(data, s, 'p1')).toBe(1);
    expect(inhabitedWorldCount(data, s, null)).toBe(0);
  });
});

describe('tax module — economy.production hook (kernel-integrated)', () => {
  it('an inhabited world with no buildings still earns the flat civic tax', () => {
    const kernel = createKernel([taxModule, economyModule]);
    const s = stateWith({ a: world('a', 'p1') });
    const r = okAdvance(kernel.advanceTo(s, ctx(HOUR)));
    expect(r.state.players.p1?.resources.credits).toBeCloseTo(TAX_PER_HOUR);
  });

  it('a non-inhabited world (asteroid) pays no civic tax', () => {
    const kernel = createKernel([taxModule, economyModule]);
    const s = stateWith({ a: world('a', 'p1', 'asteroid') });
    const r = okAdvance(kernel.advanceTo(s, ctx(HOUR)));
    expect(r.state.players.p1?.resources.credits ?? 0).toBe(0);
  });

  it('a second inhabited world dilutes the per-world rate (sub-linear total)', () => {
    const kernel = createKernel([taxModule, economyModule]);
    const s = stateWith({ a: world('a', 'p1'), b: world('b', 'p1') });
    const r = okAdvance(kernel.advanceTo(s, ctx(HOUR)));
    expect(r.state.players.p1?.resources.credits).toBeCloseTo(2 * civicTax(2));
    expect(r.state.players.p1?.resources.credits).toBeLessThan(2 * TAX_PER_HOUR);
  });

  it('a Tax Office boosts that world’s whole credit take by 25%', () => {
    const kernel = createKernel([taxModule, economyModule]);
    const s = stateWith({ a: world('a', 'p1', undefined, [{ type: 'tax_office', level: 1, hp: 0 }]) });
    const r = okAdvance(kernel.advanceTo(s, ctx(HOUR)));
    expect(r.state.players.p1?.resources.credits).toBeCloseTo(TAX_PER_HOUR * 1.25);
  });

  // --- RULES-2: сторож «данные не врут» --------------------------------------
  // Правило переехало из константы TAX_OFFICE_BONUS в поле здания. Ценность такого
  // переезда ровно одна: ПОВЕДЕНИЕ следует объявленному числу. Иначе данные станут
  // украшением — в json одно, в игре другое, и это хуже, чем честная константа.
  it('прибавка следует ОБЪЯВЛЕННОМУ числу, а не зашитой константе', () => {
    const kernel = createKernel([taxModule, economyModule]);
    const big = stateWith({ a: world('a', 'p1', undefined, [{ type: 'tax_office_big', level: 1, hp: 0 }]) });
    const r = okAdvance(kernel.advanceTo(big, ctx(HOUR)));
    expect(r.state.players.p1?.resources.credits).toBeCloseTo(TAX_PER_HOUR * 2); // creditsBonus: 1
  });

  it('здание без объявленной прибавки её не даёт', () => {
    const kernel = createKernel([taxModule, economyModule]);
    const s = stateWith({ a: world('a', 'p1', undefined, [{ type: 'plain_hut', level: 1, hp: 0 }]) });
    const r = okAdvance(kernel.advanceTo(s, ctx(HOUR)));
    expect(r.state.players.p1?.resources.credits).toBeCloseTo(TAX_PER_HOUR);
  });

  it('прибавки нескольких зданий складываются (правило читается со ВСЕХ построек)', () => {
    const kernel = createKernel([taxModule, economyModule]);
    const s = stateWith({
      a: world('a', 'p1', undefined, [
        { type: 'tax_office', level: 1, hp: 0 },
        { type: 'tax_office_big', level: 1, hp: 0 },
      ]),
    });
    const r = okAdvance(kernel.advanceTo(s, ctx(HOUR)));
    expect(r.state.players.p1?.resources.credits).toBeCloseTo(TAX_PER_HOUR * 2.25);
  });

  it('without the module, no civic tax accrues (graceful degradation)', () => {
    const kernel = createKernel([economyModule]); // no taxModule
    const s = stateWith({ a: world('a', 'p1') });
    const r = okAdvance(kernel.advanceTo(s, ctx(HOUR)));
    expect(r.state.players.p1?.resources.credits ?? 0).toBe(0);
  });
});
