import { describe, it, expect } from 'vitest';
import { autoStance } from './stanceToggle';

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
});
