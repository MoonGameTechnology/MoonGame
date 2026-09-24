import { describe, it, expect } from 'vitest';
import { shippedGameData } from '../data/bundle';
import { moduleLadder, nextRarity, profileRarity, raiseCheck, RARITY_COPIES } from './moduleRarity';
import { forgeLadderOf } from './sectorZeroProgress';

const data = shippedGameData();
const profile = (over: Record<string, unknown> = {}) => ({
  modules: ['cargo_bay', 'targeting_array'],
  moduleRarity: {},
  moduleCopies: {},
  blueprints: {},
  ...over,
});

describe('редкость модуля в профиле (SZE-5.2)', () => {
  it('лестница: простой → уникальный → мифический → легендарный, дальше некуда', () => {
    expect(nextRarity('simple')).toBe('unique');
    expect(nextRarity('mythic')).toBe('legendary');
    expect(nextRarity('legendary')).toBeNull();
  });

  it('без записи — базовая ступень из каталога; запись не ниже базовой', () => {
    expect(profileRarity(profile(), 'cargo_bay', data)).toBe('simple');
    expect(profileRarity(profile(), 'targeting_array', data)).toBe('unique');
    expect(
      profileRarity(profile({ moduleRarity: { cargo_bay: 'mythic' } }), 'cargo_bay', data),
    ).toBe('mythic');
    // «Поднятая» ниже базовой — мусор, остаётся базовая.
    expect(
      profileRarity(
        profile({ moduleRarity: { targeting_array: 'simple' } }),
        'targeting_array',
        data,
      ),
    ).toBe('unique');
  });

  it('нужен чертёж СЛЕДУЮЩЕЙ ступени и 3 дубля — и названо, чего не хватает', () => {
    expect(raiseCheck(profile(), 'cargo_bay', data).reason).toBe('E_NO_BLUEPRINT');
    expect(
      raiseCheck(
        profile({ blueprints: { mythic: 1 }, moduleCopies: { cargo_bay: 9 } }),
        'cargo_bay',
        data,
      ).reason,
    ).toBe('E_NO_BLUEPRINT'); // чертёж не той ступени
    expect(
      raiseCheck(
        profile({ blueprints: { unique: 1 }, moduleCopies: { cargo_bay: RARITY_COPIES - 1 } }),
        'cargo_bay',
        data,
      ).reason,
    ).toBe('E_NO_COPIES');
    const ok = raiseCheck(
      profile({ blueprints: { unique: 1 }, moduleCopies: { cargo_bay: RARITY_COPIES } }),
      'cargo_bay',
      data,
    );
    expect([ok.from, ok.to, ok.can]).toEqual(['simple', 'unique', true]);
  });

  it('закрытый модуль и вершина лестницы не поднимаются', () => {
    expect(raiseCheck(profile({ modules: [] }), 'cargo_bay', data).reason).toBe('E_RARITY_LOCKED');
    expect(
      raiseCheck(profile({ moduleRarity: { cargo_bay: 'legendary' } }), 'cargo_bay', data).reason,
    ).toBe('E_RARITY_TOP');
  });

  it('потолок звёзд — от редкости и не выше общего', () => {
    const ladder = forgeLadderOf(data);
    expect(moduleLadder(ladder, 'simple').cap).toBe(3);
    expect(moduleLadder(ladder, 'legendary').cap).toBe(ladder.cap);
    expect(moduleLadder({ ...ladder, capByRarity: { simple: 99 } }, 'simple').cap).toBe(ladder.cap);
    expect(moduleLadder({ ...ladder, capByRarity: {} }, 'simple').cap).toBe(ladder.cap);
  });
});
