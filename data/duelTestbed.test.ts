/**
 * ТЕСТОВАЯ ДУЭЛЬНАЯ КАРТА — «Колыбель у мёртвой звезды» (`data/maps/duel-testbed.json`,
 * генератор `scripts/generate-duel-testbed.py`).
 *
 * Заказ владельца 2026-09-25: карта 1×1 на 55–60 провинций, на которой есть ВСЕ области и
 * ВСЕ виды провинций, хаотично по областям, без зеркала. На ней проверяют сетевой матч 1×1
 * и вырабатывают взгляд на мапдизайн. Это витрина: честность сторон не держится
 * (резолюция владельца), поэтому здесь нет замеров баланса — только то, ради чего карта
 * существует. Соседство выводится из мозаики (M4.3): любая правка координат может молча
 * поменять проходы, и этот тест её поймает.
 */
import { describe, expect, it } from 'vitest';
import {
  avaShape,
  buildStateFromMap,
  matchMapEdges,
  parseMatchMap,
  validateMatchMap,
  type MatchMap,
} from '../packages/shared-core/src/index';
import { provinceKey } from '../decisions/provinceName';
import { ru } from '../localization/ru';
import { en } from '../localization/en';
import { shippedGameData } from './bundle';
import mapJson from './maps/duel-testbed.json';

const data = shippedGameData();
const map: MatchMap = parseMatchMap(mapJson);
const ids = Object.keys(map.sectors);
const state = buildStateFromMap(map, data, {
  slots: { slot_a: { playerId: 'a' }, slot_b: { playerId: 'b' } },
});
const roadsOf = (id: string): number => state.planets[id]!.links?.length ?? 0;
const pos = (id: string): { x: number; y: number } => map.sectors[id]!.position;
const dist = (a: string, b: string): number => Math.hypot(pos(a).x - pos(b).x, pos(a).y - pos(b).y);

describe('тестовая дуэльная карта — полнота', () => {
  it('проходит валидатор на шипнутом каталоге, соседство выводится из мозаики', () => {
    expect(validateMatchMap(map, data)).toEqual([]);
    expect(map.paths).toBeUndefined();
    expect(ids.length).toBeGreaterThanOrEqual(55);
    expect(ids.length).toBeLessThanOrEqual(60);
  });

  // Карта существует ради полноты: новая запись в каталоге без места здесь — это контент,
  // который нельзя встретить на тестовой карте. Тест падает, пока её сюда не поставят.
  it('на ней ВСЕ виды провинций, все среды и все типы миров каталога', () => {
    const has = (pick: (id: string) => string | undefined): Set<string> =>
      new Set(ids.map(pick).filter((v): v is string => v !== undefined));
    expect([...has((id) => map.sectors[id]!.kind)].sort()).toEqual(Object.keys(data.sectorKinds).sort());
    expect([...has((id) => map.sectors[id]!.terrain)].sort()).toEqual(Object.keys(data.sectors).sort());
    expect([...has((id) => map.sectors[id]!.planetType)].sort()).toEqual(Object.keys(data.planetTypes).sort());
  });

  it('дуэль 1×1 на слотах — но в пул AvA тестовая карта не входит', () => {
    expect(avaShape(map)).toEqual({ sides: 2, slotsPerSide: 1 });
    expect(map.avaEligible).toBe(false);
    expect(map.sectors.home_a!.owner).toBe('slot_a');
    expect(map.sectors.home_b!.owner).toBe('slot_b');
  });

  it('обитатели на своих базах: пираты воюют со всеми, нейтралы в мире', () => {
    expect(map.sectors.globule!.kind).toBe('pirate_base');
    expect(map.players[map.sectors.globule!.owner!]!.npc).toBe('pirate');
    expect(map.sectors.observatory!.kind).toBe('neutral_base');
    expect(map.players[map.sectors.observatory!.owner!]!.npc).toBe('neutral');
  });

  it('каждая провинция названа на обоих языках', () => {
    const missing = ids
      .map((id) => provinceKey(map.id, id))
      .filter((key) => !(key in ru) || !(key in en));
    expect(missing).toEqual([]);
  });
});

describe('тестовая дуэльная карта — сцена', () => {
  it('троянцы стоят в ±60° от газового гиганта на ЕГО орбите и остаются тупиками', () => {
    const star = map.sectors.home_a!.position;
    const r = (id: string): number => Math.hypot(pos(id).x - star.x, pos(id).y - star.y);
    const ang = (id: string): number =>
      (Math.atan2(pos(id).y - star.y, pos(id).x - star.x) * 180) / Math.PI;
    for (const [trojan, shift] of [
      ['trojan_l4', -60],
      ['trojan_l5', 60],
    ] as const) {
      expect(Math.abs(r(trojan) - r('giant'))).toBeLessThan(2);
      expect(Math.abs(ang(trojan) - ang('giant') - shift)).toBeLessThan(1);
      expect(map.sectors[trojan]!.kind).toBe('asteroid_cluster');
      expect(roadsOf(trojan)).toBe(1);
    }
  });

  it('чёрная дыра и шрамы ударной волны — дыры в карте, путей в них нет', () => {
    for (const id of ['singularity', 'scar_nw', 'scar_s', 'scar_e']) {
      expect(data.sectorKinds[map.sectors[id]!.kind]!.traversable).toBe(false);
      expect(roadsOf(id)).toBe(0);
    }
  });

  it('`empty` — только две точки съёмки: здесь можно развернуть станцию', () => {
    expect(ids.filter((id) => map.sectors[id]!.kind === 'empty').sort()).toEqual(['survey_1', 'survey_2']);
  });

  it('у каждой столицы больше одного выхода', () => {
    expect(roadsOf('home_a')).toBeGreaterThanOrEqual(2);
    expect(roadsOf('home_b')).toBeGreaterThanOrEqual(2);
  });
});

describe('тестовая дуэльная карта — перекрёстки, развилки, двойные пути', () => {
  // Перекрёсток — МИР, где сходится пять и больше дорог (M2.10), а не клетка `empty`.
  it('перекрёстки стоят на стыках областей', () => {
    for (const hub of ['giant', 'reach_w', 'scorched']) expect(roadsOf(hub)).toBeGreaterThanOrEqual(5);
    expect(ids.filter((id) => roadsOf(id) >= 5).length).toBeGreaterThanOrEqual(4);
  });

  // Развилка — точка, где тропа расходится (ROADS): её ставит ядро из троп местности.
  it('развилок хватает, чтобы засаде было где стоять', () => {
    const forks = ids.flatMap((id) => (state.planets[id]!.roads?.trails ?? []).filter((t) => t.fork));
    expect(forks.length).toBeGreaterThanOrEqual(12);
  });

  // Двойной путь (M2.5): две трассы сквозь одну провинцию, которые не встречаются.
  it('три двойных пути, и каждая трасса ведёт к настоящим соседям', () => {
    const transit = ids.filter((id) => map.sectors[id]!.transit);
    expect(transit.sort()).toEqual(['cinder', 'veil_s', 'wisp']);
    const lanes = matchMapEdges(map, data).paths.map(([a, b]) => [a, b].sort().join('|'));
    for (const id of transit)
      for (const pair of map.sectors[id]!.transit!)
        for (const end of pair) expect(lanes).toContain([id, end].sort().join('|'));
  });

  // Дороги, которые владелец дорисовал на черновике (2026-09-25): кладбище ↔ щель пояса,
  // берег дома B ↔ шторм, и объезды мимо шлакового мира — каждый на своей развилке.
  it('дороги владельца: кладбище ↔ щель, берег ↔ шторм, объезды мимо шлакового мира', () => {
    expect(state.planets.debris_1!.links).toContain('gap_ne');
    expect(state.planets.shore_b!.links).toContain('storm_2');
    const trails = state.planets.cinder!.roads!.trails;
    for (const pair of [
      ['husk', 'scoured'],
      ['reach_se', 'station'],
    ]) {
      const trail = trails.find((t) => t.exits.includes(pair[0]!));
      expect([...trail!.exits].sort()).toEqual(pair);
      expect(trail!.fork).not.toBeNull();
    }
  });

  it('столицы далеко друг от друга: дуэль начинается не у порога', () => {
    expect(dist('home_a', 'home_b')).toBeGreaterThan(2500);
  });
});
