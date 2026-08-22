import { describe, expect, it } from 'vitest';
import { assaultPlan, type AssaultFleetView } from './assaultDispatch';

const стоит = (id: string, refusal: string | null = null): AssaultFleetView => ({
  id,
  parked: true,
  refusal,
  lacksTroops: false,
});
const летит = (id: string, lacksTroops = false): AssaultFleetView => ({
  id,
  parked: false,
  refusal: null,
  lacksTroops,
});

describe('сейчас или по прибытии', () => {
  it('СТОИТ У ЦЕЛИ — штурмует немедленно', () => {
    expect(assaultPlan([стоит('a')]).steps).toEqual([{ kind: 'storm', id: 'a' }]);
  });

  it('не у цели — летит, штурм по прибытии', () => {
    expect(assaultPlan([летит('a')]).steps).toEqual([{ kind: 'send', id: 'a' }]);
  });

  it('смешанная группа: каждый по своей ветке, порядок сохраняется', () => {
    expect(assaultPlan([летит('a'), стоит('b'), летит('c')]).steps).toEqual([
      { kind: 'send', id: 'a' },
      { kind: 'storm', id: 'b' },
      { kind: 'send', id: 'c' },
    ]);
  });
});

describe('отказ ядра у стоящего', () => {
  it('ОТКАЗ — ПРИКАЗА НЕТ, и причина ядра идёт в жалобу', () => {
    const plan = assaultPlan([стоит('a', 'E_NO_TROOPS')]);
    expect(plan.steps).toEqual([{ kind: 'refused', id: 'a', code: 'E_NO_TROOPS' }]);
    expect(plan.warn).toEqual({ kind: 'refusal', code: 'E_NO_TROOPS' });
  });

  it('отказ одному не отменяет штурм остальным', () => {
    const plan = assaultPlan([стоит('a', 'E_FORBIDDEN'), стоит('b')]);
    expect(plan.steps).toEqual([
      { kind: 'refused', id: 'a', code: 'E_FORBIDDEN' },
      { kind: 'storm', id: 'b' },
    ]);
  });
});

describe('жалоба одна на всю группу', () => {
  it('ПЯТЬ БЕЗ ДЕСАНТА — ОДНА строка, а не пять: иначе журнал утонет', () => {
    const plan = assaultPlan([летит('a', true), летит('b', true), летит('c', true)]);
    expect(plan.warn).toEqual({ kind: 'no-troops' });
    expect(plan.steps).toHaveLength(3);
  });

  it('первая жалоба гасит и жалобу ДРУГОГО рода', () => {
    const plan = assaultPlan([летит('a', true), стоит('b', 'E_FORBIDDEN')]);
    expect(plan.warn).toEqual({ kind: 'no-troops' });
  });

  it('и наоборот: отказ пришёл первым — про десант уже не жалуемся', () => {
    const plan = assaultPlan([стоит('a', 'E_FORBIDDEN'), летит('b', true)]);
    expect(plan.warn).toEqual({ kind: 'refusal', code: 'E_FORBIDDEN' });
  });

  it('жаловаться не на что — warn пуст', () => {
    expect(assaultPlan([стоит('a'), летит('b')]).warn).toBe(null);
  });

  it('летящий с десантом не повод для жалобы', () => {
    expect(assaultPlan([летит('a', false)]).warn).toBe(null);
  });
});

describe('место жалобы в журнале', () => {
  it('ЖАЛОБА ВСТАЁТ ПЕРЕД СВОИМ ФЛОТОМ, а не в начало пачки', () => {
    const plan = assaultPlan([летит('a'), летит('b', true), летит('c', true)]);
    expect(plan.warnAt).toBe(1); // перед шагом флота «b»
  });

  it('жалобы нет — и места у неё нет', () => {
    expect(assaultPlan([летит('a')]).warnAt).toBe(null);
  });

  it('жалуется первый же флот — жалоба идёт перед всем', () => {
    expect(assaultPlan([стоит('a', 'E_FORBIDDEN'), стоит('b')]).warnAt).toBe(0);
  });
});

describe('пустая группа', () => {
  it('ни шагов, ни жалоб', () => {
    expect(assaultPlan([])).toEqual({ steps: [], warn: null, warnAt: null });
  });
});
