import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { mapForDifficulty, parseMatchMap, safeParseMatchMap } from './mapSchema';
import { validateMatchMap } from '../state/buildFromMap';
import { loadGameData } from './loadGameData';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../..');

function readMap(name: string): unknown {
  return JSON.parse(readFileSync(path.join(repoRoot, 'data', 'maps', name), 'utf8'));
}

describe('map schema (map-roadmap.md M1.1)', () => {
  it('parses the shipped example map and applies defaults', () => {
    const map = parseMatchMap(readMap('skirmish-1.json'));
    expect(map.id).toBe('skirmish-1');
    expect(Object.keys(map.sectors)).toContain('nexus');
    // Путей у неё больше НЕТ: пропущенный `paths` означает «вывести соседство из
    // мозаики» (M4.3) — общая граница и есть путь, и разойтись им теперь негде.
    expect(map.paths).toBeUndefined();
    // defaults: a sector with no owner → null; no kind → 'planet'; empty arrays
    expect(map.sectors.nexus!.owner).toBeNull();
    expect(map.sectors.nexus!.kind).toBe('nebula');
    expect(map.sectors.drift!.kind).toBe('asteroid');
    expect(map.sectors.home_green!.buildings.length).toBe(3);
    expect(map.sectors.veil!.garrison).toEqual([]);
    // building level defaults to 1
    expect(map.sectors.home_green!.buildings[0]!.level).toBe(1);
  });

  it('parses a slot-based AvA map — teams, decoupled from concrete players', () => {
    const map = parseMatchMap(readMap('ava-duel-1.json'));
    expect(Object.keys(map.players)).toEqual([]); // no baked-in players
    expect(map.slots.slot_a!.team).toBe('A');
    expect(map.slots.slot_b!.team).toBe('B');
    expect(map.sectors.home_a!.owner).toBe('slot_a'); // a sector owner names a slot
    expect(map.fleets.fleet_a!.owner).toBe('slot_a'); // a fleet owner too
    expect(map.slots.slot_a!.resources).toEqual({ credits: 300, metal: 300 });
  });

  it('defaults a slot spawn policy to fixed and rejects an unknown one', () => {
    const ok = safeParseMatchMap({
      id: 'x',
      seed: 'x',
      sectors: { a: { position: { x: 0, y: 0 } } },
      slots: { s: { team: 'A' } },
    });
    expect(ok.success).toBe(true);
    if (ok.success) expect(ok.data.slots.s!.spawn).toBe('fixed');
    const bad = safeParseMatchMap({
      id: 'x',
      seed: 'x',
      sectors: { a: { position: { x: 0, y: 0 } } },
      slots: { s: { team: 'A', spawn: 'teleport' } },
    });
    expect(bad.success).toBe(false);
  });

  it('rejects a malformed map (missing sectors)', () => {
    expect(safeParseMatchMap({ id: 'x', seed: 'x' }).success).toBe(false);
  });

  it('rejects a sector with a non-numeric position', () => {
    const bad = { id: 'x', seed: 'x', sectors: { a: { position: { x: 'NaN', y: 0 } } } };
    expect(safeParseMatchMap(bad).success).toBe(false);
  });

  it('rejects a garrison stack with a zero/negative count', () => {
    const bad = {
      id: 'x',
      seed: 'x',
      sectors: { a: { position: { x: 0, y: 0 }, garrison: [{ unit: 'militia', count: 0 }] } },
    };
    expect(safeParseMatchMap(bad).success).toBe(false);
  });
});

/**
 * A map's `kind` / `terrain` / `planetType` are free-form strings: an id the bundle does
 * not know does NOT fail the parse. It degrades — an unknown kind falls back to the
 * permissive defaults in `sectorKind.ts`, an unknown terrain simply carries no bonus. So
 * a typo ships as "this province quietly behaves like open space", which is exactly the
 * kind of defect no one notices. The map schema cannot check this (it has no catalogue);
 * this sweep can.
 */
describe('shipped maps resolve against the shipped catalogue', () => {
  const data = loadGameData((name) => JSON.parse(readFileSync(path.join(repoRoot, 'data', name), 'utf8')));
  const files = readdirSync(path.join(repoRoot, 'data', 'maps')).filter((f) => f.endsWith('.json'));

  it('there are shipped maps at all — otherwise the sweep below is green over nothing', () => {
    expect(files.length).toBeGreaterThan(0);
  });

  for (const file of files) {
    it(`${file}: every kind, terrain and planet type is in the bundle`, () => {
      const map = parseMatchMap(readMap(file));
      for (const [id, sec] of Object.entries(map.sectors)) {
        expect([id, sec.kind, sec.kind in data.sectorKinds]).toEqual([id, sec.kind, true]);
        if (sec.terrain !== undefined)
          expect([id, sec.terrain, sec.terrain in data.sectors]).toEqual([id, sec.terrain, true]);
        if (sec.planetType !== undefined)
          expect([id, sec.planetType, sec.planetType in data.planetTypes]).toEqual([id, sec.planetType, true]);
      }
    });
  }

  /** Catalogue entries nobody places are content that cannot be met in a canonical match.
   *  The shipped maps used to be three kinds and two terrains wide while the catalogue
   *  carried eight terrains; this pins the spread so a map edit cannot quietly narrow it
   *  back. Widening it is a deliberate edit of this list, which is the point. */
  it('the maps exercise the terrain catalogue, not just nebula and asteroid', () => {
    const kinds = new Set<string>();
    const terrains = new Set<string>();
    const emptyOn = new Set<string>();
    for (const file of files) {
      for (const sec of Object.values(parseMatchMap(readMap(file)).sectors)) {
        kinds.add(sec.kind);
        if (sec.kind === 'empty') emptyOn.add(file);
        if (sec.terrain !== undefined) terrains.add(sec.terrain);
      }
    }
    expect([...terrains].sort()).toEqual([
      'asteroid_cluster',
      'asteroid_field',
      // Втора́я глава Сектора Зеро (`pve-2`): глубокая пустота — под мёртвыми мирами
      // `deep_drift` и `drift_moon`. Прежде она лежала под клетками-перекрёстками, но
      // перекрёстки провинций не создают (решение владельца): узлом дорог теперь служит
      // мир, а просторная местность — шесть подходов — как раз то, что узлу нужно.
      'deep_void',
      'dense_nebula',
      'depleted_system',
      'derelict_graveyard',
      // M2.9: `dust_lane` — средняя ступень астероидной лестницы (поле 3 → полоса 2 →
      // скопление 1). На `pve-2` это `dust_reach` между полем `scree` и ионной
      // стеной: два подхода — ровно столько, сколько нужно звену восточного кольца.
      'dust_lane',
      'empty_space',
      'ion_storm',
      'nebula',
      'solar_flare_zone',
    ]);
    // Тестовая дуэльная карта (`duel-testbed`, заказ владельца 2026-09-25) выкладывает
    // каталог ЦЕЛИКОМ, поэтому набор видов на шипнутых картах теперь равен каталогу.
    // Впервые с неё пришли пять: `black_hole`, `debris_field`, `empty`, `neutral_base`,
    // `void_station`.
    expect([...kinds].sort()).toEqual([
      'asteroid',
      'asteroid_cluster',
      'black_hole',
      'dead_world',
      'debris_field',
      'dense_nebula',
      // Только «точки съёмки» тестовой карты — см. проверку ниже.
      'empty',
      'graveyard',
      'ion_storm',
      'nebula',
      'neutral_base',
      'pirate_base',
      'planet',
      // Третья глава (`pve-3`, «Карантинный рубеж»): пространственные разломы держат стену
      // между областями, и путь с севера на юг идёт только через три перехода. Разлом
      // непроходим (`traversable: false`) — это отсутствие пути, а не провинция.
      'rift',
      // M2.9: зона вспышек `flare_belt` на северном рукаве `pve-2`, между обломками
      // экспедиции и астероидным полем. Быстрая, но по живучести штрафная: пролететь
      // можно, драться там дорого.
      'solar_flare',
      // Учебный полигон (`training-1`, §14): передовой пост противника и наблюдательная
      // станция с маяком — орбитальные станции, место, а не узел-дорога.
      'void_station',
    ]);
    // `empty` на БОЕВЫХ картах НЕ стоит — решение владельца (22 сентября): «развилки не
    // создают отдельную провинцию, и перекрёстки тоже не обязательно должны создавать
    // провинцию». На `pve-2` было семь клеток `empty` — перекрёстки решётки, которые нельзя
    // присвоить и которые существовали только чтобы через них летали. Развилка получается
    // сама, там, где расходятся дороги (ROADS), а перекрёсток — это мир, где их сходится
    // пять и больше. Единственное исключение — тестовая карта (резолюция владельца
    // 2026-09-25): две «точки съёмки», чтобы на ней можно было развернуть станцию
    // (`station.deploy` требует клетку `empty`). Любая другая карта с `empty` — возврат
    // узла-дороги, от которого владелец отказался.
    expect([...emptyOn]).toEqual(['duel-testbed.json']);
  });
});

/**
 * PVR-6.32 — старт главы по сложности забега (решение владельца 2026-09-26): на обычном
 * Рое у игрока в главе I гарнизон дома 6 вместо 9 и +3 крейсера. Карта объявляет это
 * сама, блоком `difficultyStart`; `mapForDifficulty` заменяет им гарнизоны и флоты до
 * сборки мира.
 */
describe('старт главы по сложности (PVR-6.32)', () => {
  const data = loadGameData((name) => JSON.parse(readFileSync(path.join(repoRoot, 'data', name), 'utf8')));
  const count = (stacks: Array<{ count: number }>): number => stacks.reduce((n, u) => n + u.count, 0);

  it('глава I на обычном Рое: гарнизон дома 6 вместо 9, во втором флоте 5 крейсеров вместо 2', () => {
    const base = parseMatchMap(readMap('pve-1.json'));
    const weak = mapForDifficulty(base, 'weak');
    expect(count(base.sectors.home_a!.garrison)).toBe(9);
    expect(count(weak.sectors.home_a!.garrison)).toBe(6);
    expect(base.fleets.p1_2!.units).toEqual([{ unit: 'cruiser', count: 2 }]);
    expect(weak.fleets.p1_2!.units).toEqual([{ unit: 'cruiser', count: 5 }]);
    // Остальное — та же карта: первый флот, чужие флоты и прочие сектора не тронуты.
    expect(weak.fleets.p1_1).toEqual(base.fleets.p1_1);
    expect(weak.fleets.p3_1).toEqual(base.fleets.p3_1);
    expect(weak.sectors.hive).toEqual(base.sectors.hive);
  });

  it('матёрый Рой и забег без сложности играют базовый старт — ту же карту', () => {
    const base = parseMatchMap(readMap('pve-1.json'));
    expect(mapForDifficulty(base, 'strong')).toBe(base);
    expect(mapForDifficulty(base, undefined)).toBe(base);
    // Имя, совпавшее с полем прототипа, — не сложность: блока под него нет.
    expect(mapForDifficulty(base, 'constructor')).toBe(base);
  });

  it('карту на входе не мутирует', () => {
    const base = parseMatchMap(readMap('pve-1.json'));
    const before = JSON.stringify(base);
    mapForDifficulty(base, 'weak');
    expect(JSON.stringify(base)).toBe(before);
  });

  it('карта без блока получает пустой, а глава I проходит проверку целиком', () => {
    expect(parseMatchMap(readMap('skirmish-1.json')).difficultyStart).toEqual({});
    expect(validateMatchMap(parseMatchMap(readMap('pve-1.json')), data)).toEqual([]);
  });

  it('опечатка в блоке — ошибка карты, а не молча базовый старт', () => {
    const raw = readMap('pve-1.json') as Record<string, unknown>;
    const bad = parseMatchMap({
      ...raw,
      difficultyStart: {
        weak: {
          garrison: { home_x: [{ unit: 'militia', count: 1 }] },
          fleets: {
            p1_9: [{ unit: 'cruiser', count: 1 }],
            p1_2: [
              { unit: 'cruser', count: 1 },
              { unit: 'cruiser', count: 1, modules: ['no_such_module'] },
            ],
          },
        },
      },
    });
    const issues = validateMatchMap(bad, data);
    expect(issues).toContain('E_START_UNKNOWN_SECTOR:weak:home_x');
    expect(issues).toContain('E_START_UNKNOWN_FLEET:weak:p1_9');
    expect(issues).toContain('E_UNKNOWN_UNIT:cruser');
    expect(issues).toContain('E_MAP_LOADOUT:weak:cruiser:E_UNKNOWN_MODULE');
  });
});
