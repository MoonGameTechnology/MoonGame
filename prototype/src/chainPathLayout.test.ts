import { describe, it, expect } from 'vitest';
import {
  CAPSULE_DX,
  CAPSULE_DY,
  CAPSULE_STACK,
  capsuleAt,
  chainPathNodes,
  lastStepAtPoint,
  stackIndexes,
  type PathStep,
} from './chainPathLayout';

// A—B—C по цепочке лейнов, A—D напрямую нет пути
const лейны: Record<string, string[]> = {
  'A>B': ['B'],
  'B>C': ['C'],
  'A>C': ['B', 'C'],
  'C>A': ['B', 'A'],
};
const маршрут = (from: string, to: string): string[] | null => лейны[`${from}>${to}`] ?? null;
const ход = (to: string): PathStep => ({ kind: 'move', to });

describe('линия плана — по каким узлам идёт', () => {
  it('ЛИНИЯ ИДЁТ ПО ЛЕЙНАМ, А НЕ ПО ПРЯМОЙ: иначе она врёт про путь и про время', () => {
    expect(chainPathNodes([ход('C')], 'A', маршрут)).toEqual(['B', 'C']);
  });

  it('МАРШРУТА НЕТ — СТАВИМ ХОТЯ БЫ ЦЕЛЬ: шаг не должен исчезнуть с карты молча', () => {
    expect(chainPathNodes([ход('D')], 'A', маршрут)).toEqual(['D']);
  });

  it('ШАГИ НЕ-ПЕРЕЛЁТЫ ТОЧКУ НЕ ДВИГАЮТ: ждать и штурмовать — это ТАМ ЖЕ', () => {
    const план: PathStep[] = [{ kind: 'wait' }, ход('B'), { kind: 'assault' }, { kind: 'fire' }];
    expect(chainPathNodes(план, 'A', маршрут)).toEqual(['B']);
  });

  it('ПЕРЕЛЁТ «СЮДА ЖЕ» ПРОПУСКАЕТСЯ — иначе точка задвоится нулевым сегментом', () => {
    expect(chainPathNodes([ход('A')], 'A', маршрут)).toEqual([]);
    expect(chainPathNodes([ход('B'), ход('B')], 'A', маршрут)).toEqual(['B']);
  });

  it('перелёты идут подряд, каждый от конца предыдущего', () => {
    expect(chainPathNodes([ход('B'), ход('C')], 'A', маршрут)).toEqual(['B', 'C']);
  });

  it('пустой план — пустая линия', () => {
    expect(chainPathNodes([], 'A', маршрут)).toEqual([]);
  });

  it('перелёт без цели не рисуется', () => {
    expect(chainPathNodes([{ kind: 'move' }], 'A', маршрут)).toEqual([]);
  });
});

describe('капсулы шагов — стопка в одной точке', () => {
  it('НЕСКОЛЬКО ШАГОВ В ТОЧКЕ — СТОПКОЙ ВПРАВО, иначе лягут друг на друга', () => {
    expect(stackIndexes(['A', 'A', 'A'])).toEqual([0, 1, 2]);
  });

  it('счёт ведётся отдельно по каждой точке', () => {
    expect(stackIndexes(['A', 'B', 'A', 'B', 'B'])).toEqual([0, 0, 1, 1, 2]);
  });

  it('шаг без точки рисовать негде', () => {
    expect(stackIndexes(['A', null, undefined, 'A'])).toEqual([0, null, null, 1]);
  });

  it('первая капсула стоит со смещением, следующие — на шаг стопки правее', () => {
    const c = { x: 100, y: 50 };
    expect(capsuleAt(c, 0)).toEqual({ x: 100 + CAPSULE_DX, y: 50 + CAPSULE_DY });
    expect(capsuleAt(c, 2).x - capsuleAt(c, 1).x).toBe(CAPSULE_STACK);
  });

  it('стопка растёт вправо и не съезжает по вертикали', () => {
    expect(capsuleAt({ x: 0, y: 0 }, 3).y).toBe(capsuleAt({ x: 0, y: 0 }, 0).y);
  });
});

describe('подпись «~T» — под последней капсулой точки', () => {
  it('ВРЕМЯ ТОЧКИ — КОГДА ОНА ОТРАБОТАНА ЦЕЛИКОМ, а не когда начат первый шаг', () => {
    expect(lastStepAtPoint(['A', 'A', 'A'])).toEqual(new Map([['A', 2]]));
  });

  it('у каждой точки своя последняя капсула', () => {
    expect(lastStepAtPoint(['A', 'B', 'A'])).toEqual(
      new Map([
        ['A', 2],
        ['B', 1],
      ]),
    );
  });

  it('шаги без точки подпись не получают', () => {
    expect(lastStepAtPoint([null, undefined])).toEqual(new Map());
  });
});
