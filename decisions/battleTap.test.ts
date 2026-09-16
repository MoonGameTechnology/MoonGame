import { describe, it, expect } from 'vitest';
import { battleAtTap, battleTapRadius, type BattleTapTarget } from './battleTap';

const at = (x: number, y: number, id = 'b1', identified = true): BattleTapTarget => ({
  id,
  at: { x, y },
  identified,
});

describe('battleTap — во что попал палец', () => {
  it('ПРИКАЗ ВАЖНЕЕ: занятый тап значок не забирает', () => {
    expect(battleAtTap([at(0, 0)], { x: 0, y: 0 }, false, true)).toBeNull();
  });

  it('свободный тап по кольцу открывает бой', () => {
    expect(battleAtTap([at(0, 0)], { x: 5, y: 5 }, false, false)).toBe('b1');
  });

  it('за радиусом — промах, а не «ближайший из всех»', () => {
    expect(battleAtTap([at(0, 0)], { x: 100, y: 0 }, false, false)).toBeNull();
  });

  it('у ПАЛЬЦА радиус шире, чем у курсора', () => {
    expect(battleTapRadius(true)).toBeGreaterThan(battleTapRadius(false));
    const far = { x: 22, y: 0 }; // между курсорным и пальцевым радиусом
    expect(battleAtTap([at(0, 0)], far, false, false)).toBeNull();
    expect(battleAtTap([at(0, 0)], far, true, false)).toBe('b1');
  });

  it('под ТУМАНОМ кольца нет — тапать нечего', () => {
    expect(battleAtTap([at(0, 0, 'b1', false)], { x: 0, y: 0 }, false, false)).toBeNull();
  });

  it('бой без точки схватки не претендент', () => {
    expect(battleAtTap([{ id: 'b1', at: null, identified: true }], { x: 0, y: 0 }, false, false))
      .toBeNull();
  });

  it('из двух берётся БЛИЖАЙШИЙ, а не первый по порядку', () => {
    const far = at(10, 0, 'b1');
    const near = at(2, 0, 'b2');
    expect(battleAtTap([far, near], { x: 0, y: 0 }, false, false)).toBe('b2');
    expect(battleAtTap([near, far], { x: 0, y: 0 }, false, false)).toBe('b2');
  });

  it('ничья по расстоянию разводится по id — исход не зависит от порядка обхода', () => {
    const a = at(3, 0, 'b-a');
    const b = at(-3, 0, 'b-b');
    expect(battleAtTap([a, b], { x: 0, y: 0 }, false, false)).toBe('b-a');
    expect(battleAtTap([b, a], { x: 0, y: 0 }, false, false)).toBe('b-a');
  });
});
