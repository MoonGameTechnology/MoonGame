import { describe, expect, it } from 'vitest';
import { shippedGameData } from '../data/bundle';
import { pveState } from '../packages/client/src/gameData';
import type { GameState } from '../packages/shared-core/src/index';
import {
  grantTokenHeroes,
  HERO_TOKENS_TO_JOIN,
  heroStarCost,
  heroTokenCount,
  heroTokenGoal,
  heroTokenUse,
  rollHeroTokens,
} from './heroTokens';
import {
  changeSectorZeroProgress,
  freshSectorZeroProgress,
  parseSectorZeroProgress,
  settleSectorZeroRun,
  type SectorZeroProgress,
} from './sectorZeroProgress';
import { shopRows, type ShopCapabilities } from './sectorZeroShop';

const data = shippedGameData();
const fresh = (over: Partial<SectorZeroProgress> = {}): SectorZeroProgress => ({
  ...freshSectorZeroProgress(data, 'tokens'),
  ...over,
});
const ALL: ShopCapabilities = { sovereigns: true, ads: true };

describe('жетоны героев', () => {
  it('звезда стоит 10 и 20 жетонов, ★3 — потолок', () => {
    expect(heroStarCost(1)).toBe(10);
    expect(heroStarCost(2)).toBe(20);
    expect(heroStarCost(3)).toBeNull();
  });

  it('жетоны нужны своему герою ниже потолка и герою, которого приводят только жетоны', () => {
    const p = fresh();
    expect(heroTokenUse(p, 'commander', data)).toBe('star');
    expect(heroTokenGoal(p, 'commander', data)).toBe(10);
    // Герой главы до своей главы жетонов не получает — придёт наградой (Авангард — глава II).
    expect(heroTokenUse(p, 'vanguard', data)).toBeNull();
    // Налётчика глава не приводит (с PVR-6.16 награда главы I — Учёный): его приводят жетоны.
    expect(heroTokenUse(p, 'ravager', data)).toBe('join');
    expect(heroTokenGoal(p, 'ravager', data)).toBe(HERO_TOKENS_TO_JOIN);
    const maxed = fresh({ heroes: { commander: { ...p.heroes.commander!, level: 3 } } });
    expect(heroTokenUse(maxed, 'commander', data)).toBeNull();
    expect(heroTokenUse(p, 'nobody', data)).toBeNull();
  });

  it('за забег: 1, +2 за победу, +1 за новую задачу', () => {
    expect(heroTokenCount(false, 0)).toBe(1);
    expect(heroTokenCount(true, 2)).toBe(5);
  });

  it('бросок детерминирован и отдаёт все жетоны одному нуждающемуся герою', () => {
    const p = fresh();
    const roll = (attempt: number) =>
      rollHeroTokens({
        seed: 's',
        attempt,
        outcome: 'world',
        progress: p,
        data,
        won: true,
        newTasks: 1,
      });
    expect(roll(3)).toEqual(roll(3));
    // AUD-26: исход мира входит в ключ — другой итог забега, другой бросок.
    const byOutcome = new Set(
      Array.from(
        { length: 40 },
        (_, i) =>
          Object.keys(
            rollHeroTokens({
              seed: 's',
              attempt: 1,
              outcome: `w${i}`,
              progress: p,
              data,
              won: true,
              newTasks: 1,
            }),
          )[0],
      ),
    );
    expect(byOutcome.size).toBe(2);
    const seen = new Set<string>();
    for (let attempt = 1; attempt <= 40; attempt++) {
      const got = Object.entries(roll(attempt));
      expect(got).toHaveLength(1);
      expect(got[0]![1]).toBe(4);
      seen.add(got[0]![0]);
    }
    // Герои глав ещё не пришли — жетоны делят командир и «жетонный» Налётчик.
    expect([...seen].sort()).toEqual(['commander', 'ravager']);
    const nobody = fresh({
      heroes: {
        commander: { ...p.heroes.commander!, level: 3 },
        ravager: { ...p.heroes.commander!, level: 3 },
      },
    });
    expect(
      rollHeroTokens({
        seed: 's',
        attempt: 1,
        outcome: 'world',
        progress: nobody,
        data,
        won: true,
        newTasks: 0,
      }),
    ).toEqual({});
  });

  it('10 жетонов приводят героя, остаток идёт в его звёзды', () => {
    const p = fresh({ heroTokens: { ravager: 12, commander: 3 } });
    const { progress, joined } = grantTokenHeroes(p, data);
    expect(joined).toEqual(['ravager']);
    expect(progress.heroes.ravager?.level).toBe(1);
    expect(progress.heroTokens).toEqual({ ravager: 2, commander: 3 });
    expect(grantTokenHeroes(fresh({ heroTokens: { ravager: 9 } }), data).joined).toEqual([]);
    // Герою главы жетоны не помогают прийти раньше главы.
    expect(grantTokenHeroes(fresh({ heroTokens: { vanguard: 40 } }), data).joined).toEqual([]);
  });

  it('звезда героя тратит жетоны, а не данные; без жетонов — отказ', () => {
    const p = fresh({ research: 99, heroTokens: { commander: 9 } });
    expect(changeSectorZeroProgress(p, { kind: 'upgrade-hero', id: 'commander' }, data)).toBeNull();
    const up = changeSectorZeroProgress(
      { ...p, heroTokens: { commander: 30 } },
      { kind: 'upgrade-hero', id: 'commander' },
      data,
    )!;
    expect(up.heroes.commander!.level).toBe(2);
    expect(up.research).toBe(99);
    expect(up.heroTokens.commander).toBe(20);
    const top = changeSectorZeroProgress(up, { kind: 'upgrade-hero', id: 'commander' }, data)!;
    expect(top.heroes.commander!.level).toBe(3);
    expect(top.heroTokens.commander).toBeUndefined();
    expect(
      changeSectorZeroProgress(
        { ...top, heroTokens: { commander: 99 } },
        { kind: 'upgrade-hero', id: 'commander' },
        data,
      ),
    ).toBeNull();
  });

  it('итог забега кладёт жетоны в профиль и в строку итогов', () => {
    const s: GameState = pveState(data, 0);
    s.pve = { waveNumber: 4, totalWaves: 10, npcPlayerId: 'p3' };
    s.match.status = 'ended';
    s.match.winner = 'p1';
    const p = fresh({ nextAttempt: 2 });
    const settled = settleSectorZeroRun(p, 1, s, undefined, data);
    // Победа без задач: 1 + 2 — одному из нуждающихся (командир или «жетонный» Налётчик).
    const loot = settled.lastRun?.loot?.heroTokens ?? {};
    const [who] = Object.keys(loot);
    expect(['commander', 'ravager']).toContain(who);
    expect(loot).toEqual({ [who!]: 3 });
    expect(settled.heroTokens).toEqual(loot);
    // Итог переживает перезагрузку вместе с жетонами.
    const back = parseSectorZeroProgress(JSON.stringify(settled), data);
    expect(back.heroTokens).toEqual(loot);
    expect(back.lastRun?.loot?.heroTokens).toEqual(loot);
  });

  it('профиль из хранилища отбрасывает мусорные и чужие жетоны', () => {
    const raw = JSON.stringify({
      ...fresh(),
      heroTokens: { commander: 4, ghost: 7, ravager: -2, warden: 1.5 },
    });
    expect(parseSectorZeroProgress(raw, data).heroTokens).toEqual({ commander: 4 });
  });

  it('магазин продаёт жетоны нуждающемуся герою; на потолке и до главы — нет', () => {
    const dayWith = (p: SectorZeroProgress, id: string): SectorZeroProgress => {
      for (let day = 0; day < 400; day++) {
        const on = { ...p, day };
        if (shopRows(on, data, ALL).some((r) => r.id === id)) return on;
      }
      throw new Error(`лот ${id} не выпал ни на одни сутки из 400`);
    };
    const p = dayWith(fresh({ sovereigns: 100, warrants: 1000 }), 'tokens_commander');
    const bought = changeSectorZeroProgress(
      p,
      { kind: 'buy', id: 'tokens_commander', pay: 'sovereigns' },
      data,
    )!;
    expect(bought.heroTokens.commander).toBe(5);
    expect(bought.sovereigns).toBe(75);
    const maxed = { ...p, heroes: { commander: { ...p.heroes.commander!, level: 3 } } };
    const rowMax = shopRows(maxed, data, ALL).find((r) => r.id === 'tokens_commander')!;
    expect(rowMax.prices.every((x) => x.reason === 'E_SHOP_OWNED')).toBe(true);
    expect(
      changeSectorZeroProgress(
        maxed,
        { kind: 'buy', id: 'tokens_commander', pay: 'warrants' },
        data,
      ),
    ).toBeNull();
    const q = dayWith(fresh({ sovereigns: 100 }), 'tokens_vanguard');
    const rowLocked = shopRows(q, data, ALL).find((r) => r.id === 'tokens_vanguard')!;
    expect(rowLocked.prices.every((x) => x.reason === 'E_SHOP_LOCKED')).toBe(true);
    expect(
      changeSectorZeroProgress(q, { kind: 'buy', id: 'tokens_vanguard', pay: 'sovereigns' }, data),
    ).toBeNull();
    // «Жетонному» Налётчику лот продаётся и до прихода: так его и приводят.
    const r = dayWith(fresh({ sovereigns: 100 }), 'tokens_ravager');
    expect(
      changeSectorZeroProgress(r, { kind: 'buy', id: 'tokens_ravager', pay: 'sovereigns' }, data)!
        .heroTokens.ravager,
    ).toBe(5);
  });
});
