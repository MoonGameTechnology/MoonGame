import { describe, expect, it } from 'vitest';
import { openTab, pairOfChoices, parseTab, tabPick, tabsForSelection } from './worldFleetTabs';

// Мир w1 мой, у него стоит мой флот f1; w2 мой с двумя флотами f2, f3; w9 чужой с f9.
const parked: Record<string, string> = { f1: 'w1', f2: 'w2', f3: 'w2' };
const facts = {
  ownWorld: (id: string) => id === 'w1' || id === 'w2',
  parkedAt: (id: string) => parked[id] ?? null,
  ownFleetsAt: (w: string) => Object.keys(parked).filter((f) => parked[f] === w),
};

describe('свой мир со своим флотом — одна карточка с вкладками (UIX-7.1)', () => {
  it('свой мир и его единственный флот складываются в пару', () => {
    expect(
      pairOfChoices(
        [
          { kind: 'fleet', id: 'f1' },
          { kind: 'planet', id: 'w1' },
        ],
        facts,
      ),
    ).toEqual({ world: 'w1', fleet: 'f1' });
  });

  it('чужой мир, флот не у этого мира, лишний кандидат — пары нет, остаётся список', () => {
    expect(
      pairOfChoices(
        [
          { kind: 'fleet', id: 'f9' },
          { kind: 'planet', id: 'w9' },
        ],
        facts,
      ),
    ).toBeNull();
    expect(
      pairOfChoices(
        [
          { kind: 'fleet', id: 'f1' },
          { kind: 'planet', id: 'w2' },
        ],
        facts,
      ),
    ).toBeNull();
    expect(
      pairOfChoices(
        [
          { kind: 'fleet', id: 'f2' },
          { kind: 'fleet', id: 'f3' },
          { kind: 'planet', id: 'w2' },
        ],
        facts,
      ),
    ).toBeNull();
    expect(
      pairOfChoices(
        [
          { kind: 'strike', id: 's1' },
          { kind: 'fleet', id: 'f1' },
          { kind: 'planet', id: 'w1' },
        ],
        facts,
      ),
    ).toBeNull();
  });

  it('открыта вкладка прошлого раза, без памяти — «Флот»', () => {
    expect(openTab(null)).toBe('fleet');
    expect(openTab('world')).toBe('world');
    expect(tabPick({ world: 'w1', fleet: 'f1' }, 'world')).toEqual({ kind: 'planet', id: 'w1' });
    expect(tabPick({ world: 'w1', fleet: 'f1' }, 'fleet')).toEqual({ kind: 'fleet', id: 'f1' });
  });

  it('вкладки есть и у пары, выбранной напрямую — флотом или миром', () => {
    expect(tabsForSelection({ kind: 'fleet', id: 'f1' }, facts)).toEqual({
      pair: { world: 'w1', fleet: 'f1' },
      active: 'fleet',
    });
    expect(tabsForSelection({ kind: 'planet', id: 'w1' }, facts)).toEqual({
      pair: { world: 'w1', fleet: 'f1' },
      active: 'world',
    });
    expect(tabsForSelection({ kind: 'planet', id: 'w2' }, facts)).toBeNull();
    expect(tabsForSelection({ kind: 'fleet', id: 'f2' }, facts)).toBeNull();
    expect(tabsForSelection({ kind: 'planet', id: 'w9' }, facts)).toBeNull();
    expect(tabsForSelection({ kind: 'fleet', id: 'fx' }, facts)).toBeNull();
    expect(tabsForSelection(null, facts)).toBeNull();
  });

  it('память вкладки: мусор читается как «выбора не было»', () => {
    expect(parseTab('world')).toBe('world');
    expect(parseTab('fleet')).toBe('fleet');
    expect(parseTab('planet')).toBeNull();
    expect(parseTab(null)).toBeNull();
  });
});
