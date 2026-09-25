import { describe, it, expect } from 'vitest';

import { sumUnitStat, planRoute, playablePlayerIds, type Planet } from '@void/shared-core';

import { shippedGameData } from '../../../data/bundle';
import { pveState, pveModeId, pveMissionOfMap, pveMissionIndex, PVE_MISSION_COUNT, skirmishState } from './gameData';

/**
 * The client's doors into a playable state. Both were uncovered, and the PvE one was
 * shut: `pve-1.json` shipped four criss-crossing lanes, so `buildStateFromMap` threw
 * `E_INVALID_MAP` and the prototype's "🤖 PvE" button died without a word (PVR-0.1).
 * A door nobody opens in tests is a door that closes silently.
 */
const data = shippedGameData();

describe('pveState — the PvE door', () => {
  it('builds a state from the shipped PvE map', () => {
    const state = pveState(data);
    expect(Object.keys(state.planets).sort()).toEqual([
      'cluster',
      'cove',
      'drift',
      'ford',
      'hive',
      'home_a',
      'home_b',
      'pirate_den',
      'ridge',
      'shear',
      'shoal',
      'veil',
    ]);
    // Двенадцать провинций и НИ ОДНОГО пустого путевого узла: соседство выводится из
    // мозаики (M4.3), а точке схода линий в мозаике места нет — клетки у неё быть
    // не может, значит и границы тоже (§0 роадмапа карты).
    expect(state.planets.home_a!.owner).toBe('p1'); // the human seat
    expect(state.planets.hive!.owner).toBe('p3');
    expect(state.players.p3!.faction).toBe('swarm');
    expect(state.fleets.p1_1!.location).toBe('home_a');
  });

  it('keeps two contenders: the player and the Swarm; pirates are map inhabitants', () => {
    // Карта возила ВТОРОЕ человеческое место `p2`, а `startPvEMatch()` сажает бота на
    // всё, кроме `p1` — то есть забег за игрока играл союзный бот: он занимал середину
    // к 30-му часу и принимал на себя весь штурм. Забег по решению владельца
    // ОДИНОЧНЫЙ (§0.1/§0.3), поэтому мест ровно два.
    const state = pveState(data);
    expect(playablePlayerIds(state).sort()).toEqual(['p1', 'p3']);
    // `home_b` осталась на карте, но НИЧЬЯ: это компактная зона развития сбоку, за
    // которую игрок платит десантом, а не бесплатный второй дом.
    expect(state.planets.home_b!.owner).toBeNull();
    expect(state.planets.home_b!.garrison.length).toBeGreaterThan(0);
  });

  it('terrain, not coordinates, decides how many lanes a sector carries', () => {
    // MAP-LINK, теперь поверх мозаики (M4.3). Геометрия ПРЕДЛАГАЕТ каждую общую
    // границу, местность ЗАКРЫВАЕТ лишние: больше половины карты сидит ровно на своём
    // бюджете, и «эта провинция — тупик» остаётся фактом мира, а не следствием того,
    // куда автор поставил точки.
    const state = pveState(data);
    const planetOf = (id: string): Planet => {
      const p = state.planets[id];
      if (!p) throw new Error(`no such sector: ${id}`);
      return p;
    };
    // `Planet.links` is optional — a sector with none declared simply has degree 0.
    const degree = (id: string): number => (planetOf(id).links ?? []).length;
    const budget = (id: string): number => {
      const def = data.sectors[planetOf(id).terrain ?? ''];
      if (!def) throw new Error(`sector ${id} declares no known terrain`);
      return def.maxLinks;
    };
    for (const id of Object.keys(state.planets)) {
      expect([id, degree(id) <= budget(id)]).toEqual([id, true]);
    }
    // Seven sectors are AT their budget — the constraint is real, not decorative.
    const atBudget = Object.keys(state.planets)
      .filter((id) => degree(id) === budget(id))
      .sort();
    expect(atBudget).toEqual(['cluster', 'drift', 'ford', 'ridge', 'shear', 'shoal', 'veil']);
  });

  it('a border with no lane is SEALED, not absent — the mosaic never lies', () => {
    // Суть M4.3. Раньше «путей нет» означало, что общая граница молча обещала переход:
    // мозаику рисовали по координатам, а список путей писали руками, и это были два
    // графа. Теперь граф ОДИН — `links` и `sealed` вместе дают ровно все границы
    // клетки, и закрытая граница остаётся границей, которую видно как барьер.
    const state = pveState(data);
    // Печать всегда двусторонняя: дверь не бывает закрыта с одной стороны.
    for (const [id, p] of Object.entries(state.planets))
      for (const other of p.sealed ?? [])
        expect([id, other, state.planets[other]?.sealed ?? []]).toEqual([
          id,
          other,
          expect.arrayContaining([id]),
        ]);
    // И то, что закрыто, НЕ проходимо: печать — это не украшение поверх открытого пути.
    for (const [id, p] of Object.entries(state.planets))
      for (const other of p.sealed ?? []) expect([id, p.links ?? []]).toEqual([id, expect.not.arrayContaining([other])]);
    // Местность закрыла восемь границ этой карты, и каждая объяснима: скопление
    // впускает один подход, ионные штормы не смыкаются друг с другом и несут по два пути,
    // гнездо не режет напрямик в астероидную отмель; к пиратам ведёт только домашний
    // подход; туманный брод в центре ведёт к обоим домам, дрейфу и пелене, а к штормам
    // и отмели на юге прохода нет.
    const seals = Object.entries(state.planets)
      .flatMap(([id, p]) => (p.sealed ?? []).map((o) => (id < o ? `${id}|${o}` : `${o}|${id}`)))
      .filter((k, i, all) => all.indexOf(k) === i)
      .sort();
    expect(seals).toEqual([
      'cluster|drift',
      'cove|ridge',
      'drift|pirate_den',
      'ford|ridge',
      'ford|shear',
      'ford|shoal',
      'hive|shoal',
      'ridge|shear',
    ]);
  });

  it('the dense cluster sits INSIDE the asteroid massif but admits one approach', () => {
    // Owner's refinement (docs/map-terrain-regions-concept.md §5.3): dense core →
    // ordinary asteroid field around it → periphery → open space. The core is
    // geometrically surrounded — `drift` and `shoal` are both ordinary field next to
    // it — yet `asteroid_cluster` carries a single lane, so the one approach has a
    // connected surrounding instead of being a bare dead end (§11, criterion 3).
    const state = pveState(data);
    expect(state.planets.cluster!.links).toEqual(['shoal']);
    // Вторая его граница — с `drift` — существует и ЗАКРЫТА местностью: скопление
    // впускает один подход, и это видно на карте барьером, а не пустотой.
    expect(state.planets.cluster!.sealed).toEqual(['drift']);
    expect(data.sectors.asteroid_cluster!.maxLinks).toBe(1);
    for (const neighbour of ['drift', 'shoal'] as const) {
      expect(state.planets[neighbour]!.terrain).toBe('asteroid_field');
    }
    // It is worth taking: slow inside, but metal-rich — that is the price/prize pair.
    expect(data.sectors.asteroid_cluster!.speedBonus).toBeLessThan(0);
    expect(data.sectors.asteroid_cluster!.baseOutput.metal).toBeGreaterThan(0);
  });

  it('one corridor runs THROUGH the asteroid belt; sideways it is shut (MAP-TRANSIT)', () => {
    // Модель владельца: параллельные пути могут проходить СКВОЗЬ провинцию. Раньше это
    // держал пустой узел `crossing`; узлов больше нет, и транзит переехал туда, где ему
    // и место — на МЕСТНОСТЬ. Через пояс `drift` идёт один безопасный коридор со
    // стороны `home_a`: войдя с отмели, выйти можно только к дому, а поперёк пояса
    // (shoal ↔ ford) прохода нет.
    const state = pveState(data);
    expect(state.planets.drift!.transit).toEqual([
      ['home_a', 'shoal'],
      ['home_a', 'ford'],
    ]);
    // Обе стороны — соседи по мозаике, то есть транзит ограничивает НАСТОЯЩИЕ пути,
    // а не указывает в пустоту.
    expect(state.planets.drift!.links).toEqual(['ford', 'home_a', 'shoal']);
    // Поперечный срез действительно исчез, а не стал длиннее на шаг:
    expect(planRoute(state, 'shoal', 'veil')).toEqual(['drift', 'home_a', 'ford', 'veil']);
    // …и у Роя два разных подхода к двум домам — восточный через заводь и западный
    // через отмель, вместо одной общей спины через перекрёсток.
    expect(planRoute(state, 'hive', 'home_b')).toEqual(['cove', 'shear', 'veil', 'home_b']);
    expect(planRoute(state, 'hive', 'home_a')).toEqual(['ridge', 'shoal', 'drift', 'home_a']);
  });
});

describe('skirmishState — the single-player door', () => {
  it('builds a state from the shipped skirmish map', () => {
    expect(Object.keys(skirmishState(data).planets)).toHaveLength(5);
  });
});

describe('the shipped PvE scenario — the assault the player actually meets (PVR-1.3)', () => {
  const data = shippedGameData();
  const cfg = data.modes[pveModeId() ?? '']?.pve;

  /** Что режим выставляет на волне N: объявленный состав, взятый N раз. Это ТА ЖЕ
   *  арифметика, что в `pveModule`, повторённая здесь намеренно — тест держит КОНТЕНТ,
   *  а не код: сколько именно железа приедет к игроку по шипнутым числам. */
  const wave = (n: number) => (cfg?.waveFleet ?? []).map((s) => ({ unit: s.unit, count: s.count * n }));

  it('the PvE mode declares its own wave composition, not the Swarm player loadout', () => {
    // Рой — играбельная фракция, поэтому её `startingLoadout` балансируют под ИГРОКА.
    // Пока волна бралась оттуда, «усилить штурм» и «усилить фракцию» были одной ручкой.
    expect(cfg?.waveFleet).toBeDefined();
    expect(cfg?.waveFleet).not.toEqual(data.factions.swarm?.startingLoadout.fleet);
  });

  it('the last wave outguns the fleet the player opens with — by hull and by guns', () => {
    const opening = pveState(data).fleets.p1_1!.units;
    const last = wave(cfg!.waves);
    for (const stat of ['attack', 'hp']) {
      const player = sumUnitStat(opening, data, stat);
      expect([stat, sumUnitStat(last, data, stat) > player * 3]).toEqual([stat, true]);
    }
  });

  it('even wave 1 is a fight, not a formality', () => {
    // Нижняя граница тоже важна: волна, которую два стартовых крейсера снимают не
    // заметив, — это не «лёгкое начало», это отсутствующая механика.
    const opening = pveState(data).fleets.p1_1!.units;
    expect(sumUnitStat(wave(1), data, 'hp')).toBeGreaterThan(
      sumUnitStat(opening, data, 'hp') * 0.5,
    );
  });

  it('the wave can cross the map: no hull slower than the player ships it hunts', () => {
    // 154 игровых часа до первого боя в прогоне PVR-1.5 — цена `scout_drone` со
    // скоростью 12: флот идёт по САМОМУ МЕДЛЕННОМУ корпусу. Волна, которая ползёт
    // дольше, чем длится забег, враждебна только на бумаге.
    const speeds = wave(1).map((s) => data.units[s.unit]!.stats.speed ?? 0);
    expect(speeds.length).toBeGreaterThan(0); // иначе Math.min пустого — Infinity, и проверка зелена ни на чём
    expect(Math.min(...speeds)).toBeGreaterThanOrEqual(40);
  });
});

describe('YAG-2.1 — мир забега знает свою главу', () => {
  // У глав один режим (`pve_waves`), поэтому главу отличает только карта. Без её id в мире
  // дескриптор забега не смог бы восстановить ту же главу.
  it('id карты едет в сам мир, у каждой главы — свой', () => {
    expect(pveState(data, 0).mapId).toBe('pve-1');
    expect(pveState(data, 1).mapId).toBe('pve-2');
    expect(pveModeId(0)).toBe(pveModeId(1));
  });

  it('глава находится по id карты и обратно', () => {
    expect(pveMissionOfMap(pveState(data, 1).mapId)).toBe(1);
    expect(pveMissionOfMap('pve-1')).toBe(0);
  });

  it('незнакомая карта или её отсутствие — null, а не первая глава', () => {
    expect(pveMissionOfMap('pve-99')).toBeNull();
    expect(pveMissionOfMap(undefined)).toBeNull();
  });
});

describe('AUD-32 — номер главы из хранилища один на карту и награду', () => {
  // Карта клампила чужой номер к первой главе, а чертёж за первую победу считался по
  // сырому номеру: «5» из правленого хранилища играло главу I, а платило легендарным
  // чертежом вместо уникального. Теперь номер приводится один раз и одним правилом.
  it('номер в диапазоне — он сам', () => {
    for (let i = 0; i < PVE_MISSION_COUNT; i++) expect(pveMissionIndex(i)).toBe(i);
  });

  it('вне диапазона, дробный и мусорный — первая глава, ровно как у карты', () => {
    for (const bad of [-1, PVE_MISSION_COUNT, 1e9, Number.NaN, Infinity]) {
      expect(pveMissionIndex(bad)).toBe(0);
      expect(pveState(data, bad).mapId).toBe(pveState(data, pveMissionIndex(bad)).mapId);
    }
    expect(pveMissionIndex(1.7)).toBe(Math.min(1, PVE_MISSION_COUNT - 1));
  });
});
