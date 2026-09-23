import { describe, expect, it } from 'vitest';
import { battleStance, STANCE_FAN } from './battleStance';

const norm = (a: number) => ((a % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI);

describe('боевая стойка — строй сторон лицом друг к другу', () => {
  it('своя сторона слева, противник справа, носы в центр', () => {
    const s = battleStance(
      [
        { id: 'e1', owner: 'p2' },
        { id: 'm1', owner: 'p1' },
      ],
      'p1',
    );
    expect(norm(s.get('m1')!.angle)).toBeCloseTo(Math.PI);
    expect(norm(s.get('e1')!.angle)).toBeCloseTo(0);
    expect(norm(s.get('m1')!.heading)).toBeCloseTo(0); // смотрит вправо — на врага
    expect(norm(s.get('e1')!.heading)).toBeCloseTo(Math.PI);
  });

  it('флоты стороны — веером вокруг её угла, в порядке id', () => {
    const s = battleStance(
      [
        { id: 'm2', owner: 'p1' },
        { id: 'm1', owner: 'p1' },
        { id: 'e1', owner: 'p2' },
      ],
      'p1',
    );
    expect(s.get('m1')!.angle).toBeCloseTo(Math.PI - STANCE_FAN / 2);
    expect(s.get('m2')!.angle).toBeCloseTo(Math.PI + STANCE_FAN / 2);
  });

  it('три стороны делят круг поровну; раскладка не зависит от порядка входа', () => {
    const fleets = [
      { id: 'a', owner: 'p3' },
      { id: 'b', owner: 'p2' },
      { id: 'c', owner: 'p1' },
    ];
    const one = battleStance(fleets, 'p1');
    const two = battleStance([...fleets].reverse(), 'p1');
    expect([...one.entries()].sort()).toEqual([...two.entries()].sort());
    expect(norm(one.get('c')!.angle)).toBeCloseTo(Math.PI);
    expect(norm(one.get('b')!.angle - one.get('c')!.angle)).toBeCloseTo((2 * Math.PI) / 3);
  });

  it('наблюдатель без своих флотов в бою — стороны всё равно расставлены', () => {
    const s = battleStance(
      [
        { id: 'x', owner: 'p2' },
        { id: 'y', owner: 'p3' },
      ],
      'p1',
    );
    expect(s.size).toBe(2);
    expect(norm(s.get('x')!.angle)).toBeCloseTo(Math.PI);
  });
});
