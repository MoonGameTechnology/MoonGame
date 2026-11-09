/**
 * Статический слой карты (REFM-232): небо под картой и политическая карта — заливка
 * провинций, местность, дороги, край доски и кольца обзора, — выпеченные под камерой в свой
 * холст с запасом за экраном. Модуль решает, когда выпекать, сдвигать окно выпечки или
 * дорисовывать её в фоне полосами (`decisions/mapLayerView.ts`), и кладёт небо с картой под
 * живой кадр (`blitStaticLayer`), а медленному устройству — ещё и подложку из всей карты на
 * обзоре там, где отдаление открыло край выпечки (правило 9). Здесь же рецепт подготовки карты
 * за заставкой входа (`mapPreparationJobs`) и рисунок сети дорог.
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
import { visibleState, type GameState } from '../../packages/shared-core/src/index';
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
import { framedRect, intersectRect, uncoveredRects } from '../../decisions/livingBorderLayer';
import {
  DRAFT_DENSITY,
  DRAFT_OVERSCAN_SHARE,
  GESTURE_BAKE_MS,
  LIVE_RING_BUDGET,
  MAX_BAKE_PIXELS,
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
  liveRingsShown,
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
import type { TerrainEnvironment } from '../../decisions/terrainEnvironment';
import { knownEnvironment, projectTerrainTile, terrainKnowledge, TerrainEnvironmentSceneCache } from './terrainEnvironmentView';
import { gridGap, gridLines, gridOffset } from './backdropGrid';
import { canvasCompatibilityOptions } from './canvasCompatibility';
import { SECTOR_TYPES, type MapNode } from './game';
import { data } from './gameData';
import { glowOn, starfieldOn } from './graphicsPrefs';
import { clipGlassSurface, drawGlassRim, drawGlassScreen, drawGlassWave, type TerrainField } from './holographicSurface';
import { atOverview, cam, insets, mapBounds, panBy, world } from './mapCamera';
import { known, memory, surveyed, vision, type Vision } from './mapFog';
import { pinchStart } from './mapInput';
import { GRID, ownerColor } from './mapPalette';
import type { PreparationJob } from './mapPreparation';
import { clipPolygon, clipRect, provinceSeeds, type ProvinceSeed } from './provinceMap';
import { COLOR } from './sideColors';
import { bakeSignature, KnowledgeRevision } from './staticLayerCache';
import { floorDensityFor, TERRAIN_PAD, TerrainRasterCache } from './terrainRasterCache';
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
  /** Часы голограммы. */
  clock(): number;
  /** Часы голограммы стоят по выбору игрока — выключено движение: рамку и волну стекла держит
   *  выпечка, а не кадр. */
  still(): boolean;
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
// camera composes sky and map into `bg` once, and idle frames are one 1:1 blit. A slow device
// also keeps the whole map at the overview in an UNDERLAY, painted at rest in bands: a zoom out
// shows it where it uncovers the bake, instead of baking the map mid-gesture (rule 9).
const bg = document.createElement('canvas');
export const bgx = (mapContextOptions ? bg.getContext('2d', mapContextOptions) : bg.getContext('2d')) as CanvasRenderingContext2D;
let mapLayer = document.createElement('canvas');
let mapLayerX = (mapContextOptions ? mapLayer.getContext('2d', mapContextOptions) : mapLayer.getContext('2d')) as CanvasRenderingContext2D;
/** Rule 7: the canvas the next bake is painted into in the background. It gives its pixels
 *  back once the camera has rested with nothing to bake ({@link SPARE_KEEP_MS}). */
let mapSpare = document.createElement('canvas');
let mapSpareX = (mapContextOptions ? mapSpare.getContext('2d', mapContextOptions) : mapSpare.getContext('2d')) as CanvasRenderingContext2D;
/** Rule 9: a slow device's underlay — the whole board at the overview, without rings like its
 *  bakes. It gets pixels only once the device proves slow. */
const mapUnder = document.createElement('canvas');
const mapUnderX = (mapContextOptions ? mapUnder.getContext('2d', mapContextOptions) : mapUnder.getContext('2d')) as CanvasRenderingContext2D;
const terrainRaster = new TerrainRasterCache(undefined, mapContextOptions);
const terrainGeometry = new TerrainGeometryCache();
const terrainEnvironment = new TerrainEnvironmentSceneCache();
export const mapContextEvents = { lost: 0, restored: 0 };
export const backgroundContextEvents = { lost: 0, restored: 0 };
let mapLayerContent = ''; // content signature of the map-layer bake ('' — none or invalid)
let mapLayerAt: MapProjection = { a: 1, x: 0, y: 0 }; // projection the map layer was painted at
let mapLayerMargin: Overscan = { x: 0, y: 0 }; // its margin beyond the screen, CSS px
let mapLayerScroll: LayerScroll = NO_SCROLL; // how far its window moved since (rule 3), CSS px
let mapLayerBakes = 0; // bumps on every bake and move, so the composite knows its map is current
let mapLayerDensity = 1; // its canvas pixels per CSS px: the DPR, or a draft's (rule 8)
let mapLayerDraft = false; // it is a draft, baked mid-gesture on a slow device (rule 8)
/** This frame's transform from the map layer's bake space to the screen. The province
 *  geometry below (polygons, borders, terrain fields, glass frame) lives in bake space. */
export let mapView: LayerTransform = { k: 1, tx: 0, ty: 0 };
/** Next terrain field whose sharp raster a bake could not afford yet; -1 — none. */
let terrainRefine = -1;
/** The scene whose floors the frames at rest are making, and its next tile to look at. */
let floorScene: TerrainEnvironment | null = null;
let floorNext = 0;
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
/** Rule 9: the underlay being painted, a band a frame at rest like the next bake. */
let underJob: BakeJob | null = null;
let underContent = ''; // content signature of the underlay ('' — none, stale or half-painted)
let underAt: MapProjection = { a: 1, x: 0, y: 0 }; // projection it was painted at: the overview
let underOffset = { x: 0, y: 0 }; // where its point (0, 0) lies on its canvas, device px
let underBakes = 0; // bumps on every underlay painted, so the composite knows its underlay
let underRefused = ''; // content whose underlay had no pixels: not measured again at rest
/** The underlay holds the board this much wider than its glass and province clip, CSS px: the
 *  board edge, the glass rim and the terrain's raster padding reach past them. */
const UNDER_PAD = TERRAIN_PAD + 2;
/** Rule 8: what the last whole bake cost this device, its raster included, ms. */
let bakeCostMs = 0;
let bgComposite = ''; // what `bg` holds: which map bake, at which offset, over which sky
let camSeen = ''; // projection of the previous frame, to notice the camera moving
let camMovedAt = -Infinity;
/** Provinces as the frame and input read them: the geometry of the last bake handed over
 *  ({@link publishMapGeometry}), polygons through {@link provincePolygon} and
 *  {@link provinceAt}. `null` — no bake yet. */
export let provinceGeometry: MapLayerGeometry | null = null;
/** The camera has rested `SETTLE_MS` (as {@link blitStaticLayer} judged this frame). */
export let mapSettled = false;
/** The camera is moving at `now`: a pinch is open, or a frame saw it move less than `SETTLE_MS`
 *  ago. Judged at the moment asked, so a camera that stopped while the map was not drawn is not
 *  moving. */
export function mapMoving(now: number): boolean {
  return pinchStart !== null || now - camMovedAt < SETTLE_MS;
}
/** A whole bake costs this device more than `GESTURE_BAKE_MS`: a gesture does not wait for one
 *  (rule 8, as {@link blitStaticLayer} judged this frame). */
export let mapCostly = false;
export let terrainFields: TerrainField[] = [];
export let holographicFrame = { x: 0, y: 0, width: 0, height: 0 };

/** WebView can restore contexts without changing canvas dimensions or camera state. */
export function invalidateMapSurfaces(): void {
  cancelBakeJob();
  releaseMapSpare();
  mapLayerContent = '';
  forgetUnderlay();
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
for (const type of ['contextlost', 'contextrestored'] as const)
  mapUnder.addEventListener?.(type, () => {
    backgroundContextEvents[type === 'contextlost' ? 'lost' : 'restored']++;
    forgetUnderlay();
    bgComposite = '';
  });

/** Rule 9: the underlay no longer shows the map, and its painting starts over. */
function forgetUnderlay(): void {
  underContent = '';
  underJob = null;
  underRefused = '';
}

/**
 * ROADS-7: рисунок сети дорог — штрихи и отметки развилок — меняется только вместе с
 * топологией (временный коридор героя бьёт `state.topology`), а слой карты перепекается
 * куда чаще: смена владельца, туман, зум, уход камеры за запас выпечки. Пересчёт сети на
 * каждой выпечке стоил ~3 мс на frontier-50; теперь она считается раз на топологию и
 * сбрасывается вместе с геометрией карты. Там же рамка каждого штриха в координатах
 * карты: дорогу вне выпечки отсеивают, не проецируя ни одной её точки.
 */
type RoadDrawing = { strokes: NetPoint[][]; boxes: Float64Array; marks: ForkMark[]; topology: number };
let roadDrawing: (RoadDrawing & { topology: number; sourceTopology: number; viewer: string }) | null = null;
export function roadDrawingOf(state: GameState): RoadDrawing {
  const topology = state.topology ?? 0;
  const viewer = game?.me() ?? '';
  if (roadDrawing?.sourceTopology !== topology || roadDrawing.viewer !== viewer) {
    // In solo the host owns the authoritative state. Project secret hero corridors
    // before they can influence either visible roads or the decorative clearings.
    const permitted = state.tempLanes?.length && viewer ? visibleState(state, viewer, data) : state;
    const strokes = roadStrokes(permitted.planets);
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
    roadDrawing = { topology: permitted.topology ?? 0, sourceTopology: topology, viewer, strokes, boxes, marks: forkMarks(permitted.planets) };
  }
  return roadDrawing;
}

/** Новая карта (`installMapGeometry`): сеть дорог, геометрия местности и её растры остались
 *  от прежней. */
export function forgetMapArt(): void {
  roadDrawing = null; // другая карта — другая сеть
  terrainGeometry.clear();
  terrainEnvironment.clear();
  environmentMade = null;
  terrainRaster.clear();
  forgetUnderlay(); // подложка — рисунок прежней карты
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
/** Знание игрока о мирах для подписи выпечки: сверяется каждым кадром без строки по всем
 *  мирам (`staticLayerCache.ts`, правило 2). */
const knowledge = new KnowledgeRevision();
/** С чем знание о мирах сверено в последний раз. Знание читает мир, зрение кадра, память
 *  разведки, игрока и узлы карты. Мир не правят на месте, а заменяют целиком, зрение
 *  меняется вместе с ним (договор `visionMemo` в `mapFog.ts`), память считает свои правки
 *  (`version`). Пока всё это прежнее, прежний и номер, и обход всех миров карты (на большой
 *  их больше тысячи) кадр пропускает. Без тумана зрения нет, а песочница правит мир на
 *  месте: там сверка идёт каждым кадром, как раньше. */
let knowledgeSeen: {
  world: GameState;
  vision: Vision;
  scans: number;
  me: string;
  nodes: readonly MapNode[];
  revision: number;
} | null = null;
/** Номер знания о мирах: сверка, только когда сменилось то, что она читает. */
function knowledgeRevision(s: GameState, me: string): number {
  const nodes = game.nodes();
  const scans = memory.version();
  const seen = knowledgeSeen;
  if (
    seen &&
    seen.world === s &&
    seen.vision === vision &&
    seen.scans === scans &&
    seen.me === me &&
    seen.nodes === nodes
  )
    return seen.revision;
  const revision = knowledge.check(nodes, knownOwner, (id) =>
    knownEnvironment(s.planets[id], known(id), memory.get(id), surveyed(id)),
  );
  knowledgeSeen = vision ? { world: s, vision, scans, me, nodes, revision } : null;
  return revision;
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
  const ME = game.me();
  const VW = game.vw();
  const VH = game.vh();
  const DPR = game.dpr();
  return bakeSignature({
    vw: VW,
    vh: VH,
    dpr: DPR,
    me: ME,
    // Подпись читает ЗНАНИЕ игрока (`knownOwner`, `knownEnvironment`), а не правду — см.
    // `staticLayerCache.ts` (REFM-60): иначе скрытый захват выдал бы себя самим фактом перерисовки.
    knowledge: knowledgeRevision(s, ME),
    starfield: starfieldOn(),
  }) + `|holo:${holographicMapOn()}|glow:${glowOn()}` +
    // A standing hologram's glass is baked at the moment its clock stands at.
    `|still:${holographicMapOn() && game.still() ? game.clock() : '-'}` +
    // The roads: a hero's corridor lays new lanes mid-match. A scroll paints its strips with
    // the roads of the moment, so a bake that missed them would end at the strip's edge.
    `|topo:${roadDrawingOf(s).topology}`;
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
  if (starfieldOn()) {
    // One colour for all the stars, their brightness in the alpha: the canvas parses a colour
    // string through a cache of eight, and 280 distinct ones missed it in every frame of a
    // gesture, each miss leaving a heap object that only a major GC frees.
    const alpha = g.globalAlpha;
    g.fillStyle = '#bfeee6';
    for (const st of STARS) {
      g.globalAlpha = alpha * st.b * 0.45;
      g.fillRect(st.x * VW, st.y * VH, 0.7, 0.7);
    }
    g.globalAlpha = alpha;
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
  /** One permitted world-space scene, reused by the bake and all its exposed strips. */
  environment: TerrainEnvironment | null;
  readonly lod: MapLod;
  /** The bake carries the overview's node rings. A slow device's leaves them to the frame
   *  ({@link drawLiveRings}, rule 8): stretched with the bake, they would swell with the map. */
  readonly rings: boolean;
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
  const at = camProjection(cam, insets(), mapBounds());
  const nodes: MapNode[] = [];
  const seeds = provinceSeeds(MAP, at.a, (n) => {
    const p = s.planets[n.id];
    if (!p) return null;
    nodes.push(n);
    return { size: p.size ?? 1, at: world(n), owner: knownOwner(n.id) };
  });
  for (let i = 0; i < seeds.length; i++) {
    const id = nodes[i]!.id;
    seeds[i]!.kind = terrainKnowledge(s.planets[id], known(id), memory.get(id), surveyed(id)).kind ?? 'unknown';
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
    at,
    environment: null,
    lod: currentMapLod(),
    rings: !mapCostly,
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

/** The last terrain scene and what it was made from: the provinces' shape (one object while
 *  it holds, `territoryGeometry.ts`), what the viewer knows of each, the roads and the map. */
let environmentMade: { shape: TerritoryShape; place: string; knowledge: string; roads: RoadDrawing;
  seed: string; environment: TerrainEnvironment } | null = null;

/**
 * The permitted terrain scene of `geo`. Its cache (`terrainEnvironmentView.ts`) knows a scene by
 * every vertex of the input, put in canonical order and written out whole — on a 2v2 map half
 * the CPU of a bake, paid by every bake and every bake in the background, although a zoom or a
 * pan changes nothing in it. The same shape put at the same place in the world, the same
 * knowledge and the same roads are the same scene: then the input is not even built.
 */
function environmentOf(geo: MapLayerGeometry, roads: RoadDrawing): TerrainEnvironment {
  const s = game.world();
  const seed = s.mapId ?? 'terrain';
  const knowledge = geo.shape.cells.map((cell) => {
    const id = geo.nodes[cell.idx]!.id;
    const k = terrainKnowledge(s.planets[id], known(id), memory.get(id), surveyed(id));
    return `${id}:${k.known ? 1 : 0}:${k.kind ?? ''}:${k.terrain ?? ''}`;
  }).join('|');
  // Where the shape's coordinates land in the world; camera roundoff only costs a miss.
  const projection = geo.at;
  const q = (n: number): number => Math.round(n * 1e6);
  const place = [geo.place.scale / projection.a, (geo.place.x - projection.x) / projection.a,
    (geo.place.y - projection.y) / projection.a].map(q).join(',');
  const made = environmentMade;
  if (made && made.shape === geo.shape && made.place === place && made.knowledge === knowledge &&
    made.roads === roads && made.seed === seed)
    return made.environment;
  const environment = terrainEnvironment.prepare({
    seed,
    cells: geo.shape.cells.map(cell => {
      const n = geo.nodes[cell.idx]!;
      return {
        id: n.id,
        ...terrainKnowledge(s.planets[n.id], known(n.id), memory.get(n.id), surveyed(n.id)),
        poly: cell.poly.map(([x, y]): [number, number] => [
          (x * geo.place.scale + geo.place.x - projection.x) / projection.a,
          (y * geo.place.scale + geo.place.y - projection.y) / projection.a,
        ]),
      };
    }),
    roads: roads.strokes,
    markers: [
      ...geo.nodes.map(n => ({ x: n.x, y: n.y, kind: 'capture' as const })),
      ...roads.marks.map(m => ({ ...m.at, kind: 'fork' as const })),
    ],
  });
  environmentMade = { shape: geo.shape, place, knowledge, roads, seed, environment };
  return environment;
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
    // Continuous terrain supplies geography; a kind wash would redraw cell seams.
    kindAccent: () => undefined,
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
  const roads = roadDrawingOf(s);
  if (!geo.environment) geo.environment = environmentOf(geo, roads);
  // The floors of the terrain (`terrainRasterCache.ts`) are as sharp as the map's size allows.
  const bounds = mapBounds();
  terrainRaster.setFloorDensity(floorDensityFor((bounds.maxX - bounds.minX) * (bounds.maxY - bounds.minY)));
  // Large fields remain legible in overview and in the simplified renderer.
  // Features belong to spatial tiles once; only the union of KNOWN territory clips them.
  g.save();
  g.globalAlpha *= Math.max(0.5, lod.art);
  const reach = TERRAIN_PAD + 1;
  const projection = { scale: at.a, x: at.x, y: at.y };
  for (const tile of geo.environment.tiles) {
    const field = projectTerrainTile(tile, projection);
    const b = field.box;
    if (b.x > view.x1 + reach || b.y > view.y1 + reach ||
      b.x + b.width < view.x0 - reach || b.y + b.height < view.y0 - reach) continue;
    fields.push(field);
    if (!preparing) terrainRaster.draw(g, field, DPR, zooming);
  }
  g.restore();
  // Rifts retain their exceptional local identity; ordinary environments use the field above.
  if (holographicMapOn() && lod.art > 0) {
    g.save();
    g.globalAlpha *= lod.art;
    for (let i = 0; i < geo.shape.cells.length; i++) {
      if (!meets(i, reach)) continue;
      const n = geo.nodes[geo.shape.cells[i]!.idx]!;
      const visible = terrainKnowledge(s.planets[n.id], known(n.id), memory.get(n.id), surveyed(n.id));
      if (visible.kind !== 'rift') continue;
      const field = terrainGeometry.project(n.id, 'rift', sectorTypeOf(n.id)?.color ?? '#9fb6bd',
        cellPoly(geo, i), visible.known, inBake(n));
      if (!field) continue;
      fields.push(field);
      if (!preparing) terrainRaster.draw(g, field, DPR, zooming);
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
  // roads they end, since a frame stroking 1675 of them spent half its raster on them. A slow
  // device's bake leaves them to the frame (`drawLiveRings`, rule 8).
  if (geo.rings && lod.art < 1) {
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
  // Motion off: the hologram stands, and the glass wave and rim the frame lays over the map
  // (`mapSurface.ts`) are part of its picture. Baked over all of it, they cost a strip of the
  // bake only where they pass.
  if (holographicMapOn() && game.still()) {
    drawGlassWave(g, geo.frame, game.vw(), game.vh(), game.clock(), glowOn(), view);
    drawGlassRim(g, geo.frame, game.clock(), glowOn(), view);
  }
  return fields;
}

/** A bake's size at the current screen and `density` canvas pixels per CSS px: its margin beyond
 *  the screen (a draft's is narrower, rule 8), where the bake's point (0, 0) lies on its canvas,
 *  and the canvas, all but the margin in its pixels. */
function mapLayerSize(density = game.dpr(), draft = false): { margin: Overscan; ox: number; oy: number; width: number; height: number } {
  const VW = game.vw();
  const VH = game.vh();
  const margin = draft ? overscanFor(VW, VH, density, MAX_BAKE_PIXELS, DRAFT_OVERSCAN_SHARE) : overscanFor(VW, VH, density);
  const ox = Math.round(margin.x * density);
  const oy = Math.round(margin.y * density);
  return { margin, ox, oy, width: Math.round(VW * density) + 2 * ox, height: Math.round(VH * density) + 2 * oy };
}

/** Bake the map layer at the current camera, with its margin beyond the screen. A `draft` (rule 8)
 *  is baked at {@link DRAFT_DENSITY}, with the terrain rasters at hand, and is never left at rest. */
function bakeMapLayer(content: string, zooming: boolean, preparing = false, draft = false): void {
  const VW = game.vw();
  const VH = game.vh();
  const DPR = game.dpr();
  cancelBakeJob(); // this bake supersedes it
  if (mapLayerX.isContextLost?.()) return;
  const at = performance.now();
  const density = draft ? Math.min(DPR, DRAFT_DENSITY) : DPR;
  const { margin, ox, oy, width, height } = mapLayerSize(density, draft);
  mapLayerContent = ''; // publish the signature only after a complete paint
  // Preserve the allocation when only the scene changed.
  if (mapLayer.width !== width) mapLayer.width = width;
  if (mapLayer.height !== height) mapLayer.height = height;
  mapLayerX.setTransform(1, 0, 0, 1, 0, 0);
  mapLayerX.clearRect(0, 0, width, height);
  mapLayerX.setTransform(density, 0, 0, density, ox, oy);
  const geo = measureMapLayer();
  publishMapGeometry(geo);
  if (draft) terrainRaster.beginFrame(0);
  terrainFields = paintMapLayer(mapLayerX, { x0: -margin.x, y0: -margin.y, x1: VW + margin.x, y1: VH + margin.y },
    zooming, preparing, geo);
  if (!preparing) {
    // Rule 8: the raster is four fifths of a bake, and it would land in the frame that shows the
    // bake anyway: made here, it is counted in the bake's cost. A draft's cost is not the bake's.
    flushRaster(mapLayer);
    if (!draft) bakeCostMs = performance.now() - at;
  }
  mapLayerGeometry = geo;
  mapLayerAt = geo.at;
  mapLayerMargin = margin;
  mapLayerScroll = NO_SCROLL;
  mapLayerDensity = density;
  mapLayerDraft = draft;
  mapLayerBakes++;
  // A loading bake is geometry only; the finished one follows it (`prepareEnteringMap`).
  if (!preparing && !mapLayerX.isContextLost?.()) mapLayerContent = content;
  // Sharp terrain the frame budget could not afford is refined a few rasters per frame
  // and baked once at the end — the map is not re-baked every frame meanwhile. A draft owes
  // nothing: the bake that replaces it at rest makes its own.
  terrainRefine = !preparing && !draft && terrainRaster.pending ? 0 : -1;
  terrainOwed = terrainRefine < 0 ? [] : null;
}

/** Canvas pixel `c` of the map layer shows the bake's point `(c − offset) / mapLayerDensity`: the
 *  bake sits past the screen by its margin, and its window moved by its scroll. */
function mapLayerOffset(): { x: number; y: number } {
  const d = mapLayerDensity;
  return {
    x: Math.round(mapLayerMargin.x * d) - Math.round(mapLayerScroll.x * d),
    y: Math.round(mapLayerMargin.y * d) - Math.round(mapLayerScroll.y * d),
  };
}

/** Paint the canvas rect `r` of the map layer (or of `g`, where the bake's point (0, 0) lies at
 *  `o` and a CSS px is `d` of its pixels) afresh from the bake's geometry; the terrain fields it
 *  meets join `fields` (once: `met` holds their ids). */
function paintMapLayerRect(r: PixelRect, geo: MapLayerGeometry, zooming: boolean, fields: TerrainField[],
  met: Set<string>, g = mapLayerX, o = mapLayerOffset(), d = mapLayerDensity): void {
  g.save();
  g.setTransform(1, 0, 0, 1, 0, 0);
  g.clearRect(r.x, r.y, r.width, r.height);
  g.beginPath();
  g.rect(r.x, r.y, r.width, r.height);
  g.clip();
  g.setTransform(d, 0, 0, d, o.x, o.y);
  const view = { x0: (r.x - o.x) / d, y0: (r.y - o.y) / d, x1: (r.x + r.width - o.x) / d, y1: (r.y + r.height - o.y) / d };
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
  const d = mapLayerDensity;
  const geo = mapLayerGeometry;
  const content = mapLayerContent;
  mapLayerContent = ''; // a half-moved picture is no picture of the map
  if (!geo || mapLayerX.isContextLost?.()) return;
  const dx = Math.round(to.x * d) - Math.round(mapLayerScroll.x * d);
  const dy = Math.round(to.y * d) - Math.round(mapLayerScroll.y * d);
  const g = mapLayerX;
  g.save();
  g.setTransform(1, 0, 0, 1, 0, 0);
  g.globalCompositeOperation = 'copy'; // a canvas drawn onto itself reads it as it was
  g.drawImage(mapLayer, -dx, -dy);
  g.restore();
  mapLayerScroll = to;
  const o = mapLayerOffset();
  // The frame's glints need the fields of the window, not of every place it has been.
  const fields = terrainFields.filter((f) => f.box.x + f.box.width >= -o.x / d && f.box.x <= (mapLayer.width - o.x) / d &&
    f.box.y + f.box.height >= -o.y / d && f.box.y <= (mapLayer.height - o.y) / d);
  const met = new Set(fields.map((f) => f.id));
  const strips = exposedStrips(mapLayer.width, mapLayer.height, dx, dy);
  for (const r of strips) paintMapLayerRect(r, geo, zooming, fields, met);
  terrainFields = fields;
  mapLayerBakes++; // the settled composite holds the pixels from before the move
  if (!mapLayerX.isContextLost?.()) mapLayerContent = content;
  // A strip may meet terrain the frame budget could not raster yet: sharpen it as after a
  // bake, then paint the strips that owe it once more, not the whole map. They are kept in
  // the bake's own pixels, which a later move does not shift. A draft owes nothing (rule 8).
  if (mapLayerDraft) return;
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
 * Paint the next `rows` of the bake in the background (or of the underlay: `g` draws into
 * `surface`). `flush` rasters them in this frame: Chromium records a canvas's paint and rasters
 * it only when the canvas is next drawn from, so without it the raster of every band would land
 * at once on the frame that shows the bake.
 */
function paintBakeBand(job: BakeJob, rows: number, flush: boolean, g = mapSpareX, surface = mapSpare): void {
  const at = performance.now();
  const owed = terrainRaster.pending;
  // A refinement's bake makes the last rasters the cache owes: never leave one owed again.
  // Any other band makes none: a raster costs a slow phone more than a band's whole share
  // of the frame, and the refinement makes them after the bake, in a budget of its own.
  terrainRaster.beginFrame(job.final ? Infinity : 0);
  paintMapLayerRect({ x: 0, y: job.done, width: job.width, height: rows }, job.geo, job.zooming, job.fields,
    job.met, g, job.offset, game.dpr());
  job.pending ||= terrainRaster.pending;
  terrainRaster.pending = owed;
  if (flush) flushRaster(surface);
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

/** A floor is the tile's drawing whatever the camera: any projection names its tile. */
const FLOOR_PROJECTION = { scale: 1, x: 0, y: 0 };

/**
 * The frames at rest make the floors the known map still lacks (`terrainRasterCache.ts`): of the
 * tiles exploration revealed since the loading, a few per frame in the share of the frame a
 * bake in the background gets. Then a later zoom out finds every known tile at least soft,
 * never missing. `true` — they are all made, and this frame made none.
 */
function prepareFloors(): boolean {
  const scene = provinceGeometry?.environment;
  if (!scene || mapLayerX.isContextLost?.()) return false;
  if (scene !== floorScene) {
    floorScene = scene;
    floorNext = 0;
  }
  if (floorNext >= scene.tiles.length) return true;
  const DPR = game.dpr();
  const at = performance.now();
  const budget = bakeBudgetMs(game.fps());
  const owed = terrainRaster.pending;
  let made = false;
  while (floorNext < scene.tiles.length && performance.now() - at < budget) {
    const field = projectTerrainTile(scene.tiles[floorNext]!, FLOOR_PROJECTION);
    floorNext++;
    if (terrainRaster.hasFloor(field, DPR)) continue;
    terrainRaster.beginFrame(1);
    made = !!terrainRaster.prepareFloor(field, DPR) || made;
  }
  terrainRaster.beginFrame(0);
  terrainRaster.pending = owed;
  if (floorNext >= scene.tiles.length) terrainRaster.packFloors();
  // Rastered here, at rest, not by the first frame of the next gesture.
  const atlas = terrainRaster.floorAtlas;
  if (made && atlas) flushRaster(atlas);
  return false;
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
  mapLayerDensity = game.dpr();
  mapLayerDraft = false;
  mapLayerBakes++;
  mapLayerContent = mapLayerX.isContextLost?.() ? '' : job.content;
  // Rule 8: its bands were rastered as they were painted, so they add up to a whole bake.
  bakeCostMs = job.startMs + job.paintedMs;
  // As after a bake: the terrain its bands could not afford is sharpened next.
  terrainRefine = job.pending ? 0 : -1;
  terrainOwed = terrainRefine < 0 ? [] : null;
}

/** Rule 9: start painting the underlay — the whole board at the overview, measured there — into
 *  its canvas. `false` — it has no pixels to paint into. */
function startUnderlay(content: string): boolean {
  const DPR = game.dpr();
  if (mapUnderX.isContextLost?.()) return false;
  const at = performance.now();
  const geo = atOverview(measureMapLayer);
  // The board: its glass and the province clip, which holds the terrain, the roads and the edge.
  let x0 = geo.frame.x;
  let y0 = geo.frame.y;
  let x1 = geo.frame.x + geo.frame.width;
  let y1 = geo.frame.y + geo.frame.height;
  for (const [x, y] of geo.clip) {
    if (x < x0) x0 = x;
    if (x > x1) x1 = x;
    if (y < y0) y0 = y;
    if (y > y1) y1 = y;
  }
  const offset = { x: -Math.floor((x0 - UNDER_PAD) * DPR), y: -Math.floor((y0 - UNDER_PAD) * DPR) };
  const width = Math.ceil((x1 + UNDER_PAD) * DPR) + offset.x;
  const height = Math.ceil((y1 + UNDER_PAD) * DPR) + offset.y;
  if (!(width > 0 && height > 0) || width * height > MAX_BAKE_PIXELS) return false;
  if (mapUnder.width !== width) mapUnder.width = width;
  if (mapUnder.height !== height) mapUnder.height = height;
  underContent = ''; // a half-painted underlay is no picture of the map
  underJob = { content, geo, margin: { x: 0, y: 0 }, offset, width, height, zooming: true, final: false,
    budget: bakeBudgetMs(game.fps()), startMs: performance.now() - at, fields: [], met: new Set(),
    work: bakeWork(geo.boxes, width, height, DPR, offset), done: 0, paintedMs: 0, lastRows: 0, lastMs: 0,
    pending: false };
  return true;
}

/** Rule 9: the next band of the underlay of `content`; a content change starts it over, since a
 *  stale underlay is never shown. Its terrain is the floors': rasters it makes none. */
function paintUnderlay(content: string): void {
  if (underContent === content || underRefused === content) return;
  const going = underJob?.content === content;
  if (!going && !startUnderlay(content)) {
    underRefused = content;
    return;
  }
  const job = underJob!;
  const rows = bandRows({ work: job.work, done: job.done, paintedMs: job.paintedMs, lastRows: job.lastRows,
    lastMs: job.lastMs, budgetMs: job.budget, spentMs: going ? 0 : job.startMs });
  if (rows > 0) paintBakeBand(job, rows, true, mapUnderX, mapUnder);
  if (job.done < job.height) return;
  underJob = null;
  if (mapUnderX.isContextLost?.()) return;
  underContent = job.content;
  underAt = job.geo.at;
  underOffset = job.offset;
  underBakes++;
}

/** Rule 9: what of the screen the bake leaves to the underlay. In device pixels. */
interface UnderlayPlan {
  /** From the underlay's space to the screen. */
  readonly view: LayerTransform;
  /** The bake's whole pixels on the screen; `null` — none. */
  readonly bake: PixelRect | null;
  /** The rest of the screen: at most four rects, apart from the bake and from each other. */
  readonly strips: PixelRect[];
}

/** Rule 9: the plan for the bake shown under `view` over an underlay fresh for this frame; `null` —
 *  the bake covers the screen. */
function underlayPlan(view: LayerTransform, here: MapProjection): UnderlayPlan | null {
  const DPR = game.dpr();
  const screen = { x: 0, y: 0, width: Math.round(game.vw() * DPR), height: Math.round(game.vh() * DPR) };
  const o = mapLayerOffset();
  // The bake in the screen's pixels at its scale: a draft's are larger (rule 8).
  const sc = DPR / mapLayerDensity;
  const framed = framedRect({ x: -o.x * sc, y: -o.y * sc, width: mapLayer.width * sc, height: mapLayer.height * sc }, view, DPR);
  const bake = framed && intersectRect(framed, screen);
  const strips = uncoveredRects(screen, bake);
  return strips.length ? { view: onPixelGrid(layerTransform(underAt, here), DPR), bake, strips } : null;
}

/** Draw the device-pixel rect `r` of the screen from `source`, whose pixel `c` shows the point
 *  `(c − o) / d` of a space the screen shows under `tr`: a source rect, not a clip — a clip
 *  around a scaled image costs the software raster as much again. */
function drawPixels(g: CanvasRenderingContext2D, source: HTMLCanvasElement, o: { x: number; y: number },
  tr: LayerTransform, r: PixelRect, d = game.dpr()): void {
  const DPR = game.dpr();
  const s = (tr.k * DPR) / d;
  g.drawImage(source, (r.x - tr.tx * DPR) / s + o.x, (r.y - tr.ty * DPR) / s + o.y, r.width / s, r.height / s,
    r.x, r.y, r.width, r.height);
}

/** Draw the map layer into `g` under `view` (bake space → screen), over the underlay where `plan`
 *  says the bake leaves the screen (rule 9). */
function showMapLayer(g: CanvasRenderingContext2D, view: LayerTransform, plan: UnderlayPlan | null): void {
  const DPR = game.dpr();
  const { x: ox, y: oy } = mapLayerOffset();
  g.setTransform(1, 0, 0, 1, 0, 0);
  if (plan) {
    // The underlay where the bake leaves the screen, the bake in its own whole pixels: the two
    // meet edge to edge, and neither translucent glass is drawn over the other.
    const under = framedRect({ x: -underOffset.x, y: -underOffset.y, width: mapUnder.width, height: mapUnder.height },
      plan.view, DPR);
    for (const strip of plan.strips) {
      const r = under && intersectRect(strip, under);
      if (r) drawPixels(g, mapUnder, underOffset, plan.view, r);
    }
    if (plan.bake) drawPixels(g, mapLayer, { x: ox, y: oy }, view, plan.bake, mapLayerDensity);
    return;
  }
  const sharp = mapLayerDensity === DPR;
  const exact = sharp && exactOffset(view, DPR);
  // On its pixel grid the layer is a plain copy; otherwise it is resampled — for the
  // frames of a gesture only, since a settled camera gets an exact bake (rules 4 and 8).
  if (exact) g.drawImage(mapLayer, exact.x - ox, exact.y - oy);
  else {
    const k = (view.k * DPR) / mapLayerDensity;
    g.drawImage(mapLayer, view.tx * DPR - k * ox, view.ty * DPR - k * oy, k * mapLayer.width, k * mapLayer.height);
  }
}

/** One ring of the overview per radius and pixel density, drawn as a bake draws it. */
const ringSprites = new Map<string, HTMLCanvasElement>();
function ringSprite(radius: number, dpr: number): HTMLCanvasElement {
  const key = `${radius}:${dpr}`;
  let sprite = ringSprites.get(key);
  if (!sprite) {
    sprite = document.createElement('canvas');
    sprite.width = sprite.height = Math.ceil((2 * radius + 2) * dpr);
    const g = sprite.getContext('2d') as CanvasRenderingContext2D;
    const c = sprite.width / dpr / 2;
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    drawSchematicNode(g, { x: c, y: c }, radius);
    ringSprites.set(key, sprite);
  }
  return sprite;
}

/**
 * Rule 8: the overview's node rings that the bake shown under `view` does not carry, drawn into
 * `g` at the current camera's size, so a stretched bake does not swell them. A sprite a ring on
 * whole device pixels: a copy, not a resample. In motion only while few are on the screen
 * ({@link liveRingsShown}).
 */
function drawLiveRings(g: CanvasRenderingContext2D, geo: MapLayerGeometry, view: LayerTransform,
  settled: boolean): void {
  if (geo.rings) return;
  const lod = currentMapLod();
  if (!(lod.art < 1)) return;
  const VW = game.vw();
  const VH = game.vh();
  const DPR = game.dpr();
  // A ring's size goes in tenths of a pixel: a zoom makes a few sprites, not one a frame.
  const radius = Math.round(lod.markerRadius * 10) / 10;
  const reach = radius + 1;
  // Map point `p` lies on the screen at `a·p + (x0, y0)`: the bake's projection, then `view`.
  const a = view.k * geo.at.a;
  const x0 = view.k * geo.at.x + view.tx;
  const y0 = view.k * geo.at.y + view.ty;
  const shown = (x: number, y: number): boolean => x >= -reach && x <= VW + reach && y >= -reach && y <= VH + reach;
  let onScreen = 0;
  if (!settled)
    for (const n of geo.nodes) if (shown(a * n.x + x0, a * n.y + y0) && ++onScreen > LIVE_RING_BUDGET) break;
  if (!liveRingsShown(geo.rings, settled, onScreen)) return;
  const sprite = ringSprite(radius, DPR);
  const half = sprite.width / 2;
  g.save();
  g.setTransform(1, 0, 0, 1, 0, 0);
  g.globalAlpha = 1 - lod.art;
  g.globalCompositeOperation = 'source-over';
  for (const n of geo.nodes) {
    const x = a * n.x + x0;
    const y = a * n.y + y0;
    if (shown(x, y)) g.drawImage(sprite, Math.round(x * DPR - half), Math.round(y * DPR - half));
  }
  g.restore();
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
  const settled = !mapMoving(now);
  mapSettled = settled;
  const costly = bakeCostMs > GESTURE_BAKE_MS;
  mapCostly = costly;
  const content = mapLayerSignature();
  // Rule 9: the underlay shows the map only as it is now.
  const underlay = underContent === content && !mapUnderX.isContextLost?.();
  if (mapLayerX.isContextLost?.()) {
    // No offscreen map to reuse: paint it straight into the frame.
    mapSettled = false;
    cancelBakeJob();
    cx.save();
    paintSky(cx);
    const geo = measureMapLayer();
    publishMapGeometry(geo);
    terrainFields = paintMapLayer(cx, { x0: 0, y0: 0, x1: VW, y1: VH }, !settled, false, geo);
    drawLiveRings(cx, geo, { k: 1, tx: 0, ty: 0 }, true);
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
    costly,
    underlay,
    density: mapLayerDensity,
    draft: mapLayerDraft,
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
      // The screen cannot wait for it, and its rows left cost less than a whole bake. Their
      // raster lands in this frame anyway: made here, the bake's cost counts it (rule 8).
      paintBakeBand(job, job.height - job.done, true);
      swapBakeJob(job);
      view = layerTransform(mapLayerAt, here);
      action = decide();
      // A bake is enough for this frame: the next one snaps or starts the next bake.
      if (action === 'snap' || action === 'refresh') action = 'show';
    }
  }
  if (action === 'rebake') {
    // A bake inside a gesture reuses terrain art at its last scale; a settled one
    // sharpens it. A slow device bakes a draft mid-gesture (rule 8).
    bakeMapLayer(content, !settled, false, costly && !settled);
    view = { k: 1, tx: 0, ty: 0 };
  } else {
    let refineMs = 0;
    if (action === 'scroll') scrollMapLayer(recentredScroll(view, mapLayerDensity), !settled);
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
    // Rule 8: on a slow device the bands wait for the camera to rest.
    if (next && (settled || !costly)) {
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
  // Rule 9: a slow device paints its underlay at rest, after the floors its far terrain is made of.
  if (settled && !bakeJob && terrainRefine < 0 && prepareFloors() && costly) paintUnderlay(content);
  if (!bakeJob && terrainRefine < 0 && now - camMovedAt >= SPARE_KEEP_MS) releaseMapSpare();
  // In motion a pan moves the layer by whole device pixels — a copy, not a resample;
  // what is drawn from bake geometry follows the same rounded transform.
  mapView = onPixelGrid(view, DPR);
  const plan = underlay ? underlayPlan(mapView, here) : null;
  if (settled && !bgx.isContextLost?.()) {
    // Settled: compose sky + map once, then every idle frame is one 1:1 blit — also while
    // the sharp bake paints in the background under the stretched one (rule 7).
    const key = `${mapLayerBakes}|${mapView.k},${mapView.tx},${mapView.ty}|${VW}x${VH}:${DPR}|` +
      `${starfieldOn()}:${spaceBackdropReady(holographicMapOn())}:${holographicMapOn()}|${cam.x},${cam.y},${cam.scale}|` +
      `${plan ? underBakes : '-'}`;
    if (bgComposite !== key) {
      bgComposite = '';
      const width = Math.round(VW * DPR);
      const height = Math.round(VH * DPR);
      if (bg.width !== width) bg.width = width;
      if (bg.height !== height) bg.height = height;
      paintSky(bgx);
      showMapLayer(bgx, mapView, plan);
      if (mapLayerGeometry) drawLiveRings(bgx, mapLayerGeometry, mapView, true);
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
  showMapLayer(cx, mapView, plan);
  if (mapLayerGeometry) drawLiveRings(cx, mapLayerGeometry, mapView, false);
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
    ...game.nodes().map((_, index, nodes) => ({ label: t('map-loading.terrain'), run: () => {
      // A loading slice warms a bounded share of the scene tiles, rather than stamping
      // a separate illustration into each province. No hidden material enters this list.
      terrainRaster.beginFrame(Infinity); // a frame between the slices may have spent it
      for (let i = index; i < terrainFields.length; i += nodes.length)
        terrainRaster.prepare(terrainFields[i]!, game.dpr());
      // And the floors of the whole known map, so that no zoom ever finds a tile without one.
      const tiles = provinceGeometry?.environment?.tiles ?? [];
      for (let i = index; i < tiles.length; i += nodes.length)
        terrainRaster.prepareFloor(projectTerrainTile(tiles[i]!, FLOOR_PROJECTION), game.dpr());
    } })),
    { label: t('map-loading.ready'), run: () => {
      terrainRaster.packFloors();
      bakeMapLayer(mapLayerSignature(), false);
      bgComposite = '';
    } },
  ];
}
