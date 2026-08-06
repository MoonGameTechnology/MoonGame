import { describe, it, expect } from 'vitest';
import { fleetWhere, groupTotals, pickPanel, type Selection } from './panelSelect';
import { newGame } from './game';
import type { Fleet, GameState, Planet } from '../../packages/shared-core/src/index';

const base = newGame();
const somePlanet = Object.values(base.planets)[0]!;

const fleet = (id: string, over: Partial<Fleet> = {}): Fleet =>
  ({ id, owner: 'p1', location: somePlanet.id, units: [], ...over }) as Fleet;

const state = (
  fleets: Fleet[],
  planets: Planet[] = [somePlanet],
): Pick<GameState, 'fleets' | 'planets'> => ({
  fleets: Object.fromEntries(fleets.map((f) => [f.id, f])),
  planets: Object.fromEntries(planets.map((p) => [p.id, p])),
});

const sel = (over: Partial<Selection> = {}): Selection => ({
  fleets: [],
  fleet: null,
  planet: null,
  ...over,
});

const seen = () => true;

describe('панель — кого показывать', () => {
  const a = fleet('f1');
  const b = fleet('f2');

  it('два и больше флотов — тактическая группа', () => {
    const pick = pickPanel(sel({ fleets: ['f1', 'f2'] }), state([a, b]), seen);
    expect(pick.kind).toBe('group');
    expect(pick.kind === 'group' && pick.fleets.map((f) => f.id)).toEqual(['f1', 'f2']);
  });

  it('ГРУППА ИЗ ОДНОГО — не группа: рамка на один флот даёт обычную карточку', () => {
    const pick = pickPanel(sel({ fleets: ['f1'], fleet: 'f1' }), state([a, b]), seen);
    expect(pick.kind).toBe('fleet');
  });

  it('УСТАРЕВШИЙ ВЫБОР ФЛОТА НЕ ЗАПИРАЕТ ПАНЕЛЬ — показывается мир', () => {
    const pick = pickPanel(
      sel({ fleet: 'сгорел-в-бою', planet: somePlanet.id }),
      state([], [somePlanet]),
      seen,
    );
    expect(pick.kind).toBe('world');
  });

  it('мёртвые ссылки в рамке отбрасываются, а не считаются флотами', () => {
    const pick = pickPanel(sel({ fleets: ['f1', 'нет-такого'] }), state([a]), seen);
    expect(pick.kind).toBe('empty'); // один живой — уже не группа, а одиночного выбора нет
    const two = pickPanel(sel({ fleets: ['f1', 'нет-такого'], fleet: 'f1' }), state([a]), seen);
    expect(two.kind).toBe('fleet');
  });

  it('флот важнее мира: выбраны оба — показывается флот', () => {
    const pick = pickPanel(sel({ fleet: 'f1', planet: somePlanet.id }), state([a]), seen);
    expect(pick.kind).toBe('fleet');
  });

  it('МИР ВНЕ СЕНСОРОВ — своя карточка, а не чужие данные', () => {
    const pick = pickPanel(sel({ planet: somePlanet.id }), state([], [somePlanet]), () => false);
    expect(pick).toEqual({ kind: 'world', planet: somePlanet, known: false });
  });

  it('ничего не выбрано — пусто', () => {
    expect(pickPanel(sel(), state([]), seen).kind).toBe('empty');
  });

  it('выбран исчезнувший мир — тоже пусто, а не падение', () => {
    expect(pickPanel(sel({ planet: 'нет-такого' }), state([]), seen).kind).toBe('empty');
  });

  it('порядок флотов в группе — порядок выбора игрока', () => {
    const pick = pickPanel(sel({ fleets: ['f2', 'f1'] }), state([a, b]), seen);
    expect(pick.kind === 'group' && pick.fleets.map((f) => f.id)).toEqual(['f2', 'f1']);
  });
});

describe('панель — где флот', () => {
  it('стоящий флот назван миром', () => {
    expect(fleetWhere(fleet('f', { location: 'C1R1' }))).toEqual({ kind: 'orbit', at: 'C1R1' });
  });

  it('ПРИЛЕТЕВШИЙ ФЛОТ СТОИТ, даже если остался прежний след пути', () => {
    const arrived = fleet('f', {
      location: 'C1R1',
      movement: { from: 'C1R0', to: 'C1R1' },
      edge: { from: 'C1R0', to: 'C1R1' },
    } as Partial<Fleet>);
    expect(fleetWhere(arrived).kind).toBe('orbit');
  });

  it('идущий флот назван парой миров', () => {
    const moving = fleet('f', {
      location: null,
      movement: { from: 'A', to: 'B' },
    } as Partial<Fleet>);
    expect(fleetWhere(moving)).toEqual({ kind: 'transit', from: 'A', to: 'B' });
  });

  it('флот на дуге отличается от идущего по маршруту', () => {
    const onLane = fleet('f', {
      location: null,
      edge: { from: 'A', to: 'B' },
    } as Partial<Fleet>);
    expect(fleetWhere(onLane)).toEqual({ kind: 'lane', from: 'A', to: 'B' });
  });

  it('без всяких признаков положение неизвестно, а не пустая строка', () => {
    expect(fleetWhere(fleet('f', { location: null } as Partial<Fleet>))).toEqual({
      kind: 'unknown',
    });
  });
});

describe('панель — итоги группы', () => {
  it('складывает борта и десант по всем флотам', () => {
    const g = [
      fleet('f1', {
        units: [{ unit: 'cruiser', count: 2 }],
        landing: [{ unit: 'tank', count: 3 }],
      }),
      fleet('f2', { units: [{ unit: 'scout', count: 1 }] }),
    ];
    expect(groupTotals(g)).toEqual({ fleets: 2, ships: 3, troops: 3 });
  });

  it('пустой трюм считается нулём, а не отсутствием', () => {
    expect(groupTotals([fleet('f1', { units: [{ unit: 'scout', count: 1 }] })])).toEqual({
      fleets: 1,
      ships: 1,
      troops: 0,
    });
  });

  it('пустая группа — все нули', () => {
    expect(groupTotals([])).toEqual({ fleets: 0, ships: 0, troops: 0 });
  });
});
