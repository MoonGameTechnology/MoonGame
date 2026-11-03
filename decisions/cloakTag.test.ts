import { describe, expect, it } from 'vitest';
import { parseGameData, type Fleet } from '../packages/shared-core/src/index';
import { cloakFacts } from './cloakTag';

const data = parseGameData({
  version: '0.1.0',
  resources: ['metal'],
  units: { hero: { faction: 'x', traits: ['hero'], stats: { attack: 4, defense: 4, speed: 6, hp: 60 }, slots: { utility: 1 } } },
  factions: {},
  buildings: {},
  events: {},
  modules: {
    cloak_field: { name: 'Cloak Field', rarity: 'legendary', slot: 'utility', tag: 'horizontal', effects: { stats: { cloak: 0.2 } } },
  },
});

function fleet(extra: Partial<Fleet> = {}, cloak = true): Fleet {
  const unit = cloak ? { unit: 'hero', count: 1, modules: ['cloak_field'] } : { unit: 'hero', count: 1 };
  return { id: 'f', owner: 'p1', location: 'A', movement: null, units: [unit], traits: [], ...extra };
}

describe('метка маскировочного поля (SM-4.3)', () => {
  const s = { time: 1000 };

  it('без поля метки нет', () => {
    expect(cloakFacts(s, fleet({}, false), data)).toBeUndefined();
  });

  it('работающее поле: сила в процентах, без таймера', () => {
    expect(cloakFacts(s, fleet(), data)).toEqual({ pct: 20, broken: false, brokenUntil: null });
  });

  it('после боя, залпа или вылета — таймер возврата', () => {
    expect(cloakFacts(s, fleet({ cloakBrokenUntil: 5000 }), data)).toEqual({ pct: 20, broken: true, brokenUntil: 5000 });
  });

  it('в бою и при обстреле срок неизвестен — только «сорвана»', () => {
    expect(cloakFacts(s, fleet({ battleId: 'b', cloakBrokenUntil: 5000 }), data)).toEqual({ pct: 20, broken: true, brokenUntil: null });
    expect(cloakFacts(s, fleet({ bombarding: true }), data)).toEqual({ pct: 20, broken: true, brokenUntil: null });
  });

  it('истёкшая отметка — поле снова работает', () => {
    expect(cloakFacts(s, fleet({ cloakBrokenUntil: 1000 }), data)).toEqual({ pct: 20, broken: false, brokenUntil: null });
  });
});
