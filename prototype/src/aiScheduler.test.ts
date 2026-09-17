import { describe, expect, it } from 'vitest';
import { StaggeredAi } from './aiScheduler';

const seats = ['a', 'b', 'c', 'd'];
const decision = () => 'expand';
const plan = (seat: string) => [`${seat}:1`, `${seat}:2`];

describe('распределённые ходы ИИ', () => {
  it('разносит решения по всему циклу и повторяет расписание весь день', () => {
    const ai = new StaggeredAi<string>(100);
    const events: Array<[number, string]> = [];
    for (let now = 0; now <= 1200; now++) {
      const step = ai.step(now, seats, decision, (seat) => {
        events.push([now, seat]);
        return [];
      });
      expect(step.action).toBeUndefined();
    }
    expect(events.slice(0, 5)).toEqual([
      [25, 'a'],
      [50, 'b'],
      [75, 'c'],
      [100, 'd'],
      [125, 'a'],
    ]);
    for (const seat of seats) expect(events.filter(([, id]) => id === seat)).toHaveLength(12);
  });

  it('за вызов только рассчитывает одно решение ИЛИ выдаёт один приказ', () => {
    const ai = new StaggeredAi<string>(100);
    expect(ai.step(25, seats, decision, plan)).toEqual({ worked: true });
    expect(ai.step(25, seats, decision, plan).action).toBe('a:1');
    expect(ai.step(25, seats, decision, plan).action).toBe('a:2');
    expect(ai.step(25, seats, decision, plan).worked).toBe(false);
  });

  it('скачок на много дней не создаёт очередь пропущенных ходов и не голодает места', () => {
    const ai = new StaggeredAi<string>(100);
    const actions = [];
    for (let n = 0; n < 30; n++) {
      const step = ai.step(100000, seats, decision, plan);
      if (step.action) actions.push(step.action);
    }
    expect(actions).toEqual(seats.flatMap(plan));
    expect(ai.step(100000, seats, decision, plan).worked).toBe(false);
    expect(ai.step(100025, seats, decision, plan).worked).toBe(true);
  });

  it('отбрасывает старые приказы при возврате человека, смене осанки или просрочке', () => {
    for (const reason of ['human', 'posture', 'expired']) {
      const ai = new StaggeredAi<string>(100);
      ai.step(25, seats, decision, plan);
      const step = ai.step(
        reason === 'expired' ? 125 : 25,
        seats,
        () => (reason === 'human' ? null : reason === 'posture' ? 'defend' : 'expand'),
        plan,
      );
      expect(step.action).toBeUndefined();
    }
  });

  it('reset очищает незаконченный ход, новые места распределяются от новых часов', () => {
    const ai = new StaggeredAi<string>(100);
    ai.step(25, seats, decision, plan);
    ai.reset(1000);
    expect(ai.step(1000, seats, decision, plan).worked).toBe(false);
    expect(ai.step(1025, seats, decision, plan).worked).toBe(true);
    expect(ai.step(1025, [], decision, plan).action).toBeUndefined();
  });
});
