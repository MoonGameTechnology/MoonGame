/**
 * ЧЕТВЁРТАЯ ГЛАВА СЕКТОРА ЗЕРО — карта «Архив без ответа».
 *
 * Дизайн — `docs/sector-zero-map-concepts.md` §6 (обсуждён с владельцем 2026-09-27): манёвренная
 * карта вокруг смещённой чёрной дыры, две дуги с перемычками, точка встречи с союзником раньше
 * основного сопротивления, район союзника на внешнем направлении, архив на дальней стороне и
 * зона вывода у входа. Соседство выводится из мозаики (M4.3), поэтому всё это ПРОВЕРЯЕТСЯ здесь
 * числами — любая правка координат может молча поменять карту.
 *
 * Дверь главы (список глав клиента) открыта последним кирпичом фазы (PVR-7.6), когда сценарий
 * был готов целиком; геометрия ниже собирается напрямую из данных карты.
 */
import { describe, expect, it } from 'vitest';
import {
  buildStateFromMap,
  getStance,
  identifiedNodes,
  matchMapEdges,
  parseMatchMap,
  validateMatchMap,
  type MatchMap,
} from '../packages/shared-core/src/index';
import { PVE_MISSION_COUNT, pveModeId, pveState } from '../packages/client/src/gameData';
import { CHAPTER_KEYS } from '../decisions/chapterRoute';
import { chapterHero } from '../decisions/heroRecruits';
import { shippedGameData } from './bundle';
import mapJson from './maps/pve-4.json';

const data = shippedGameData();
const map: MatchMap = parseMatchMap(mapJson);
const edges = matchMapEdges(map, data).paths;

/** Внутренняя дуга жмётся к дыре, внешняя идёт широким южным районом. */
const INNER = ['inner_w', 'spire', 'hollow', 'ember', 'shade', 'spore_gate', 'inner_e'];
const OUTER = [
  'outer_w',
  'gloom',
  'outer_mid',
  'outer_e',
  'outer_far',
  'station_west',
  'station_east',
];
const BRIDGES = ['bridge_w', 'bridge_c', 'bridge_e'];

const pos = (id: string): { x: number; y: number } => map.sectors[id]!.position;
const dist = (a: string, b: string): number => Math.hypot(pos(a).x - pos(b).x, pos(a).y - pos(b).y);
const blocked = (id: string): boolean =>
  data.sectorKinds[map.sectors[id]!.kind]?.traversable === false;
const provinces = Object.keys(map.sectors).filter((id) => !blocked(id));
const neighbours = (id: string): string[] =>
  edges.flatMap(([a, b]) => (a === id ? [b] : b === id ? [a] : []));

/** Кратчайший путь (в единицах карты) по дорогам, минуя `banned`; Infinity — пути нет. */
function route(from: string, to: string, banned: ReadonlySet<string> = new Set()): number {
  const best = new Map<string, number>([[from, 0]]);
  const open = new Set([from]);
  while (open.size > 0) {
    const cur = [...open].sort((a, b) => best.get(a)! - best.get(b)! || (a < b ? -1 : 1))[0]!;
    open.delete(cur);
    if (cur === to) return best.get(cur)!;
    for (const next of neighbours(cur)) {
      if (banned.has(next)) continue;
      const d = best.get(cur)! + dist(cur, next);
      if (d < (best.get(next) ?? Infinity)) {
        best.set(next, d);
        open.add(next);
      }
    }
  }
  return Infinity;
}

const swarmWorlds = Object.keys(map.sectors).filter((id) => map.sectors[id]!.owner === 'swarm');

describe('карта четвёртой главы — «Архив без ответа»', () => {
  it('проходит валидатор на ШИПНУТОМ каталоге, соседство выводится из мозаики', () => {
    expect(validateMatchMap(map, data)).toEqual([]);
    expect(matchMapEdges(map, data).derived).toBe(true);
    expect((mapJson as { paths?: unknown }).paths).toBeUndefined();
  });

  it('провинций 30–36 (§6.2): связность выросла, а не длина пустых перелётов', () => {
    expect(provinces.length).toBeGreaterThanOrEqual(30);
    expect(provinces.length).toBeLessThanOrEqual(36);
    // Средний перелёт — как на третьей карте, а не длинные пустые плечи.
    const mean = edges.reduce((s, [a, b]) => s + dist(a, b), 0) / edges.length;
    expect(mean).toBeLessThan(320);
  });

  it('смещённая чёрная дыра — непроходимая область без путей', () => {
    const hole = map.sectors.black_hole!;
    expect(hole.kind).toBe('black_hole');
    expect(neighbours('black_hole')).toEqual([]);
    // Область, а не точка: вокруг дыры — разломы, тоже без путей.
    const barrier = Object.keys(map.sectors).filter(blocked);
    expect(barrier.length).toBeGreaterThanOrEqual(4);
    for (const id of barrier) expect(neighbours(id), id).toEqual([]);
    // Смещена к северу: обе дуги идут вокруг неё с юга.
    const ys = provinces.map((id) => pos(id).y);
    expect(hole.position.y).toBeLessThan((Math.min(...ys) + Math.max(...ys)) / 2);
  });

  it('ДВЕ ДУГИ к архиву: внутренняя короче, внешняя длиннее, и каждая — самостоятельный путь', () => {
    const viaInner = route('staging', 'archive', new Set([...OUTER, ...BRIDGES]));
    const viaOuter = route('staging', 'archive', new Set(INNER));
    expect(viaInner).toBeLessThan(Infinity);
    expect(viaOuter).toBeLessThan(Infinity);
    expect(viaInner).toBeLessThan(viaOuter);
  });

  it('ДУГИ — широкие районы с развилками: у внутренней два ряда, у внешней обход Роя', () => {
    // Внутренняя: центральный мир Роя можно обойти у самого горизонта дыры, не уходя с дуги.
    const offInner = new Set(['hollow', ...OUTER, ...BRIDGES]);
    expect(route('spire', 'spore_gate', offInner)).toBeLessThan(Infinity);
    // Внешняя: станции Роя можно обойти по своему ряду.
    const offOuter = new Set(['station_west', 'station_east', ...INNER, ...BRIDGES]);
    expect(route('outer_mid', 'outer_far', offOuter)).toBeLessThan(Infinity);
  });

  it('ПЕРЕМЫЧКИ связывают дуги: направление меняется после начала операции', () => {
    for (const b of BRIDGES) {
      const n = neighbours(b);
      expect(
        n.some((id) => INNER.includes(id)),
        `${b} → внутренняя`,
      ).toBe(true);
      expect(
        n.some((id) => OUTER.includes(id)),
        `${b} → внешняя`,
      ).toBe(true);
    }
  });

  it('между перемычками дуги разделены разломами: без перемычки напротив — долгий обход', () => {
    let facing = 0;
    for (const i of INNER)
      for (const o of OUTER) {
        if (Math.abs(pos(i).x - pos(o).x) > 150 || dist(i, o) > 350) continue; // напротив через разлом
        facing += 1;
        expect(route(i, o, new Set(BRIDGES)), `${i}–${o}`).toBeGreaterThan(2.5 * dist(i, o));
      }
    expect(facing).toBeGreaterThanOrEqual(3);
  });

  it('один потерянный перекрёсток не запирает половину карты', () => {
    // Любая одна провинция на пути (кроме базы и архива) закрыта — архив всё равно достижим.
    for (const id of provinces) {
      if (id === 'staging' || id === 'archive') continue;
      expect(route('staging', 'archive', new Set([id])), `без ${id}`).toBeLessThan(Infinity);
    }
  });

  it('ПАРЫ ПОД «КОРИДОР»: близко по прямой, далеко по дорогам — и путь без героя есть', () => {
    const range = data.heroAbilities.corridor!.range!;
    const pairs: string[] = [];
    for (let i = 0; i < provinces.length; i++)
      for (let j = i + 1; j < provinces.length; j++) {
        const a = provinces[i]!;
        const b = provinces[j]!;
        if (neighbours(a).includes(b) || dist(a, b) > range) continue;
        const r = route(a, b);
        expect(r, `${a}–${b}: путь без героя`).toBeLessThan(Infinity);
        if (r >= 2 * dist(a, b)) pairs.push(`${a}–${b}`);
      }
    expect(pairs.length, pairs.join(', ')).toBeGreaterThanOrEqual(2);
    // Пары — между дугами через разлом, а не сквозь саму дыру.
    for (const p of pairs) expect(p).not.toContain('black_hole');
  });
});

describe('кто где стоит (§6.2–§6.3)', () => {
  const state = buildStateFromMap(map, data);

  it('база у входа — она же зона вывода накопителя', () => {
    const base = map.sectors.staging!;
    expect(base.owner).toBe('p1');
    expect(base.traits).toContain('haven');
    // Вход — западный край, архив — восточный.
    const xs = provinces.map((id) => pos(id).x);
    expect(pos('staging').x).toBeLessThan(Math.min(...xs) + 200);
    expect(pos('archive').x).toBeGreaterThan(Math.max(...xs) - 200);
    expect(route('staging', 'archive')).toBeGreaterThan(route('staging', 'rendezvous'));
  });

  it('точка встречи — стыковочный узел раньше основного сопротивления', () => {
    const rv = map.sectors.rendezvous!;
    expect(rv.kind).toBe('void_station');
    expect(rv.owner).toBeNull();
    // Место объявлено картой: первое прибытие игрока устанавливает связь с `ally` (PVR-7.2).
    expect(rv.rendezvous).toBe('ally');
    expect(Object.values(map.sectors).filter((sec) => sec.rendezvous)).toHaveLength(1);
    // Путь к ней не идёт через миры Роя, и она ближе любого из них.
    expect(route('staging', 'rendezvous', new Set(swarmWorlds))).toBe(
      route('staging', 'rendezvous'),
    );
    for (const w of swarmWorlds)
      expect(route('staging', 'rendezvous'), w).toBeLessThan(route('staging', w));
  });

  it('союзник — житель карты на внешнем направлении, до встречи в мире, а не в союзе', () => {
    const ally = state.players.ally!;
    expect(ally).toMatchObject({ npc: 'neutral', ai: true, faction: 'vanguard' });
    expect(getStance(state, 'p1', 'ally')).toBe('peace');
    expect(getStance(state, 'swarm', 'ally')).not.toBe('alliance');
    const base = map.sectors.ally_base!;
    expect(base.owner).toBe('ally');
    expect(base.buildings.some((b) => b.type === 'shipyard')).toBe(true);
    // Внешнее направление: к внешней дуге ближе, чем к внутренней.
    const toArc = (arc: string[]) => Math.min(...arc.map((id) => route('ally_base', id)));
    expect(toArc(OUTER)).toBeLessThan(toArc(INNER));
  });

  it('география разводит отряды до встречи: на старте они друг друга не видят', () => {
    const allyWorlds = Object.keys(state.planets).filter(
      (id) => state.planets[id]!.owner === 'ally',
    );
    const mine = Object.keys(state.planets).filter((id) => state.planets[id]!.owner === 'p1');
    const seenByMe = identifiedNodes(state, 'p1', data);
    const seenByAlly = identifiedNodes(state, 'ally', data);
    for (const id of allyWorlds) expect(seenByMe.has(id), id).toBe(false);
    for (const id of mine) expect(seenByAlly.has(id), id).toBe(false);
    // Флоты тоже стоят порознь.
    const fleets = Object.values(state.fleets);
    const at = (owner: string) =>
      new Set(fleets.filter((f) => f.owner === owner).map((f) => f.location));
    for (const loc of at('ally')) expect(at('p1').has(loc), String(loc)).toBe(false);
  });

  it('архив — на дальней стороне, его держит десант Роя; улей рядом, ни одна дуга не безопасна', () => {
    const archive = map.sectors.archive!;
    expect(archive.owner).toBe('swarm');
    expect(archive.garrison.reduce((n, u) => n + u.count, 0)).toBeGreaterThan(0);
    expect(data.sectorKinds[archive.kind]?.capturable).toBe(true);
    for (const id of provinces)
      if (id !== 'archive')
        expect(route('staging', id), id).toBeLessThanOrEqual(route('staging', 'far_eye'));
    expect(map.sectors.hive!.buildings.some((b) => b.type === 'swarm_hive')).toBe(true);
    // На каждой дуге есть мир Роя.
    expect(INNER.some((id) => swarmWorlds.includes(id))).toBe(true);
    expect(OUTER.some((id) => swarmWorlds.includes(id))).toBe(true);
  });
});

describe('задачи четвёртой главы — пул из восьми (§6.7)', () => {
  const objectives = map.objectives;

  it('восемь задач, не меньше, чем у третьей главы (PVR-5.6: запас не убывает)', () => {
    expect(objectives).toHaveLength(8);
    expect(new Set(objectives.map((o) => o.id)).size).toBe(8);
  });

  it('каждая цель задачи есть на карте', () => {
    for (const o of objectives) {
      for (const id of ['control', 'rescue'].includes(o.kind) ? (o.targets ?? []) : [])
        expect(map.sectors[id], `${o.id}: ${id}`).toBeDefined();
      if (o.kind === 'build' || o.kind === 'raze')
        for (const b of o.targets ?? []) expect(data.buildings[b], `${o.id}: ${b}`).toBeDefined();
      expect(o.reward).toBeGreaterThan(0);
    }
  });

  it('«Последняя смена»: транспорты лаборатории стоят за дырой и доводятся до базы', () => {
    const evac = objectives.find((o) => o.kind === 'evac')!;
    const transports = Object.values(map.fleets).filter(
      (f) =>
        f.owner === 'p1' && f.units.some((u) => data.units[u.unit]?.traits.includes('evacuee')),
    );
    const count = transports.flatMap((f) => f.units).reduce((n, u) => n + u.count, 0);
    expect(count).toBe(evac.count);
    expect(transports.map((f) => f.location)).toEqual(['lab_outpost']);
    expect(route('lab_outpost', 'staging')).toBeGreaterThan(route('staging', 'archive'));
  });

  it('«Книга голосов»: община наша и уже в осаде Роя', () => {
    expect(map.sectors.covenant_hold!.owner).toBe('p1');
    const siege = Object.values(map.fleets).find(
      (f) => f.location === 'covenant_hold' && f.owner === 'swarm',
    );
    expect(siege?.landing?.length).toBeGreaterThan(0);
  });

  it('«Запасной рубеж» — на перемычке, где форт можно построить', () => {
    const line = objectives.find((o) => o.id === 'mission.fallback-line')!;
    expect(line.at).toEqual(['bridge_w']);
    expect(BRIDGES).toContain('bridge_w');
    expect(data.sectorKinds[map.sectors.bridge_w!.kind]?.buildable).toBe(true);
  });
});

describe('дверь четвёртой главы (PVR-7.6)', () => {
  it('глава открывается своей картой под режимом волн, с архивом и точкой встречи', () => {
    expect(PVE_MISSION_COUNT).toBeGreaterThanOrEqual(4);
    const s = pveState(data, 3);
    expect(s.mapId).toBe('pve-4');
    expect(pveModeId(3)).toBe('pve_waves');
    expect(s.extraction).toMatchObject({ vault: 'archive', zone: 'staging' });
    expect(s.planets.rendezvous?.rendezvous).toBe('ally');
  });

  it('у главы есть название и брифинг; героя-награды нет (§6.7: награда — по экономике)', () => {
    expect(CHAPTER_KEYS[3]).toEqual({
      name: 'sector-zero.mission.4',
      brief: 'sector-zero.mission.4.brief',
    });
    expect(chapterHero(3)).toBeNull();
  });
});
