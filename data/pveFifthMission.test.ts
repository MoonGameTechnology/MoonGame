/**
 * ПЯТАЯ ГЛАВА СЕКТОРА ЗЕРО — карта «Разорванная сеть».
 *
 * Дизайн — `docs/sector-zero-map-concepts.md` §7 (обсуждён с владельцем 2026-09-28): совместное
 * наступление против трёх очагов Роя с прикомандированным союзником; исход — контракт операции
 * главы VI из одних очагов (PVR-9.3). Тыл экспедиции на юге,
 * на севере три района Роя со своими очагами, между ними перекрёсток, поперечные пути и
 * внешние обходы. Два графа: дороги выводятся из мозаики (M4.3), сеть Роя — из пересечения
 * кругов связи его узлов. Поэтому всё это ПРОВЕРЯЕТСЯ здесь числами и настоящей геометрией
 * ядра (`swarmNet`): любая правка координат может молча поменять соседство или связь сети.
 *
 * Генератор — `scripts/generate-pve-5.py`.
 */
import { describe, expect, it } from 'vitest';
import {
  buildStateFromMap,
  getStance,
  identifiedNodes,
  matchMapEdges,
  parseMatchMap,
  playablePlayerIds,
  swarmNet,
  validateMatchMap,
  type GameState,
  type MatchMap,
} from '../packages/shared-core/src/index';
import {
  PVE_MISSION_COUNT,
  pveChapter,
  pveModeId,
  pveObjectives,
  pveState,
} from '../packages/client/src/gameData';
import { CHAPTER_KEYS } from '../decisions/chapterRoute';
import { linkedAlly } from '../decisions/chapterChain';
import { confidentGroundWin } from '../decisions/groundForecast';
import { chapterHero } from '../decisions/heroRecruits';
import { objectiveProgress, shownObjectives } from '../decisions/missionObjectives';
import { retireDoneEncounters } from '../decisions/retiredEncounters';
import { runAiSeats } from '../decisions/runAiSeats';
import { shippedGameData } from './bundle';
import mapJson from './maps/pve-5.json';
import fourthMapJson from './maps/pve-4.json';

const data = shippedGameData();
const map: MatchMap = parseMatchMap(mapJson);
const edges = matchMapEdges(map, data).paths;

const FOCI = ['focus_center', 'focus_east', 'focus_west'];

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

/** Сеть Роя на этом состоянии: в одной ли части два мира. */
function sameNetPart(state: GameState, a: string, b: string): boolean {
  const view = swarmNet(state, data, 'swarm', 0);
  return view.partOf.get(`planet:${a}`) === view.partOf.get(`planet:${b}`);
}
/** Стартовый мир без названных постов сети. */
function withoutRelays(...fleets: string[]): GameState {
  const state = buildStateFromMap(map, data);
  for (const id of fleets) delete state.fleets[id];
  return state;
}

describe('карта пятой главы — «Разорванная сеть»', () => {
  it('проходит валидатор на ШИПНУТОМ каталоге, соседство выводится из мозаики', () => {
    expect(validateMatchMap(map, data)).toEqual([]);
    expect(matchMapEdges(map, data).derived).toBe(true);
    expect((mapJson as { paths?: unknown }).paths).toBeUndefined();
  });

  it('провинций 40–46: не меньше главы IV по размаху, переброски короткие', () => {
    expect(provinces.length).toBeGreaterThanOrEqual(40);
    expect(provinces.length).toBeLessThanOrEqual(46);
    // Средний перелёт — эскиз (§7.8): чуть длиннее, чем у третьей и четвёртой карт (320),
    // потому что между районами Роя лежат разломы; длинных пустых плеч нет.
    const mean = edges.reduce((s, [a, b]) => s + dist(a, b), 0) / edges.length;
    expect(mean).toBeLessThan(350);
    for (const [a, b] of edges) expect(dist(a, b), `${a}–${b}`).toBeLessThan(480);
  });

  it('разломы между районами — непроходимые, без путей', () => {
    const barrier = Object.keys(map.sectors).filter(blocked);
    expect(barrier.sort()).toEqual(['rift_e', 'rift_w']);
    for (const id of barrier) expect(neighbours(id), id).toEqual([]);
  });

  it('тыл на юге, три района Роя на севере: к каждому очагу есть путь', () => {
    for (const f of FOCI) {
      expect(pos(f).y, f).toBeLessThan(pos('crossroad').y);
      expect(route('staging', f), f).toBeLessThan(Infinity);
    }
    expect(pos('staging').y).toBeGreaterThan(pos('crossroad').y);
    expect(pos('ally_base').y).toBeGreaterThan(pos('crossroad').y);
    // Запад, центр, восток — по порядку.
    expect(pos('focus_west').x).toBeLessThan(pos('focus_center').x);
    expect(pos('focus_center').x).toBeLessThan(pos('focus_east').x);
  });

  it('одна потерянная провинция не запирает экспедицию: ни один очаг не отрезается', () => {
    for (const id of provinces) {
      if (id === 'staging') continue;
      for (const f of FOCI)
        if (id !== f)
          expect(route('staging', f, new Set([id])), `без ${id} → ${f}`).toBeLessThan(Infinity);
    }
    // И даже без перекрёстка и центрального очага фланги достижимы — обходами.
    const center = new Set(['crossroad', 'focus_center']);
    expect(route('staging', 'focus_east', center)).toBeLessThan(Infinity);
    expect(route('ally_base', 'focus_west', center)).toBeLessThan(Infinity);
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
  });
});

describe('сеть Роя — второй граф (§7.3)', () => {
  it('на старте три очага в одной сети: центры и посты связаны кругами', () => {
    const state = buildStateFromMap(map, data);
    expect(sameNetPart(state, 'focus_west', 'focus_center')).toBe(true);
    expect(sameNetPart(state, 'focus_east', 'focus_center')).toBe(true);
  });

  it('запад держится на ОДНОМ посту — Жила: сбит он, и западный очаг отрезан', () => {
    const state = buildStateFromMap(map, data);
    expect(state.fleets.relay_west!.location).toBe('w_link');
    expect(map.sectors.w_link!.traits).toContain('net_lead');
    const cut = withoutRelays('relay_west');
    expect(sameNetPart(cut, 'focus_west', 'focus_center')).toBe(false);
    expect(sameNetPart(cut, 'focus_east', 'focus_center')).toBe(true);
  });

  it('с востоком ДВЕ цепочки: заметная (Створ) одна не изолирует, нужна и обходная', () => {
    expect(sameNetPart(withoutRelays('relay_gate'), 'focus_east', 'focus_center')).toBe(true);
    expect(sameNetPart(withoutRelays('relay_north'), 'focus_east', 'focus_center')).toBe(true);
    expect(
      sameNetPart(withoutRelays('relay_gate', 'relay_north'), 'focus_east', 'focus_center'),
    ).toBe(false);
  });

  it('захват перекрёстка связь не рвёт: сеть — по узлам, а не по дорогам и хозяевам', () => {
    const state = buildStateFromMap(map, data);
    state.planets.crossroad!.owner = 'p1';
    state.planets.c_south!.owner = 'p1';
    expect(sameNetPart(state, 'focus_west', 'focus_center')).toBe(true);
    expect(sameNetPart(state, 'focus_east', 'focus_center')).toBe(true);
  });
});

describe('кто где стоит (§7.2–§7.3)', () => {
  const state = buildStateFromMap(map, data);

  it('игрок стартует с ОДНОЙ планетой; база — убежище и зона доставки пленного', () => {
    expect(Object.keys(map.sectors).filter((id) => map.sectors[id]!.owner === 'p1')).toEqual([
      'staging',
    ]);
    expect(map.sectors.staging!.traits).toContain('haven');
    const colony = map.sectors.west_colony!;
    expect(colony.kind).toBe('planet');
    expect(colony.owner).toBeNull();
    expect(neighbours('staging')).toContain('west_colony');
  });

  it('союзник на связи с первой минуты, как в главе VI: союз, общий обзор, встречи нет', () => {
    expect(state.players.ally).toMatchObject({ npc: 'neutral', ai: true, faction: 'vanguard' });
    // Встреча уже состоялась (`contactAtStart`): место связи — база союзника, факт контакта
    // и союз ставит загрузчик, повторного знакомства на карте нет.
    expect(map.sectors.ally_base).toMatchObject({ rendezvous: 'ally', contactAtStart: true });
    expect(state.missionFacts?.contacted?.p1).toEqual(['ally_base']);
    expect(linkedAlly(state, 'p1')).toBe('ally');
    expect(getStance(state, 'p1', 'ally')).toBe('alliance');
    // С Роем — не союз; войну всем он объявляет сам на старте волн (`pve.started`).
    expect(getStance(state, 'swarm', 'ally')).not.toBe('alliance');
    // Общий обзор: база союзника видна игроку, база игрока — союзнику.
    expect(identifiedNodes(state, 'p1', data).has('ally_base')).toBe(true);
    expect(identifiedNodes(state, 'ally', data).has('staging')).toBe(true);
    // Своя задача без приказа — освобождаемые позиции общего тыла, их держит Рой.
    const task = Object.keys(map.sectors).filter((id) =>
      (map.sectors[id]!.traits ?? []).includes('ally_task'),
    );
    expect(task.sort()).toEqual(['outpost_east', 'outpost_south']);
    for (const id of task) expect(map.sectors[id]!.owner, id).toBe('swarm');
  });

  it('исход — три очага контракта операции, без соединений и эвакуации; улей волн — центральный', () => {
    expect([...map.operation!.production].sort()).toEqual(FOCI);
    expect(state.operation).toMatchObject({ forces: {}, evacuate: 0 });
    expect([...state.operation!.production].sort()).toEqual(FOCI);
    for (const f of FOCI) {
      expect(map.sectors[f]!.owner, f).toBe('swarm');
      expect(
        map.sectors[f]!.buildings.some((b) => b.type === 'swarm_datacenter'),
        f,
      ).toBe(true);
    }
    // Волна рождается в мире Роя с наименьшим id (`pveModule`): им должен быть улей центра.
    const swarmWorlds = Object.keys(map.sectors).filter((id) => map.sectors[id]!.owner === 'swarm');
    expect(swarmWorlds.sort()[0]).toBe('focus_center');
    expect(map.sectors.focus_center!.buildings.some((b) => b.type === 'swarm_hive')).toBe(true);
  });

  it('силы Роя поделены между очагами, а не умножены втрое', () => {
    const at = (loc: string) =>
      Object.values(map.fleets).filter((f) => f.owner === 'swarm' && f.location === loc);
    for (const f of FOCI) expect(at(f).length, f).toBe(1);
    const fourth = parseMatchMap(fourthMapJson);
    const mothers = (m: MatchMap) =>
      Object.values(m.fleets)
        .filter((f) => f.owner === 'swarm')
        .flatMap((f) => f.units)
        .filter((u) => u.unit === 'swarm_brood_mother')
        .reduce((n, u) => n + u.count, 0);
    expect(mothers(map)).toBeLessThanOrEqual(mothers(fourth) + 1);
  });
});

describe('Завет Единения: убежище проповедника (docs/covenant-of-unity.md)', () => {
  const state = buildStateFromMap(map, data);

  it('убежище держат сценарные люди Завета — гарнизон крепче, чем у Приюта главы IV', () => {
    expect(Object.keys(map.sectors).filter((id) => map.sectors[id]!.owner === 'covenant')).toEqual([
      'hideout',
    ]);
    const troops = (m: MatchMap, id: string) =>
      m.sectors[id]!.garrison.reduce((n, u) => n + u.count, 0);
    expect(troops(map, 'hideout')).toBeGreaterThan(
      troops(parseMatchMap(fourthMapJson), 'covenant_hold'),
    );
    expect(state.players.covenant).toMatchObject({ faction: 'vanguard', npc: 'pirate' });
    expect(state.players.covenant!.ai).not.toBe(true);
    expect(Object.values(map.fleets).filter((f) => f.owner === 'covenant')).toEqual([]);
    expect(getStance(state, 'p1', 'covenant')).toBe('war');
    expect(getStance(state, 'ally', 'covenant')).toBe('war');
    expect(playablePlayerIds(state)).not.toContain('covenant');
    expect([...runAiSeats(state, 'p1', 'weak').keys()]).not.toContain('covenant');
  });

  it('стартового десанта экспедиции на убежище мало — нужен ещё пехотинец или союзник', () => {
    // Весь стартовый десант: ополченец на борту и пехота базы (гарнизонные части не грузятся).
    const troops = [...(map.fleets.p1_1!.landing ?? []), ...map.sectors.staging!.garrison];
    const count = (unit: string) =>
      troops.filter((u) => u.unit === unit).reduce((n, u) => n + u.count, 0);
    const start = [
      { unit: 'militia', count: count('militia') },
      { unit: 'heavy_infantry', count: count('heavy_infantry') },
    ];
    expect(start).toEqual([
      { unit: 'militia', count: 3 },
      { unit: 'heavy_infantry', count: 4 },
    ]);
    const hideout = map.sectors.hideout!.garrison;
    expect(confidentGroundWin(start, hideout, data)).toBe(false);
    const hired = [start[0]!, { unit: 'heavy_infantry', count: count('heavy_infantry') + 1 }];
    expect(confidentGroundWin(hired, hideout, data)).toBe(true);
  });

  it('пленный в убежище один на матч, доставка — на базу игрока', () => {
    expect(state.captive).toEqual({ hideout: 'hideout', zone: 'staging' });
    expect(Object.values(map.sectors).filter((sec) => sec.captive)).toHaveLength(1);
  });

  it('убежище — на боковом западном направлении, на пути транспортов станции', () => {
    expect(pos('hideout').x).toBeLessThan(pos('focus_west').x);
    // Путь транспортов через убежище вдвое короче обхода.
    const through = route('listening_post', 'staging');
    const around = route('listening_post', 'staging', new Set(['hideout']));
    expect(around).toBeGreaterThan(1.5 * through);
    // И оно прикрывает подход к Жиле: сосед её соседа.
    expect(neighbours('hideout').some((id) => neighbours(id).includes('w_link'))).toBe(true);
  });
});

describe('задачи пятой главы — пул из двенадцати (§7.6)', () => {
  const objectives = map.objectives;

  it('двенадцать задач — не меньше, чем у главы IV (PVR-5.6: запас не убывает)', () => {
    expect(objectives).toHaveLength(12);
    expect(new Set(objectives.map((o) => o.id)).size).toBe(12);
    expect(objectives.length).toBeGreaterThanOrEqual(
      parseMatchMap(fourthMapJson).objectives.length,
    );
  });

  it('за заход видно четыре, потолок шесть; «Голос Единения» — с первого захода', () => {
    expect(map.objectiveSlots).toEqual({ base: 4, cap: 6 });
    const { slots } = pveChapter(4);
    const first = shownObjectives(pveObjectives(4), [], slots);
    expect(first).toHaveLength(4);
    expect(first.map((o) => o.id)).toContain('mission.voice-of-unity');
  });

  it('каждая цель задачи есть на карте', () => {
    for (const o of objectives) {
      for (const id of ['control', 'beacon', 'isolate', 'captive'].includes(o.kind)
        ? (o.targets ?? [])
        : [])
        expect(map.sectors[id], `${o.id}: ${id}`).toBeDefined();
      if (o.kind === 'build' || o.kind === 'raze')
        for (const b of o.targets ?? []) expect(data.buildings[b], `${o.id}: ${b}`).toBeDefined();
      for (const id of o.at ?? []) expect(map.sectors[id], `${o.id}: ${id}`).toBeDefined();
      expect(o.reward).toBeGreaterThan(0);
    }
  });

  it('разрыв сети — по очагам, которые на старте связаны с ульем', () => {
    const isolate = objectives.filter((o) => o.kind === 'isolate');
    expect(isolate.map((o) => o.targets)).toEqual([['focus_west'], ['focus_east']]);
    const state = buildStateFromMap(map, data);
    for (const o of isolate) expect(sameNetPart(state, o.targets![0]!, 'focus_center')).toBe(true);
  });

  it('общая операция (§7.6): взятое союзником засчитано игроку, стройка — только своя', () => {
    const state = buildStateFromMap(map, data);
    const task = (id: string) => objectives.find((o) => o.id === id)!;
    state.planets.far_eye!.owner = 'ally';
    state.planets.remote_yard!.owner = 'ally';
    expect(objectiveProgress(task('mission.watch-station'), state, 'p1').complete).toBe(true);
    expect(objectiveProgress(task('mission.remote-yard'), state, 'p1').complete).toBe(true);
    // Форт союзника на Перекрёстке — его постройка, не «Опорный рубеж» игрока (как в главе VI).
    state.planets.crossroad!.owner = 'ally';
    state.planets.crossroad!.buildings = [{ type: 'fort', level: 1, hp: 100 }];
    expect(objectiveProgress(task('mission.bulwark'), state, 'p1').complete).toBe(false);
  });

  it('«Последний сеанс»: транспорты ждут на станции и выходят к флоту игрока', () => {
    const evac = objectives.find((o) => o.kind === 'evac')!;
    const transports = map.fleets.p1_evac!;
    expect(transports).toMatchObject({
      owner: 'p1',
      location: 'listening_post',
      joinsOnArrival: true,
    });
    expect(transports.units.reduce((n, u) => n + u.count, 0)).toBe(evac.count);
    const state = buildStateFromMap(map, data);
    expect(state.fleets.p1_evac).toBeUndefined();
    expect(state.planets.listening_post!.awaitingFleets?.map((f) => f.id)).toEqual(['p1_evac']);
  });

  it('«Опорный рубеж» и «Полевая верфь» — там, где такую постройку можно поставить', () => {
    for (const [id, at, building] of [
      ['mission.bulwark', 'crossroad', 'fort'],
      ['mission.field-yard', 'west_colony', 'shipyard'],
    ] as const) {
      const o = objectives.find((x) => x.id === id)!;
      expect(o).toMatchObject({ kind: 'build', targets: [building], at: [at] });
      const kind = data.sectorKinds[map.sectors[at]!.kind]!;
      expect(kind.buildable, id).toBe(true);
      expect(kind.allowedBuildings ?? [building], id).toContain(building);
    }
  });
});

describe('дверь пятой главы (PVR-9.8)', () => {
  it('глава открывается своей картой под режимом волн, с контрактом операции и пленным', () => {
    expect(PVE_MISSION_COUNT).toBeGreaterThanOrEqual(5);
    const s = pveState(data, 4);
    expect(s.mapId).toBe('pve-5');
    expect(pveModeId(4)).toBe('pve_waves');
    expect([...s.operation!.production].sort()).toEqual(FOCI);
    expect(s.captive).toEqual({ hideout: 'hideout', zone: 'staging' });
    expect(getStance(s, 'p1', 'ally')).toBe('alliance');
  });

  it('у главы есть название и брифинг; героя-награды нет (§7.7: награда — по экономике)', () => {
    expect(CHAPTER_KEYS[4]).toEqual({
      name: 'sector-zero.mission.5',
      brief: 'sector-zero.mission.5.brief',
    });
    expect(chapterHero(4)).toBeNull();
  });

  it('доставленный пленный не возвращается: убежище и Завет списаны, пленного нет', () => {
    const start = pveState(data, 4);
    const next = retireDoneEncounters(start, pveObjectives(4), ['mission.voice-of-unity']);
    expect(next.captive).toBeUndefined();
    expect(next.planets.hideout!.owner).toBeNull();
    expect(next.planets.hideout!.garrison).toEqual([]);
    expect(next.players.covenant).toBeUndefined();
    // Невыполненная задача ничего не списывает.
    expect(retireDoneEncounters(start, pveObjectives(4), []).captive).toEqual(start.captive);
  });
});
