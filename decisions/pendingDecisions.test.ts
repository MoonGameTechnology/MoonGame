import { describe, expect, it } from 'vitest';
import { pendingDecisions } from './pendingDecisions';

describe('«Ждёт решения» в окне «События» (UIX-4.2)', () => {
  it('свой бой выше боя, который только виден', () => {
    const got = pendingDecisions(
      [
        { id: 'b1', location: 'p1', mine: false, nextRoundAt: 10 },
        { id: 'b2', location: 'p2', mine: true, nextRoundAt: 50 },
      ],
      0,
    );
    expect(got.map((i) => (i.kind === 'battle' ? i.id : 'letters'))).toEqual(['b2', 'b1']);
  });

  it('внутри — по ближайшему раунду, без раунда — в конце, ровно — по id', () => {
    const got = pendingDecisions(
      [
        { id: 'c', location: 'p', mine: true },
        { id: 'b', location: 'p', mine: true, nextRoundAt: 30 },
        { id: 'z', location: 'p', mine: true, nextRoundAt: 20 },
        { id: 'a', location: 'p', mine: true, nextRoundAt: 30 },
      ],
      0,
    );
    expect(got.map((i) => (i.kind === 'battle' ? i.id : ''))).toEqual(['z', 'a', 'b', 'c']);
  });

  it('письма — один пункт со счётом после боёв', () => {
    const got = pendingDecisions([{ id: 'b', location: 'p', mine: false, nextRoundAt: 1 }], 3);
    expect(got).toEqual([
      { kind: 'battle', id: 'b', location: 'p', mine: false },
      { kind: 'letters', count: 3 },
    ]);
  });

  it('нечего решать — пунктов нет', () => {
    expect(pendingDecisions([], 0)).toEqual([]);
    expect(pendingDecisions([], 2)).toEqual([{ kind: 'letters', count: 2 }]);
  });

  it('вход не меняется', () => {
    const battles = [
      { id: 'b', location: 'p', mine: false, nextRoundAt: 5 },
      { id: 'a', location: 'p', mine: true, nextRoundAt: 9 },
    ];
    pendingDecisions(battles, 0);
    expect(battles.map((b) => b.id)).toEqual(['b', 'a']);
  });
});
