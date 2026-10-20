import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { shippedGameData } from '../data/bundle';
import type { ArsenalItem } from '../packages/shared-core/src/index';
import type {
  MetaDropOddsView,
  MetaRecipeView,
  MetaSeasonView,
} from '../packages/protocol/src/metaEconomyView';
import {
  arsenalCatalog,
  canSell,
  copiesOf,
  defaultModule,
  dropOdds,
  fitsOf,
  hullBays,
  hullCarries,
  hullGroups,
  isLastCopy,
  modulesFor,
  percent,
  recipeProgress,
  seasonWays,
  shopOffersFor,
  type StarterEntry,
} from './arsenalView';

const data = shippedGameData();
const starter = JSON.parse(
  readFileSync(new URL('../data/starterArsenal.json', import.meta.url), 'utf8'),
) as StarterEntry[];
const drops = JSON.parse(
  readFileSync(new URL('../data/dropTables.json', import.meta.url), 'utf8'),
) as MetaDropOddsView;

const item = (over: Partial<ArsenalItem> & Pick<ArsenalItem, 'itemId' | 'defId'>): ArsenalItem => ({
  kind: 'module',
  form: 'blueprint',
  soulbound: false,
  origin: 'drop',
  acquiredAt: 1,
  ...over,
});

describe('arsenalView — каталог', () => {
  const { hulls, modules } = arsenalCatalog({ starter, items: [], data });

  it('корабли — стартовый набор аккаунта, в его порядке', () => {
    expect(hulls).toEqual(starter.filter((s) => s.kind === 'hull').map((s) => s.defId));
  });

  it('модули — все, что несут корабли игрока или флагман; крепостные и роевые — нет', () => {
    expect(modules).toEqual(
      expect.arrayContaining(['targeting_array', 'rocket_mine_layer', 'mine_layer']),
    );
    for (const s of starter.filter((s) => s.kind === 'module')) expect(modules).toContain(s.defId);
    for (const id of [
      'void_shield_i',
      'swarm_brood_chamber',
      'leviathan_brood',
      'swarm_intercept_veil',
    ])
      expect(modules).not.toContain(id);
  });

  it('модуль из каждой награды сервера уже в каталоге', () => {
    for (const line of drops.pool.filter((l) => l.kind === 'module'))
      expect(modules, line.defId).toContain(line.defId);
  });

  it('модуль в коллекции попадает в каталог, даже если ни один корабль игрока его не несёт', () => {
    const owned = arsenalCatalog({
      starter,
      items: [item({ itemId: 'v', defId: 'void_shield_i' })],
      data,
    });
    expect(owned.modules).toContain('void_shield_i');
  });

  it('предмет, которого нет в данных клиента, не показывается', () => {
    const extra = arsenalCatalog({
      starter,
      items: [
        item({ itemId: 'x', defId: 'laser' }),
        item({ itemId: 'h', defId: 'ghost', kind: 'hull' }),
      ],
      data,
    });
    expect(extra.modules).not.toContain('laser');
    expect(extra.hulls).not.toContain('ghost');
  });
});

describe('arsenalView — совместимость', () => {
  it('модуль встаёт по правилу allowed и отсеку своего типа', () => {
    expect(hullCarries('cruiser', 'targeting_array', data)).toBe(true);
    expect(hullCarries('frigate', 'targeting_array', data)).toBe(false); // нет отсека оружия
    expect(hullCarries('scout', 'cargo_bay', data)).toBe(false); // разведчику грузовой отсек запрещён
    expect(hullCarries('frigate', 'siege_platform', data)).toBe(false); // только крейсерам
  });

  it('универсальный отсек берёт модуль любого типа', () => {
    expect(hullCarries('heavy_cruiser', 'targeting_array', data)).toBe(true);
    expect(hullCarries('heavy_cruiser', 'cargo_bay', data)).toBe(true);
  });

  it('ракетная мина — только на флагман', () => {
    const { hulls } = arsenalCatalog({ starter, items: [], data });
    expect(fitsOf('rocket_mine_layer', hulls, data)).toEqual({ hulls: [], flagship: true });
    expect(fitsOf('siege_platform', hulls, data)).toEqual({
      hulls: ['cruiser', 'heavy_cruiser'],
      flagship: false,
    });
  });

  it('модули корабля — в порядке каталога, без чужих', () => {
    expect(modulesFor('scout', ['cargo_bay', 'compact_radar', 'radar_module'], data)).toEqual([
      'compact_radar',
    ]);
  });
});

describe('arsenalView — группы', () => {
  it('отсеки корабля по типам, универсальные последними, пустые не показываются', () => {
    expect(hullBays('cruiser', data)).toEqual([
      { slot: 'weapon', count: 1 },
      { slot: 'defense', count: 1 },
      { slot: 'utility', count: 1 },
    ]);
    expect(hullBays('heavy_cruiser', data)).toEqual([{ slot: 'universal', count: 4 }]);
    expect(hullBays('landing_shuttle', data)).toEqual([]);
    expect(hullBays('ghost', data)).toEqual([]);
  });

  it('корабли по вкладкам «Производства», пустая группа не показывается', () => {
    expect(hullGroups(['cruiser', 'scout', 'bomber'], data)).toEqual([
      { group: 'line', ids: ['cruiser'] },
      { group: 'support', ids: ['scout'] },
      { group: 'shuttles', ids: ['bomber'] },
    ]);
    expect(hullGroups(['cruiser'], data).map((g) => g.group)).toEqual(['line']);
  });
});

describe('arsenalView — копии', () => {
  const st = item({
    itemId: 's',
    defId: 'cargo_bay',
    origin: 'starter',
    soulbound: true,
    acquiredAt: 0,
  });
  const a = item({ itemId: 'a', defId: 'targeting_array', acquiredAt: 5 });
  const b = item({ itemId: 'b', defId: 'targeting_array', acquiredAt: 9 });

  it('копии сведены по defId, свежая первой', () => {
    expect(copiesOf([a, st, b], 'targeting_array').map((i) => i.itemId)).toEqual(['b', 'a']);
  });

  it('продаётся то же, что берёт аукцион', () => {
    expect(canSell(a)).toBe(true);
    expect(canSell(st)).toBe(false);
    expect(canSell({ ...a, soulbound: true })).toBe(false);
    expect(canSell({ ...a, origin: 'rent' })).toBe(false);
  });

  it('последняя копия — когда других копий этого defId нет', () => {
    expect(isLastCopy([a, b], a)).toBe(false);
    expect(isLastCopy([a, st], a)).toBe(true);
  });
});

describe('arsenalView — мастерская', () => {
  const recipe: MetaRecipeView = {
    id: 'tractor_beam',
    defId: 'tractor_beam',
    ingredients: [
      { materialId: 'ferroalloys', required: 15, tradable: 17, soulbound: 5 },
      { materialId: 'control_circuits', required: 20, tradable: 13, soulbound: 0 },
    ],
    canCraft: false,
    requiresSoulbound: false,
    salvage: [],
  };

  it('в сумму идёт не больше нужного, нехватка — по каждому материалу', () => {
    expect(recipeProgress(recipe)).toEqual({
      got: 28,
      need: 35,
      ready: false,
      short: [{ materialId: 'control_circuits', missing: 7 }],
    });
  });

  it('разрешение собирать — ответ сервера, а не пересчёт', () => {
    expect(recipeProgress({ ...recipe, canCraft: true }).ready).toBe(true);
  });

  it('процент не уходит за 100 и не делит на ноль', () => {
    expect(percent(28, 35)).toBe(80);
    expect(percent(50, 35)).toBe(100);
    expect(percent(3, 0)).toBe(0);
  });
});

describe('arsenalView — шансы награды', () => {
  it('доля модуля и шанс по местам — из таблицы сервера', () => {
    const odds = dropOdds(drops, 'targeting_array');
    const total = drops.pool.reduce((s, l) => s + l.weight, 0);
    const own = drops.pool.find((l) => l.defId === 'targeting_array')!.weight;
    expect(odds.share).toBe(Math.round((own / total) * 100));
    expect(odds.places).toEqual([
      { from: 1, to: 1, chance: 60 },
      { from: 2, to: 3, chance: 35 },
      { from: 4, to: null, chance: 20 },
    ]);
    expect(odds.dryRun).toBe(drops.pityAfter - 1);
  });

  it('модуля нет в пуле — доли нет; гарантии с первой партии — нет и строки про серию', () => {
    expect(dropOdds(drops, 'cargo_bay').share).toBeNull();
    expect(dropOdds({ ...drops, pityAfter: 1 }, 'cargo_bay').dryRun).toBeNull();
  });

  it('последняя строка с узким потолком — это диапазон, а не «остальные»', () => {
    const odds = dropOdds({ ...drops, byPlace: [{ maxPlace: 8, chance: 0.5 }] }, 'x');
    expect(odds.places).toEqual([{ from: 1, to: 8, chance: 50 }]);
  });
});

describe('arsenalView — сезон и магазин', () => {
  const season = (over: Partial<MetaSeasonView> = {}): MetaSeasonView => ({
    id: 'frontier',
    nameKey: 'meta.season.frontier_fleet',
    startsAt: 0,
    endsAt: 1,
    levels: 50,
    xpPerLevel: 200,
    xp: 0,
    level: 7,
    premium: false,
    active: true,
    started: true,
    archived: false,
    contracts: [],
    milestones: [
      {
        level: 10,
        free: 'a',
        premium: 'b',
        freeClaimed: false,
        premiumClaimed: false,
        choices: ['mine_layer', 'targeting_array'],
      },
      {
        level: 30,
        free: 'c',
        premium: 'd',
        freeClaimed: false,
        premiumClaimed: false,
        choices: [],
        module: 'repair_tender',
      },
    ],
    ...over,
  });

  it('уровень с выбором и уровень с самим модулем', () => {
    expect(seasonWays([season()], 'targeting_array')).toEqual([
      {
        seasonId: 'frontier',
        nameKey: 'meta.season.frontier_fleet',
        level: 10,
        current: 7,
        levels: 50,
        choices: 2,
        claimable: false,
      },
    ]);
    expect(seasonWays([season({ level: 31 })], 'repair_tender')[0]).toMatchObject({
      level: 30,
      choices: 1,
      claimable: true,
    });
  });

  it('забранная награда и закончившийся сезон без уровня — не способ получить', () => {
    const claimed = season();
    claimed.milestones[0]!.freeClaimed = true;
    expect(seasonWays([claimed], 'targeting_array')).toEqual([]);
    expect(seasonWays([season({ archived: true })], 'targeting_array')).toEqual([]);
    expect(seasonWays([season({ archived: true, level: 12 })], 'targeting_array')).toHaveLength(1);
  });

  it('магазин — предложения с этим модулем', () => {
    const offer = {
      productId: 'module_shield_booster',
      catalogVersion: 'v',
      source: 'payment' as const,
      nameKey: 'n',
      contentsKey: 'c',
      contents: { moduleId: 'shield_booster', soulbound: true as const },
      available: false,
    };
    expect(shopOffersFor([offer], 'shield_booster')).toEqual([offer]);
    expect(shopOffersFor([offer], 'tractor_beam')).toEqual([]);
  });
});

describe('arsenalView — что открыть сначала', () => {
  const owned = [item({ itemId: 'a', defId: 'cargo_bay' })];
  it('цель мастерской, иначе первый недостающий, иначе первый', () => {
    expect(defaultModule(['cargo_bay', 'tractor_beam'], owned, 'tractor_beam')).toBe(
      'tractor_beam',
    );
    expect(defaultModule(['cargo_bay', 'mine_layer', 'tractor_beam'], owned, null)).toBe(
      'mine_layer',
    );
    expect(defaultModule(['cargo_bay'], owned, 'gone')).toBe('cargo_bay');
    expect(defaultModule([], owned, null)).toBeUndefined();
  });
});
