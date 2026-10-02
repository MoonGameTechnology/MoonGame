import { describe, it, expect } from 'vitest';
import { engageOrders, type EngageFleet } from './engageOrders';

const at = (id: string, location: string | null, engaged = false): EngageFleet => ({
  id,
  location,
  engaged,
});

describe('приказы выделенным флотам по «Атаке» (ATK-3)', () => {
  it('флот у цели атакует, флот вдали идёт маршем к её узлу', () => {
    expect(engageOrders([at('a', 'P'), at('b', 'Q')], 'P')).toEqual({
      engage: ['a'],
      march: ['b'],
      adrift: false,
    });
  });

  it('несколько флотов у цели — кандидаты одного приказа: остальных втянет бой', () => {
    const plan = engageOrders([at('a', 'P'), at('b', 'P'), at('c', 'Q')], 'P');
    // Приказ получает первый принятый; `b` в бой втянет ядро, второй приказ дал бы E_IN_BATTLE.
    expect(plan.engage).toEqual(['a', 'b']);
    expect(plan.march).toEqual(['c']);
  });

  it('первыми идут свободные: занятый боем флот приказ отвергнет', () => {
    expect(engageOrders([at('a', 'P', true), at('b', 'P')], 'P').engage).toEqual(['b']);
  });

  it('свободных у цели нет — приказ получает первый занятый: честный отказ один раз', () => {
    expect(engageOrders([at('a', 'P', true), at('b', 'P', true)], 'P').engage).toEqual(['a']);
  });

  it('флот в пути получает марш к цели, как флот на другом узле', () => {
    expect(engageOrders([at('a', null)], 'P')).toEqual({ engage: [], march: ['a'], adrift: false });
  });

  it('цель в пути — приказов нет, подсказка одна на весь приказ', () => {
    expect(engageOrders([at('a', 'P'), at('b', 'Q')], null)).toEqual({
      engage: [],
      march: [],
      adrift: true,
    });
    expect(engageOrders([], null).adrift).toBe(false);
  });
});
