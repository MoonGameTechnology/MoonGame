/**
 * The prototype's sector-type registry and the generated match map — a rotationally
 * symmetric «wheel» of ten 36° sectors around a shared hub, wired by an index
 * template so every start position maps onto every other one (BAL-1; the long
 * rationale sits above `HUB`). Extracted from `game.ts` (REFP-2): the block depended only on `data`
 * (for `SECTOR_TYPES` derivation) and the core `sectorKind` helpers, none of the
 * rest of `game.ts`. `game.ts` re-exports the public surface (`SECTOR_TYPES`,
 * `MapNode`, `SectorType`, `START_CANDIDATES`, `MAP`) for back-compat.
 */
import {
  allowedBuildings,
  hasOrbit,
  isBuildable,
  isCapturable,
} from '../../packages/shared-core/src/index';
import { data } from './prototypeData';

/**
 * Sector-type registry — the whole map is a graph of sectors, each of exactly one
 * type. Types are pure data: add/remove them freely; every type carries its own
 * properties, and rendering + behaviour read from here (no hard-coded sector logic).
 *   core       — terrain key in `data.sectors` (speed/HP bonuses) this type maps to
 *   capturable — can be owned/taken (empty space can't — only traversed)
 *   buildable  — structures can be raised here
 *   orbit      — has the orbital layer; fleets can station in orbit (cities, fortresses)
 *   color      — map accent for the type
 */
export interface SectorType {
  name: string;
  core: string;
  capturable: boolean;
  buildable: boolean;
  orbit: boolean;
  color: string;
  /** Province-centric build roster (the buildings raisable here). Absent = the
   *  default `BUILDABLE` set. Mirrors core `sectorKinds.allowedBuildings`. */
  allowedBuildings?: string[];
}
/** The prototype's UI delta per sector kind: display name, `data.sectors` terrain
 *  mapping and map colour, plus an optionally STRICTER build roster than the core's
 *  (asteroid: the UI offers only the starfort even though the core kind is open). */
interface SectorTypeUi {
  name: string;
  core: string;
  color: string;
  allowedBuildings?: string[];
}
const SECTOR_TYPE_UI: Record<string, SectorTypeUi> = {
  planet: { name: 'Planet', core: 'empty_space', color: '#5fd0ff' },
  nebula: { name: 'Nebula', core: 'nebula', color: '#8f6dff' },
  asteroid: {
    name: 'Asteroid Field',
    core: 'asteroid_field',
    color: '#d6a645',
    allowedBuildings: ['starfort'],
  },
  empty: { name: 'Empty Space', core: 'empty_space', color: '#46606e' },
  // new terrains — each maps to a core `data.sectors` entry for its speed/HP bonus
  ion_storm: { name: 'Ion Storm', core: 'ion_storm', color: '#6fe3ff' },
  dense_nebula: { name: 'Dense Nebula', core: 'dense_nebula', color: '#a78bff' },
  solar_flare: { name: 'Solar Flare Zone', core: 'solar_flare_zone', color: '#ff9f3a' },
  graveyard: { name: 'Derelict Graveyard', core: 'derelict_graveyard', color: '#9fb0a8' },
  // debris field — a fast but UN-capturable corridor (kind `debris_field` in sectorKinds)
  debris_field: { name: 'Debris Field', core: 'deep_void', color: '#2f4a59' },
  // dead world — a destroyed planet; re-claimable, only the salvage rig builds here
  dead_world: { name: 'Dead World', core: 'deep_void', color: '#5a4a4a' },
};

/** SECTOR_TYPES = UI delta + gameplay flags DERIVED from `data.sectorKinds` via the
 *  core's own resolution (permissive default for kinds the data doesn't list) — one
 *  source of truth for capturable/buildable/orbit, so the prototype can't drift from
 *  what the kernel actually enforces. `allowedBuildings` stays the UI roster: the
 *  prototype may be stricter than the core (asteroid), else it mirrors the data
 *  (dead_world's salvage rig comes from `data.sectorKinds`). */
export const SECTOR_TYPES: Record<string, SectorType> = Object.fromEntries(
  Object.entries(SECTOR_TYPE_UI).map(([kind, ui]) => {
    const planet = { kind };
    const roster = ui.allowedBuildings ?? allowedBuildings(data, planet);
    const type: SectorType = {
      name: ui.name,
      core: ui.core,
      color: ui.color,
      capturable: isCapturable(data, planet),
      buildable: isBuildable(data, planet),
      orbit: hasOrbit(data, planet),
      ...(roster === undefined ? {} : { allowedBuildings: roster }),
    };
    return [kind, type];
  }),
);

// --- the map -----------------------------------------------------------------

/** One sector node. `sector` is its type key (see SECTOR_TYPES); `links` are the
 *  paths to neighbouring sectors; `type` is the planet-type (bonuses) for worlds. */
export interface MapNode {
  id: string;
  owner: string | null;
  x: number;
  y: number;
  sector: string;
  type?: string;
  links: string[];
  buildings?: Array<{ type: string; level?: number }>;
  garrison?: Array<[string, number]>;
}

type KeyNode = Omit<MapNode, 'links'>;

// «КОЛЕСО» — десять секторов вокруг ступицы, ни один старт не даёт форы (BAL-1 → BAL-9).
//
// Откуда конструкция. Поле было квадратной сеткой 11×11, зеркальной по обеим осям, а старты
// стояли по периметру. Зеркало уравнивает ПРОТИВОПОЛОЖНЫЕ клетки, но не клетки РАЗНОГО РОДА:
// на квадрате позиция у середины стороны и позиция у угла структурно различны, сколько их ни
// отражай. Замер это и показал: у `C5R1` в радиусе 500 лежало десять призовых миров, у `C2R1`
// — шесть, и первый выигрывал 77–80% матчей, давая +62…83% очков (BAL-1). Колесо это вылечило:
// десять секторов по 36° вокруг общей ступицы, и старт переводится в старт поворотом.
//
// Почему конструкция изменилась ВТОРОЙ раз (BAL-9, заказ владельца). Равнозначность-по-повороту
// покупалась ценой того, что все секторы БУКВАЛЬНО одинаковы: одна и та же решётка «четыре
// кольца по три», у каждого узла 3–4 связи, ни одного тупика, все расстояния равны. Карта
// стала честной и — плоской. Теперь бюджет и рисунок разведены:
//
//   • БЮДЖЕТ у секторов общий. Один и тот же граф-шаблон (те же 14 рёбер по индексам, те же
//     роли узлов) ⟹ все графовые инварианты старта совпадают ТОЧНО: миры в 1/2/3 прыжках,
//     очки вокруг, число выходов, дистанция до ближайшего соперника. Плюс одинаковая СУММА
//     длин путей от старта до всех своих провинций (см. калибровку ниже) и одинаковая сумма
//     производственных бонусов пары нейтральных миров.
//   • РИСУНОК у каждого свой. Радиусы и углы узлов джиттерятся детерминированным хешем от
//     номера сектора, поэтому у одного ближний приз в 64 px от старта, у другого — в 155;
//     террейны разложены по узлам циклическим сдвигом (мультимножество то же). Третьей осью
//     различия пробовали типы планет — не выдержала замера, см. `NEUTRAL_PLANET_TYPES`.
//
// Калибровка — гомотетия. Джиттер меняет суммарную длину путей внутри сектора, а это и есть
// «сколько времени стоит владеть своим двором». Поэтому радиусы сектора умножаются на `m`,
// подобранный так, чтобы сумма сошлась с эталонной. Узлы заданы полярно от ступицы, значит
// умножение радиусов — гомотетия относительно неё: ВСЕ внутрисекторные длины растут ровно в
// `m` раз, и `m = эталон / сумма(k)` считается одной формулой, без поиска. Бюджет сходится
// точно, а рисунок остаётся кривым.
//
// Хаос связности задан самим шаблоном, а не случайностью: у каждого сектора два ТУПИКА (узел
// с единственным входом) — внешний выступ и глубокая планета `P2`, два коридора со степенью 2,
// и один перекрёсток со степенью 5. Соседние по геометрии узлы связаны не всегда: маршрутная
// сеть — это граф, а не «всё со всем поблизости». Стык соседних секторов — ДВА прохода
// (внешний и глубинный), а не четыре, как было в решётке.
//
// Что осталось от старого колеса: 121 узел, 30 миров вида `planet` (10 стартов + 20
// нейтральных, по два на сектор), ~2410 базовых очков при `SCORE_LIMIT` 1100, порядок
// `START_CANDIDATES` по кругу (поэтому «+5 из десяти» — буквально напротив) и профиль старта
// по прыжкам (приз в одном прыжке, второй мир в трёх, ближайший соперник в трёх).
//
// ЦЕНА, заплаченная осознанно: нейтральные миры несут ДВА типа планет из девяти (BAL-8 остаётся
// открытым). Тип задаёт не только производство от −0.25 до +0.45, но и оборону, и СОСТАВ добычи,
// а ресурсы не равноценны — поэтому «равная сумма бонусов» равноценности не даёт, что и показал
// замер чередующихся пар.
const HUB = { x: 800, y: 800 };
const SECTORS = 10;
const SECTOR_ARC = (Math.PI * 2) / SECTORS;
/** Ступица — мёртвый мир в центре: равноудалён от всех десяти стартов, поэтому не даёт
 *  никому форы, и это единственное место, где строится `metal_station`. */
const HUB_ID = 'C0R0';

/** Роль узла в шаблоне сектора. Позиция в массиве = индекс узла, он же номер в `C{k}R{i+1}`. */
type Role = 'start' | 'planet' | 'terrain';
/** Шаблон сектора: 12 узлов. Радиус — от ступицы, угол — от оси сектора (радианы).
 *  Раскладка НЕ решётка: узлы стоят слоями с разным вылетом, `7` торчит наружу тупиком,
 *  `2` (вторая планета) сидит тупиком в глубине. */
const SLOTS: Array<{ r: number; a: number; role: Role }> = [
  { r: 640, a: 0.0, role: 'start' }, //  0 — стартовый мир, по оси сектора
  { r: 560, a: 0.13, role: 'planet' }, //  1 — приз у порога (один прыжок)
  { r: 200, a: -0.02, role: 'planet' }, //  2 — глубокий приз, ТУПИК
  { r: 600, a: -0.21, role: 'terrain' }, //  3 — левый край, стык с соседом
  { r: 615, a: 0.21, role: 'terrain' }, //  4 — правый край, стык с соседом
  { r: 405, a: -0.19, role: 'terrain' }, //  5 — коридор (степень 2)
  { r: 470, a: 0.21, role: 'terrain' }, //  6
  { r: 700, a: 0.09, role: 'terrain' }, //  7 — выступ наружу, ТУПИК
  { r: 450, a: -0.06, role: 'terrain' }, //  8
  { r: 330, a: 0.1, role: 'terrain' }, //  9
  { r: 240, a: 0.2, role: 'terrain' }, // 10 — глубинный стык + ступица
  { r: 300, a: -0.2, role: 'terrain' }, // 11 — перекрёсток (степень 5)
];
/** Маршрутная сеть внутри сектора — 14 рёбер по ИНДЕКСАМ, поэтому одна и та же у всех
 *  десяти секторов независимо от того, как разъехалась их геометрия. */
const SECTOR_EDGES: Array<[number, number]> = [
  [0, 1],
  [0, 3],
  [0, 4],
  [4, 7],
  [4, 6],
  [1, 6],
  [3, 11],
  [5, 8],
  [6, 8],
  [5, 11],
  [11, 9],
  [8, 9],
  [9, 10],
  [11, 2],
];
/** Террейны девяти непланетных узлов — мультимножество одно на все секторы (иначе разъедутся
 *  бонусы скорости/HP), а раскладка по узлам частично своя. Порядок соответствует обходу
 *  непланетных слотов: 3, 4, 5, 6, 7, 8, 9, 10, 11. */
const SECTOR_TERRAIN = [
  'asteroid', // слот 3 — внешний стык, ЗАКРЕПЛЁН
  'nebula', // слот 4 — внешний стык, ЗАКРЕПЛЁН
  'graveyard', // слот 5 ┐
  'ion_storm', // слот 6 │
  'dense_nebula', // слот 7 ├ рядовые: перемешиваются сдвигом на номер сектора
  'solar_flare', // слот 8 │
  'asteroid', // слот 9 ┘
  'nebula', // слот 10 — глубинный стык + ступица, ЗАКРЕПЛЁН
  'graveyard', // слот 11 — перекрёсток степени 5, ЗАКРЕПЛЁН
];
/** Позиции в `SECTOR_TERRAIN`, которые крутятся от сектора к сектору. Остальные четыре стоят
 *  на структурно ВЛИЯТЕЛЬНЫХ узлах — двух внешних стыках, глубинном стыке и перекрёстке, —
 *  и закреплены замером: пока крутились все девять, бонусы скорости и обороны на этих узлах
 *  разъезжались, и секторы расходились по очкам на ±5% (устойчиво в обеих семьях сидов,
 *  корреляция 0.83). Мультимножество от перестановки не меняется, поэтому «набор одинаков,
 *  раскладка разная» продолжает выполняться — просто разница ушла с несущих узлов. */
const ROTATING_TERRAIN = [2, 3, 4, 5, 6];
/** Типы двух нейтральных миров сектора — ОДНИ И ТЕ ЖЕ у всех десяти.
 *
 *  Чередование двух пар здесь стояло и было снято замером. Вторая пара (`volcanic` +
 *  `relic_world`) подбиралась по равной сумме `productionBonus` (+0.30 против +0.30) и близкой
 *  добыче металла (15 против 17) — и всё равно проигрывала: 300 матчей на двух семьях дали
 *  секторам с `crystalline` **340 побед против 258**. Причина в том, что РЕСУРСЫ НЕ
 *  РАВНОЦЕННЫ (BAL-3): 12 кредитов `relic_world` не ограничивают ничего, кредитов и так 64k
 *  к 11-му дню, — а `crystalline` + `fortress_world` дают вдобавок +0.2 обороны, то есть
 *  удерживаются. Пока пары нельзя сравнивать по одному числу бонуса, тип остаётся общим, и
 *  секторы отличаются рисунком, а не содержимым (`BAL-8` — как собрать вторую равноценную). */
const NEUTRAL_PLANET_TYPES = ['crystalline', 'fortress_world'];

/** Детерминированный шум в [0,1) от (сектор, узел, соль) — целочисленный хеш, без RNG и без
 *  состояния: карта обязана быть одинаковой у клиента, прото-хоста и харнесов. */
function noise(k: number, i: number, salt: number): number {
  let h = Math.imul(k + 1, 73856093) ^ Math.imul(i + 1, 19349663) ^ Math.imul(salt, 83492791);
  h = Math.imul(h, 2654435761);
  h ^= h >>> 13;
  h = Math.imul(h, 1274126177);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}
/** Смещения слотов для сектора `k`, ЦЕНТРИРОВАННЫЕ (среднее ровно 0), чтобы джиттер кривил
 *  рисунок, но не раздувал и не сжимал сектор целиком — этим занимается только калибровка. */
function offsets(k: number, salt: number, amp: number): number[] {
  const raw = SLOTS.map((_, i) => amp * (noise(k, i, salt) * 2 - 1));
  const mean = raw.reduce((sum, v) => sum + v, 0) / raw.length;
  return raw.map((v) => v - mean);
}
const JITTER_R = 0.09; // ±9% радиуса
const JITTER_A = 0.03; // ±0.03 рад — узлы остаются внутри своего клина в 36°

/** Полярные координаты узлов сектора `k` при масштабе `m`. */
function sectorPolar(k: number, m: number): Array<{ x: number; y: number }> {
  const axis = k * SECTOR_ARC - Math.PI / 2; // сектор 0 смотрит вверх
  const dr = offsets(k, 1, JITTER_R);
  const da = offsets(k, 2, JITTER_A);
  return SLOTS.map((slot, i) => {
    const r = slot.r * (1 + dr[i]!) * m;
    const angle = axis + slot.a + da[i]!;
    return { x: HUB.x + Math.cos(angle) * r, y: HUB.y + Math.sin(angle) * r };
  });
}
/** Сумма длин кратчайших путей от старта до всех прочих узлов сектора — «во что обходится
 *  собственный двор». Это и есть выравниваемый бюджет; считается по рёбрам шаблона. */
function travelBudget(points: Array<{ x: number; y: number }>): number {
  const len = (a: number, b: number): number =>
    Math.hypot(points[a]!.x - points[b]!.x, points[a]!.y - points[b]!.y);
  const dist = SLOTS.map(() => Infinity);
  const done = SLOTS.map(() => false);
  dist[0] = 0;
  for (;;) {
    let at = -1;
    for (let i = 0; i < SLOTS.length; i += 1)
      if (!done[i] && dist[i]! < (dist[at] ?? Infinity)) at = i;
    if (at < 0) break;
    done[at] = true;
    for (const [a, b] of SECTOR_EDGES) {
      if (a !== at && b !== at) continue;
      const to = a === at ? b : a;
      const via = dist[at]! + len(at, to);
      if (via < dist[to]!) dist[to] = via;
    }
  }
  return dist.slice(1).reduce((sum, v) => sum + v, 0);
}
/** Эталон бюджета — сектор без джиттера. К нему гомотетией подтягиваются все десять. */
const BASE_BUDGET = travelBudget(
  SLOTS.map((slot) => ({
    x: HUB.x + Math.cos(-Math.PI / 2 + slot.a) * slot.r,
    y: HUB.y + Math.sin(-Math.PI / 2 + slot.a) * slot.r,
  })),
);

/** Террейн `idx`-го по счёту непланетного узла сектора `k`: закреплённые позиции стоят на
 *  месте, рядовые едут по кругу внутри своей пятёрки. */
function terrainAt(idx: number, k: number): string {
  const rotating = ROTATING_TERRAIN.indexOf(idx);
  if (rotating < 0) return SECTOR_TERRAIN[idx]!;
  return SECTOR_TERRAIN[ROTATING_TERRAIN[(rotating + k) % ROTATING_TERRAIN.length]!]!;
}

/** id узла: сектор k, позиция i в шаблоне. Формат тот же `C{n}R{m}`, что и у прежней
 *  сетки, — его читают имена миров (`planetName.ts`) и множество фикстур. */
const nodeId = (k: number, i: number): string => `C${k}R${i + 1}`;

function buildField(): KeyNode[] {
  const nodes: KeyNode[] = [
    // Ступица: мёртвый мир, общий для всех секторов.
    { id: HUB_ID, owner: null, x: HUB.x, y: HUB.y, sector: 'dead_world' },
  ];
  for (let k = 0; k < SECTORS; k += 1) {
    const points = sectorPolar(k, BASE_BUDGET / travelBudget(sectorPolar(k, 1)));
    let terrainIdx = 0;
    let planetIdx = 0;
    SLOTS.forEach((slot, i) => {
      const node: KeyNode = {
        id: nodeId(k, i),
        owner: null,
        x: Math.round(points[i]!.x),
        y: Math.round(points[i]!.y),
        sector: slot.role === 'terrain' ? terrainAt(terrainIdx++, k) : 'planet',
      };
      if (slot.role === 'start') node.type = 'terran';
      if (slot.role === 'planet') node.type = NEUTRAL_PLANET_TYPES[planetIdx++]!;
      nodes.push(node);
    });
  }
  return nodes;
}

const KEY: KeyNode[] = buildField();
/** Десять миров, на которых появляются игроки, по кругу — сектор за сектором. */
export const START_CANDIDATES: string[] = Array.from({ length: SECTORS }, (_, k) => nodeId(k, 0));

/**
 * Маршрутная сеть — ШАБЛОН в индексах, одинаковый для каждого сектора и потому не зависящий
 * от того, как разъехалась его геометрия. Три вида рёбер:
 *   • внутрисекторные — `SECTOR_EDGES`;
 *   • межсекторные — ДВА прохода на стык: внешний (правый край k ↔ левый край k+1) и
 *     глубинный (узел 10 ↔ узел 11 соседа);
 *   • ступица — связана с глубинным узлом 10 каждого сектора.
 */
function withNeighborLinks(nodes: KeyNode[]): MapNode[] {
  const adj = new Map<string, Set<string>>(nodes.map((n) => [n.id, new Set<string>()]));
  const link = (a: string, b: string): void => {
    adj.get(a)!.add(b);
    adj.get(b)!.add(a);
  };
  for (let k = 0; k < SECTORS; k += 1) {
    const next = (k + 1) % SECTORS;
    for (const [a, b] of SECTOR_EDGES) link(nodeId(k, a), nodeId(k, b));
    link(nodeId(k, 4), nodeId(next, 3)); // внешний проход к соседу
    link(nodeId(k, 10), nodeId(next, 11)); // глубинный проход к соседу
    link(HUB_ID, nodeId(k, 10)); // ступица
  }
  return nodes.map((n) => ({ ...n, links: [...adj.get(n.id)!] }));
}

// Bytro-style province map: only real provinces (no "empty" void waypoints), wired
// to their neighbours by shared border (relative-neighbourhood graph). Movement is
// province-to-adjacent; the links ARE the visible path network.
export const MAP: MapNode[] = withNeighborLinks(KEY);
