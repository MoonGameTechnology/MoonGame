/**
 * ФОРТ ВЫДАЁТ И ЗАБИРАЕТ ГАРНИЗОН (FORT-2.1 + FORT-2.2; решение владельца 6: «прокачка
 * форта даёт больше процента И НЕБОЛЬШОЙ ГАРНИЗОН — юнит „Гарнизон форта“»).
 *
 * Гарнизон — не войско на довольствии, а часть здания: пока форт стоит, стоят и
 * защитники; снесли форт — ушли вместе с ним. Отсюда три вещи, каждая из которых может
 * отвалиться отдельно:
 *   1. форт ставит защитников и ПРОКАЧКА их добавляет;
 *   2. разрушение форта их УНОСИТ — иначе они переживут то, что их породило, и мир
 *      останется «занят» призраками снесённого здания;
 *   3. выданный гарнизон держит узел от захвата прилётом — ровно то, ради чего решение 6.
 *
 * Плюс граница трейта `issued`: гарнизон не заказывают в казармах, как не заказывают
 * орудия крепости на верфи.
 */
import { describe, expect, it } from 'vitest';
import {
  captureOnArrivalModule,
  constructionModule,
  factionModule,
  createInitialState,
  createKernel,
  type Action,
  type Context,
  type Fleet,
  type GameState,
  type Planet,
} from '../packages/shared-core/src/index';
import { shippedGameData } from './bundle';

const data = shippedGameData();
const HOUR = 3_600_000;
const ctx = (now = 0): Context => ({ now, data });
const kernel = createKernel([constructionModule, captureOnArrivalModule]);
const GARRISON = 'garrison';

function world(buildings: { type: string; level: number; hp: number }[], fleets: Fleet[] = []): GameState {
  const s = createInitialState({ seed: 'fg2', version: { data: data.version, manifest: '1' } });
  const planet: Planet = {
    id: 'A', owner: 'p1', kind: 'planet', position: { x: 0, y: 0 }, links: [],
    resources: {}, buildings, garrison: [], traits: [],
  };
  return {
    ...s,
    players: {
      p1: { id: 'p1', name: 'p1', faction: 'x', status: 'active', resources: Object.fromEntries(data.resources.map((r) => [r, 99000])) },
      p2: { id: 'p2', name: 'p2', faction: 'x', status: 'active', resources: {} },
    },
    planets: { A: planet },
    fleets: Object.fromEntries(fleets.map((f) => [f.id, f])),
  };
}
const act = (type: string, payload: Record<string, unknown>, playerId = 'p1'): Action => ({
  id: `s:${playerId}:1`, type, playerId, payload, issuedAt: 0,
});
const held = (st: GameState): number =>
  st.planets.A?.garrison.find((s) => s.unit === GARRISON)?.count ?? 0;

/** Построить форт с нуля и дождаться готовности. */
function withFort(): GameState {
  const r = kernel.applyAction(world([]), act('building.construct', { planetId: 'A', building: 'fort' }), ctx());
  if (!r.ok) throw new Error(`отказ ${r.code}`);
  const done = kernel.advanceTo(r.state, ctx(200 * HOUR));
  if (!done.ok) throw new Error('advance отказ');
  return done.state;
}

describe('гарнизон форта — решение владельца 6', () => {
  it('готовый форт СТАВИТ защитников, прокачка их добавляет', () => {
    let st = withFort();
    expect(held(st), 'форт достроен, а защитников нет').toBeGreaterThan(0);
    const before = held(st);
    const up = kernel.applyAction(st, act('building.upgrade', { planetId: 'A', building: 'fort' }), ctx(200 * HOUR));
    if (!up.ok) throw new Error(`прокачка: отказ ${up.code}`);
    const done = kernel.advanceTo(up.state, ctx(600 * HOUR));
    if (!done.ok) throw new Error('advance отказ');
    st = done.state;
    expect(st.planets.A?.buildings.find((b) => b.type === 'fort')?.level).toBe(2);
    expect(held(st), 'прокачка защитников не добавила').toBeGreaterThan(before);
  });

  it('РАЗРУШЕНИЕ форта уносит гарнизон — он не переживает своё здание', () => {
    const st = withFort();
    expect(held(st)).toBeGreaterThan(0);
    // Снос эмулируем тем же путём, каким его наносит игра: обстрел бьёт по зданиям.
    const razed = kernel.advanceTo(
      { ...st, planets: { A: { ...st.planets.A!, buildings: st.planets.A!.buildings.map((b) => ({ ...b, hp: 0 })) } },
        scheduled: [{ id: 'e:0', at: 1, type: 'planet.bombarded', payload: { planetId: 'A', power: 1 }, seq: 0 }], scheduleSeq: 1 },
      ctx(300 * HOUR),
    );
    if (!razed.ok) throw new Error('advance отказ');
    expect(razed.state.planets.A?.buildings.some((b) => b.type === 'fort'), 'форт обязан быть снесён').toBe(false);
    expect(held(razed.state), 'гарнизон пережил своё здание').toBe(0);
  });

  it('ВЫДАННЫЙ гарнизон держит узел: прилётом его не забрать', () => {
    // То, ради чего решение 6 и было: форт перестаёт быть «бонусом к цифре» и начинает
    // физически держать мир.
    const raider: Fleet = {
      id: 'R', owner: 'p2', location: 'A', movement: null,
      units: [{ unit: 'cruiser', count: 2 }], landing: [], traits: [], battleId: null,
    };
    const st = withFort();
    const attacked: GameState = {
      ...st,
      players: { ...st.players, p1: { ...st.players.p1!, status: 'active' } },
      fleets: { R: raider },
      diplomacy: { 'p1|p2': 'war' },
      scheduled: [{ id: 'e:0', at: 1, type: 'fleet.arrived', payload: { fleetId: 'R', at: 'A' }, seq: 0 }],
      scheduleSeq: 1,
    };
    const after = kernel.advanceTo(attacked, ctx(300 * HOUR));
    if (!after.ok) throw new Error('advance отказ');
    expect(after.state.planets.A?.owner, 'мир с живым гарнизоном отдали прилётом').toBe('p1');
  });

  it('ПОТОЛОК считается по ПЛАНЕТЕ: два форта его не обходят сложением', () => {
    // FORT-2.3. Считай потолок по зданию — «потолок 3» означало бы «3 на каждый форт», и
    // правило отменяло бы само себя на второй постройке.
    const twoForts = world([
      { type: 'fort', level: 3, hp: 100 },
      { type: 'fort', level: 3, hp: 100 },
    ]);
    const r = kernel.advanceTo(
      { ...twoForts, scheduled: [{ id: 'e:0', at: 1, type: 'planet.bombarded', payload: { planetId: 'A', power: 0.0001 }, seq: 0 }], scheduleSeq: 1 },
      ctx(HOUR),
    );
    if (!r.ok) throw new Error('advance отказ');
    // Два форта третьего уровня объявляют 3 + 3 = 6 защитников, потолок режет до трёх.
    expect(held(r.state)).toBe(3);
  });

  it('ФРАКЦИЯ двигает потолок, а без модуля фракций работает база', () => {
    const scene = (faction: string) => {
      const base = world([{ type: 'fort', level: 3, hp: 100 }]);
      return {
        ...base,
        players: { ...base.players, p1: { ...base.players.p1!, faction } },
        scheduled: [{ id: 'e:0', at: 1, type: 'planet.bombarded', payload: { planetId: 'A', power: 0.0001 }, seq: 0 }],
        scheduleSeq: 1,
      };
    };
    const withFactions = createKernel([factionModule, constructionModule]);
    const run = (k: typeof kernel, faction: string): number => {
      const r = k.advanceTo(scene(faction), ctx(HOUR));
      if (!r.ok) throw new Error('advance отказ');
      return held(r.state);
    };
    // Форт третьего уровня объявляет ровно 3 — столько же, сколько базовый потолок.
    // Поэтому видно именно ДВИЖЕНИЕ потолка: вниз у роя, база у прочих.
    expect(run(withFactions, 'swarm'), 'рой обязан держать меньше').toBe(2);
    expect(run(withFactions, 'crimson'), 'фракция без модификатора — база').toBe(3);
    // Без модуля фракций пассивка не читается вовсе, и работает база (инвариант #3).
    expect(run(kernel, 'swarm'), 'без модуля фракций обязана работать база').toBe(3);
  });

  it('гарнизон НЕ ЗАКАЗЫВАЮТ в казармах — его выдаёт здание', () => {
    const r = kernel.applyAction(
      world([{ type: 'barracks', level: 1, hp: 100 }]),
      act('unit.build', { planetId: 'A', unit: GARRISON }),
      ctx(),
    );
    expect(r.ok).toBe(false);
    expect(r.ok ? '' : r.code).toBe('E_NOT_BUILDABLE');
  });
});
