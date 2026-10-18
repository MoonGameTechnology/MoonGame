import { describe, expect, it } from 'vitest';
import { rightClickAct, type RightClickInput } from './rightClick';

const click = (over: Partial<RightClickInput> = {}): RightClickInput => ({
  button: 2,
  touch: false,
  pc: true,
  armed: false,
  movers: 1,
  ...over,
});

describe('правый клик по карте — «Курс сюда» (UIX-9.2)', () => {
  it('правая кнопка на ПК с выбранным флотом даёт курс', () => {
    expect(rightClickAct(click())).toBe('course');
    expect(rightClickAct(click({ movers: 3 }))).toBe('course');
  });

  it('левая и средняя кнопки и палец идут прежней дорогой', () => {
    expect(rightClickAct(click({ button: 0 }))).toBe('pass');
    expect(rightClickAct(click({ button: 1 }))).toBe('pass');
    expect(rightClickAct(click({ touch: true }))).toBe('pass');
  });

  it('не на ПК правый клик не посылает флот', () => {
    expect(rightClickAct(click({ pc: false }))).toBe('none');
  });

  it('взведённый приказ правой кнопкой не стреляет', () => {
    expect(rightClickAct(click({ armed: true }))).toBe('none');
  });

  it('без своих флотов под приказ правая кнопка ничего не выбирает', () => {
    expect(rightClickAct(click({ movers: 0 }))).toBe('none');
  });
});
