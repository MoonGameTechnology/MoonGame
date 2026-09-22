/**
 * СЛОТЫ ПОСТРОЕК (FORT-5.3; решения владельца 10 и 11 — §0.7 роадмапа).
 *
 * «Крепость 1 уровня несёт одну постройку, 2-го — две, и так до пяти. Слоты ТОЛЬКО у
 * крепости.» Лимита на число зданий в игре не было вообще — есть лишь `maxPerPlanet` на
 * каждое здание, — так что это новая механика, и у неё три места, где можно ошибиться:
 *
 *   1. лимит должен включаться сам, наличием мест, иначе планета тоже окажется под ним;
 *   2. носитель мест не должен занимать место — иначе крепость 1 уровня вместит НОЛЬ
 *      построек, ведь корпус уже стоит;
 *   3. очередь обязана считаться вместе со стоящим, иначе лимит обходится заказом впрок.
 */
import { describe, expect, it } from 'vitest';
import {
  constructionModule,
  createInitialState,
  createKernel,
  stationModule,
  type Action,
  type Context,
  type GameState,
} from '../packages/shared-core/src/index';
import { shippedGameData } from './bundle';

const data = shippedGameData();
const ctx = (now = 0): Context => ({ now, data });
const kernel = createKernel([stationModule, constructionModule]);

function world(kind: string): GameState {
  const s = createInitialState({ seed: 'sl', version: { data: data.version, manifest: '1' } });
  return {
    ...s,
    players: { p1: { id: 'p1', name: 'p1', faction: 'x', status: 'active', resources: { metal: 99000, credits: 99000, energy: 99000, food: 99000 } } },
    planets: {
      A: { id: 'A', owner: 'p1', kind, position: { x: 0, y: 0 }, links: [], resources: {}, buildings: [], garrison: [], traits: [] },
    },
  };
}
const act = (type: string, payload: Record<string, unknown>): Action => ({
  id: 's:p1:1', type, playerId: 'p1', payload, issuedAt: 0,
});
/** Поднять крепость и вернуть состояние. */
function fortress(): GameState {
  const r = kernel.applyAction(world('asteroid'), act('station.deploy', { planetId: 'A' }), ctx());
  if (!r.ok) throw new Error(`отказ ${r.code}`);
  return r.state;
}
const order = (st: GameState, building: string, now = 0): ReturnType<typeof kernel.applyAction> =>
  kernel.applyAction(st, act('building.construct', { planetId: 'A', building }), ctx(now));

describe('слоты построек — решения владельца 10 и 11', () => {
  it('крепость 1 уровня вмещает РОВНО ОДНУ постройку, вторая отбивается своим кодом', () => {
    // Второй пункт из шапки: если бы корпус занимал место, эта первая постройка уже не
    // прошла бы, и тест упал бы здесь.
    const st = fortress();
    const first = order(st, 'radar');
    expect(first.ok, 'первая постройка обязана пройти — корпус слота не занимает').toBe(true);
    if (!first.ok) return;
    const second = order(first.state, 'fort');
    expect(second.ok).toBe(false);
    expect(second.ok ? '' : second.code).toBe('E_NO_BUILD_SLOTS');
  });

  it('ПРОКАЧКА открывает следующее место', () => {
    let st = fortress();
    const first = order(st, 'radar');
    if (!first.ok) throw new Error('первая постройка не прошла');
    st = first.state;
    const up = kernel.applyAction(st, act('building.upgrade', { planetId: 'A', building: 'starfort' }), ctx(1));
    if (!up.ok) throw new Error(`прокачка: отказ ${up.code}`);
    const done = kernel.advanceTo(up.state, ctx(500 * 3_600_000));
    if (!done.ok) throw new Error('advance отказ');
    expect(done.state.planets.A?.buildings.find((b) => b.type === 'starfort')?.level).toBe(2);
    expect(order(done.state, 'fort', 500 * 3_600_000).ok, 'на втором уровне обязано влезать двое').toBe(true);
  });

  it('ОЧЕРЕДЬ считается вместе со стоящим — лимит не обойти заказом впрок', () => {
    // Третий пункт: без счёта очереди на крепость первого уровня можно было бы
    // поставить пять заказов, и все пять доехали бы до готовности.
    const st = fortress();
    const first = order(st, 'radar');
    if (!first.ok) throw new Error('первая постройка не прошла');
    // Первая ещё СТРОИТСЯ (не достроена), а место уже занято.
    expect(first.state.planets.A?.buildings.some((b) => b.type === 'radar')).toBe(false);
    const second = order(first.state, 'fort');
    expect(second.ok ? '' : second.code).toBe('E_NO_BUILD_SLOTS');
  });

  it('НА ПЛАНЕТЕ лимита нет — слоты только у крепости (решение 11)', () => {
    // Первый пункт: лимит включается наличием мест, а на планете их не объявляет никто.
    let st = world('planet');
    let now = 0;
    for (const building of ['mine', 'farm', 'power_plant', 'barracks', 'radar', 'fort']) {
      const r = order(st, building, now);
      expect(r.ok, `планета отказала в постройке ${building}`).toBe(true);
      if (!r.ok) return;
      const done = kernel.advanceTo(r.state, ctx((now += 200 * 3_600_000)));
      if (!done.ok) throw new Error('advance отказ');
      st = done.state;
    }
    expect(st.planets.A?.buildings.length, 'шесть построек обязаны стоять').toBe(6);
  });
});
