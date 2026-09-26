import { describe, expect, it } from 'vitest';
import { shippedGameData } from '../data/bundle';
import {
  changeSectorZeroProgress,
  freshSectorZeroProgress,
  type SectorProgressAction,
  type SectorZeroProgress,
} from './sectorZeroProgress';
import { upgradeFx } from './upgradeFx';

const data = shippedGameData();
const rich = (over: Partial<SectorZeroProgress> = {}): SectorZeroProgress => ({
  ...freshSectorZeroProgress(data, 'profile-7'),
  warrants: 99999,
  research: 999,
  moduleRarity: { cargo_bay: 'legendary' },
  ...over,
});
/** Действие через настоящий редуктор профиля — отклик сверяется с тем, что игрок получит. */
function fxOf(p: SectorZeroProgress, action: SectorProgressAction) {
  const next = changeSectorZeroProgress(p, action, data);
  expect(next).not.toBeNull();
  return { next: next!, fx: upgradeFx(action, p, next!, data) };
}

describe('upgradeFx — что отметить после улучшения', () => {
  it('звезда модуля: отмечается модуль и его НОВАЯ звезда', () => {
    expect(fxOf(rich(), { kind: 'forge', id: 'cargo_bay' }).fx).toEqual({ kind: 'star', id: 'cargo_bay', star: 1 });
  });

  it('промах кузни — свой отклик, а не тишина и не «звезда»', () => {
    // Высокие ступени бросают кость: гоняем попытки, пока не выпадут оба исхода.
    let p = rich({ stars: { cargo_bay: data.sectorZeroStars.cap - 1 } });
    const seen = new Set<string>();
    for (let i = 0; i < 40 && seen.size < 2; i++) {
      const { next, fx } = fxOf(p, { kind: 'forge', id: 'cargo_bay' });
      const won = (next.stars.cargo_bay ?? 0) > (p.stars.cargo_bay ?? 0);
      expect(fx).toEqual(won ? { kind: 'star', id: 'cargo_bay', star: next.stars.cargo_bay } : { kind: 'miss', id: 'cargo_bay' });
      seen.add(fx!.kind);
      // Удача упирается в потолок — откатываем звезду, чтобы бросать дальше.
      p = { ...next, stars: p.stars };
    }
    expect([...seen].sort()).toEqual(['miss', 'star']);
  });

  it('подъём редкости называет новую ступень', () => {
    const p = rich({ moduleRarity: {}, blueprints: { unique: 1 }, moduleCopies: { cargo_bay: 3 } });
    expect(fxOf(p, { kind: 'raise-rarity', id: 'cargo_bay' }).fx).toEqual({ kind: 'rarity', id: 'cargo_bay', rarity: 'unique' });
  });

  it('звезда корабля отмечает купленный слот на своём корпусе', () => {
    expect(fxOf(rich(), { kind: 'hull-star', hull: 'cruiser', slot: 'defense' }).fx).toEqual({
      kind: 'slot',
      hull: 'cruiser',
      slot: 'defense',
    });
  });

  it('звезда героя отмечает героя и номер звезды', () => {
    const p = rich({ heroTokens: { commander: 99 } });
    const star = (p.heroes.commander?.level ?? 0) + 1;
    expect(fxOf(p, { kind: 'upgrade-hero', id: 'commander' }).fx).toEqual({ kind: 'hero-star', id: 'commander', star });
  });

  it('действия без улучшения отклика не получают', () => {
    expect(fxOf(rich(), { kind: 'fit', hull: 'cruiser', id: 'cargo_bay' }).fx).toBeNull();
    const p = rich();
    expect(upgradeFx({ kind: 'forge', id: 'cargo_bay' }, p, p, data)).toBeNull();
  });
});
