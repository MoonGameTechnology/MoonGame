/**
 * The prototype's sector-type registry and the generated match map — a square,
 * mirror-symmetric 11×11 lattice of provinces wired by a relative-neighbourhood
 * graph. Extracted from `game.ts` (REFP-2): the block depended only on `data`
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

// «КОЛЕСО» — карта, у которой ВСЕ ДЕСЯТЬ СТАРТОВ РАВНОЗНАЧНЫ ПО ПОСТРОЕНИЮ (BAL-1).
//
// Почему прежняя решётка не годилась. Поле было квадратной сеткой 11×11, зеркальной по
// обеим осям, а старты стояли по периметру. Зеркальная симметрия уравнивает ПРОТИВОПОЛОЖНЫЕ
// клетки, но не клетки РАЗНОГО РОДА: на квадрате позиция у середины стороны и позиция у угла
// структурно различны, сколько их ни отражай. Замер это и показал: у `C5R1` в радиусе 500
// лежало десять призовых миров, у `C2R1` — шесть, и первый выигрывал 77–80% матчей, давая
// +62…83% очков (кирпич BAL-1). Никакая перестановка миров внутри квадрата этого не лечит —
// лечит только структура, в которой все старты переходят друг в друга.
//
// Что здесь вместо неё. Десять СЕКТОРОВ по 36°, вокруг общей ступицы. Сектор — это шаблон из
// 12 узлов (четыре кольца по три), одинаковый для всех десяти и просто повёрнутый на k·36°.
// Карта переходит сама в себя при повороте на 36°, поэтому любой старт можно ПЕРЕВЕСТИ в
// любой другой поворотом — вместе со всем его двором, соседями и расстояниями. Равнозначность
// здесь не измеряется и не подгоняется: она следует из симметрии, и `mapFairness.test.ts`
// проверяет это по графу (число миров в 1/2/3 прыжках, сумма очков, дистанция до соседа).
//
// Связи заданы ШАБЛОНОМ, а не геометрией. Прежний relative-neighbourhood graph выводил рёбра
// из координат, и после поворота на иррациональный угол округление до целых пикселей давало
// у разных секторов чуть разные наборы рёбер — то есть ломало ровно ту симметрию, ради которой
// всё затевалось. Шаблон в индексах от координат не зависит вовсе. Соседние по геометрии узлы
// при этом связаны не всегда (внутри кольца соседи связаны, через кольцо — нет): маршрутная
// сеть — это граф, а не «всё со всем поблизости».
//
// Числа доски сохранены: 121 узел, 30 миров вида `planet` (10 стартов + 20 нейтральных, по два
// на сектор) и 91 прочая провинция, то есть ~2410 базовых очков при `SCORE_LIMIT` 1100.
// Порядок `START_CANDIDATES` идёт по кругу, поэтому «соседние индексы — соседние миры», а
// «+5 из десяти — напротив» стало буквальной правдой (на квадрате это было приближением).
//
// ЦЕНА, заплаченная осознанно: нейтральные миры несут ДВА типа планет вместо восьми
// (`crystalline` — рудная жила, `fortress_world` — крепость), потому что типы дают разброс
// производства от −0.25 до +0.45, и разные наборы у разных секторов сделали бы старты
// неравными снова. Шесть остальных типов на дефолтной карте не встречаются — это записано
// отдельным кирпичом; вернуть их можно только конструкцией, где каждый сектор получает
// ОДИНАКОВЫЙ набор.
const HUB = { x: 800, y: 800 };
/** Радиусы четырёх колец сектора: от ступицы к внешнему краю, где стоит старт. */
const RINGS = [165, 310, 460, 620];
/** Угловые смещения трёх узлов кольца от оси сектора (радианы). */
const SPOKES = [-0.21, 0, 0.21];
const SECTORS = 10;
const SECTOR_ARC = (Math.PI * 2) / SECTORS;
/** Ступица — мёртвый мир в центре: равноудалён от всех десяти стартов, поэтому не даёт
 *  никому форы, и это единственное место, где строится `metal_station`. */
const HUB_ID = 'C0R0';
const NEUTRAL_PLANET_TYPES = ['crystalline', 'fortress_world'];
// Террейны девяти непланетных узлов сектора — один и тот же порядок во всех секторах
// (иначе сектора разъедутся по бонусам скорости/HP, а с ними и равнозначность).
const SECTOR_TERRAIN = [
  'asteroid',
  'nebula',
  'graveyard',
  'ion_storm',
  'dense_nebula',
  'solar_flare',
  'asteroid',
  'nebula',
  'graveyard',
];

/** Роль узла в шаблоне сектора: `[кольцо, спица]` → что это за провинция. */
type Slot = { ring: number; spoke: number; role: 'start' | 'planet' | 'terrain' };
/** Шаблон сектора: 12 узлов — старт на внешнем кольце по оси, две планеты по оси
 *  (ближняя и средняя), девять прочих провинций. Порядок задаёт нумерацию `R{i}`. */
const SECTOR_SLOTS: Slot[] = [
  { ring: 3, spoke: 1, role: 'start' }, // R1 — внешнее кольцо, по оси сектора
  { ring: 0, spoke: 1, role: 'planet' }, // R2 — ближний к ступице приз
  { ring: 2, spoke: 1, role: 'planet' }, // R3 — приз на подступах к старту
  { ring: 0, spoke: 0, role: 'terrain' },
  { ring: 0, spoke: 2, role: 'terrain' },
  { ring: 1, spoke: 0, role: 'terrain' },
  { ring: 1, spoke: 1, role: 'terrain' },
  { ring: 1, spoke: 2, role: 'terrain' },
  { ring: 2, spoke: 0, role: 'terrain' },
  { ring: 2, spoke: 2, role: 'terrain' },
  { ring: 3, spoke: 0, role: 'terrain' },
  { ring: 3, spoke: 2, role: 'terrain' },
];

/** id узла: сектор k, позиция i в шаблоне. Формат тот же `C{n}R{m}`, что и у прежней
 *  сетки, — его читают имена миров (`planetName.ts`) и множество фикстур. */
const nodeId = (k: number, i: number): string => `C${k}R${i + 1}`;

function buildField(): KeyNode[] {
  const nodes: KeyNode[] = [
    // Ступица: мёртвый мир, общий для всех секторов.
    { id: HUB_ID, owner: null, x: HUB.x, y: HUB.y, sector: 'dead_world' },
  ];
  for (let k = 0; k < SECTORS; k += 1) {
    const axis = k * SECTOR_ARC - Math.PI / 2; // сектор 0 смотрит вверх
    let terrainIdx = 0;
    let planetIdx = 0;
    SECTOR_SLOTS.forEach((slot, i) => {
      const angle = axis + SPOKES[slot.spoke]!;
      const r = RINGS[slot.ring]!;
      const node: KeyNode = {
        id: nodeId(k, i),
        owner: null,
        x: Math.round(HUB.x + Math.cos(angle) * r),
        y: Math.round(HUB.y + Math.sin(angle) * r),
        sector: slot.role === 'terrain' ? SECTOR_TERRAIN[terrainIdx++]! : 'planet',
      };
      if (slot.role === 'start') node.type = 'terran';
      if (slot.role === 'planet') {
        node.type = NEUTRAL_PLANET_TYPES[planetIdx++ % NEUTRAL_PLANET_TYPES.length]!;
      }
      nodes.push(node);
    });
  }
  return nodes;
}

const KEY: KeyNode[] = buildField();
/** Десять миров, на которых появляются игроки, по кругу — сектор за сектором. */
export const START_CANDIDATES: string[] = Array.from({ length: SECTORS }, (_, k) => nodeId(k, 0));

/**
 * Маршрутная сеть — ШАБЛОН в индексах, одинаковый для каждого сектора и потому
 * инвариантный к повороту на 36°. Три вида рёбер:
 *   • радиальные — узел кольца связан с узлом следующего кольца по той же спице;
 *   • тангенциальные — соседние спицы внутри одного кольца;
 *   • межсекторные — крайняя спица сектора k стыкуется с крайней спицей сектора k+1.
 * Плюс ступица, связанная с осевым узлом ближнего кольца каждого сектора.
 */
function withNeighborLinks(nodes: KeyNode[]): MapNode[] {
  const adj = new Map<string, Set<string>>(nodes.map((n) => [n.id, new Set<string>()]));
  const link = (a: string, b: string): void => {
    adj.get(a)!.add(b);
    adj.get(b)!.add(a);
  };
  /** Индекс узла шаблона по кольцу и спице. */
  const at = (ring: number, spoke: number): number =>
    SECTOR_SLOTS.findIndex((s) => s.ring === ring && s.spoke === spoke);
  for (let k = 0; k < SECTORS; k += 1) {
    const next = (k + 1) % SECTORS;
    for (let ring = 0; ring < RINGS.length; ring += 1) {
      // тангенциальные: 0—1—2 внутри кольца
      link(nodeId(k, at(ring, 0)), nodeId(k, at(ring, 1)));
      link(nodeId(k, at(ring, 1)), nodeId(k, at(ring, 2)));
      // межсекторные: край сектора k стыкуется с краем следующего
      link(nodeId(k, at(ring, 2)), nodeId(next, at(ring, 0)));
      // радиальные: та же спица на следующем кольце
      if (ring + 1 < RINGS.length) {
        for (let spoke = 0; spoke < SPOKES.length; spoke += 1) {
          link(nodeId(k, at(ring, spoke)), nodeId(k, at(ring + 1, spoke)));
        }
      }
    }
    link(HUB_ID, nodeId(k, at(0, 1))); // ступица — с осевым узлом ближнего кольца
  }
  return nodes.map((n) => ({ ...n, links: [...adj.get(n.id)!] }));
}

// Bytro-style province map: only real provinces (no "empty" void waypoints), wired
// to their neighbours by shared border (relative-neighbourhood graph). Movement is
// province-to-adjacent; the links ARE the visible path network.
export const MAP: MapNode[] = withNeighborLinks(KEY);