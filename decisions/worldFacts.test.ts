import { describe, expect, it } from 'vitest';
import { worldFacts, type WorldFactsInput } from './worldFacts';

const base: WorldFactsInput = {
  mine: true,
  capital: false,
  blackout: false,
  bonuses: {},
  mitigation: 0,
  baseOutput: {},
};
const kinds = (i: Partial<WorldFactsInput>) => worldFacts({ ...base, ...i }).map((f) => f.kind);

describe('шапка мира — какие факты и в каком порядке', () => {
  it('пустой мир без свойств — без фишек: ноль не показывается', () => {
    expect(worldFacts(base)).toEqual([]);
    expect(kinds({ baseOutput: { metal: 0, food: 0 } })).toEqual([]);
  });

  it('состояние первым, потом свойства, в конце выход', () => {
    expect(
      kinds({
        capital: true,
        blackout: true,
        bonuses: { defense: 0.1 },
        mitigation: 0.15,
        baseOutput: { metal: 4 },
      }),
    ).toEqual(['capital', 'blackout', 'type', 'cover', 'output']);
  });

  it('обстрел — состояние мира: сразу за блэкаутом, и для чужого мира тоже (видимость решает хост)', () => {
    expect(kinds({ blackout: true, bombardAt: 90_000, mitigation: 0.1 })).toEqual(['blackout', 'bombard', 'cover']);
    expect(worldFacts({ ...base, mine: false, bombardAt: 0 })).toEqual([{ kind: 'bombard', at: 0 }]);
    expect(kinds({ bombardAt: null })).toEqual([]);
  });

  it('столица, блэкаут и лимит управления — только о своём мире', () => {
    expect(kinds({ mine: false, capital: true, blackout: true, uncontrolled: true })).toEqual([]);
  });

  it('планета вне лимита управления — состояние мира, сразу за блэкаутом (BAL-19)', () => {
    expect(kinds({ blackout: true, uncontrolled: true, bombardAt: 90_000 })).toEqual([
      'blackout',
      'uncontrolled',
      'bombard',
    ]);
  });

  it('освоение: своя планета — доля выхода, взятая у смотрящего — право отбить (BAL-19)', () => {
    const integration = { share: 0.4, until: 90_000, claimMine: false };
    expect(worldFacts({ ...base, uncontrolled: true, integration, bombardAt: 1 })).toEqual([
      { kind: 'uncontrolled' },
      { kind: 'integrating', share: 0.4 },
      { kind: 'bombard', at: 1 },
    ]);
    expect(kinds({ mine: false, integration })).toEqual([]);
    const lost = { ...integration, claimMine: true };
    expect(worldFacts({ ...base, mine: false, integration: lost })).toEqual([{ kind: 'reclaim', until: 90_000 }]);
    // Туман помнит мир своим, но его уже взяли: право отбить, а не доля выхода.
    expect(kinds({ integration: lost })).toEqual(['reclaim']);
    expect(kinds({ integration: null })).toEqual([]);
  });

  it('бонус типа несёт только ненулевые доли', () => {
    expect(worldFacts({ ...base, bonuses: { production: 0.45, defense: -0.25 } })).toEqual([
      { kind: 'type', production: 0.45, defense: -0.25 },
    ]);
    expect(worldFacts({ ...base, bonuses: { production: 0, defense: 0.1 } })).toEqual([
      { kind: 'type', defense: 0.1 },
    ]);
    expect(kinds({ bonuses: { production: 0, defense: 0 } })).toEqual([]);
  });

  it('выход перечисляет только то, что мир производит', () => {
    expect(worldFacts({ ...base, baseOutput: { metal: 4, credits: 0, food: 5, energy: 0 } })).toEqual([
      { kind: 'output', perHour: { metal: 4, food: 5 } },
    ]);
  });
});
