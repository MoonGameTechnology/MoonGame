import { describe, it, expect } from 'vitest';
import { pruneGroup, refSurvives } from './selectionPrune';

const живые = new Set(['f1', 'f2', 'враг']);
const есть = (id: string) => живые.has(id);
const владелец = (id: string): string | null | undefined =>
  ({ f1: 'p1', f2: 'p1', враг: 'p2' })[id];

describe('очистка ссылок — одиночные', () => {
  it('живой флот ссылку держит', () => {
    expect(refSurvives('f1', есть)).toBe(true);
  });

  it('ИСЧЕЗНУВШИЙ ФЛОТ ССЫЛКУ СНИМАЕТ: иначе приказ уйдёт в пустоту', () => {
    expect(refSurvives('погиб', есть)).toBe(false);
  });

  it('пустая ссылка остаётся пустой', () => {
    expect(refSurvives(null, есть)).toBe(false);
    expect(refSurvives(undefined, есть)).toBe(false);
  });

  it('ОДИНОЧНАЯ ССЫЛКА О ВЛАДЕЛЬЦЕ НЕ СПРАШИВАЕТ: чужой флот можно осматривать', () => {
    expect(refSurvives('враг', есть)).toBe(true);
  });
});

describe('очистка ссылок — групповое выделение', () => {
  it('свои живые флоты остаются', () => {
    expect([...pruneGroup(['f1', 'f2'], владелец, 'p1')]).toEqual(['f1', 'f2']);
  });

  it('ПРОПАВШИЙ ВЫПАДАЕТ ИЗ ГРУППЫ', () => {
    expect([...pruneGroup(['f1', 'погиб'], владелец, 'p1')]).toEqual(['f1']);
  });

  it('ЗАХВАЧЕННЫЙ ВЫПАДАЕТ ТОЖЕ: он жив, но больше не мой', () => {
    expect([...pruneGroup(['f1', 'враг'], владелец, 'p1')]).toEqual(['f1']);
  });

  it('группа из одних чужих схлопывается в пустую', () => {
    expect(pruneGroup(['враг', 'погиб'], владелец, 'p1').size).toBe(0);
  });

  it('пустая группа остаётся пустой', () => {
    expect(pruneGroup([], владелец, 'p1').size).toBe(0);
  });

  it('повторы схлопываются — это множество, а не список', () => {
    expect(pruneGroup(['f1', 'f1'], владелец, 'p1').size).toBe(1);
  });
});
