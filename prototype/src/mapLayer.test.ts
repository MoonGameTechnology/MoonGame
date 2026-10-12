/**
 * Статический слой карты (REFM-232) — прямой тест владельца на живом мире прототипа.
 *
 * Когда печь, сдвигать окно выпечки или допекать её в фоне, решают чистые правила
 * `decisions/mapLayerView.ts`, и у них свой тест. Здесь — то, что собирается только вместе:
 * ввод до первого кадра получает провинции, сбой и потеря поверхностей забывают выпечку,
 * туман прячет чужой захват от самой перерисовки, кадр в движении и на покое, сдвиг, сетка,
 * фоновая выпечка после зума, рецепт подготовки за заставкой и сеть дорог. Холсты поддельные
 * и записывают вызовы; мир, камера и туман — настоящие. Каждый тест — свежая загрузка модулей.
 */
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';

import type { GameState } from '../../packages/shared-core/src/index';
import { fitTransform } from '../../packages/client/src/camera';
import { mapLod, mapSpacing } from '../../packages/client/src/mapLod';
import { SETTLE_MS } from '../../decisions/mapLayerView';
import { t } from '../../localization/runtime';

type Listener = () => void;
interface Call {
  name: string;
  args: unknown[];
  op: unknown;
}
interface FakeCanvas {
  width: number;
  height: number;
  calls: Call[];
  lost: boolean;
  listeners: Map<string, Listener[]>;
  getContext(): unknown;
  addEventListener(type: string, fn: Listener): void;
  fire(type: string): void;
}

/** Холст, чей контекст записывает каждый вызов и режим наложения в момент вызова. */
function fakeCanvas(): FakeCanvas {
  const c: FakeCanvas = {
    width: 0,
    height: 0,
    calls: [],
    lost: false,
    listeners: new Map(),
    getContext: () => ctx,
    addEventListener(type, fn) {
      c.listeners.set(type, [...(c.listeners.get(type) ?? []), fn]);
    },
    fire(type) {
      for (const fn of c.listeners.get(type) ?? []) fn();
    },
  };
  const props: Record<string, unknown> = { canvas: c, globalCompositeOperation: 'source-over', globalAlpha: 1 };
  const ctx = new Proxy(props, {
    get(target, name) {
      if (typeof name !== 'string') return undefined;
      if (name in target) return target[name];
      return (...args: unknown[]) => {
        if (name === 'isContextLost') return c.lost;
        c.calls.push({ name, args, op: target.globalCompositeOperation });
        if (name.startsWith('create')) return { addColorStop() {} };
        if (name === 'measureText') return { width: 0 };
        return undefined;
      };
    },
    set(target, name, value) {
      target[name as string] = value;
      return true;
    },
  });
  return c;
}

beforeAll(async () => {
  vi.stubGlobal('document', { createElement: fakeCanvas, getElementById: fakeCanvas });
  await import('./mapLayer');
  vi.unstubAllGlobals();
}, 60_000);
beforeEach(() => {
  vi.resetModules();
});
afterEach(() => {
  vi.unstubAllGlobals();
});

async function boot(opts: { holo?: boolean; straight?: boolean } = {}) {
  const made: FakeCanvas[] = [];
  vi.stubGlobal('__PLAYER_BUILD__', false); // туман читает профиль сборки
  const page = fakeCanvas(); // #map
  const frame = fakeCanvas(); // контекст кадра, его отдаёт хук `ctx`
  vi.stubGlobal('document', {
    createElement: () => {
      const c = fakeCanvas();
      made.push(c);
      return c;
    },
    getElementById: (id: string) => (id === 'map' ? page : null),
  });
  const game = await import('./game');
  const world: GameState = game.newGame({
    seats: [
      { id: 'p1', name: 'A', faction: 'azure', start: game.START_CANDIDATES[0]!, ai: false },
      { id: 'p2', name: 'B', faction: 'crimson', start: game.START_CANDIDATES[1]!, ai: false },
    ],
  });
  const env = { world, holo: !!opts.holo, lost: 0, fps: 60 };
  const nodes = (await import('./mapCatalog')).mapNodesFromState(world);
  const camera = await import('./mapCamera');
  camera.initMapCamera({
    vw: () => 1600,
    vh: () => 900,
    mobile: () => false,
    console: () => false,
    world: () => env.world,
    me: () => 'p1',
  } as never);
  camera.frameMap(nodes);
  camera.setView({ scale: 1, x: 0, y: 0 });
  const fog = await import('./mapFog');
  fog.initMapFog({ world: () => env.world, me: () => 'p1', net: () => false, contacts: () => [], sight: () => [] });
  fog.refreshVision();
  (await import('./mapPalette')).initMapPalette({
    world: () => env.world,
    me: () => 'p1',
    ctx: () => frame.getContext() as CanvasRenderingContext2D,
    dpr: () => 1,
  } as never);
  const ml = await import('./mapLayer');
  ml.initMapLayer({
    world: () => env.world,
    me: () => 'p1',
    nodes: () => nodes,
    ctx: () => frame.getContext() as CanvasRenderingContext2D,
    vw: () => 1600,
    vh: () => 900,
    dpr: () => 1,
    mobile: () => false,
    fps: () => env.fps,
    outline: () => [],
    holographic: () => env.holo,
    sectorType: (id) => game.SECTOR_TYPES[nodes.find((n) => n.id === id)?.sector ?? ''],
    wave: () => {
      const fit = fitTransform(camera.insets(), camera.mapBounds()).scale;
      return { amp: opts.straight ? 0 : 11 * fit, wavelength: 190 * fit, segment: 26 * fit };
    },
    lod: () => mapLod(camera.worldDist(mapSpacing(nodes)), camera.cam.scale),
    surfacesLost: () => env.lost++,
  });
  const [bg, layer, spare] = made as [FakeCanvas, FakeCanvas, FakeCanvas];
  /** Источники `drawImage` холста, с режимом наложения. */
  const drawn = (c: FakeCanvas) => c.calls.filter((x) => x.name === 'drawImage').map((x) => ({ src: x.args[0], op: x.op }));
  const home = (id: string) => Object.values(env.world.planets).find((p) => p.owner === id)!;
  return { ml, fog, camera, env, nodes, page, frame, bg, layer, spare, drawn, home };
}

describe('REFM-232 — статический слой карты', () => {
  it('ввод до первого кадра выпекает карту, и под миром — его провинция', async () => {
    // Прямые границы: `insideProvince` судит клетку как выпуклую, а волна (M2.9) делает её
    // невыпуклой, и центр иной провинции он не узнаёт. Здесь проверяется стык, а не волна.
    const { ml, camera, env } = await boot({ straight: true });
    expect(ml.provinceGeometry).toBeNull();
    expect(ml.provinceAt(800, 450)).toBeUndefined();
    expect(ml.provincePolygon('anything')).toBeUndefined();
    expect(ml.mapLayerForInput()).toEqual({ k: 1, tx: 0, ty: 0 });
    const geo = ml.provinceGeometry;
    expect(geo).not.toBeNull();
    const planets = Object.values(env.world.planets);
    for (const p of planets) {
      const at = camera.world(p.position);
      expect(ml.provinceAt(at.x, at.y), p.id).toBe(p.id);
      expect(ml.provincePolygon(p.id), p.id).toBeDefined();
    }
    // Выпечка есть — второй вопрос ввода её не повторяет.
    ml.mapLayerForInput();
    expect(ml.provinceGeometry).toBe(geo);
    expect(ml.provinceAt(-1e6, -1e6)).toBeUndefined();
    expect(ml.provincePolygon('nowhere')).toBeUndefined();
  });

  it('сбой подготовки и потеря поверхностей забывают выпечку', async () => {
    const { ml, env, page, bg, layer, spare } = await boot();
    const rebaked = () => {
      const before = ml.provinceGeometry;
      ml.mapLayerForInput();
      return ml.provinceGeometry !== before;
    };
    expect(rebaked()).toBe(true);
    expect(rebaked()).toBe(false);
    ml.forgetMapBake();
    expect(rebaked()).toBe(true);
    expect(env.lost).toBe(0);
    ml.invalidateMapSurfaces();
    expect(env.lost).toBe(1);
    expect(rebaked()).toBe(true);
    // Холст кадра потерял контекст: забыть всё, и слой живых границ тоже.
    page.fire('contextlost');
    expect(ml.mapContextEvents).toEqual({ lost: 1, restored: 0 });
    expect(env.lost).toBe(2);
    expect(rebaked()).toBe(true);
    page.fire('contextrestored');
    expect(ml.mapContextEvents).toEqual({ lost: 1, restored: 1 });
    expect(env.lost).toBe(3);
    expect(rebaked()).toBe(true);
    // Холст выпечки — только её; запасной и готовый кадр выпечку не трогают.
    layer.fire('contextlost');
    expect(ml.backgroundContextEvents).toEqual({ lost: 1, restored: 0 });
    expect(rebaked()).toBe(true);
    spare.fire('contextrestored');
    bg.fire('contextlost');
    expect(ml.backgroundContextEvents).toEqual({ lost: 2, restored: 1 });
    expect(rebaked()).toBe(false);
    expect(env.lost).toBe(3);
  });

  it('туман: владелец провинции — каким его знает игрок, чужой захват не перерисовывает карту', async () => {
    const { ml, fog, env, home } = await boot();
    const mine = home('p1').id;
    const hidden = Object.values(env.world.planets).find((p) => !fog.known(p.id))!;
    expect(ml.knownOwner(mine)).toBe('p1');
    expect(ml.knownOwner(hidden.id)).toBeNull();
    ml.blitStaticLayer(1000);
    const geo = ml.provinceGeometry;
    env.world.planets[hidden.id]!.owner = 'p2';
    expect(ml.knownOwner(hidden.id)).toBeNull();
    ml.blitStaticLayer(1016);
    expect(ml.provinceGeometry).toBe(geo);
    // Своя провинция сменила владельца — это знание, и карта перепекается.
    env.world.planets[mine]!.owner = 'p2';
    expect(ml.knownOwner(mine)).toBe('p2');
    ml.blitStaticLayer(1032);
    expect(ml.provinceGeometry).not.toBe(geo);
  });

  it('кадр: в движении небо и карта рисуются живьём, на покое — одна копия готового кадра', async () => {
    const { ml, frame, bg, layer, drawn } = await boot();
    ml.blitStaticLayer(1000);
    expect(ml.mapSettled).toBe(false);
    expect(ml.mapView).toEqual({ k: 1, tx: 0, ty: 0 });
    expect(drawn(frame).map((d) => d.src)).toEqual([layer]);
    expect(drawn(bg)).toEqual([]);
    frame.calls.length = 0;
    ml.blitStaticLayer(1000 + SETTLE_MS);
    expect(ml.mapSettled).toBe(true);
    expect(drawn(bg).map((d) => d.src)).toEqual([layer]);
    expect(bg.width).toBe(1600);
    expect(bg.height).toBe(900);
    // Весь кадр заменяется готовым, а не копится поверх живого свечения.
    expect(drawn(frame)).toEqual([{ src: bg, op: 'copy' }]);
    frame.calls.length = 0;
    bg.calls.length = 0;
    ml.blitStaticLayer(1100 + SETTLE_MS);
    expect(drawn(bg)).toEqual([]);
    expect(drawn(frame)).toEqual([{ src: bg, op: 'copy' }]);
    // Готовый кадр потерял контекст — собирается заново.
    bg.fire('contextlost');
    ml.blitStaticLayer(1200 + SETTLE_MS);
    expect(drawn(bg).map((d) => d.src)).toEqual([layer]);
  });

  it('панорама сдвигает выпечку, не перепекая её, а покой между пикселями ставит камеру на сетку', async () => {
    const { ml, camera, home } = await boot();
    ml.blitStaticLayer(1000);
    ml.blitStaticLayer(1000 + SETTLE_MS);
    const geo = ml.provinceGeometry;
    const p = home('p1').position;
    const before = camera.world(p);
    camera.panBy(37, -21);
    ml.blitStaticLayer(2000);
    const after = camera.world(p);
    expect(ml.provinceGeometry).toBe(geo);
    expect(ml.mapSettled).toBe(false);
    expect(ml.mapView).toEqual({ k: 1, tx: after.x - before.x, ty: after.y - before.y });
    // Ввод переводит экран в пространство той же выпечки, что показана.
    expect(ml.mapLayerForInput()).toEqual(ml.mapView);
    // Пол-пикселя: на покое камера встаёт на сетку выпечки, а карта не перепекается.
    camera.panBy(10.3, 0);
    const x = camera.cam.x;
    ml.blitStaticLayer(3000);
    // В движении выпечка сдвигается на целые пиксели: копия, а не пересэмплирование.
    expect(Number.isInteger(ml.mapView.tx)).toBe(true);
    ml.blitStaticLayer(3000 + SETTLE_MS);
    expect(ml.provinceGeometry).toBe(geo);
    expect(camera.cam.x).not.toBe(x);
    expect(Math.abs(camera.cam.x - x)).toBeLessThanOrEqual(0.5);
    expect(Number.isInteger(ml.mapView.tx)).toBe(true);
  });

  it('зум на покое допекает резкость в фоне: на экране старая выпечка, пока новая не готова', async () => {
    const { ml, camera, layer, spare } = await boot();
    ml.blitStaticLayer(1000);
    ml.blitStaticLayer(1000 + SETTLE_MS);
    const geo = ml.provinceGeometry;
    camera.zoomAt(800, 450, 1.25);
    ml.blitStaticLayer(2000);
    expect(ml.provinceGeometry).toBe(geo);
    expect(ml.mapView.k).toBeCloseTo(1.25, 6);
    let now = 2000 + SETTLE_MS;
    ml.blitStaticLayer(now);
    // Фоновая выпечка началась в запасном холсте, на экране — растянутая старая.
    expect(spare.width).toBeGreaterThan(0);
    expect(ml.provinceGeometry).toBe(geo);
    let frames = 0;
    while (ml.provinceGeometry === geo && frames++ < 2000) ml.blitStaticLayer((now += 16));
    expect(ml.provinceGeometry).not.toBe(geo);
    expect(ml.mapView.k).toBe(1);
    // Холсты поменялись ролями: прежний холст выпечки стал запасным. Его пиксели камера
    // отдаёт, только отдохнув SPARE_KEEP_MS (5 с) без выпечки.
    expect(now).toBeLessThan(6999);
    ml.blitStaticLayer(2000 + 4999);
    expect(layer.width).toBeGreaterThan(0);
    ml.blitStaticLayer(2000 + 5000);
    expect(layer.width).toBe(0);
    expect(spare.width).toBeGreaterThan(0);
  });

  it('потерянный контекст выпечки: карта рисуется прямо в кадр', async () => {
    const { ml, frame, layer, drawn } = await boot();
    ml.blitStaticLayer(1000);
    const geo = ml.provinceGeometry;
    layer.lost = true;
    frame.calls.length = 0;
    ml.blitStaticLayer(1000 + SETTLE_MS);
    expect(ml.mapSettled).toBe(false);
    expect(ml.mapView).toEqual({ k: 1, tx: 0, ty: 0 });
    expect(ml.provinceGeometry).not.toBe(geo);
    expect(drawn(frame)).toEqual([]);
    expect(frame.calls.some((c) => c.name === 'fillRect')).toBe(true);
    // Вводу тоже нечего печь: провинции — те, что кадр нарисовал.
    const painted = ml.provinceGeometry;
    ml.forgetMapBake();
    ml.mapLayerForInput();
    expect(ml.provinceGeometry).toBe(painted);
  });

  it('голограмма: живые границы и рамка стекла — из последней выпечки', async () => {
    const flat = await boot();
    flat.ml.mapLayerForInput();
    expect(flat.ml.livingBorders()).toBeNull();
    vi.resetModules();
    const { ml } = await boot({ holo: true });
    expect(ml.livingBorders()).toBeNull();
    ml.mapLayerForInput();
    expect(ml.livingBorders()).not.toBeNull();
    expect(ml.holographicFrame).toBe(ml.provinceGeometry!.frame);
    expect(ml.holographicFrame.width).toBeGreaterThan(0);
  });

  it('рецепт подготовки: фон, геометрия, местность каждой провинции, последняя выпечка', async () => {
    const { ml, nodes } = await boot({ holo: true });
    const jobs = ml.mapPreparationJobs();
    expect(jobs.map((j) => j.label)).toEqual([
      t('map-loading.background'),
      t('map-loading.geometry'),
      ...nodes.map(() => t('map-loading.terrain')),
      t('map-loading.ready'),
    ]);
    await jobs[0]!.run();
    expect(ml.provinceGeometry).toBeNull();
    await jobs[1]!.run();
    const loading = ml.provinceGeometry;
    expect(loading).not.toBeNull();
    // Выпечка подготовки — только геометрия: ввод её не принимает за готовую карту.
    ml.mapLayerForInput();
    expect(ml.provinceGeometry).not.toBe(loading);
    for (const job of jobs.slice(1)) await job.run();
    const ready = ml.provinceGeometry;
    ml.mapLayerForInput();
    expect(ml.provinceGeometry).toBe(ready);
  });

  it('сеть дорог считается раз на топологию и забывается с картой', async () => {
    const { ml, env } = await boot();
    const roads = ml.roadDrawingOf(env.world);
    expect(roads.strokes.length).toBeGreaterThan(0);
    expect(roads.boxes).toHaveLength(roads.strokes.length * 4);
    expect(ml.roadDrawingOf(env.world)).toBe(roads);
    env.world.topology = (env.world.topology ?? 0) + 1;
    const next = ml.roadDrawingOf(env.world);
    expect(next).not.toBe(roads);
    expect(ml.roadDrawingOf(env.world)).toBe(next);
    ml.forgetMapArt();
    expect(ml.roadDrawingOf(env.world)).not.toBe(next);
  });
});

describe('REFM-232 — стык с main.ts', () => {
  const MAIN = readFileSync(new URL('./main.ts', import.meta.url), 'utf8');
  const SRC = readFileSync(new URL('./mapLayer.ts', import.meta.url), 'utf8');
  const init = /initMapLayer\(\{([\s\S]*?)\n\}\);/.exec(MAIN)?.[1] ?? '';

  it('хуки — мир, место, узлы, кадр, экран, режимы карты и сброс живых границ', () => {
    for (const hook of [
      'world: () => s,',
      'me: () => ME,',
      'nodes: () => MAP,',
      'ctx: () => cx,',
      'vw: () => VW,',
      'vh: () => VH,',
      'dpr: () => DPR,',
      'mobile: () => MOBILE,',
      'fps: () => fpsEma,',
      'outline: () => galaxyOutline,',
      'holographic: holographicMapOn,',
      'sectorType: sectorTypeOf,',
      'wave: provinceWave,',
      'lod: currentMapLod,',
    ])
      expect(init, hook).toContain(hook);
    // Слой живых границ забывает картинку своей дверью (`borderLayer.ts`, часть 2).
    expect(init).toContain('surfacesLost: forgetBorderLayer,');
  });

  it('выпечка, её холсты и кэши живут только в модуле', () => {
    expect(MAIN).not.toMatch(
      /\bfunction (bakeMapLayer|paintMapLayer|paintSky|blitStaticLayer|measureMapLayer|scrollMapLayer|startBakeJob|swapBakeJob|knownOwner|provinceAt|provincePolygon|invalidateMapSurfaces|roadDrawingOf|mapLayerForInput)\(/,
    );
    expect(MAIN).not.toMatch(
      /\b(let|const) (bg|bgx|mapLayer|mapSpare|terrainRaster|terrainGeometry|territoryGeometry|mapView|provinceGeometry|terrainFields|mapSettled|holographicFrame|roadDrawing)\b/,
    );
    // Новая карта забывает сеть дорог и местность дверью модуля.
    const install = /function installMapGeometry\([\s\S]*?\n\}/.exec(MAIN)?.[0] ?? '';
    expect(install).toContain('forgetMapArt();');
    expect(install).not.toMatch(/terrainGeometry|terrainRaster|roadDrawing =/);
    // Ввод берёт провинции слоя карты.
    expect(MAIN).toMatch(/mapLayer: mapLayerForInput,\s*provinceAt,/);
  });

  it('модуль не тянет `main.ts`', () => {
    expect(SRC).not.toMatch(/from '\.\/main'/);
  });
});
