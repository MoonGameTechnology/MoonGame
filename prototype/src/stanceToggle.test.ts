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

  it('ГРУППА СНАПИТСЯ В ОДНО: разнородный набор приходит к общему состоянию', () => {
    const было = [true, false, true, false];
    const итог = было.map((cur) => (autoStance(true, cur, true) === 'set' ? true : cur));
    expect(итог).toEqual([true, true, true, true]);
  });
});

describe('стойки — дежурный вылет', () => {
  it('пришвартованное свободное крыло поднимает патруль', () => {
    expect(scrambleStance(true, true, false, true, true, true)).toBe('set');
  });

  it('ДЕЖУРИТЬ НЕЧЕМ БЕЗ КРЫЛА', () => {
    expect(scrambleStance(true, false, false, true, true, true)).toBe('skip');
  });

  it('чужой флот дежурства не получает', () => {
    expect(scrambleStance(false, true, false, true, true, true)).toBe('skip');
  });

  it('уже дежурит — приказа нет', () => {
    expect(scrambleStance(true, true, true, true, true, true)).toBe('skip');
  });

  it('СНЯТИЕ — ОТДЕЛЬНЫЙ ИСХОД: остаток вылета надо запомнить', () => {
    expect(scrambleStance(true, true, true, false, true, true)).toBe('clear');
  });

  it('СНЯТИЕ НЕ ТРЕБУЕТ ПРИКОЛА: улетевшее дежурство тоже снимается', () => {
    expect(scrambleStance(true, true, true, false, false, false)).toBe('clear');
  });

  it('ПАТРУЛЬ ВСТАЁТ ТОЛЬКО С ПРИКОЛА — зеркало гейта редьюсера', () => {
    expect(scrambleStance(true, true, false, true, false, true)).toBe('need-dock');
  });

  it('занятый флот патруль не поднимает', () => {
    expect(scrambleStance(true, true, false, true, true, false)).toBe('need-idle');
  });

  it('нет прикола важнее занятости — причина называется одна', () => {
    expect(scrambleStance(true, true, false, true, false, false)).toBe('need-dock');
  });

  it('отказ по крылу важнее отказа по приколу: без крыла молчим', () => {
    expect(scrambleStance(true, false, false, true, false, false)).toBe('skip');
  });
});
