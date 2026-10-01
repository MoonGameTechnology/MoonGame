import { describe, it, expect } from 'vitest';
import { shippedGameData } from '../data/bundle';
import {
  addLoot,
  BLUEPRINT_CHANCE,
  chapterBlueprint,
  lootShare,
  moduleLadder,
  nextRarity,
  profileRarity,
  raiseCheck,
  rarityOffered,
  RARITY_COPIES,
  runLoot,
} from './moduleRarity';
import { forgeLadderOf } from './sectorZeroProgress';

const data = shippedGameData();
const profile = (over: Record<string, unknown> = {}) => ({
  modules: ['cargo_bay', 'targeting_array'],
  moduleRarity: {},
  moduleCopies: {},
  blueprints: {},
  ...over,
});

describe('когда карточка модуля предлагает поднять редкость (решение владельца 2026-09-25)', () => {
  // Мастерская переехала в «Корабли»: блок редкости встаёт только тогда, когда для неё есть
  // чертёж следующей ступени, — иначе в каждой карточке висело бы «Чертёж 0/1» без пути.
  it('без чертежа следующей ступени — не предлагает', () => {
    expect(rarityOffered(profile(), 'cargo_bay', data)).toBe(false);
    expect(rarityOffered(profile({ blueprints: { mythic: 1 } }), 'cargo_bay', data)).toBe(false);
  });

  it('с чертежом — предлагает, даже если дублей пока не хватает: видно, что копить', () => {
    expect(rarityOffered(profile({ blueprints: { unique: 1 } }), 'cargo_bay', data)).toBe(true);
  });

  it('закрытый модуль и вершина лестницы — не предлагает', () => {
    expect(
      rarityOffered(profile({ modules: [], blueprints: { unique: 1 } }), 'cargo_bay', data),
    ).toBe(false);
    expect(
      rarityOffered(
        profile({
          moduleRarity: { cargo_bay: 'legendary' },
          blueprints: { unique: 1, mythic: 1, legendary: 1 },
        }),
        'cargo_bay',
        data,
      ),
    ).toBe(false);
  });
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

describe('добыча забега: дубли и чертежи (SZE-5.3)', () => {
  const base = {
    seed: 's',
    attempt: 1,
    modules: ['cargo_bay', 'ion_engine'],
    won: false,
    newTasks: 0,
    firstWinBlueprint: null,
    outcome: 'world',
  };
  const total = (r: Record<string, number>): number => Object.values(r).reduce((a, b) => a + b, 0);

  it('дубли: 1 за забег, +1 за победу, +1 за каждую новую задачу — и только открытых модулей', () => {
    expect(total(runLoot(base).copies)).toBe(1);
    expect(total(runLoot({ ...base, won: true, newTasks: 2 }).copies)).toBe(4);
    for (const id of Object.keys(runLoot({ ...base, won: true, newTasks: 5 }).copies))
      expect(base.modules).toContain(id);
    expect(runLoot({ ...base, modules: [] }).copies).toEqual({});
  });

  it('бросок детерминирован: тот же забег — та же добыча, другой — своя', () => {
    expect(runLoot(base)).toEqual(runLoot(base));
    const tries = Array.from({ length: 40 }, (_, i) =>
      JSON.stringify(runLoot({ ...base, attempt: i + 1 })),
    );
    expect(new Set(tries).size).toBeGreaterThan(1);
  });

  it('НОМЕР ПОПЫТКИ БРОСОК НЕ ВЫБИРАЕТ (AUD-26): при том же номере решает исход забега', () => {
    // Сид лежит в профиле открытым текстом, хеш — в бандле. Ключуйся бросок только номером
    // попытки, игрок посчитал бы удачный номер заранее и промотал бы до него попытки через
    // «Новый забег → Заменить». Исход забега до его конца не знает никто.
    const rolls = new Set(
      Array.from({ length: 60 }, (_, i) =>
        JSON.stringify(runLoot({ ...base, won: true, outcome: `world-${i}` })),
      ),
    );
    expect(rolls.size).toBeGreaterThan(1);
  });

  it('первая победа в главе даёт чертёж ГАРАНТИРОВАННО, ступень растёт к эпицентру', () => {
    expect([chapterBlueprint(0), chapterBlueprint(1), chapterBlueprint(4)]).toEqual([
      'unique',
      'mythic',
      'legendary',
    ]);
    expect(chapterBlueprint(-1)).toBeNull();
    const loot = runLoot({ ...base, won: true, firstWinBlueprint: 'mythic' });
    expect(loot.blueprints.mythic ?? 0).toBeGreaterThanOrEqual(1);
  });

  it('случайный чертёж — редкость: за победу чаще, чем за поражение', () => {
    const rate = (won: boolean): number =>
      Array.from({ length: 2000 }, (_, i) => runLoot({ ...base, won, attempt: i + 1 })).filter(
        (l) => total(l.blueprints) > 0,
      ).length / 2000;
    expect(rate(true)).toBeGreaterThan(rate(false));
    expect(Math.abs(rate(true) - BLUEPRINT_CHANCE.won)).toBeLessThan(0.05);
    expect(Math.abs(rate(false) - BLUEPRINT_CHANCE.lost)).toBeLessThan(0.04);
  });

  it('сданный раньше конца забег: дубль «за забег» и шанс чертежа — по доле волн (2026-09-28)', () => {
    // Баг-репорт владельца: сдача через секунду платила, а после фикса — сдача сразу после
    // первой волны. Целый дубль за любой забег делал десять забегов по волне в десять раз
    // выгоднее одного на десять волн. По доле ожидаемая добыча за волну одна и та же.
    const runs = (share: number | undefined) =>
      Array.from({ length: 2000 }, (_, i) => runLoot({ ...base, share, outcome: `w${i}` }));
    const copyRate = (share: number | undefined): number =>
      runs(share).filter((l) => total(l.copies) > 0).length / 2000;
    const blueprintRate = (share: number | undefined): number =>
      runs(share).filter((l) => total(l.blueprints) > 0).length / 2000;
    expect(copyRate(undefined)).toBe(1); // не передана — весь забег, как раньше
    expect(copyRate(1)).toBe(1);
    expect(copyRate(0)).toBe(0);
    expect(Math.abs(copyRate(0.1) - 0.1)).toBeLessThan(0.02);
    expect(Math.abs(copyRate(0.4) - 0.4)).toBeLessThan(0.03);
    expect(blueprintRate(0)).toBe(0);
    expect(blueprintRate(0.5)).toBeLessThan(blueprintRate(1));
    // Мусор в доле не платит; больше единицы — не больше целого забега.
    expect(copyRate(Number.NaN)).toBe(0);
    expect(copyRate(-1)).toBe(0);
    expect(copyRate(7)).toBe(1);
    expect(lootShare(Number.POSITIVE_INFINITY)).toBe(0);
    // Победа платит за себя сама: её дубль от доли не зависит.
    expect(total(runLoot({ ...base, won: true, share: 0 }).copies)).toBe(1);
  });

  it('добыча складывается в счётчики, входы не меняются', () => {
    const p = { moduleCopies: { cargo_bay: 1 }, blueprints: { unique: 1 } };
    const out = addLoot(p, {
      copies: { cargo_bay: 2, ion_engine: 1 },
      blueprints: { unique: 1, mythic: 1 },
    });
    expect(out).toEqual({
      moduleCopies: { cargo_bay: 3, ion_engine: 1 },
      blueprints: { unique: 2, mythic: 1 },
    });
    expect(p).toEqual({ moduleCopies: { cargo_bay: 1 }, blueprints: { unique: 1 } });
  });
});
