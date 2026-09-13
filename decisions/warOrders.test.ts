import { describe, it, expect } from 'vitest';
import { laneEnds, warConfirmPlan, type StagedOrder } from './warOrders';

const order = (over: Partial<StagedOrder> = {}): StagedOrder => ({
  fleetIds: ['f1', 'f2'],
  destId: 'A',
  blockers: ['azure'],
  ...over,
});

describe('подтверждение войны — порядок шагов', () => {
  it('ВОЙНА ОБЪЯВЛЯЕТСЯ ПЕРВОЙ: приказ раньше объявления упрётся в те же запертые лейны', () => {
    const steps = warConfirmPlan(order());
    expect(steps[0]).toEqual({ kind: 'declare-war', on: 'azure' });
    expect(steps[1]!.kind).toBe('move');
  });

  it('ОБЪЯВЛЯЮТ КАЖДОМУ ВИНОВНИКУ, а не первому — иначе второй по-прежнему запирает', () => {
    const steps = warConfirmPlan(order({ blockers: ['azure', 'crimson', 'amber'] }));
    expect(steps.slice(0, 3)).toEqual([
      { kind: 'declare-war', on: 'azure' },
      { kind: 'declare-war', on: 'crimson' },
      { kind: 'declare-war', on: 'amber' },
    ]);
  });

  it('порядок объявлений — тот же, в каком виновники названы игроку', () => {
    const steps = warConfirmPlan(order({ blockers: ['violet', 'amber'] }));
    expect(
      steps.filter((s) => s.kind === 'declare-war').map((s) => (s as { on: string }).on),
    ).toEqual(['violet', 'amber']);
  });

  it('шаг движения ровно один, и он последний', () => {
    const steps = warConfirmPlan(order({ blockers: ['azure', 'crimson'] }));
    expect(steps.filter((s) => s.kind !== 'declare-war')).toHaveLength(1);
    expect(steps[steps.length - 1]!.kind).toBe('move');
  });

  it('без виновников приказ всё равно исполняется — план не пустой', () => {
    expect(warConfirmPlan(order({ blockers: [] }))).toEqual([
      { kind: 'move', fleetIds: ['f1', 'f2'], destId: 'A' },
    ]);
  });
});

describe('подтверждение войны — каким приказом кончается', () => {
  it('штурм остаётся штурмом, а не превращается в ход', () => {
    const steps = warConfirmPlan(order({ assault: true }));
    expect(steps[steps.length - 1]).toEqual({
      kind: 'assault',
      fleetIds: ['f1', 'f2'],
      destId: 'A',
    });
  });

  it('марш по лейну идёт своим шагом — у него точка, а не мир', () => {
    const edge = { from: 'A', to: 'B', t: 0.4 };
    const steps = warConfirmPlan(order({ edge }));
    expect(steps[steps.length - 1]).toEqual({ kind: 'move-edge', fleetIds: ['f1', 'f2'], edge });
  });

  it('ШТУРМ ПЕРЕВЕШИВАЕТ ЛЕЙН: штурмуют мир, а не точку посреди дороги', () => {
    const steps = warConfirmPlan(order({ assault: true, edge: { from: 'A', to: 'B', t: 0.5 } }));
    expect(steps[steps.length - 1]!.kind).toBe('assault');
  });

  it('флоты доезжают до шага движения все', () => {
    const steps = warConfirmPlan(order({ fleetIds: ['a', 'b', 'c'] }));
    const last = steps[steps.length - 1] as { fleetIds: readonly string[] };
    expect(last.fleetIds).toEqual(['a', 'b', 'c']);
  });
});

describe('марш по лейну — какие миры проверять', () => {
  it('ПРОВЕРЯЮТСЯ ОБА КОНЦА: хозяин любого из них запирает марш', () => {
    expect(laneEnds({ from: 'A', to: 'B', t: 0.3 })).toEqual(['A', 'B']);
  });

  it('доля пути на список концов не влияет — флот стоит на всём отрезке', () => {
    expect(laneEnds({ from: 'A', to: 'B', t: 0 })).toEqual(laneEnds({ from: 'A', to: 'B', t: 1 }));
  });
});
