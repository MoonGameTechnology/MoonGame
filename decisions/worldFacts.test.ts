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

  it('столица и блэкаут — только о своём мире', () => {
    expect(kinds({ mine: false, capital: true, blackout: true })).toEqual([]);
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
