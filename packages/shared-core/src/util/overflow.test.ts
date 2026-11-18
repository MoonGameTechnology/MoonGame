import { describe, expect, it } from 'vitest';
import { spendVolley, type VolleyLeg } from './overflow';

/** Цель-заглушка: сколько доли залпа она способна принять, прежде чем погибнуть. */
interface Dummy {
  id: string;
  room: number;
  alive: boolean;
}

/** Проход «по-честному»: каждая нога ложится на цель; лишнее сверх `room` возвращается. */
function landAll(log: string[]) {
  return (legs: readonly VolleyLeg<Dummy>[]): number[] =>
    legs.map(({ target, budget }) => {
      log.push(`${target.id}:${budget.toFixed(4)}`);
      const used = Math.min(budget, target.room);
      target.room -= used;
      if (target.room <= 0) target.alive = false;
      return budget - used;
    });
}
const liveOf = (all: Dummy[]) => (): Dummy[] => all.filter((t) => t.alive);

describe('остаток залпа уходит в живые цели (резолюция владельца 2026-11-17)', () => {
  it('никто не погиб — залп делится поровну, как и прежде, остатка нет', () => {
    const all = [
      { id: 'a', room: 1, alive: true },
      { id: 'b', room: 1, alive: true },
    ];
    const log: string[] = [];
    expect(spendVolley(all, liveOf(all), landAll(log))).toBe(0);
    expect(log).toEqual(['a:0.5000', 'b:0.5000']);
  });

  it('приманка забирает только то, что держит; лишнее — в живых', () => {
    // Приманка держит 0.1 залпа, основной флот — сколько угодно.
    const decoy = { id: 'decoy', room: 0.1, alive: true };
    const main = { id: 'main', room: 10, alive: true };
    const log: string[] = [];
    expect(spendVolley([decoy, main], liveOf([decoy, main]), landAll(log))).toBe(0);
    // Первый проход — поровну; остаток приманки (0.4) — целиком основному.
    expect(log).toEqual(['decoy:0.5000', 'main:0.5000', 'main:0.4000']);
    expect(main.room).toBeCloseTo(10 - 0.9, 10);
  });

  it('остаток делится поровну между всеми, кто ещё жив, и переходит дальше по цепочке', () => {
    const all = [
      { id: 'a', room: 0.05, alive: true },
      { id: 'b', room: 0.4, alive: true },
      { id: 'c', room: 5, alive: true },
    ];
    const log: string[] = [];
    expect(spendVolley(all, liveOf(all), landAll(log))).toBe(0);
    const third = 1 / 3;
    // a берёт 0.05 и отдаёт 0.2833: поровну b и c. b погибает на втором проходе,
    // его остаток уходит единственному живому — c.
    expect(log[0]).toBe(`a:${third.toFixed(4)}`);
    expect(log.slice(3)).toEqual(['b:0.1417', 'c:0.1417', 'c:0.0750']);
    expect(all[2]!.room).toBeCloseTo(5 - (1 - 0.05 - 0.4), 10);
  });

  it('живых целей не осталось — возвращает долю, которой некуда лечь', () => {
    const all = [
      { id: 'a', room: 0.1, alive: true },
      { id: 'b', room: 0.2, alive: true },
    ];
    expect(spendVolley(all, liveOf(all), landAll([]))).toBeCloseTo(0.7, 10);
  });

  it('живая, но непробиваемая цель повторно не получает остаток — цикл не зависает', () => {
    // Цель жива, но ничего не принимает (например, роду войск нечем навредить).
    const wall = { id: 'wall', room: 0, alive: true };
    const target = { id: 't', room: 0.1, alive: true };
    const log: string[] = [];
    const pass = (legs: readonly VolleyLeg<Dummy>[]): number[] =>
      legs.map(({ target: x, budget }) => {
        log.push(`${x.id}:${budget.toFixed(2)}`);
        if (x === wall) return budget;
        const used = Math.min(budget, x.room);
        x.room -= used;
        if (x.room <= 0) x.alive = false;
        return budget - used;
      });
    const left = spendVolley([wall, target], () => [wall, target].filter((x) => x.alive), pass);
    expect(left).toBeCloseTo(0.9, 10);
    expect(log).toEqual(['wall:0.50', 't:0.50']);
  });

  it('бюджет — любая доля залпа: так разряжается сохранённый заряд', () => {
    const all = [{ id: 'a', room: 5, alive: true }];
    const log: string[] = [];
    expect(spendVolley(all, liveOf(all), landAll(log), 0.25)).toBe(0);
    expect(log).toEqual(['a:0.2500']);
  });

  it('пустой список целей — весь бюджет без цели', () => {
    expect(
      spendVolley(
        [] as Dummy[],
        () => [],
        () => [],
        0.6,
      ),
    ).toBe(0.6);
  });
});
