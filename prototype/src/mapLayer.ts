/**
 * Статический слой карты (REFM-232): небо под картой и политическая карта — заливка
 * провинций, местность, дороги, край доски и кольца обзора, — выпеченные под камерой в свой
 * холст с запасом за экраном. Модуль решает, когда выпекать, сдвигать окно выпечки или
 * дорисовывать её в фоне полосами (`decisions/mapLayerView.ts`), и кладёт небо с картой под
 * живой кадр (`blitStaticLayer`). Здесь же рецепт подготовки карты за заставкой входа
 * (`mapPreparationJobs`) и рисунок сети дорог.
 *
 * Модуль — владелец холстов слоя, кэшей местности и геометрии провинций последней выпечки.
 * Снаружи их только читают: кадр — перенос из пространства выпечки на экран `mapView`,
 * геометрию `provinceGeometry`, рамку стекла `holographicFrame`, поля местности
 * `terrainFields` и покой камеры `mapSettled`; ввод — провинцию под точкой (`provinceAt`,
 * `mapLayerForInput`). Сбрасывают состояние двери: смена карты — {@link forgetMapArt},
 * сбой подготовки — {@link forgetMapBake}, потеря контекста — {@link invalidateMapSurfaces}.
 *
 * Мир, своё место, узлы карты, контекст кадра, размер экрана, частота кадров, контур
 * галактики, режим голограммы, типы секторов, волна границ, детализация и слой живых границ
 * живут в `main.ts`; модуль получает их хуками {@link initMapLayer} — импорт оттуда был бы
 * циклом.
 */
import type { GameState } from '../../packages/shared-core/src/index';
import { projection as camProjection } from '../../packages/client/src/camera';
import { clearHolographicSprites, rgba } from '../../packages/client/src/holoDraw';
import { drawForkMark } from '../../packages/client/src/forkMark';
import { drawSchematicNode, type MapLod } from '../../packages/client/src/mapLod';
import { insideProvince, type ProvincePolygon } from '../../packages/client/src/provinceSelection';
import { drawSpaceBackdrop, prepareSpaceBackdrop, spaceBackdropReady } from '../../packages/client/src/spaceBackdrop';
import {
  drawTerritory,
  strokeBorders,
  type ClassifiedBorders,
  type TerritoryCell,
  type TerritoryPalette,
} from '../../packages/client/src/territory';
import { placePoly, TerritoryGeometryCache, type ShapePlacement, type TerritoryShape } from '../../packages/client/src/territoryGeometry';
import { borderTolerance } from '../../packages/client/src/territoryLod';
import { t } from '../../localization/runtime';
import {
  NO_SCROLL,
  SETTLE_MS,
  bakeBudgetMs,
  bakeJobFate,
  bakeWork,
  bandRows,
  exactOffset,
  exposedStrips,
  gridNudge,
  layerTransform,
  mapLayerAction,
  onPixelGrid,
  overscanFor,
  recentredScroll,
  type LayerScroll,
  type LayerTransform,
  type MapLayerAction,
  type MapLayerFrame,
  type MapProjection,
  type Overscan,
  type PixelRect,
} from '../../decisions/mapLayerView';
import { forkMarks, roadStrokes, type ForkMark, type NetPoint } from '../../decisions/roadNetwork';
import { terrainArtKind } from '../../decisions/terrainArt';
import { gridGap, gridLines, gridOffset } from './backdropGrid';
import { canvasCompatibilityOptions } from './canvasCompatibility';
import { SECTOR_TYPES, type MapNode } from './game';
import { glowOn, starfieldOn } from './graphicsPrefs';
import { clipGlassSurface, drawGlassScreen, type TerrainField } from './holographicSurface';
import { cam, insets, mapBounds, panBy, world } from './mapCamera';
import { known, memory } from './mapFog';
import { pinchStart } from './mapInput';
import { GRID, ownerColor } from './mapPalette';
import type { PreparationJob } from './mapPreparation';
import { clipPolygon, clipRect, provinceSeeds, type ProvinceSeed } from './provinceMap';
import { COLOR } from './sideColors';
import { bakeSignature, ownersSignature } from './staticLayerCache';
import { TERRAIN_PAD, TerrainRasterCache } from './terrainRasterCache';
import { TerrainGeometryCache } from './terrainGeometryCache';
import { NEBULAE, STARS } from './viewport';

/** Что слою карты нужно от игры. Мир, кадр, экран и режимы карты живут в `main.ts`. */
export interface MapLayerHost {
  /** Мир на экране. */
  world(): GameState;
  /** Своё место. */
  me(): string;
  /** Узлы карты этого матча. */
  nodes(): readonly MapNode[];
  /** Контекст канваса карты: в него кладётся слой, на нём растрируются полосы выпечки. */
  ctx(): CanvasRenderingContext2D;
  /** Ширина экрана в CSS-пикселях. */
  vw(): number;
  /** Высота экрана в CSS-пикселях. */
  vh(): number;
  /** Плотность пикселей отрисовки. */
  dpr(): number;
  /** Телефонная раскладка: туманности неба меньше. */
  mobile(): boolean;
  /** Сглаженная частота кадров: из неё доля кадра на выпечку в фоне. */
  fps(): number;
  /** Контур галактики на картах Фронтира; `[]` — карта в прямоугольной рамке. */
  outline(): ReadonlyArray<{ x: number; y: number }>;
  /** Карта в голограмме (ПК с голографическим интерфейсом и телефон). */
  holographic(): boolean;
  /** Тип сектора узла; `undefined` — узел не на карте. */
  sectorType(id: string): (typeof SECTOR_TYPES)[string] | undefined;
  /** Волна на границах провинций в локальных единицах мозаики. */
  wave(): { amp: number; wavelength: number; segment: number };
  /** Детализация карты при нынешнем зуме. */
  lod(): MapLod;
  /** Холсты карты потеряли пиксели: слой живых границ забывает свои тоже. */
  surfacesLost(): void;
}

let game: MapLayerHost;

/** Поднять слой карты: хуки игры и слушатели потери контекста канваса `#map`. Зовётся из
 *  `main.ts` один раз, до первого кадра. */
export function initMapLayer(host: MapLayerHost): void {
  game = host;
  const canvas = document.getElementById('map') as unknown as HTMLCanvasElement;
  canvas.addEventListener('contextlost', () => { mapContextEvents.lost++; invalidateMapSurfaces(); });
  canvas.addEventListener('contextrestored', () => { mapContextEvents.restored++; invalidateMapSurfaces(); });
}

const holographicMapOn = (): boolean => game.holographic();
const sectorTypeOf = (id: string): (typeof SECTOR_TYPES)[string] | undefined => game.sectorType(id);
const provinceWave = (): { amp: number; wavelength: number; segment: number } => game.wave();
const currentMapLod = (): MapLod => game.lod();
const mapContextOptions = canvasCompatibilityOptions();

/**
 * Province field — the whole map is a tiling of provinces (Bytro/Paradox-style):
 * every point belongs to the nearest seed (planets = capturable territory tinted
 * in the owner's colour; empty-space voids = uncapturable, neutral). The tiling is
 * computed as vector Voronoi cells (half-plane clipping) in base space and filled
 * under the camera each frame — so it covers the whole map, scales without
 * stretching, and never shimmers. Rebuilt only on viewport / ownership change.
 */
// --- holographic static layer (territory + hyperlanes), camera-baked & cached --
// Two caches (`decisions/mapLayerView.ts`). The MAP LAYER holds the political map on a
// transparent canvas with a margin beyond the screen: while the camera moves it is shown
// under one scale + shift instead of being repainted, and it is re-baked only when its
// content changes, it stops covering the screen, or the camera settles off its pixel
// grid (after a zoom). A bake wanted for sharpness alone (after a zoom) is painted in bands
// into a spare canvas over a few frames while the frame keeps showing the old one, and
// the two canvases then trade places (rule 7). The SKY under it (backdrop art, grid, stars)
// keeps its own bounded parallax, so moving frames paint it live — it is cheap. A settled
// camera composes sky and map into `bg` once, and idle frames are one 1:1 blit.
const bg = document.createElement('canvas');
export const bgx = (mapContextOptions ? bg.getContext('2d', mapContextOptions) : bg.getContext('2d')) as CanvasRenderingContext2D;
let mapLayer = document.createElement('canvas');
let mapLayerX = (mapContextOptions ? mapLayer.getContext('2d', mapContextOptions) : mapLayer.getContext('2d')) as CanvasRenderingContext2D;
/** Rule 7: the canvas the next bake is painted into in the background. It gives its pixels
 *  back once the camera has rested with nothing to bake ({@link SPARE_KEEP_MS}). */
let mapSpare = document.createElement('canvas');
let mapSpareX = (mapContextOptions ? mapSpare.getContext('2d', mapContextOptions) : mapSpare.getContext('2d')) as CanvasRenderingContext2D;
const terrainRaster = new TerrainRasterCache(undefined, mapContextOptions);
const terrainGeometry = new TerrainGeometryCache();
export const mapContextEvents = { lost: 0, restored: 0 };
export const backgroundContextEvents = { lost: 0, restored: 0 };
let mapLayerContent = ''; // content signature of the map-layer bake ('' — none or invalid)
let mapLayerAt: MapProjection = { a: 1, x: 0, y: 0 }; // projection the map layer was painted at
let mapLayerMargin: Overscan = { x: 0, y: 0 }; // its margin beyond the screen, CSS px
let mapLayerScroll: LayerScroll = NO_SCROLL; // how far its window moved since (rule 3), CSS px
let mapLayerBakes = 0; // bumps on every bake and move, so the composite knows its map is current
/** This frame's transform from the map layer's bake space to the screen. The province
 *  geometry below (polygons, borders, terrain fields, glass frame) lives in bake space. */
export let mapView: LayerTransform = { k: 1, tx: 0, ty: 0 };
/** Next terrain field whose sharp raster a bake could not afford yet; -1 — none. */
let terrainRefine = -1;
/** Where the map layer owes that terrain: the strips that moves painted without it, in the
 *  bake's own device pixels (a canvas rect less {@link mapLayerOffset}); `null` — all of it. */
let terrainOwed: PixelRect[] | null = [];
/** Past this many strips owing terrain, one bake of the map is cheaper than repainting them. */
const MAX_OWED_STRIPS = 8;
/** The spare canvas keeps its pixels while the camera rested less than this, or a bake is due:
 *  a fresh backing store costs the first band of a bake 9–18 ms on a phone. */
const SPARE_KEEP_MS = 5000;
/** Rule 7: the map layer's next bake, painted into {@link mapSpare} a band a frame. */
interface BakeJob {
  readonly content: string;
  readonly geo: MapLayerGeometry;
  readonly margin: Overscan;
  /** Where the bake's point (0, 0) lies on its canvas, in device pixels. */
  readonly offset: { x: number; y: number };
  readonly width: number;
  readonly height: number;
  readonly zooming: boolean;
  /** The last bake of a terrain refinement ({@link terrainRefine}), at the scale on the screen. */
  readonly final: boolean;
  /** Its share of a frame, ms. */
  readonly budget: number;
  /** What starting it cost (the province geometry), ms. */
  readonly startMs: number;
  /** The terrain fields its bands met, once each: `met` holds their ids. */
  readonly fields: TerrainField[];
  readonly met: Set<string>;
  /** The work of its rows, a running total: bands are measured by it, not by rows. */
  readonly work: Float64Array;
  /** Rows painted from the top, what they cost, and the rows and cost of the last band. */
  done: number;
  paintedMs: number;
  lastRows: number;
  lastMs: number;
  /** A band met terrain the frame budget could not raster yet. */
  pending: boolean;
}
let bakeJob: BakeJob | null = null;
let bgComposite = ''; // what `bg` holds: which map bake, at which offset, over which sky
let camSeen = ''; // projection of the previous frame, to notice the camera moving
let camMovedAt = -Infinity;
/** Provinces as the frame and input read them: the geometry of the last bake handed over
 *  ({@link publishMapGeometry}), polygons through {@link provincePolygon} and
 *  {@link provinceAt}. `null` — no bake yet. */
export let provinceGeometry: MapLayerGeometry | null = null;
/** The camera has rested `SETTLE_MS` (as {@link blitStaticLayer} judged this frame). */
export let mapSettled = false;
export let terrainFields: TerrainField[] = [];
export let holographicFrame = { x: 0, y: 0, width: 0, height: 0 };

/** WebView can restore contexts without changing canvas dimensions or camera state. */
export function invalidateMapSurfaces(): void {
  cancelBakeJob();
  releaseMapSpare();
  mapLayerContent = '';
  bgComposite = '';
  game.surfacesLost();
  terrainRefine = -1;
  terrainRaster.clear();
  clearHolographicSprites();
}
// Offscreen contexts can also be lost independently. Their events do not bubble
// through document, so observe the actual cached surfaces.
bg.addEventListener?.('contextlost', () => { backgroundContextEvents.lost++; bgComposite = ''; });
bg.addEventListener?.('contextrestored', () => { backgroundContextEvents.restored++; bgComposite = ''; });
// The two map canvases trade places (rule 7): an event concerns the role its canvas holds now.
for (const surface of [mapLayer, mapSpare])
  for (const type of ['contextlost', 'contextrestored'] as const)
    surface.addEventListener?.(type, () => {
      backgroundContextEvents[type === 'contextlost' ? 'lost' : 'restored']++;
      if (surface !== mapLayer) {
        cancelBakeJob();
        return;
      }
      mapLayerContent = '';
      bgComposite = '';
    });

/**
 * ROADS-7: рисунок сети дорог — штрихи и отметки развилок — меняется только вместе с
 * топологией (временный коридор героя бьёт `state.topology`), а слой карты перепекается
 * куда чаще: смена владельца, туман, зум, уход камеры за запас выпечки. Пересчёт сети на
 * каждой выпечке стоил ~3 мс на frontier-50; теперь она считается раз на топологию и
 * сбрасывается вместе с геометрией карты. Там же рамка каждого штриха в координатах
 * карты: дорогу вне выпечки отсеивают, не проецируя ни одной её точки.
 */
type RoadDrawing = { strokes: NetPoint[][]; boxes: Float64Array; marks: ForkMark[] };
let roadDrawing: (RoadDrawing & { topology: number }) | null = null;
export function roadDrawingOf(state: GameState): RoadDrawing {
  const topology = state.topology ?? 0;
  if (roadDrawing?.topology !== topology) {
    const strokes = roadStrokes(state.planets);
    const boxes = new Float64Array(strokes.length * 4);
    strokes.forEach((line, i) => {
      let x0 = Infinity; let y0 = Infinity; let x1 = -Infinity; let y1 = -Infinity;
      for (const p of line) {
        if (p.x < x0) x0 = p.x;
        if (p.x > x1) x1 = p.x;
        if (p.y < y0) y0 = p.y;
        if (p.y > y1) y1 = p.y;
      }
      boxes.set([x0, y0, x1, y1], i * 4);
    });
    roadDrawing = { topology, strokes, boxes, marks: forkMarks(state.planets) };
  }
  return roadDrawing;
}

/** Новая карта (`installMapGeometry`): сеть дорог, геометрия местности и её растры остались
 *  от прежней. */
export function forgetMapArt(): void {
  roadDrawing = null; // другая карта — другая сеть
  terrainGeometry.clear();
  terrainRaster.clear();
}

/** Подготовка карты упала: недопечённый слой не годится, кадр выпечет карту обычным путём. */
export function forgetMapBake(): void {
  mapLayerContent = '';
}


/** The owner of node `id` AS THE VIEWER MAY KNOW IT: live when identified (or fog
 *  off), last-known from memory when only remembered, unknown otherwise. The
 *  political fill and its cache signature both read THIS, never the raw truth —
 *  the map must not repaint a hidden capture (an intel leak the fog exists to stop). */
export function knownOwner(id: string): string | null {
  const s = game.world();
  if (known(id)) return s.planets[id]?.owner ?? null;
  return memory.ownerOf(id);
}
function ownersSig(): string {
  const MAP = game.nodes();
  // Подпись читает ЗНАНИЕ игрока (`knownOwner`), а не правду — см. `staticLayerCache.ts`
  // (REFM-60): иначе скрытый захват выдал бы себя самим фактом перерисовки.
  return ownersSignature(
    MAP.map((n) => n.id),
    knownOwner,
  );
}

/** Чем обрезаются провинции. На картах Фронтира это выпуклый контур галактики, на
 *  прочих — прежняя рамка по границам карты. Координаты ЭКРАННЫЕ: кэш геометрии
 *  (`territoryGeometry.ts`) нормализует вход по первой точке клипа и масштабу сам,
 *  поэтому панорама и зум из его подписи сокращаются, а на выход он отдаёт форму в этих
 *  нормализованных координатах и место, куда её поставить в экранные (`placePoly`). */
function provinceClip(): Array<[number, number]> {
  const galaxyOutline = game.outline();
  if (galaxyOutline.length)
    return galaxyOutline.map((pt): [number, number] => {
      const v = world(pt);
      return [v.x, v.y];
    });
  const frame = clipRect(mapBounds());
  return clipPolygon(world(frame.topLeft), world(frame.bottomRight));
}

/** Одна на прототип: геометрия провинций не зависит от того, в какой холст её пишут. */
export const territoryGeometry = new TerritoryGeometryCache();

/** Everything the map layer depends on except the camera (`staticLayerCache.ts`): the
 *  viewer's knowledge of owners and of explored provinces, never the raw truth. */
function mapLayerSignature(): string {
  const s = game.world();
  const MAP = game.nodes();
  const ME = game.me();
  const VW = game.vw();
  const VH = game.vh();
  const DPR = game.dpr();
  return bakeSignature({
    vw: VW,
    vh: VH,
    dpr: DPR,
    me: ME,
    owners: ownersSig(),
    starfield: starfieldOn(),
  }) + `|holo:${holographicMapOn()}|glow:${glowOn()}` +
    // The roads: a hero's corridor lays new lanes mid-match. A scroll paints its strips with
    // the roads of the moment, so a bake that missed them would end at the strip's edge.
    `|topo:${s.topology ?? 0}` +
    `|known:${MAP.map((n) => known(n.id) || memory.has(n.id) ? '1' : '0').join('')}`;
}

/** The sky under the map — backdrop art (or the fallback nebulae), grid and stars — in
 *  screen space with the camera's bounded parallax. Opaque, so it also clears `g`. */
function paintSky(g: CanvasRenderingContext2D): void {
  const VW = game.vw();
  const VH = game.vh();
  const DPR = game.dpr();
  g.setTransform(DPR, 0, 0, DPR, 0, 0);
  g.clearRect(0, 0, VW, VH);
  // Dark space is embedded in the offline bundle. The settled composite keys on its
  // readiness, so loading the image refreshes it once, even if the camera stays still.
  drawSpaceBackdrop(g, VW, VH, cam.x, cam.y, starfieldOn(), holographicMapOn(), DPR);
  // Graphics pref: `starfield` off leaves the flat fill + grid (nebulae/stars skipped).
  if (starfieldOn() && !spaceBackdropReady(holographicMapOn()))
    for (const neb of NEBULAE) {
      const r = neb.r * (game.mobile() ? 0.7 : 1);
      const grd = g.createRadialGradient(neb.x * VW, neb.y * VH, 0, neb.x * VW, neb.y * VH, r);
      grd.addColorStop(0, rgba(neb.color, 0.06));
      grd.addColorStop(0.45, rgba(neb.color, 0.024));
      grd.addColorStop(1, 'rgba(2,6,12,0)');
      g.fillStyle = grd;
      g.fillRect(0, 0, VW, VH);
    }
  // Шаг, смещение под камерой и куда лечь линиям — `backdropGrid.ts` (REFM-110).
  const gap = gridGap(cam.scale);
  g.lineWidth = 1;
  g.strokeStyle = holographicMapOn() ? 'rgba(113,163,184,0)' : GRID;
  g.beginPath();
  for (const x of gridLines(gridOffset(cam.x, gap), VW, gap)) {
    g.moveTo(x, 0);
    g.lineTo(x, VH);
  }
  for (const y of gridLines(gridOffset(cam.y, gap), VH, gap)) {
    g.moveTo(0, y);
    g.lineTo(VW, y);
  }
  g.stroke();
  if (starfieldOn())
    for (const st of STARS) {
      g.fillStyle = rgba('#bfeee6', st.b * 0.45);
      g.fillRect(st.x * VW, st.y * VH, 0.7, 0.7);
    }
}

/** A screen rectangle in CSS pixels; a bake's view reaches past the screen by its margin. */
interface ScreenRect {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

/**
 * A bake's province geometry, in its own space. It costs O(provinces) whatever the view
 * (the seeds, the shape cache's signature, the cells' boxes placed in the bake), so a bake
 * computes it once and the strips a scroll later paints into the same bake reuse it (rule 3,
 * `decisions/mapLayerView.ts`).
 */
export interface MapLayerGeometry {
  /** The bake's space: map point `p` lies at `at.a·p + (at.x, at.y)` in it. */
  readonly at: MapProjection;
  readonly lod: MapLod;
  readonly seeds: ProvinceSeed[];
  /** The province of `seeds[i]`. */
  readonly nodes: readonly MapNode[];
  /** The provinces' shape in the map's own space — one object for every bake while the
   *  shape holds (`territoryGeometry.ts`) — and where it lands in this bake's space. */
  readonly shape: TerritoryShape;
  readonly place: ShapePlacement;
  /** The box of `shape.cells[i]` in the bake's space at `4i` (x0, y0, x1, y1): a strip finds
   *  its few provinces by these, where walking every vertex of the map would cost it as much
   *  as a bake's cull. */
  readonly boxes: Float64Array;
  /** `shape.cells[i]` in the bake's space, placed when first needed ({@link cellPoly}). */
  readonly polys: Array<Array<[number, number]> | undefined>;
  /** The cell of each province, built when first asked ({@link provincePolygon}). */
  index: Map<string, number> | null;
  readonly clip: Array<[number, number]>;
  readonly frame: { x: number; y: number; width: number; height: number };
}
/** The current bake's geometry; `null` before the first bake. */
let mapLayerGeometry: MapLayerGeometry | null = null;

/** The political map's geometry at the current camera. */
function measureMapLayer(): MapLayerGeometry {
  const s = game.world();
  const MAP = game.nodes();
  // PROVINCES — political map (Bytro-style). Every sector is a filled CELL of a
  // weighted Voronoi (power diagram) over the sector centres: the cells tile the
  // map and share borders, so a bigger `size` claims more territory and resizing
  // one shifts the shared borders with its neighbours evenly. Adjacency IS the
  // shared border — no lanes. EVERY sector gets a cell, `empty` crossroads included:
  // the kernel derives its lanes from the diagram over all of them, so skipping one here
  // would draw a different map than the one being played (provinceMap.ts, rule 1).
  // Вес семени — там же (REFM-61): растёт квадратично по масштабу, иначе карта
  // перекраивается при зуме.
  const nodes: MapNode[] = [];
  const seeds = provinceSeeds(MAP, cam.scale, (n) => {
    const p = s.planets[n.id];
    if (!p) return null;
    nodes.push(n);
    return { size: p.size ?? 1, at: world(n), owner: knownOwner(n.id) };
  });
  for (let i = 0; i < seeds.length; i++) {
    const id = nodes[i]!.id;
    if (!known(id) && !memory.has(id)) seeds[i]!.kind = 'unknown';
  }
  // Clip cells to the MAP boundary (province bounding box + padding), not the
  // viewport — otherwise the outermost provinces stretch to the screen edge. This
  // gives the map a defined edge that pans/zooms with the camera.
  const frame = clipRect(mapBounds());
  const tl = world(frame.topLeft);
  const br = world(frame.bottomRight);
  const clip = provinceClip();
  // Тесселяция степенной диаграммы квадратична по числу семян, а слой карты
  // перепекается и посреди жеста (растянут зумом) — ровно тогда, когда кадр и так
  // дорогой. Кэш (`territoryGeometry.ts`) снимает подпись с координат,
  // нормализованных по первой точке клипа и масштабу, поэтому панорама и зум из неё
  // СОКРАЩАЮТСЯ: форма не изменилась — выпечка берёт ту же и только ставит её на место.
  // Копий в своих координатах выпечка не делает: заливка ставит каждую точку на место
  // прямо при обводке пути (`drawTerritory` с `place`), а копию клетки получает только
  // тот, кто о ней спрашивает (`cellPoly`: выделение, тап, местность, вспышка захвата).
  // Перепроекция всех вершин карты стоила почти половину выпечки, хотя у дома на экран
  // попадают десятки клеток из сотен. Владельца и тип выпечка берёт из СВЕЖИХ семян,
  // поэтому кэш не может донести чужой туман: `knownOwner` остаётся единственным
  // источником видимой принадлежности.
  const { shape, place } = territoryGeometry.shape(seeds, clip, cam.scale, provinceWave());
  // Рамки клеток — те же числа, что дал бы обход поставленных вершин: проекция —
  // положительный масштаб, минимум и максимум остаются на своих вершинах (`placePoly`).
  const boxes = new Float64Array(shape.boxes.length);
  for (let i = 0; i < boxes.length; i += 2) {
    boxes[i] = shape.boxes[i]! * place.scale + place.x;
    boxes[i + 1] = shape.boxes[i + 1]! * place.scale + place.y;
  }
  return {
    at: camProjection(cam, insets(), mapBounds()),
    lod: currentMapLod(),
    seeds,
    nodes,
    shape,
    place,
    boxes,
    polys: new Array(shape.cells.length),
    index: null,
    clip,
    frame: { x: tl.x, y: tl.y, width: br.x - tl.x, height: br.y - tl.y },
  };
}

/** Hand a bake's geometry to the frame and input: they read the provinces in its space. */
function publishMapGeometry(geo: MapLayerGeometry): void {
  provinceGeometry = geo;
  holographicFrame = geo.frame;
}

/**
 * M2.11: the province borders of the last bake, which the frame strokes living rather than
 * baking them. They are in the mosaic's coordinates: `provinceGeometry.place` puts them in
 * place. Their classes depend only on the owners, so a bake from the same place or after a
 * camera gesture takes the same ones (`territoryGeometry.borders`). Far out they keep only
 * the points the screen can show (`territoryLod.ts`): the level is the bake's own, or a finer
 * one while a zoom-in stretches it, so a line never strays by more than a quarter pixel.
 * `null` — the flat map: its borders stand in the static layer, as its frame does.
 */
export function livingBorders(): ClassifiedBorders | null {
  const geo = provinceGeometry;
  if (!geo || !holographicMapOn()) return null;
  return territoryGeometry.borders(geo.shape, geo.seeds, livingLevel(geo));
}

/** The border detail for this frame: see {@link livingBorders}. */
export function livingLevel(geo: MapLayerGeometry): number {
  const DPR = game.dpr();
  const pxPerUnit = DPR * Math.max(1, mapView.k) * geo.place.scale;
  return borderTolerance(pxPerUnit, provinceWave().segment);
}

/** `shape.cells[i]` of `geo` in its bake's space, placed once per bake when first needed. */
function cellPoly(geo: MapLayerGeometry, i: number): Array<[number, number]> {
  return (geo.polys[i] ??= placePoly(geo.shape.cells[i]!.poly, geo.place));
}

/** The painted polygon of province `id` in the bake's space; `undefined` — not on the map. */
export function provincePolygon(id: string): ProvincePolygon | undefined {
  const geo = provinceGeometry;
  if (!geo) return undefined;
  const index = (geo.index ??= new Map(geo.shape.cells.map((cell, i) => [geo.nodes[cell.idx]!.id, i])));
  const i = index.get(id);
  return i === undefined ? undefined : cellPoly(geo, i);
}

/** The province under point (x, y) of the bake's space: the first cell, in the map's order,
 *  whose painted polygon holds it (`insideProvince`). A cell whose box misses the point by
 *  more than a pixel cannot hold it, so only the cells around the point are placed. */
export function provinceAt(x: number, y: number): string | undefined {
  const geo = provinceGeometry;
  if (!geo) return undefined;
  const b = geo.boxes;
  for (let i = 0; i < geo.shape.cells.length; i++) {
    if (x < b[i * 4]! - 1 || x > b[i * 4 + 2]! + 1 || y < b[i * 4 + 1]! - 1 || y > b[i * 4 + 3]! + 1) continue;
    if (insideProvince(cellPoly(geo, i), x, y)) return geo.nodes[geo.shape.cells[i]!.idx]!.id;
  }
  return undefined;
}

/**
 * The political map in the space of `geo` (by default, the current camera): glass,
 * provinces, terrain art, roads, the board edge and the overview's node rings, culled to
 * `view` in that space.
 * Returns the terrain fields it met there: the frame draws their live glints.
 */
function paintMapLayer(g: CanvasRenderingContext2D, view: ScreenRect, zooming: boolean, preparing: boolean,
  geo = measureMapLayer()): TerrainField[] {
  const s = game.world();
  const DPR = game.dpr();
  const galaxyOutline = game.outline();
  const { at, lod } = geo;
  // Every map point goes through the bake's own projection, so a strip painted into the
  // bake later lands exactly where the first paint put its neighbours.
  const inBake = (p: { x: number; y: number }): { x: number; y: number } => ({ x: at.a * p.x + at.x, y: at.a * p.y + at.y });
  /** Can `cells[i]`, grown by `pad`, touch `view`? */
  const meets = (i: number, pad: number): boolean => geo.boxes[i * 4 + 2]! >= view.x0 - pad &&
    geo.boxes[i * 4]! <= view.x1 + pad && geo.boxes[i * 4 + 3]! >= view.y0 - pad && geo.boxes[i * 4 + 1]! <= view.y1 + pad;
  if (holographicMapOn()) {
    drawGlassScreen(g, geo.frame);
    g.save();
    clipGlassSurface(g, geo.frame);
  }
  // Weighted-Voronoi political fill + classified borders — the shared @void/client
  // territory renderer clamps the weights (so no cell is swallowed), tessellates the
  // power diagram, fills each province in its owner's colour, and draws same-owner
  // inner hairlines vs glowing owner frontiers. Fog is honoured upstream: each seed
  // carries the owner AS THE VIEWER KNOWS IT (knownOwner), so a hidden capture never
  // repaints the map. Ownership reads through precise frontiers and restrained
  // transparent fills, leaving the background visible through the plotting plane.
  const palette: TerritoryPalette = {
    ownerColor,
    neutralFill: COLOR.null!,
    kindAccent: (kind) => holographicMapOn() && kind === 'asteroid' ? '#71879d'
      : holographicMapOn() && kind === 'solar_flare' ? '#b295d8' : SECTOR_TYPES[kind]?.color,
    hideOwnedInner: holographicMapOn(),
    provinceDetail: lod.provinceDetail,
    // M2.11: на голографической карте граница живёт, как рамка, — её рисует кадр, а не
    // выпечка. Запеки её и здесь — линия легла бы дважды, одна из них застывшей. Плоская
    // карта запекает её ниже, из классов, общих для всех выпечек.
    strokeBorders: false,
  };
  // Only the cells the view meets — the renderer's own test (by vertices, pad 1), made here
  // by box — with the owner and kind the viewer knows. They stay in the shape's space: the
  // fill places each point as it traces it (`geo.place`), no placed copy is made.
  const cells: TerritoryCell[] = [];
  geo.shape.cells.forEach((cell, i) => {
    if (!meets(i, 1)) return;
    const seed = geo.seeds[cell.idx]!;
    cells.push({ poly: cell.poly, tags: cell.tags, owner: seed.owner, kind: seed.kind, idx: cell.idx });
  });
  drawTerritory(g, geo.seeds, geo.clip, palette, cells, undefined, geo.place);
  if (!holographicMapOn()) {
    // A shared edge is stroked from one side only, so the classes take every cell; they come
    // from the shape's cache (an owner change alone classifies them again). A segment is placed
    // by the polygons' own formula (`placePoly`), and one that misses the view by more than
    // the widest stroke (the frontier glow) is dropped before it is placed.
    const { scale: k, x: ox, y: oy } = geo.place;
    const x0 = view.x0 - 4;
    const y0 = view.y0 - 4;
    const x1 = view.x1 + 4;
    const y1 = view.y1 + 4;
    strokeBorders(g, territoryGeometry.borders(geo.shape, geo.seeds), palette, (x, y) => [x * k + ox, y * k + oy],
      (sg) => {
        const ax = sg[0] * k + ox;
        const ay = sg[1] * k + oy;
        const bx = sg[2] * k + ox;
        const by = sg[3] * k + oy;
        return !((ax < x0 && bx < x0) || (ax > x1 && bx > x1) || (ay < y0 && by < y0) || (ay > y1 && by > y1));
      });
  }
  const fields: TerrainField[] = [];
  if (holographicMapOn() && lod.art > 0) {
    g.save();
    g.globalAlpha *= lod.art;
    // A field's raster reaches past its box by its padding: cull by that reach, or a field
    // just outside one paint would miss the edge pixels a later strip keeps from it.
    const reach = TERRAIN_PAD + 1;
    const x0 = view.x0 - reach;
    const x1 = view.x1 + reach;
    const y0 = view.y0 - reach;
    const y1 = view.y1 + reach;
    // Cells keep the map's order, so the fields overlap as they always did.
    for (let i = 0; i < geo.shape.cells.length; i++) {
      // Cull by the province's box BEFORE constructing rock geometry.
      if (!meets(i, reach)) continue;
      const n = geo.nodes[geo.shape.cells[i]!.idx]!;
      const field = terrainGeometry.project(n.id, terrainArtKind(n.sector, s.planets[n.id]?.terrain), sectorTypeOf(n.id)?.color ?? '#9fb6bd', cellPoly(geo, i),
        known(n.id) || memory.has(n.id), inBake(n));
      if (!field || field.box.x > x1 || field.box.y > y1 ||
        field.box.x + field.box.width < x0 || field.box.y + field.box.height < y0) continue;
      fields.push(field);
      if (preparing) continue; // prewarm these fields in bounded loading slices
      // Reuse the last sharp bake through the gesture; sharpen in bounded slices
      // once settled (`blitStaticLayer`), instead of redrawing vector strokes per tick.
      terrainRaster.draw(g, field, DPR, zooming);
    }
    g.restore();
  }

  // PATH NETWORK — thin roads between adjacent provinces (the visible "пути").
  // Movement runs along these; an army marches province-to-adjacent-province and
  // its route (drawAimPreview / drawFleetRoutes) traces them.
  g.strokeStyle = rgba('#96b9c3', 0.32 * lod.provinceDetail);
  g.lineWidth = 0.7;
  // Каждая дорога рисуется ОДИН раз — `setupMap.ts` (правило 1, REFM-127), та же
  // функция, что раскладывает трассы мини-карты сетапа. Здесь стоял свой цикл с тем же
  // сравнением идентификаторов: штрих полупрозрачный, и дважды нарисованная дорога
  // просто светлее соседних — «магистраль», которой в данных нет. Узлы без мира
  // отсеиваются до вызова, поэтому ссылка в никуда не даёт дороги.
  // Все дороги — ОДИН путь: штрих у них общий (цвет и толщина выставлены выше), поэтому
  // `beginPath`/`stroke` на каждое ребро были чистой платой за ничто — четыре вызова
  // холста вместо двух на дорогу. Плюс отсев по рамке: дорога, ОБА конца которой вышли
  // за один и тот же край экрана, пересечь его не может. Запас в лишний пиксель — на
  // толщину штриха, чтобы дорога, касающаяся кромки, не пропала.
  // ROADS-2: дороги — СЕТЬ, а не прямые: тропы от миров, развилки, переходы на общей
  // грани. Какими отрезками её рисовать (каждый кусок один раз, прямая — только у лейна
  // без дороги) — чистое решение `decisions/roadNetwork.ts`; здесь проекция и отсев.
  const M = 1 + g.lineWidth;
  const roads = roadDrawingOf(s);
  // The same frame in map units (the projection is a positive uniform scale), one pixel
  // wider: a road whose box misses it is dropped before a single point is projected.
  const pad = (M + 1) / at.a;
  const rx0 = (view.x0 - at.x) / at.a - pad;
  const rx1 = (view.x1 - at.x) / at.a + pad;
  const ry0 = (view.y0 - at.y) / at.a - pad;
  const ry1 = (view.y1 - at.y) / at.a + pad;
  g.beginPath();
  for (let r = 0; lod.provinceDetail > 0 && r < roads.strokes.length; r++) {
    const b = roads.boxes;
    if (b[r * 4 + 2]! < rx0 || b[r * 4]! > rx1 || b[r * 4 + 3]! < ry0 || b[r * 4 + 1]! > ry1) continue;
    const pts = roads.strokes[r]!.map(inBake);
    let x0 = Infinity; let x1 = -Infinity; let y0 = Infinity; let y1 = -Infinity;
    for (const p of pts) {
      if (p.x < x0) x0 = p.x;
      if (p.x > x1) x1 = p.x;
      if (p.y < y0) y0 = p.y;
      if (p.y > y1) y1 = p.y;
    }
    if (x1 < view.x0 - M || x0 > view.x1 + M || y1 < view.y0 - M || y0 > view.y1 + M) continue;
    g.moveTo(pts[0]!.x, pts[0]!.y);
    for (let i = 1; i < pts.length; i++) g.lineTo(pts[i]!.x, pts[i]!.y);
  }
  g.stroke();
  // ROADS-4: развилка — МЕСТО, а не излом дороги: на ней можно встать, и стоящий там ловит
  // всю тропу (ROADS-3). Какие отметки ставить — `forkMarks` (`decisions/roadNetwork.ts`),
  // чем рисовать — общий с клиентом `drawForkMark`.
  if (lod.provinceDetail > 0) {
    g.fillStyle = rgba('#96b9c3', 0.55 * lod.provinceDetail);
    for (const m of roads.marks) {
      const c = inBake(m.at);
      if (c.x < view.x0 - 6 || c.x > view.x1 + 6 || c.y < view.y0 - 6 || c.y > view.y1 + 6) continue;
      drawForkMark(g, c.x, c.y);
    }
  }

  // map boundary — a faint frame so the edge of the sector reads as intentional
  if (holographicMapOn()) g.restore();
  g.strokeStyle = 'rgba(90,151,165,0.2)';
  g.lineWidth = 0.7;
  // На картах Фронтира территория обрезается выпуклым контуром галактики
  // (`provinceClip`), а рамка рисовалась прежним прямоугольником — между ними
  // оставалась широкая пустая полоса, и рамка переставала обозначать край доски.
  // Рисуем то же, чем обрезаем; прочие карты сохраняют прямоугольник.
  // Край доски — линия КАРТЫ, а не провинций (владелец 2026-09-24): `classifyBorders`
  // больше не обводит грани края. Прямоугольник на голограмме — это рамка стекла,
  // контур галактики там рисует только эта линия, поэтому он идёт в обоих режимах.
  if (galaxyOutline.length) {
    g.beginPath();
    galaxyOutline.forEach((pt, i) => {
      const v = inBake(pt);
      if (i === 0) g.moveTo(v.x, v.y);
      else g.lineTo(v.x, v.y);
    });
    g.closePath();
    g.stroke();
  } else if (!holographicMapOn()) {
    g.strokeRect(geo.frame.x, geo.frame.y, geo.frame.width, geo.frame.height);
  }
  // The overview's node rings belong to the map, not to the moment: every province the same
  // neutral ring (`drawSchematicNode`), fading as the node art comes in. Baked on top of the
  // roads they end, since a frame stroking 1675 of them spent half its raster on them.
  if (lod.art < 1) {
    g.save();
    g.globalAlpha *= 1 - lod.art;
    const reach = lod.markerRadius + 1;
    for (const n of geo.nodes) {
      const c = inBake(n);
      if (c.x < view.x0 - reach || c.x > view.x1 + reach || c.y < view.y0 - reach || c.y > view.y1 + reach) continue;
      drawSchematicNode(g, c, lod.markerRadius);
    }
    g.restore();
  }
  return fields;
}

/** A bake's size at the current screen: its margin beyond the screen, where the bake's point
 *  (0, 0) lies on its canvas, and the canvas, all but the margin in device pixels. */
function mapLayerSize(): { margin: Overscan; ox: number; oy: number; width: number; height: number } {
  const VW = game.vw();
  const VH = game.vh();
  const DPR = game.dpr();
  const margin = overscanFor(VW, VH, DPR);
  const ox = Math.round(margin.x * DPR);
  const oy = Math.round(margin.y * DPR);
  return { margin, ox, oy, width: Math.round(VW * DPR) + 2 * ox, height: Math.round(VH * DPR) + 2 * oy };
}

/** Bake the map layer at the current camera, with its margin beyond the screen. */
function bakeMapLayer(content: string, zooming: boolean, preparing = false): void {
  const VW = game.vw();
  const VH = game.vh();
  const DPR = game.dpr();
  cancelBakeJob(); // this bake supersedes it
  if (mapLayerX.isContextLost?.()) return;
  const { margin, ox, oy, width, height } = mapLayerSize();
  mapLayerContent = ''; // publish the signature only after a complete paint
  // Preserve the allocation when only the scene changed.
  if (mapLayer.width !== width) mapLayer.width = width;
  if (mapLayer.height !== height) mapLayer.height = height;
  mapLayerX.setTransform(1, 0, 0, 1, 0, 0);
  mapLayerX.clearRect(0, 0, width, height);
  mapLayerX.setTransform(DPR, 0, 0, DPR, ox, oy);
  const geo = measureMapLayer();
  publishMapGeometry(geo);
  terrainFields = paintMapLayer(mapLayerX, { x0: -margin.x, y0: -margin.y, x1: VW + margin.x, y1: VH + margin.y },
    zooming, preparing, geo);
  mapLayerGeometry = geo;
  mapLayerAt = geo.at;
  mapLayerMargin = margin;
  mapLayerScroll = NO_SCROLL;
  mapLayerBakes++;
  // A loading bake is geometry only; the finished one follows it (`prepareEnteringMap`).
  if (!preparing && !mapLayerX.isContextLost?.()) mapLayerContent = content;
  // Sharp terrain the frame budget could not afford is refined a few rasters per frame
  // and baked once at the end — the map is not re-baked every frame meanwhile.
  terrainRefine = !preparing && terrainRaster.pending ? 0 : -1;
  terrainOwed = terrainRefine < 0 ? [] : null;
}

/** Canvas pixel `c` of the map layer shows the bake's point `(c − offset) / DPR`: the bake
 *  sits past the screen by its margin, and its window moved by its scroll. */
function mapLayerOffset(): { x: number; y: number } {
  const DPR = game.dpr();
  return {
    x: Math.round(mapLayerMargin.x * DPR) - Math.round(mapLayerScroll.x * DPR),
    y: Math.round(mapLayerMargin.y * DPR) - Math.round(mapLayerScroll.y * DPR),
  };
}

/** Paint the canvas rect `r` of the map layer (or of `g`, where the bake's point (0, 0) lies at
 *  `o`) afresh from the bake's geometry; the terrain fields it meets join `fields` (once: `met`
 *  holds their ids). */
function paintMapLayerRect(r: PixelRect, geo: MapLayerGeometry, zooming: boolean, fields: TerrainField[],
  met: Set<string>, g = mapLayerX, o = mapLayerOffset()): void {
  const DPR = game.dpr();
  g.save();
  g.setTransform(1, 0, 0, 1, 0, 0);
  g.clearRect(r.x, r.y, r.width, r.height);
  g.beginPath();
  g.rect(r.x, r.y, r.width, r.height);
  g.clip();
  g.setTransform(DPR, 0, 0, DPR, o.x, o.y);
  const view = { x0: (r.x - o.x) / DPR, y0: (r.y - o.y) / DPR, x1: (r.x + r.width - o.x) / DPR, y1: (r.y + r.height - o.y) / DPR };
  for (const field of paintMapLayer(g, view, zooming, false, geo))
    if (!met.has(field.id)) {
      met.add(field.id);
      fields.push(field);
    }
  g.restore();
}

/**
 * Rule 3: move the bake's window to `to` instead of baking the map again. Its pixels move
 * by whole device pixels with a copy, and only the strips that nothing covered before are
 * painted, from the bake's own geometry: no province is measured again. The bake's space
 * does not move, so the geometry the frame and input read stays valid as it is.
 */
function scrollMapLayer(to: LayerScroll, zooming: boolean): void {
  const DPR = game.dpr();
  const geo = mapLayerGeometry;
  const content = mapLayerContent;
  mapLayerContent = ''; // a half-moved picture is no picture of the map
  if (!geo || mapLayerX.isContextLost?.()) return;
  const dx = Math.round(to.x * DPR) - Math.round(mapLayerScroll.x * DPR);
  const dy = Math.round(to.y * DPR) - Math.round(mapLayerScroll.y * DPR);
  const g = mapLayerX;
  g.save();
  g.setTransform(1, 0, 0, 1, 0, 0);
  g.globalCompositeOperation = 'copy'; // a canvas drawn onto itself reads it as it was
  g.drawImage(mapLayer, -dx, -dy);
  g.restore();
  mapLayerScroll = to;
  const o = mapLayerOffset();
  // The frame's glints need the fields of the window, not of every place it has been.
  const fields = terrainFields.filter((f) => f.box.x + f.box.width >= -o.x / DPR && f.box.x <= (mapLayer.width - o.x) / DPR &&
    f.box.y + f.box.height >= -o.y / DPR && f.box.y <= (mapLayer.height - o.y) / DPR);
  const met = new Set(fields.map((f) => f.id));
  const strips = exposedStrips(mapLayer.width, mapLayer.height, dx, dy);
  for (const r of strips) paintMapLayerRect(r, geo, zooming, fields, met);
  terrainFields = fields;
  mapLayerBakes++; // the settled composite holds the pixels from before the move
  if (!mapLayerX.isContextLost?.()) mapLayerContent = content;
  // A strip may meet terrain the frame budget could not raster yet: sharpen it as after a
  // bake, then paint the strips that owe it once more, not the whole map. They are kept in
  // the bake's own pixels, which a later move does not shift.
  if (terrainRaster.pending && terrainOwed) {
    for (const r of strips) terrainOwed.push({ ...r, x: r.x - o.x, y: r.y - o.y });
    if (terrainOwed.length > MAX_OWED_STRIPS) terrainOwed = null; // past this the bake is cheaper
  }
  // The fields to sharpen changed: walk them from the start.
  if (terrainRaster.pending || terrainRefine >= 0) terrainRefine = 0;
}

/** Paint the strips that owed sharp terrain once more, now that the cache holds it. */
function repaintOwedTerrain(owed: PixelRect[]): void {
  const geo = mapLayerGeometry;
  if (!geo || mapLayerX.isContextLost?.()) return;
  const o = mapLayerOffset();
  const met = new Set(terrainFields.map((f) => f.id));
  for (const r of owed) {
    const x0 = Math.max(0, r.x + o.x);
    const y0 = Math.max(0, r.y + o.y);
    const x1 = Math.min(mapLayer.width, r.x + o.x + r.width);
    const y1 = Math.min(mapLayer.height, r.y + o.y + r.height);
    if (x1 > x0 && y1 > y0) paintMapLayerRect({ x: x0, y: y0, width: x1 - x0, height: y1 - y0 }, geo, false, terrainFields, met);
  }
  mapLayerBakes++;
}

/** Give back the spare canvas's pixels; the next bake into it allocates them again. */
function releaseMapSpare(): void {
  if (mapSpare.width) mapSpare.width = 0;
  if (mapSpare.height) mapSpare.height = 0;
}

/** Drop the bake in the background, if any. */
function cancelBakeJob(): void {
  bakeJob = null;
}

/** Rule 7: start the next bake in the spare canvas at the current camera. `false` — the spare
 *  is unusable, and the caller bakes at once. */
function startBakeJob(content: string, zooming: boolean, final: boolean): boolean {
  const DPR = game.dpr();
  if (mapSpareX.isContextLost?.()) return false;
  const at = performance.now();
  const { margin, ox, oy, width, height } = mapLayerSize();
  if (mapSpare.width !== width) mapSpare.width = width;
  if (mapSpare.height !== height) mapSpare.height = height;
  const geo = measureMapLayer();
  const work = bakeWork(geo.boxes, width, height, DPR, { x: ox, y: oy });
  bakeJob = { content, geo, margin, offset: { x: ox, y: oy }, width, height, zooming, final,
    budget: bakeBudgetMs(game.fps()), startMs: performance.now() - at, fields: [], met: new Set(), work,
    done: 0, paintedMs: 0, lastRows: 0, lastMs: 0, pending: false };
  return true;
}

/**
 * Paint the next `rows` of the bake in the background. `flush` rasters them in this frame:
 * Chromium records a canvas's paint and rasters it only when the canvas is next drawn from,
 * so without it the raster of every band would land at once on the frame that shows the bake.
 */
function paintBakeBand(job: BakeJob, rows: number, flush: boolean): void {
  const at = performance.now();
  const owed = terrainRaster.pending;
  // A refinement's bake makes the last rasters the cache owes: never leave one owed again.
  // Any other band makes none: a raster costs a slow phone more than a band's whole share
  // of the frame, and the refinement makes them after the bake, in a budget of its own.
  terrainRaster.beginFrame(job.final ? Infinity : 0);
  paintMapLayerRect({ x: 0, y: job.done, width: job.width, height: rows }, job.geo, job.zooming, job.fields,
    job.met, mapSpareX, job.offset);
  job.pending ||= terrainRaster.pending;
  terrainRaster.pending = owed;
  if (flush) flushRaster(mapSpare);
  job.done += rows;
  job.lastRows = rows;
  job.lastMs = performance.now() - at;
  job.paintedMs += job.lastMs;
}

/** Raster now what was painted into `source` since it was last drawn from: one pixel drawn
 *  into the frame, which paints over it before it is shown. */
function flushRaster(source: HTMLCanvasElement): void {
  const cx = game.ctx();
  cx.save();
  cx.setTransform(1, 0, 0, 1, 0, 0);
  cx.globalAlpha = 1;
  cx.globalCompositeOperation = 'source-over';
  cx.drawImage(source, 0, 0, 1, 1, 0, 0, 1, 1);
  cx.restore();
}

/** Rule 7: the bake in the background is complete, and it becomes the map layer. */
function swapBakeJob(job: BakeJob): void {
  [mapLayer, mapSpare] = [mapSpare, mapLayer];
  [mapLayerX, mapSpareX] = [mapSpareX, mapLayerX];
  bakeJob = null;
  publishMapGeometry(job.geo);
  mapLayerGeometry = job.geo;
  terrainFields = job.fields;
  mapLayerAt = job.geo.at;
  mapLayerMargin = job.margin;
  mapLayerScroll = NO_SCROLL;
  mapLayerBakes++;
  mapLayerContent = mapLayerX.isContextLost?.() ? '' : job.content;
  // As after a bake: the terrain its bands could not afford is sharpened next.
  terrainRefine = job.pending ? 0 : -1;
  terrainOwed = terrainRefine < 0 ? [] : null;
}

/** Draw the map layer into `g` under `view` (bake space → screen). */
function showMapLayer(g: CanvasRenderingContext2D, view: LayerTransform): void {
  const DPR = game.dpr();
  const { x: ox, y: oy } = mapLayerOffset();
  const exact = exactOffset(view, DPR);
  g.setTransform(1, 0, 0, 1, 0, 0);
  // On its pixel grid the layer is a plain copy; otherwise it is resampled — for the
  // frames of a gesture only, since a settled camera gets an exact bake (rule 4).
  if (exact) g.drawImage(mapLayer, exact.x - ox, exact.y - oy);
  else
    g.drawImage(mapLayer, view.tx * DPR - view.k * ox, view.ty * DPR - view.k * oy,
      view.k * mapLayer.width, view.k * mapLayer.height);
}

/** Province geometry for input and the transform from the screen into it. Bakes the map
 *  layer first when there is none yet (a tap before the first frame). */
export function mapLayerForInput(): LayerTransform {
  if (!mapLayerContent && !mapLayerX.isContextLost?.()) bakeMapLayer(mapLayerSignature(), false);
  return layerTransform(mapLayerAt, camProjection(cam, insets(), mapBounds()));
}

/** Put the static layer — sky and political map — under the live art of this frame. */
export function blitStaticLayer(now: number): void {
  const VW = game.vw();
  const VH = game.vh();
  const DPR = game.dpr();
  const cx = game.ctx();
  terrainRaster.beginFrame(2);
  let here = camProjection(cam, insets(), mapBounds());
  const seenOf = (p: MapProjection): string => `${p.a},${p.x},${p.y},${VW},${VH},${DPR}`;
  const seen = seenOf(here);
  if (seen !== camSeen) {
    camSeen = seen;
    camMovedAt = now;
  }
  // A pinch stays open while its fingers pause: no bake at each intermediate scale.
  const settled = pinchStart === null && now - camMovedAt >= SETTLE_MS;
  mapSettled = settled;
  const content = mapLayerSignature();
  if (mapLayerX.isContextLost?.()) {
    // No offscreen map to reuse: paint it straight into the frame.
    mapSettled = false;
    cancelBakeJob();
    cx.save();
    paintSky(cx);
    const geo = measureMapLayer();
    publishMapGeometry(geo);
    terrainFields = paintMapLayer(cx, { x0: 0, y0: 0, x1: VW, y1: VH }, !settled, false, geo);
    cx.restore();
    mapLayerAt = here;
    mapView = { k: 1, tx: 0, ty: 0 };
    return;
  }
  let view = layerTransform(mapLayerAt, here);
  const frameNow = (): MapLayerFrame => ({
    fresh: mapLayerContent === content,
    transform: view,
    width: VW,
    height: VH,
    dpr: DPR,
    margin: mapLayerMargin,
    scroll: mapLayerScroll,
    settled,
  });
  const decide = (): MapLayerAction => mapLayerAction(frameNow());
  let action = decide();
  if (action === 'snap') {
    // Rule 4: a pan that came to rest between device pixels (a finger on a phone moves
    // the camera by fractions of one) puts the camera on the bake's grid instead of
    // baking the map again. The camera's shift is a term of the projection, and it is
    // under half a device pixel: nothing on the screen visibly moves.
    const nudge = gridNudge(view, DPR);
    panBy(nudge.x, nudge.y);
    here = camProjection(cam, insets(), mapBounds());
    camSeen = seenOf(here); // the camera stays at rest
    view = layerTransform(mapLayerAt, here);
    action = decide();
    if (action === 'snap') action = 'rebake'; // the grid is out of reach: never chase it
  }
  // Rule 7: the bake in the background, judged against the one on the screen.
  const job = bakeJob;
  if (job) {
    const fate = mapSpareX.isContextLost?.() ? 'drop' : bakeJobFate(frameNow(), action, {
      fresh: job.content === content,
      transform: layerTransform(job.geo.at, here),
      margin: job.margin,
      final: job.final,
    });
    if (fate === 'drop') cancelBakeJob();
    else if (fate === 'finish') {
      // The screen cannot wait for it, and its rows left cost less than a whole bake.
      paintBakeBand(job, job.height - job.done, false);
      swapBakeJob(job);
      view = layerTransform(mapLayerAt, here);
      action = decide();
      // A bake is enough for this frame: the next one snaps or starts the next bake.
      if (action === 'snap' || action === 'refresh') action = 'show';
    }
  }
  if (action === 'rebake') {
    // A bake inside a gesture reuses terrain art at its last scale; a settled one
    // sharpens it.
    bakeMapLayer(content, !settled);
    view = { k: 1, tx: 0, ty: 0 };
  } else {
    let refineMs = 0;
    if (action === 'scroll') scrollMapLayer(recentredScroll(view, DPR), !settled);
    // Rule 7: a bake for sharpness alone goes to the background; without a spare, at once.
    if (action === 'refresh' && !bakeJob && !startBakeJob(content, !settled, false)) {
      bakeMapLayer(content, !settled);
      view = { k: 1, tx: 0, ty: 0 };
    }
    if (terrainRefine >= 0 && view.k === 1 && !bakeJob) {
      // Sharpen the terrain the last bake or move could not afford, without repainting the
      // map: at rest in the share of the frame a bake in the background gets, in motion one
      // raster a frame, since the frames of a gesture are the player's. Once all are sharp,
      // paint what owes it one last time: the strips a move left without it, or the whole
      // bake, in the background. Each raster is made here to the last pixel (`flushRaster`),
      // not by the band that first draws it.
      const at = performance.now();
      const budget = settled ? bakeBudgetMs(game.fps()) : 0;
      let pixels = 0;
      terrainRaster.beginFrame(Infinity);
      while (terrainRefine < terrainFields.length) {
        const field = terrainFields[terrainRefine]!;
        const owed = terrainRaster.owed(field, DPR);
        if (owed && pixels) {
          // A raster costs about its pixels at the rate of the ones made so far: one that
          // would overrun the budget waits for the next frame.
          const spent = performance.now() - at;
          if (spent + (spent / pixels) * owed > budget) break;
        }
        const raster = owed ? terrainRaster.prepare(field, DPR) : undefined;
        if (raster) flushRaster(raster.surface);
        pixels += owed;
        terrainRefine++;
      }
      terrainRaster.beginFrame(0);
      refineMs = performance.now() - at;
      if (terrainRefine >= terrainFields.length && settled) {
        // Room for whatever the raster cache evicted meanwhile: never loop on it.
        terrainRaster.beginFrame(Infinity);
        if (terrainOwed) {
          repaintOwedTerrain(terrainOwed);
          terrainRefine = -1;
          terrainOwed = [];
        } else if (!startBakeJob(content, false, true)) {
          bakeMapLayer(content, false);
          view = { k: 1, tx: 0, ty: 0 };
        }
      }
    }
    const next = bakeJob;
    if (next) {
      // One band a frame; a bake started in this frame has already spent its start, and the
      // refinement that started it its rasters.
      const rows = bandRows({ work: next.work, done: next.done, paintedMs: next.paintedMs,
        lastRows: next.lastRows, lastMs: next.lastMs, budgetMs: next.budget,
        spentMs: next === job ? 0 : next.startMs + refineMs });
      if (rows > 0) paintBakeBand(next, rows, true);
      if (next.done >= next.height) {
        swapBakeJob(next);
        view = layerTransform(mapLayerAt, here);
      }
    }
  }
  if (!bakeJob && terrainRefine < 0 && now - camMovedAt >= SPARE_KEEP_MS) releaseMapSpare();
  // In motion a pan moves the layer by whole device pixels — a copy, not a resample;
  // what is drawn from bake geometry follows the same rounded transform.
  mapView = onPixelGrid(view, DPR);
  if (settled && !bgx.isContextLost?.()) {
    // Settled: compose sky + map once, then every idle frame is one 1:1 blit — also while
    // the sharp bake paints in the background under the stretched one (rule 7).
    const key = `${mapLayerBakes}|${mapView.k},${mapView.tx},${mapView.ty}|${VW}x${VH}:${DPR}|` +
      `${starfieldOn()}:${spaceBackdropReady(holographicMapOn())}:${holographicMapOn()}|${cam.x},${cam.y},${cam.scale}`;
    if (bgComposite !== key) {
      bgComposite = '';
      const width = Math.round(VW * DPR);
      const height = Math.round(VH * DPR);
      if (bg.width !== width) bg.width = width;
      if (bg.height !== height) bg.height = height;
      paintSky(bgx);
      showMapLayer(bgx, mapView);
      if (!bgx.isContextLost?.()) bgComposite = key;
    }
    cx.save();
    cx.setTransform(1, 0, 0, 1, 0, 0);
    // Replace the entire frame even if a backing store disappears between the
    // validity check and this blit. Source-over would accumulate live glow forever.
    cx.globalCompositeOperation = 'copy';
    cx.drawImage(bg, 0, 0);
    cx.restore();
    return;
  }
  // In motion (or settling): the sky live, the baked map under the camera's transform.
  cx.save();
  paintSky(cx);
  showMapLayer(cx, mapView);
  cx.restore();
}

/** Рецепт подготовки карты за заставкой входа (`mapLoading.ts`): фон, выпечка геометрии,
 *  местность каждой провинции и последняя выпечка. */
export function mapPreparationJobs(): PreparationJob[] {
  return [
    { label: t('map-loading.background'), run: () => starfieldOn() ? prepareSpaceBackdrop(holographicMapOn()) : undefined },
    { label: t('map-loading.geometry'), run: () => {
      terrainRaster.beginFrame(Infinity);
      bakeMapLayer(mapLayerSignature(), false, true);
      // The borders' detail by zoom is weighed once per shape: here, not on the first zoom out.
      if (holographicMapOn() && provinceGeometry) territoryGeometry.weighBorders(provinceGeometry.shape);
    } },
    ...game.nodes().map(n => ({ label: t('map-loading.terrain'), run: () => {
      // Prepare known geometry beyond the first screen, in cooperative loading
      // slices. Unexplored provinces never enter either terrain cache.
      const poly = provincePolygon(n.id);
      if (holographicMapOn() && poly) terrainGeometry.prepare(n.id, terrainArtKind(n.sector, game.world().planets[n.id]?.terrain),
        sectorTypeOf(n.id)?.color ?? '#9fb6bd', poly, known(n.id) || memory.has(n.id), world(n));
      const field = terrainFields.find(f => f.id === n.id);
      if (field) terrainRaster.prepare(field, game.dpr());
    } })),
    { label: t('map-loading.ready'), run: () => { bakeMapLayer(mapLayerSignature(), false); bgComposite = ''; } },
  ];
}
