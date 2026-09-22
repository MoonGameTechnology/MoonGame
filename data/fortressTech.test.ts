/**
 * КРЕПОСТЬ НАДО ИЗУЧИТЬ (FORT-5.1; решение владельца 12 — §0.7 роадмапа).
 *
 * До этого кирпича `station.deploy` проходил мимо дерева технологий ВОВСЕ: он не
 * `building.construct`, и общий гейт его не касался. Правило добавлено не своей проверкой
 * в модуле крепости, а обращением к ТОМУ ЖЕ хуку, которым гейтятся здания, и про то же
 * самое здание — ядро. Два дома у одного правила — это ровно тот разъезд, которым болели
 * ворота стройки до ORB-4.
 *
 * Тест гоняет НАСТОЯЩЕЕ исследование (заказ + время), а не подменяет список изученного в
 * состоянии: подмена доказала бы только то, что хук читает поле, а не то, что игрок может
 * дойти до крепости своими силами.
 */
import { describe, expect, it } from 'vitest';
import {
  constructionModule,
  createInitialState,
  createKernel,
  stationModule,
  technologyModule,
  type Action,
  type Context,
  type GameState,
} from '../packages/shared-core/src/index';
import { shippedGameData } from './bundle';

const data = shippedGameData();
const HOUR = 3_600_000;
const TECH = 'void_fortification';
const ctx = (now = 0): Context => ({ now, data });
const kernel = createKernel([technologyModule, stationModule]);

function world(): GameState {
  const s = createInitialState({ seed: 'ft', version: { data: data.version, manifest: '1' } });
  return {
    ...s,
    players: { p1: { id: 'p1', name: 'p1', faction: 'x', status: 'active', resources: { metal: 9000, credits: 9000 } } },
    planets: {
      A: { id: 'A', owner: 'p1', kind: 'asteroid', position: { x: 0, y: 0 }, links: [], resources: {}, buildings: [], garrison: [], traits: [] },
    },
  };
}
const act = (type: string, payload: Record<string, unknown>): Action => ({
  id: 's:p1:1', type, playerId: 'p1', payload, issuedAt: 0,
});
const deploy = (st: GameState, now = 0) =>
  kernel.applyAction(st, act('station.deploy', { planetId: 'A' }), ctx(now));

/** Изучить технологию целиком: заказ + ожидание. `null` — заказ отклонён. */
function research(st: GameState, technology: string, now: number): GameState | null {
  const r = kernel.applyAction(st, act('technology.research', { technology }), ctx(now));
  if (!r.ok) return null;
  const done = kernel.advanceTo(r.state, ctx(now + 200 * HOUR));
  if (!done.ok) throw new Error('advance отказ');
  return done.state;
}

describe('крепость открывается технологией — решение владельца 12', () => {
  it('БЕЗ технологии крепость не поставить', () => {
    const r = deploy(world());
    expect(r.ok).toBe(false);
    expect(r.ok ? '' : r.code).toBe('E_TECH_LOCKED');
  });

  it('С изученной технологией — ставится', () => {
    // Цепочка целиком: технология крепости стоит за орбитальной обороной, поэтому
    // сначала изучается она. Если предпосылку не выполнить, заказ отклонят, и
    // `research` вернёт null — тест скажет об этом прямо, а не упадёт на deploy.
    let st = world();
    const grid = research(st, 'orbital_defense_grid', 0);
    expect(grid, 'предпосылка не заказалась').not.toBeNull();
    st = grid!;
    const fortification = research(st, TECH, 200 * HOUR);
    expect(fortification, 'технология крепости не заказалась').not.toBeNull();
    st = fortification!;
    expect(st.players.p1?.technologies?.completed).toContain(TECH);

    const r = deploy(st, 400 * HOUR);
    expect(r.ok, r.ok ? '' : `отказ ${r.code}`).toBe(true);
    if (!r.ok) return;
    expect(r.state.planets.A?.kind).toBe('void_station');
  });

  it('ПРЕДПОСЫЛКА обязательна — технологию крепости не заказать первой', () => {
    // Иначе «изучить» свелось бы к одной кнопке, и порядок веток ничего бы не значил.
    expect(research(world(), TECH, 0)).toBeNull();
  });

  it('ЗАХВАЧЕННУЮ крепость качает и тот, кто её не изучал', () => {
    // Живой сценарий, а не теория: крепость переходит к тому, кто отбил узел, и он мог
    // не вести эту ветку вовсе. Гейт стоит на ВОЗВЕДЕНИИ; будь он ещё и на прокачке,
    // трофей навсегда застрял бы на первом уровне — наказание за победу.
    const captured: GameState = {
      ...world(),
      players: {
        p2: { id: 'p2', name: 'p2', faction: 'x', status: 'active', resources: { metal: 9000, credits: 9000 } },
      },
      planets: {
        A: {
          id: 'A', owner: 'p2', kind: 'void_station', position: { x: 0, y: 0 }, links: [],
          resources: {}, buildings: [{ type: 'starfort', level: 1, hp: 70 }], garrison: [], traits: [],
        },
      },
    };
    expect(captured.players.p2?.technologies?.completed ?? [], 'победитель ветку не вёл').not.toContain(TECH);
    const up = createKernel([technologyModule, constructionModule]).applyAction(
      captured,
      { id: 's:p2:1', type: 'building.upgrade', playerId: 'p2', payload: { planetId: 'A', building: 'starfort' }, issuedAt: 0 },
      ctx(),
    );
    expect(up.ok, up.ok ? '' : `отказ ${up.code}`).toBe(true);
  });
});
