/**
 * ТРЕТЬЯ ГЛАВА СЕКТОРА ЗЕРО — карта «Карантинный рубеж» и дверь к ней.
 *
 * Дизайн — `docs/sector-zero-map-concepts.md` §5 (согласован владельцем 2026-09-24):
 * удержать рубеж, сохранив подвижный резерв. Две широкие области, ТРИ разнесённых перехода,
 * поперечные связи по обе стороны, колонии не за общей горловиной, одна крепость не
 * накрывает все подходы. Соседство выводится из мозаики (M4.3), поэтому всё это
 * ПРОВЕРЯЕТСЯ здесь числами — любая правка координат может молча поменять карту.
 */
import { describe, expect, it } from 'vitest';
import {
  matchMapEdges,
  parseMatchMap,
  validateMatchMap,
  type MatchMap,
} from '../packages/shared-core/src/index';
import {
  pveModeId,
  pveObjectives,
  pveState,
  PVE_MISSION_COUNT,
} from '../packages/client/src/gameData';
import { CHAPTER_KEYS } from '../decisions/chapterRoute';
import { chapterHero } from '../decisions/heroRecruits';
import { shippedGameData } from './bundle';
import mapJson from './maps/pve-3.json';

const data = shippedGameData();
const map: MatchMap = parseMatchMap(mapJson);
const CROSSINGS = ['west_pass', 'quarantine', 'east_pass'] as const;

const edges = matchMapEdges(map, data).paths;
const pos = (id: string): { x: number; y: number } => map.sectors[id]!.position;
const dist = (a: string, b: string): number => Math.hypot(pos(a).x - pos(b).x, pos(a).y - pos(b).y);
const north = (id: string): boolean => pos(id).y < 0;
const south = (id: string): boolean => pos(id).y > 0;

/** Кратчайший путь (в единицах карты) по дорогам, минуя `banned`; Infinity — пути нет. */
function route(from: string, to: string, banned: ReadonlySet<string> = new Set()): number {
  const best = new Map<string, number>([[from, 0]]);
  const open = new Set([from]);
  while (open.size > 0) {
    const cur = [...open].sort((a, b) => best.get(a)! - best.get(b)! || (a < b ? -1 : 1))[0]!;
    open.delete(cur);
    if (cur === to) return best.get(cur)!;
    for (const [a, b] of edges) {
      const next = a === cur ? b : b === cur ? a : null;
      if (next === null || banned.has(next)) continue;
      const d = best.get(cur)! + dist(cur, next);
      if (d < (best.get(next) ?? Infinity)) {
        best.set(next, d);
        open.add(next);
      }
    }
  }
  return Infinity;
}

describe('карта третьей главы — «Карантинный рубеж»', () => {
  it('проходит валидатор на ШИПНУТОМ каталоге, соседство выводится из мозаики', () => {
    expect(validateMatchMap(map, data)).toEqual([]);
    expect(matchMapEdges(map, data).derived).toBe(true);
    expect((mapJson as { paths?: unknown }).paths).toBeUndefined();
  });

  it('провинций 22–24 (§5.3), разломы провинциями не считаются', () => {
    const provinces = Object.values(map.sectors).filter((s) => s.kind !== 'rift');
    expect(provinces.length).toBeGreaterThanOrEqual(22);
    expect(provinces.length).toBeLessThanOrEqual(24);
  });

  it('ТРИ ПЕРЕХОДА: с севера на юг только через них, и каждый — самостоятельный путь', () => {
    expect(route('bastion', 'hive')).toBeLessThan(Infinity);
    // Все три закрыты — рубеж цел: обходной дороги нет.
    expect(route('bastion', 'hive', new Set(CROSSINGS))).toBe(Infinity);
    // Открыт любой один — путь есть: переходы не последовательные, а параллельные.
    for (const open of CROSSINGS) {
      const closed = new Set(CROSSINGS.filter((c) => c !== open));
      expect(route('bastion', 'hive', closed), `только ${open}`).toBeLessThan(Infinity);
    }
    // Ни одна дорога не ведёт прямо с севера на юг в обход переходов.
    const crossing = new Set<string>(CROSSINGS);
    for (const [a, b] of edges) {
      if (crossing.has(a) || crossing.has(b)) continue;
      expect(north(a) && south(b), `${a}–${b}`).toBe(false);
      expect(south(a) && north(b), `${a}–${b}`).toBe(false);
    }
  });

  it('у переходов РАЗНЫЙ характер: короткий открытый центр, астероиды, обход через туманность', () => {
    expect(map.sectors.west_pass!.terrain).toBe('asteroid_field');
    expect(map.sectors.quarantine!.terrain).toBe('empty_space');
    expect(map.sectors.east_pass!.terrain).toMatch(/nebula/);
    // Центральный — самый короткий путь к улью, восточный — самый длинный.
    const via = (c: string) => route('bastion', 'hive', new Set(CROSSINGS.filter((x) => x !== c)));
    expect(via('quarantine')).toBeLessThan(via('west_pass'));
    expect(via('quarantine')).toBeLessThan(via('east_pass'));
  });

  it('ни одна крепость не накрывает двух переходов: они разнесены', () => {
    for (let i = 0; i < CROSSINGS.length; i++)
      for (let j = i + 1; j < CROSSINGS.length; j++)
        expect(dist(CROSSINGS[i]!, CROSSINGS[j]!)).toBeGreaterThanOrEqual(500);
  });

  it('ПОПЕРЕЧНЫЕ СВЯЗИ по обе стороны: резерв перебрасывается, не откатываясь к базе', () => {
    // Север: подходы к трём переходам связаны между собой без базы и колоний.
    const rear = new Set(['bastion', 'west_colony', 'east_colony', ...CROSSINGS]);
    expect(route('watch_post', 'north_gate', rear)).toBeLessThan(Infinity);
    expect(route('north_gate', 'east_haze', rear)).toBeLessThan(Infinity);
    // Юг: Рой тоже может сменить переход, не заходя в улей.
    const hive = new Set(['hive', ...CROSSINGS]);
    expect(route('south_west', 'beachhead', hive)).toBeLessThan(Infinity);
    expect(route('beachhead', 'spore_reach', hive)).toBeLessThan(Infinity);
  });

  it('один флот НЕ закрывает все три перехода: боковой путь между крайними длинный', () => {
    // От западного перехода до восточного по своей стороне — заметно дольше, чем от
    // колонии до своего перехода: успеть можно, но не везде сразу (§5.3).
    const side = route('west_pass', 'east_pass', new Set(['quarantine', ...south_ids()]));
    expect(side).toBeGreaterThan(2 * route('west_colony', 'west_pass'));
    expect(side).toBeGreaterThan(2 * route('east_colony', 'east_pass'));
  });

  it('колонии НЕ за общей горловиной: у каждой свой подход к своему переходу', () => {
    const w = new Set(['bastion', 'east_colony']);
    const e = new Set(['bastion', 'west_colony']);
    expect(route('west_colony', 'west_pass', w)).toBeLessThan(Infinity);
    expect(route('east_colony', 'east_pass', e)).toBeLessThan(Infinity);
    for (const c of ['west_colony', 'east_colony']) expect(map.sectors[c]!.owner).toBe('p1');
  });

  it('предупреждение даёт шанс: база ближе к каждому переходу, чем улей', () => {
    for (const c of CROSSINGS) expect(route('bastion', c)).toBeLessThan(route('hive', c));
  });

  it('сторона Роя: передовой плацдарм, производство и дальний очаг', () => {
    const beachhead = map.sectors.beachhead!;
    expect(beachhead.owner).toBe('swarm');
    expect(data.sectorKinds[beachhead.kind]?.capturable).toBe(true);
    const pits = Object.values(map.sectors).filter((s) =>
      s.buildings.some((b) => b.type === 'biomass_pit'),
    );
    expect(pits.length).toBeGreaterThanOrEqual(2);
    // Очаг — дальше плацдарма: плацдарм можно взять, не штурмуя улей.
    expect(route('bastion', 'hive')).toBeGreaterThan(route('bastion', 'beachhead'));
    expect(map.sectors.hive!.buildings.some((b) => b.type === 'swarm_hive')).toBe(true);
  });
});

function south_ids(): string[] {
  return Object.keys(map.sectors).filter((id) => south(id));
}

describe('задачи третьей главы — пул из восьми (§5.7)', () => {
  const objectives = map.objectives;

  it('восемь задач, запас больше, чем у второй главы (PVR-5.3)', () => {
    expect(objectives).toHaveLength(8);
    expect(new Set(objectives.map((o) => o.id)).size).toBe(8);
    expect(pveObjectives(2).length).toBeGreaterThan(pveObjectives(1).length);
  });

  it('каждая цель задачи есть на карте, а сами задачи не требуют победы', () => {
    for (const o of objectives) {
      for (const id of o.kind === 'control' || o.kind === 'beacon' ? (o.targets ?? []) : [])
        expect(map.sectors[id], `${o.id}: ${id}`).toBeDefined();
      for (const id of o.at ?? []) expect(map.sectors[id]?.owner, `${o.id}: ${id}`).toBe('p1');
      if (o.kind === 'build' || o.kind === 'raze')
        for (const b of o.targets ?? []) expect(data.buildings[b], `${o.id}: ${b}`).toBeDefined();
      expect(o.reward).toBeGreaterThan(0);
    }
    // Крепость Роя не трофей (§5.5): улей в задачах на захват не стоит.
    const captured = objectives.filter((o) => o.kind === 'control').flatMap((o) => o.targets ?? []);
    expect(captured).not.toContain('hive');
  });

  it('маяк стоит на мире с признаком маяка, вдали от базы', () => {
    const beacon = objectives.find((o) => o.kind === 'beacon')!;
    const at = beacon.targets![0]!;
    expect(map.sectors[at]!.traits).toContain('beacon');
    expect(route('bastion', at)).toBeGreaterThan(route('bastion', 'west_pass'));
  });
});

describe('дверь третьей главы', () => {
  it('глава открывается своей картой под режимом волн', () => {
    expect(PVE_MISSION_COUNT).toBeGreaterThanOrEqual(3);
    const s = pveState(data, 2);
    expect(s.mapId).toBe('pve-3');
    expect(Object.keys(s.planets)).toContain('bastion');
    expect(pveModeId(2)).toBe('pve_waves');
  });

  it('у главы есть название и брифинг, а наградой за неё идёт Страж (§5.9)', () => {
    expect(CHAPTER_KEYS[2]).toEqual({
      name: 'sector-zero.mission.3',
      brief: 'sector-zero.mission.3.brief',
    });
    expect(chapterHero(2)).toBe('warden');
  });
});
