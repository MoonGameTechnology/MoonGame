/**
 * ШЕСТАЯ ГЛАВА СЕКТОРА ЗЕРО — карта «Нулевой комплекс».
 *
 * Дизайн — `docs/sector-zero-map-concepts.md` §8 (согласован с владельцем 2026-09-28): финальный
 * штурм места рождения системы и эвакуация людей. Разорванная спираль разломов вокруг смещённого
 * комплекса, три подхода к нему, поперечные связи и пары под «Коридор» через стену спирали.
 * Соседство выводится из мозаики (M4.3), поэтому всё это ПРОВЕРЯЕТСЯ здесь числами — любая
 * правка координат может молча поменять карту.
 *
 * Дверь главы (список глав клиента) откроется последним кирпичом фазы (PVR-8.7), когда сценарий
 * будет готов целиком; геометрия ниже собирается напрямую из данных карты.
 */
import { describe, expect, it } from 'vitest';
import {
  buildStateFromMap,
  contactedAllies,
  createKernel,
  getStance,
  identifiedNodes,
  matchMapEdges,
  parseMatchMap,
  pveModule,
  rendezvousModule,
  validateMatchMap,
  waveStagingWorld,
  type GameModule,
  type MatchConfig,
  type MatchMap,
} from '../packages/shared-core/src/index';
import { linkedAlly } from '../decisions/allyPanel';
import { allyActiveOp } from '../decisions/allyOperation';
import { ru } from '../localization/ru';
import { en } from '../localization/en';
import { shippedGameData } from './bundle';
import mapJson from './maps/pve-6.json';
import fourthMapJson from './maps/pve-4.json';

const data = shippedGameData();
const map: MatchMap = parseMatchMap(mapJson);
const edges = matchMapEdges(map, data).paths;

/** Внутренний виток — прямой подход: два ряда, Бастион на южном. */
const INNER = ['scar_field', 'rampart', 'lower_gate', 'cinder_reach', 'inner_waste', 'inner_gate'];
/** Промышленный фланг — северо-запад и север, две литейные Роя. */
const FLANK = [
  'slag_belt',
  'west_foundry',
  'ash_plain',
  'north_foundry',
  'outer_station',
  'pale_drift',
];
/** Южная дуга — внешний виток и путь эвакуации, два ряда. */
const SOUTH = [
  'south_wake',
  'toll_post',
  'ember_drift',
  'dock_approach',
  'hollow_reach',
  'drift_ward',
  'burnt_hulls',
  'salvage_line',
];
const DOCKS = ['quarantine_docks', 'cold_moorings', 'voices_chapel'];
const EAST = ['east_spur', 'east_terrace', 'core_shadow'];
const NORTH = ['north_watch', 'crown_ridge', 'spore_vents'];
/** Разрывы стены спирали: каждый связывает её внешнюю и внутреннюю сторону. */
const GAPS = ['breach', 'seam', 'core_shadow', 'complex_rim', 'ash_plain'];

const BASE = 'forward_base';
const COMPLEX = 'complex';
const DOCK = 'quarantine_docks';

const pos = (id: string): { x: number; y: number } => map.sectors[id]!.position;
const dist = (a: string, b: string): number => Math.hypot(pos(a).x - pos(b).x, pos(a).y - pos(b).y);
const blocked = (id: string): boolean =>
  data.sectorKinds[map.sectors[id]!.kind]?.traversable === false;
const provinces = Object.keys(map.sectors).filter((id) => !blocked(id));
const neighbours = (id: string): string[] =>
  edges.flatMap(([a, b]) => (a === id ? [b] : b === id ? [a] : []));

/** Кратчайший путь (в единицах карты) по дорогам, минуя `banned`; Infinity — пути нет. */
function route(from: string, to: string, banned: Iterable<string> = []): number {
  const ban = new Set(banned);
  const best = new Map<string, number>([[from, 0]]);
  const open = new Set([from]);
  while (open.size > 0) {
    const cur = [...open].sort((a, b) => best.get(a)! - best.get(b)! || (a < b ? -1 : 1))[0]!;
    open.delete(cur);
    if (cur === to) return best.get(cur)!;
    for (const next of neighbours(cur)) {
      if (ban.has(next)) continue;
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

describe('карта шестой главы — «Нулевой комплекс»', () => {
  it('проходит валидатор на ШИПНУТОМ каталоге, соседство выводится из мозаики', () => {
    expect(validateMatchMap(map, data)).toEqual([]);
    expect(matchMapEdges(map, data).derived).toBe(true);
    expect((mapJson as { paths?: unknown }).paths).toBeUndefined();
  });

  it('провинций 34–38 (§8.2), перелёты короткие, а не пустые плечи', () => {
    expect(provinces.length).toBeGreaterThanOrEqual(34);
    expect(provinces.length).toBeLessThanOrEqual(38);
    // §8.2: «важны короткие переброски и обходы, а не рост пустых расстояний».
    const mean = edges.reduce((s, [a, b]) => s + dist(a, b), 0) / edges.length;
    expect(mean).toBeLessThan(300);
  });

  it('стена спирали — разломы без путей, а комплекс смещён к северо-востоку', () => {
    const wall = Object.keys(map.sectors).filter(blocked);
    expect(wall.length).toBeGreaterThanOrEqual(10);
    for (const id of wall) {
      expect(map.sectors[id]!.kind, id).toBe('rift');
      expect(neighbours(id), id).toEqual([]);
    }
    const xs = provinces.map((id) => pos(id).x);
    const ys = provinces.map((id) => pos(id).y);
    expect(pos(COMPLEX).x).toBeGreaterThan((Math.min(...xs) + Math.max(...xs)) / 2);
    expect(pos(COMPLEX).y).toBeLessThan((Math.min(...ys) + Math.max(...ys)) / 2);
  });

  it('внутренний виток огорожен стеной: наружу из него ведут только разрывы', () => {
    const inside = new Set([...INNER, ...GAPS, COMPLEX]);
    for (const id of INNER)
      for (const n of neighbours(id)) expect(inside.has(n), `${id} → ${n} мимо стены`).toBe(true);
  });

  it('пять разрывов связывают стороны стены', () => {
    const touches = (gap: string, side: string[]): boolean =>
      neighbours(gap).some((n) => side.includes(n));
    expect(neighbours('breach')).toContain(BASE);
    expect(touches('breach', INNER)).toBe(true);
    expect(touches('seam', SOUTH)).toBe(true);
    expect(touches('seam', INNER)).toBe(true);
    expect(touches('core_shadow', ['east_spur', 'east_terrace'])).toBe(true);
    expect(neighbours('core_shadow')).toContain(COMPLEX);
    expect(neighbours('complex_rim')).toContain('north_foundry');
    expect(neighbours('complex_rim')).toContain(COMPLEX);
    expect(touches('ash_plain', ['west_foundry', 'north_foundry'])).toBe(true);
    expect(touches('ash_plain', INNER)).toBe(true);
  });

  it('ТРИ ПОДХОДА к комплексу, и каждый — самостоятельный путь; прямой короче', () => {
    // К комплексу ведут ровно три дороги — с трёх сторон (§8.2).
    expect(neighbours(COMPLEX).sort()).toEqual(['complex_rim', 'core_shadow', 'inner_gate']);
    const direct = route(BASE, COMPLEX, [
      ...FLANK,
      ...SOUTH,
      ...DOCKS,
      ...EAST,
      ...NORTH,
      'seam',
      'complex_rim',
    ]);
    const flank = route(BASE, COMPLEX, [...INNER, ...SOUTH, ...DOCKS, ...EAST, ...NORTH, 'seam']);
    const docks = route(BASE, COMPLEX, [...INNER, ...FLANK, ...NORTH, 'seam', 'complex_rim']);
    for (const r of [direct, flank, docks]) expect(r).toBeLessThan(Infinity);
    expect(direct).toBeLessThan(flank);
    expect(direct).toBeLessThan(docks);
    // Фланг проходит обе литейные, третий подход — район доков (сами доки или часовня рядом).
    for (const foundry of ['west_foundry', 'north_foundry'])
      expect(
        route(BASE, COMPLEX, [...INNER, ...SOUTH, ...DOCKS, ...EAST, ...NORTH, 'seam', foundry]),
      ).toBe(Infinity);
    expect(
      route(BASE, COMPLEX, [...INNER, ...FLANK, ...NORTH, 'seam', 'complex_rim', ...DOCKS]),
    ).toBe(Infinity);
  });

  it('прямой подход идёт мимо основной обороны: Бастион на кратчайшем пути, обход рядом', () => {
    const shortest = route(BASE, COMPLEX);
    expect(route(BASE, COMPLEX, ['rampart'])).toBeGreaterThan(shortest);
    // Северный ряд витка обходит Бастион, но недалеко: это обход, а не другой подход.
    expect(route(BASE, COMPLEX, ['rampart'])).toBeLessThan(1.2 * shortest);
  });

  it('доки — не тупик: связаны с южной дугой, восточным отрогом и швом', () => {
    expect(neighbours(DOCK).length).toBeGreaterThanOrEqual(3);
    // С дуги — без отрога; к комплексу — без дуги; к внутреннему витку — через шов.
    expect(route(DOCK, BASE, EAST)).toBeLessThan(Infinity);
    expect(route(DOCK, COMPLEX, [...SOUTH, ...INNER])).toBeLessThan(Infinity);
    expect(route(DOCK, 'lower_gate', ['east_spur', 'core_shadow', COMPLEX])).toBeLessThan(Infinity);
  });

  it('путь эвакуации от доков к базе идёт южной дугой — мимо Бастиона и комплекса', () => {
    const evac = route(DOCK, BASE);
    expect(route(DOCK, BASE, [...INNER, COMPLEX, 'seam'])).toBe(evac);
    // Дуга в два ряда: застава Роя на пути — не единственная дорога.
    expect(route(DOCK, BASE, ['toll_post'])).toBeLessThan(Infinity);
  });

  it('один потерянный перекрёсток не запирает ни штурм, ни эвакуацию', () => {
    for (const id of provinces) {
      if (id !== BASE && id !== COMPLEX)
        expect(route(BASE, COMPLEX, [id]), `штурм без ${id}`).toBeLessThan(Infinity);
      if (id !== BASE && id !== DOCK)
        expect(route(DOCK, BASE, [id]), `эвакуация без ${id}`).toBeLessThan(Infinity);
    }
  });

  it('ПАРЫ ПОД «КОРИДОР» через стену: к транспортам и для переброски резерва', () => {
    const range = data.heroAbilities.corridor!.range!;
    // Любые две близкие провинции связаны и без героя.
    for (let i = 0; i < provinces.length; i++)
      for (let j = i + 1; j < provinces.length; j++) {
        const a = provinces[i]!;
        const b = provinces[j]!;
        if (dist(a, b) <= range)
          expect(route(a, b), `${a}–${b}: путь без героя`).toBeLessThan(Infinity);
      }
    // §8.2: «Коридор» полезен для выхода к транспортам или переброски резерва.
    for (const [a, b] of [
      ['seam', DOCK], // к транспортам
      ['scar_field', 'south_wake'], // резерв между прямым подходом и путём эвакуации
      ['rampart', 'toll_post'],
    ] as const) {
      expect(neighbours(a), `${a}–${b}`).not.toContain(b);
      expect(dist(a, b), `${a}–${b}`).toBeLessThanOrEqual(range);
      expect(route(a, b), `${a}–${b}`).toBeGreaterThanOrEqual(2 * dist(a, b));
    }
  });
});

describe('кто где стоит (§8.2–§8.4)', () => {
  const state = buildStateFromMap(map, data);

  it('игрок стартует с ОДНОЙ планетой: база на юго-западе, она же убежище', () => {
    expect(Object.keys(map.sectors).filter((id) => map.sectors[id]!.owner === 'p1')).toEqual([
      BASE,
    ]);
    expect(map.sectors[BASE]!.traits).toContain('haven');
    const xs = provinces.map((id) => pos(id).x);
    expect(pos(BASE).x).toBeLessThan(Math.min(...xs) + 300);
    // Ближняя экономика — за базой, до главного штурма: свободная планета и астероиды рядом.
    expect(neighbours(BASE)).toEqual(expect.arrayContaining(['free_colony', 'ore_shelf']));
    expect(map.sectors.free_colony!).toMatchObject({ kind: 'planet', owner: null });
  });

  it('союзник — житель карты в тылу у пути эвакуации', () => {
    expect(state.players.ally).toMatchObject({ npc: 'neutral', ai: true, faction: 'vanguard' });
    const camp = map.sectors.ally_camp!;
    expect(camp.owner).toBe('ally');
    expect(camp.buildings.some((b) => b.type === 'shipyard')).toBe(true);
    // Тыл: дальше от комплекса, чем база, и рядом с концом пути эвакуации.
    expect(route('ally_camp', COMPLEX)).toBeGreaterThan(route(BASE, COMPLEX));
    expect(neighbours('ally_camp')).toContain('rear_drift');
    // Своя задача — застава Роя на южной дуге.
    expect(map.sectors.toll_post!).toMatchObject({ owner: 'swarm', traits: ['ally_task'] });
    expect(SOUTH).toContain('toll_post');
  });

  it('доки держит десант Роя, выжившие ждут на транспортах и входят в игру по прибытии', () => {
    const docks = map.sectors[DOCK]!;
    expect(docks.owner).toBe('swarm');
    expect(docks.garrison.reduce((n, u) => n + u.count, 0)).toBeGreaterThan(0);
    const transports = Object.values(map.fleets).filter((f) =>
      f.units.some((u) => data.units[u.unit]?.traits.includes('evacuee')),
    );
    expect(transports).toHaveLength(1);
    expect(transports[0]).toMatchObject({ owner: 'p1', location: DOCK, joinsOnArrival: true });
    // До прибытия флота игрока транспортов среди флотов нет: они ждут на планете.
    expect(Object.values(state.fleets).some((f) => f.location === DOCK && f.owner === 'p1')).toBe(
      false,
    );
    expect(state.planets[DOCK]!.awaitingFleets?.map((f) => f.id)).toEqual(['p1_evac']);
  });

  it('на старте о доках не знает никто: эпизод доков — по настоящему обнаружению (§8.4)', () => {
    for (const viewer of ['p1', 'ally'])
      expect(identifiedNodes(state, viewer, data).has(DOCK), viewer).toBe(false);
  });

  it('производят Рой три мира — комплекс и две литейные; Бастион — крепость без производства', () => {
    // Очаг производства — улей или постройка, которая что-то производит. Верфь сюда не входит:
    // она стоит на каждом мире с постройками (`construction-yard-port.test.ts`).
    const producing = swarmWorlds.filter((id) =>
      map.sectors[id]!.buildings.some(
        (b) =>
          b.type === 'swarm_hive' || Object.keys(data.buildings[b.type]?.produces ?? {}).length > 0,
      ),
    );
    expect(producing.sort()).toEqual(['complex', 'north_foundry', 'west_foundry']);
    // Контракт операции (§8.8, PVR-8.3) называет очагами ровно их: Бастион и прочие миры Роя
    // в обязательную зачистку не входят.
    expect([...map.operation!.production].sort()).toEqual(producing);
    const complex = map.sectors[COMPLEX]!.buildings.map((b) => b.type);
    expect(complex).toEqual(expect.arrayContaining(['swarm_hive', 'swarm_datacenter']));
    const rampart = map.sectors.rampart!.buildings.map((b) => b.type);
    expect(rampart).toEqual(expect.arrayContaining(['fort', 'orbital_aa']));
    expect(map.sectors.rampart!.garrison.reduce((n, u) => n + u.count, 0)).toBeGreaterThan(
      Math.max(
        ...['west_foundry', 'north_foundry'].map((id) =>
          map.sectors[id]!.garrison.reduce((n, u) => n + u.count, 0),
        ),
      ),
    );
  });

  it('главные силы Роя — три соединения: у комплекса, у Бастиона и в резерве на севере', () => {
    const at = (id: string) => map.fleets[id]!.location;
    expect([at('swarm_guard'), at('swarm_host'), at('swarm_reserve')]).toEqual([
      COMPLEX,
      'rampart',
      'north_watch',
    ]);
    for (const id of ['swarm_guard', 'swarm_host', 'swarm_reserve'])
      expect(
        map.fleets[id]!.units.some((u) => u.unit === 'swarm_brood_mother'),
        id,
      ).toBe(true);
    // Они же — главные силы в контракте операции (§8.8, PVR-8.3); волны и ретранслятор — нет.
    expect(map.operation!.forces).toEqual(['swarm_guard', 'swarm_host', 'swarm_reserve']);
  });

  it('основной эвакуации хватит трёх транспортов из четырёх, «Никого не оставить» — всех', () => {
    const transports = map.fleets.p1_evac!.units.reduce((n, u) => n + u.count, 0);
    expect(transports).toBe(4);
    expect(map.operation!.evacuate).toBe(3);
    expect(map.objectives.find((o) => o.id === 'mission.all-survivors')?.count).toBe(transports);
  });

  it('волны рождаются в комплексе, а Рой воюет и с игроком, и с союзником', () => {
    const seeded = createKernel([pveModule]).advanceTo(state, {
      now: 3_600_000,
      data,
      config: { timeScale: 1, modeId: map.mode } as MatchConfig,
    });
    expect(seeded.ok).toBe(true);
    if (!seeded.ok) return;
    expect(seeded.state.pve?.home).toBe(COMPLEX);
    expect(waveStagingWorld(seeded.state)).toBe(COMPLEX);
    for (const side of ['p1', 'ally'])
      expect(getStance(seeded.state, 'swarm', side), side).toBe('war');
  });
});

describe('союзник с первой минуты (§8.3, PVR-8.2)', () => {
  const state = buildStateFromMap(map, data);
  /** Мир после посева PvE: Рой уже объявил войну всем (посев едет на `time.advanced`, нулевой отрезок его не зовёт). */
  const seeded = () => {
    const r = createKernel([pveModule]).advanceTo(state, {
      now: 3_600_000,
      data,
      config: { timeScale: 1, modeId: map.mode } as MatchConfig,
    });
    if (!r.ok) throw new Error(r.code);
    return r.state;
  };

  it('повторного знакомства нет: связь и союз — с нулевой минуты', () => {
    expect(getStance(state, 'p1', 'ally')).toBe('alliance');
    expect(contactedAllies(state, 'p1')).toEqual(['ally']);
    expect(state.missionFacts?.contacted).toEqual({ p1: ['ally_camp'] });
    // Рою союз не достаётся: связь пишется только людям.
    expect(getStance(state, 'swarm', 'ally')).not.toBe('alliance');
  });

  it('прибытие в лагерь союзника — не вторая встреча: события знакомства нет', () => {
    /** Звонок — поднимает прибытие так же, как его поднимает движение (как в `rendezvous.test.ts`). */
    const bell: GameModule = {
      id: 'test-bell',
      version: '1.0.0',
      setup(api) {
        api.onAction('test.arrived', (action, h) => h.emit('fleet.arrived', action.payload));
      },
    };
    const there = JSON.parse(JSON.stringify(state)) as typeof state;
    there.fleets.p1_1 = { ...there.fleets.p1_1!, location: 'ally_camp', movement: null };
    const r = createKernel([rendezvousModule, bell]).applyAction(
      there,
      {
        id: 'a1',
        type: 'test.arrived',
        playerId: 'p1',
        payload: { fleetId: 'p1_1', at: 'ally_camp' },
        issuedAt: 0,
      },
      { now: 0, data, config: { timeScale: 1 } as MatchConfig },
    );
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.events.map((e) => e.type)).toEqual(['fleet.arrived']);
    expect(r.state.missionFacts?.contacted).toEqual({ p1: ['ally_camp'] });
  });

  it('обзор общий: что опознал один, опознал и другой', () => {
    const mine = [...identifiedNodes(state, 'p1', data)].sort();
    expect(mine).toEqual([...identifiedNodes(state, 'ally', data)].sort());
    // Лагерь союзника виден игроку с первой минуты, хотя до него два перехода от базы.
    expect(neighbours(BASE)).not.toContain('ally_camp');
    expect(mine).toContain('ally_camp');
  });

  it('окно «Связь с союзником» открыто, без приказа союзник ведёт свою задачу', () => {
    expect(linkedAlly(state, 'p1')).toBe('ally');
    expect(allyActiveOp(seeded(), 'ally')).toMatchObject({
      source: 'own',
      op: { kind: 'attack', planet: 'toll_post' },
    });
  });

  it('приказ союзнику принимается с первой минуты и переживает сохранение', () => {
    const order = (s: typeof state) =>
      createKernel([rendezvousModule]).applyAction(
        s,
        {
          id: 'o1',
          type: 'ally.order',
          playerId: 'p1',
          payload: { ally: 'ally', kind: 'guard', planet: BASE },
          issuedAt: 0,
        },
        { now: 0, data, config: { timeScale: 1 } as MatchConfig },
      );
    const r = order(state);
    expect(r.ok).toBe(true);
    if (r.ok)
      expect(r.state.allyOps?.ally).toMatchObject({ by: 'p1', kind: 'guard', planet: BASE });
    // Сохранение — это JSON: связь и союз из него не выпадают.
    const reloaded = JSON.parse(JSON.stringify(state)) as typeof state;
    expect(contactedAllies(reloaded, 'p1')).toEqual(['ally']);
    expect(order(reloaded).ok).toBe(true);
  });
});

describe('задачи шестой главы — пул из двенадцати (§8.8)', () => {
  const objectives = map.objectives;
  const state = buildStateFromMap(map, data);
  const find = (id: string) => objectives.find((o) => o.id === id)!;

  it('двенадцать задач, не меньше четвёртой главы (PVR-5.6: запас не убывает)', () => {
    expect(objectives).toHaveLength(12);
    expect(new Set(objectives.map((o) => o.id)).size).toBe(12);
    expect(objectives.length).toBeGreaterThanOrEqual(
      parseMatchMap(fourthMapJson).objectives.length,
    );
    expect(map.objectiveSlots).toEqual({ base: 4, cap: 6 });
  });

  it('каждая задача названа на обоих языках и указывает на то, что есть на карте', () => {
    for (const o of objectives) {
      expect(o.id in ru && o.id in en, o.id).toBe(true);
      expect(o.reward, o.id).toBeGreaterThan(0);
      if (['control', 'beacon'].includes(o.kind))
        for (const id of o.targets) expect(map.sectors[id], `${o.id}: ${id}`).toBeDefined();
      if (o.kind === 'raze' || o.kind === 'build')
        for (const b of o.targets) expect(data.buildings[b], `${o.id}: ${b}`).toBeDefined();
      for (const id of o.at ?? []) {
        const kind = data.sectorKinds[map.sectors[id]!.kind]!;
        expect(kind.buildable, `${o.id}: ${id}`).toBe(true);
        for (const b of o.targets)
          expect(kind.allowedBuildings ?? [b], `${o.id}: ${id}`).toContain(b);
      }
    }
  });

  it('три побочные задачи §8.8: Книги голосов, внешняя станция, все выжившие', () => {
    // Книги голосов — маяк у часовни рядом с доками: удержать, пока копируются записи.
    expect(find('mission.chapel-books')).toMatchObject({
      kind: 'beacon',
      targets: ['voices_chapel'],
    });
    expect(map.sectors.voices_chapel!).toMatchObject({ owner: null, traits: ['beacon'] });
    expect(neighbours('voices_chapel')).toContain(DOCK);
    // Внешняя станция — у Роя, за ней богатый тупик с одним подходом.
    expect(find('mission.outer-station')).toMatchObject({
      kind: 'control',
      targets: ['outer_station'],
    });
    expect(map.sectors.outer_station!.owner).toBe('swarm');
    expect(neighbours('pale_drift')).toEqual(['outer_station']);
    // Все выжившие — сколько транспортов ждёт в доках.
    const waiting = state.planets[DOCK]!.awaitingFleets!.flatMap((f) => f.units);
    expect(find('mission.all-survivors')).toMatchObject({
      kind: 'evac',
      count: waiting.reduce((n, u) => n + u.count, 0),
    });
  });

  it('«Рубеж у доков» — форт на причале, через который идёт путь эвакуации (§8.7)', () => {
    expect(find('mission.dock-line')).toMatchObject({
      kind: 'build',
      targets: ['fort'],
      at: ['dock_approach'],
    });
    expect(route(DOCK, BASE, ['dock_approach'])).toBeGreaterThan(route(DOCK, BASE));
  });

  it('военные задачи — миры Роя, а не пустые клетки', () => {
    for (const [id, at] of [
      ['mission.take-rampart', 'rampart'],
      ['mission.north-watch', 'north_watch'],
    ] as const) {
      expect(find(id)).toMatchObject({ kind: 'control', targets: [at] });
      expect(map.sectors[at]!.owner).toBe('swarm');
    }
    expect(find('mission.raze-biomass')).toMatchObject({ kind: 'raze', targets: ['biomass_pit'] });
    expect(
      swarmWorlds.filter((id) => map.sectors[id]!.buildings.some((b) => b.type === 'biomass_pit'))
        .length,
    ).toBeGreaterThan(0);
  });
});

describe('«Последний приют» и последний контрудар (§8.4, §8.7, PVR-8.4)', () => {
  const state = buildStateFromMap(map, data);

  it('место эпизода одно — доки, и на старте сведений о нём нет ни у кого', () => {
    expect(
      Object.keys(map.sectors).filter((id) => map.sectors[id]!.traits.includes('refuge')),
    ).toEqual([DOCK]);
    expect(state.missionFacts?.found).toBeUndefined();
  });

  it('задачи доков молчат на карте, пока о доках не узнали: книги, все выжившие, рубеж', () => {
    expect(
      map.objectives.filter((o) => o.revealedBy !== undefined).map((o) => [o.id, o.revealedBy]),
    ).toEqual([
      ['mission.chapel-books', DOCK],
      ['mission.all-survivors', DOCK],
      ['mission.dock-line', DOCK],
    ]);
  });

  it('контрудар — после потери обеих литейных и по докам; комплекс в условие не входит', () => {
    expect(map.operation!.counterattack).toEqual({
      after: ['north_foundry', 'west_foundry'],
      target: DOCK,
    });
    // Внешние позиции — литейные из списка очагов; сердце операции — комплекс.
    for (const id of map.operation!.counterattack!.after)
      expect(map.operation!.production).toContain(id);
    expect(map.operation!.counterattack!.after).not.toContain(COMPLEX);
    expect(state.operation?.counterattack).toEqual(map.operation!.counterattack);
  });
});
