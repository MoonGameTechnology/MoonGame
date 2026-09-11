import { describe, it, expect } from 'vitest';
import { autoStance, scrambleStance } from './stanceToggle';

describe('стойки — авто-штурм', () => {
  it('свой флот без стойки её получает', () => {
    expect(autoStance(true, false, true)).toBe('set');
  });

  it('ЧУЖОЙ ФЛОТ СТОЙКИ НЕ ИМЕЕТ', () => {
    expect(autoStance(false, false, true)).toBe('skip');
  });

  it('УЖЕ В НУЖНОМ СОСТОЯНИИ — ПРИКАЗА НЕТ: иначе сеть получит пустой приказ', () => {
    expect(autoStance(true, true, true)).toBe('skip');
    expect(autoStance(true, false, false)).toBe('skip');
  });

  it('снятие стойки — тоже изменение', () => {
    expect(autoStance(true, true, false)).toBe('set');
  });

  it('ДЕЖУРСТВО СТАВИТСЯ, когда есть чем дежурить и состояние меняется', () => {
    expect(scrambleStance(true, true, false, true)).toBe('set');
  });

  it('ПУСТОЙ АНГАР — СТОЙКИ НЕТ: дежурить нечем (правило 4)', () => {
    expect(scrambleStance(true, false, false, true)).toBe('skip');
  });

  it('ЧУЖАЯ БАЗА — СТОЙКИ НЕТ (правило 2)', () => {
    expect(scrambleStance(false, true, false, true)).toBe('skip');
  });

  it('УЖЕ В НУЖНОМ СОСТОЯНИИ — приказа нет (правило 3)', () => {
    expect(scrambleStance(true, true, true, true)).toBe('skip');
    expect(scrambleStance(true, true, false, false)).toBe('skip');
  });

  it('СНЯТИЕ — обычный исход: запас вылетов принадлежит базе и им не трогается', () => {
    expect(scrambleStance(true, true, true, false)).toBe('clear');
  });
});
