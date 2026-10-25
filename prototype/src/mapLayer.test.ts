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
  const env = { world, holo: !!opts.holo, lost: 0, fps: 60, width: 1600, height: 900 };
  const nodes = (await import('./mapCatalog')).mapNodesFromState(world);
  const camera = await import('./mapCamera');
  camera.initMapCamera({
    vw: () => env.width,
    vh: () => env.height,
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
    vw: () => env.width,
    vh: () => env.height,
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
  const [bg, layer, spare, under] = made as [FakeCanvas, FakeCanvas, FakeCanvas, FakeCanvas];
  /** Источники `drawImage` холста, с режимом наложения. */
  const drawn = (c: FakeCanvas) => c.calls.filter((x) => x.name === 'drawImage').map((x) => ({ src: x.args[0], op: x.op }));
  const home = (id: string) => Object.values(env.world.planets).find((p) => p.owner === id)!;
  return { ml, fog, camera, env, nodes, page, frame, bg, layer, spare, under, drawn, home };
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

  it('туман: местность — какой её знает игрок, скрытая смена не перерисовывает карту', async () => {
    const { ml, fog, env, home } = await boot({ holo: true });
    const hidden = Object.values(env.world.planets).find((p) => !fog.known(p.id))!;
    ml.blitStaticLayer(1000);
    const geo = ml.provinceGeometry;
    hidden.terrain = 'asteroid_field';
    ml.blitStaticLayer(1016);
    expect(ml.provinceGeometry).toBe(geo);
    // Своя провинция сменила местность — это знание, и карта перепекается.
    home('p1').terrain = 'asteroid_field';
    ml.blitStaticLayer(1032);
    expect(ml.provinceGeometry).not.toBe(geo);
  });

  it('кадр: в движении небо и карта рисуются живьём, на покое — одна копия готового кадра', async () => {
    const { ml, frame, bg, layer, drawn } = await boot();
    // Часы стоят: загруженная машина гейта не сделает устройство медленным, а его покой — печью
    // подложки (правило 9).
    vi.stubGlobal('performance', { now: () => 0 });
    ml.blitStaticLayer(1000);
    expect(ml.mapSettled).toBe(false);
    expect(ml.mapView).toEqual({ k: 1, tx: 0, ty: 0 });
    // Первый кадр печёт карту: её растр делается пикселем в кадр, чтобы цена выпечки его
    // учла (правило 8), потом выпечка ложится под камеру.
    expect(drawn(frame).map((d) => d.src)).toEqual([layer, layer]);
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

  it('медленное устройство: приближение в жесте не перепекает карту, полосы ждут покоя', async () => {
    // Быстрое устройство: растянутую вчетверо выпечку жест перепекает сразу. Часы стоят:
    // цена выпечки не зависит от того, чем ещё занята машина с тестами.
    const fast = await boot();
    vi.stubGlobal('performance', { now: () => 0 });
    fast.ml.blitStaticLayer(1000);
    fast.ml.blitStaticLayer(1000 + SETTLE_MS);
    expect(fast.ml.mapCostly).toBe(false);
    const fastGeo = fast.ml.provinceGeometry;
    fast.camera.zoomAt(800, 450, 4);
    fast.ml.blitStaticLayer(2000);
    expect(fast.ml.provinceGeometry).not.toBe(fastGeo);
    vi.resetModules();
    const { ml, camera, spare } = await boot();
    // Каждое чтение часов — 60 мс: целая выпечка дороже GESTURE_BAKE_MS.
    let clock = 0;
    vi.stubGlobal('performance', { now: () => (clock += 60) });
    ml.blitStaticLayer(1000);
    ml.blitStaticLayer(1000 + SETTLE_MS);
    expect(ml.mapCostly).toBe(true);
    const geo = ml.provinceGeometry;
    camera.zoomAt(800, 450, 4);
    ml.blitStaticLayer(2000);
    expect(ml.provinceGeometry).toBe(geo);
    expect(ml.mapView.k).toBeCloseTo(4, 6);
    expect(spare.width).toBe(0);
    // Покой: чёткая выпечка печётся в фоне, на экране растянутая.
    let now = 2000 + SETTLE_MS;
    ml.blitStaticLayer(now);
    expect(spare.width).toBeGreaterThan(0);
    expect(ml.provinceGeometry).toBe(geo);
    // Новый жест: полоса не рисуется, пока камера не встанет.
    camera.zoomAt(800, 450, 1.1);
    const painted = spare.calls.length;
    ml.blitStaticLayer((now += 16));
    ml.blitStaticLayer((now += 16));
    expect(spare.calls.length).toBe(painted);
    expect(ml.provinceGeometry).toBe(geo);
    now += SETTLE_MS;
    let frames = 0;
    while (ml.provinceGeometry === geo && frames++ < 2000) ml.blitStaticLayer((now += 16));
    expect(ml.provinceGeometry).not.toBe(geo);
  });

  it('медленное устройство: кольца обзора рисует кадр, а не растянутая выпечка', async () => {
    const arcs = (c: FakeCanvas) => c.calls.filter((x) => x.name === 'arc').length;
    // Быстрое: кольца в выпечке, готовый кадр — одна её копия.
    const fast = await boot();
    vi.stubGlobal('performance', { now: () => 0 });
    fast.ml.blitStaticLayer(1000);
    fast.ml.blitStaticLayer(1000 + SETTLE_MS);
    expect(fast.ml.provinceGeometry?.rings).toBe(true);
    expect(arcs(fast.layer)).toBeGreaterThan(0);
    expect(fast.drawn(fast.bg).map((d) => d.src)).toEqual([fast.layer]);
    vi.resetModules();
    const { ml, camera, nodes, bg, frame, spare, drawn } = await boot();
    let clock = 0;
    vi.stubGlobal('performance', { now: () => (clock += 60) });
    ml.blitStaticLayer(1000);
    ml.blitStaticLayer(1000 + SETTLE_MS);
    // Первую выпечку испекли, когда цена устройства ещё не была известна: кольца в ней.
    expect(ml.mapCostly).toBe(true);
    expect(ml.provinceGeometry?.rings).toBe(true);
    const geo = ml.provinceGeometry;
    camera.zoomAt(800, 450, 1.1);
    let now = 2000;
    ml.blitStaticLayer(now);
    now += SETTLE_MS;
    let frames = 0;
    while (ml.provinceGeometry === geo && frames++ < 2000) ml.blitStaticLayer((now += 16));
    // Выпечка медленного устройства колец не несёт: растянутая, она раздула бы их.
    expect(ml.provinceGeometry?.rings).toBe(false);
    expect(arcs(spare)).toBe(0);
    // Их кладёт в готовый кадр сам кадр, картинкой на каждое кольцо на экране.
    const lod = mapLod(camera.worldDist(mapSpacing(nodes)), camera.cam.scale);
    expect(lod.art).toBeLessThan(1);
    const reach = Math.round(lod.markerRadius * 10) / 10 + 1;
    const onScreen = ml.provinceGeometry!.nodes.filter((n) => {
      const c = camera.world(n);
      return c.x >= -reach && c.x <= 1600 + reach && c.y >= -reach && c.y <= 900 + reach;
    }).length;
    expect(onScreen).toBeGreaterThan(0);
    bg.calls.length = 0;
    bg.fire('contextlost');
    ml.blitStaticLayer((now += 16));
    const [map, ...rings] = drawn(bg).map((d) => d.src);
    expect(map).toBe(spare);
    expect(rings).toHaveLength(onScreen);
    expect(new Set(rings).size).toBe(1);
    // В движении — тоже, их здесь немного (LIVE_RING_BUDGET).
    camera.panBy(5, 0);
    frame.calls.length = 0;
    ml.blitStaticLayer(now + 16);
    expect(ml.mapSettled).toBe(false);
    expect(drawn(frame).filter((d) => d.src === rings[0]).length).toBeGreaterThan(0);
  });

  it('медленное устройство: отдаление в жесте открывает подложку, а не перепекает карту', async () => {
    const { ml, camera, frame, bg, layer, under, drawn } = await boot();
    camera.zoomAt(800, 450, 4);
    // Каждое чтение часов — 60 мс: целая выпечка дороже GESTURE_BAKE_MS.
    let clock = 0;
    vi.stubGlobal('performance', { now: () => (clock += 60) });
    ml.blitStaticLayer(1000);
    // Покой: подложка — вся карта на обзоре — печётся полосами, а выпечка на экране та же.
    const geo = ml.provinceGeometry;
    let now = 1000 + SETTLE_MS;
    for (let i = 0; i < 200; i++) ml.blitStaticLayer((now += 16));
    expect(ml.mapCostly).toBe(true);
    expect(ml.provinceGeometry).toBe(geo);
    expect(under.width).toBeGreaterThan(0);
    expect(under.calls.some((c) => c.name === 'fill')).toBe(true);
    // Подложку мерили на обзоре, а камеру вернули на место.
    expect(camera.cam.scale).toBe(4);
    // Отдаление втрое посреди жеста открыло край выпечки: его закрывает подложка, а выпечка —
    // своими целыми пикселями, без перепечки.
    camera.zoomAt(800, 450, 1 / 3);
    frame.calls.length = 0;
    ml.blitStaticLayer((now += 16));
    expect(ml.mapSettled).toBe(false);
    expect(ml.provinceGeometry).toBe(geo);
    expect(ml.mapView.k).toBeCloseTo(1 / 3, 6);
    const map = frame.calls.filter((c) => c.name === 'drawImage' && c.args[0] === layer);
    expect(map).toHaveLength(1);
    expect(map[0]!.args).toHaveLength(9);
    expect(drawn(frame).filter((d) => d.src === under).length).toBeGreaterThan(0);
    // Покой: новая выпечка печётся в фоне, а готовый кадр — сжатая выпечка на подложке.
    now += SETTLE_MS;
    ml.blitStaticLayer(now);
    expect(drawn(bg).map((d) => d.src)).toContain(under);
    let frames = 0;
    while (ml.provinceGeometry === geo && frames++ < 2000) ml.blitStaticLayer((now += 16));
    expect(ml.provinceGeometry).not.toBe(geo);
    expect(ml.mapView.k).toBe(1);
    bg.calls.length = 0;
    bg.fire('contextlost');
    ml.blitStaticLayer(now + 16);
    expect(drawn(bg).length).toBeGreaterThan(0);
    expect(drawn(bg).map((d) => d.src)).not.toContain(under);
  });

  it('устаревшую подложку кадр не показывает: отдаление перепекает карту, как раньше', async () => {
    const { ml, camera, frame, under, drawn, home } = await boot();
    camera.zoomAt(800, 450, 4);
    let clock = 0;
    vi.stubGlobal('performance', { now: () => (clock += 60) });
    ml.blitStaticLayer(1000);
    let now = 1000 + SETTLE_MS;
    for (let i = 0; i < 200; i++) ml.blitStaticLayer((now += 16));
    expect(under.width).toBeGreaterThan(0);
    // Своя провинция сменила владельца: выпечка перепекается сразу, подложка устарела.
    home('p1').owner = 'p2';
    ml.blitStaticLayer((now += 16));
    const geo = ml.provinceGeometry;
    camera.zoomAt(800, 450, 1 / 3);
    frame.calls.length = 0;
    ml.blitStaticLayer(now + 16);
    expect(ml.provinceGeometry).not.toBe(geo);
    expect(drawn(frame).map((d) => d.src)).not.toContain(under);
  });

  it('быстрое устройство подложку не печёт', async () => {
    const { ml, under } = await boot();
    vi.stubGlobal('performance', { now: () => 0 });
    ml.blitStaticLayer(1000);
    for (let i = 0; i < 200; i++) ml.blitStaticLayer(1000 + SETTLE_MS + 16 * i);
    expect(ml.mapCostly).toBe(false);
    expect(under.width).toBe(0);
    expect(under.calls).toEqual([]);
  });

  it('подложку, которой не хватило пикселей, покой не меряет каждый кадр, а отдаление перепекает', async () => {
    const { ml, camera, env, under } = await boot();
    // Экран больше бюджета выпечки: вся карта на обзоре в него не влезает.
    env.width = 6000;
    env.height = 4000;
    camera.zoomAt(3000, 2000, 4);
    let clock = 0;
    vi.stubGlobal('performance', { now: () => (clock += 60) });
    const overview = vi.spyOn(camera, 'atOverview');
    ml.blitStaticLayer(1000);
    let now = 1000 + SETTLE_MS;
    for (let i = 0; i < 200; i++) ml.blitStaticLayer((now += 16));
    expect(ml.mapCostly).toBe(true);
    expect(under.width).toBe(0);
    expect(overview).toHaveBeenCalledTimes(1);
    const geo = ml.provinceGeometry;
    camera.zoomAt(3000, 2000, 1 / 3);
    ml.blitStaticLayer(now + 16);
    expect(ml.provinceGeometry).not.toBe(geo);
  });

  it('потерянный контекст выпечки: карта рисуется прямо в кадр', async () => {
    const { ml, frame, layer, drawn } = await boot();
    // Часы стоят: выпечка ничего не стоит, устройство быстрое. По настоящим часам загруженная
    // машина гейта делала его медленным, и кольца обзора рисовал бы кадр (правило 8).
    vi.stubGlobal('performance', { now: () => 0 });
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

  it('памятная среда не читает изменённый скрытый тип даже при новой выпечке', async () => {
    const { ml, fog, env } = await boot({ holo: true });
    const hidden = Object.values(env.world.planets).find(p => !fog.known(p.id))!;
    hidden.kind = 'nebula';
    hidden.terrain = 'nebula';
    fog.rememberScan([hidden.id]);
    ml.blitStaticLayer(1000);
    const geometry = ml.provinceGeometry!;
    const environment = geometry.environment!;
    expect(environment.tiles.length).toBeGreaterThan(0);
    const index = geometry.nodes.findIndex(n => n.id === hidden.id);
    expect(geometry.seeds[index]!.kind).toBe('nebula');
    hidden.kind = 'graveyard';
    hidden.terrain = 'graveyard';
    const authoritative = structuredClone(env.world);
    ml.blitStaticLayer(1016);
    expect(ml.provinceGeometry).toBe(geometry);
    ml.forgetMapBake();
    ml.mapLayerForInput();
    expect(ml.provinceGeometry!.environment).toBe(environment);
    expect(ml.provinceGeometry!.seeds[index]!.kind).toBe('nebula');
    expect(env.world).toEqual(authoritative);
  });

  it('чужой личный коридор не меняет ни видимые дороги, ни просветы в окружении', async () => {
    const { ml, fog, env, home } = await boot({ holo: true });
    const source = home('p1');
    const target = Object.values(env.world.planets).find(p =>
      p.id !== source.id && !source.links?.includes(p.id))!;
    source.terrain = 'asteroid_field';
    fog.rememberScan([source.id]);
    ml.blitStaticLayer(1000);
    const geometry = ml.provinceGeometry!;
    const environment = geometry.environment!;
    const roads = ml.roadDrawingOf(env.world);
    expect(environment.tiles.length).toBeGreaterThan(0);
    (source.links ??= []).push(target.id);
    (target.links ??= []).push(source.id);
    env.world.tempLanes = [{ id: 'private:p2', owner: 'p2', from: source.id, to: target.id,
      speedBonus: 0.5, expiresAt: env.world.time + 100_000, addedLink: true, tier: 1, heroId: 'hero:p2' }];
    env.world.topology = (env.world.topology ?? 0) + 1;
    const authoritative = structuredClone(env.world);
    ml.blitStaticLayer(1016);
    expect(ml.roadDrawingOf(env.world).strokes).toEqual(roads.strokes);
    expect(ml.roadDrawingOf(env.world).marks).toEqual(roads.marks);
    expect(ml.provinceGeometry).toBe(geometry);
    ml.forgetMapBake();
    ml.mapLayerForInput();
    expect(ml.provinceGeometry!.environment).toBe(environment);
    expect(env.world).toEqual(authoritative);
    // A publicly traversable corridor must appear, including its local calming.
    env.world.tempLanes[0]!.tier = 3;
    env.world.topology!++;
    ml.blitStaticLayer(1032);
    expect(ml.roadDrawingOf(env.world).strokes.length).toBeGreaterThan(roads.strokes.length);
    expect(ml.provinceGeometry!.environment!.signature).not.toBe(environment.signature);
  });

  it('захват меняет политическую заливку, сохраняя ту же мировую среду и её растры', async () => {
    const { ml, home } = await boot({ holo: true });
    const mine = home('p1');
    mine.terrain = 'asteroid_field';
    ml.blitStaticLayer(1000);
    const geometry = ml.provinceGeometry!;
    const environment = geometry.environment!;
    const fingerprints = environment.tiles.map(t => [t.id, t.fingerprint]);
    expect(fingerprints.length).toBeGreaterThan(0);
    mine.owner = 'p2';
    ml.blitStaticLayer(1016);
    expect(ml.provinceGeometry).not.toBe(geometry);
    expect(ml.knownOwner(mine.id)).toBe('p2');
    expect(ml.provinceGeometry!.environment).toBe(environment);
    expect(ml.provinceGeometry!.environment!.tiles.map(t => [t.id, t.fingerprint])).toEqual(fingerprints);
  });

  it('зум и смена desktop на узкое окно не перемещают мировые формы и волну границ', async () => {
    const { ml, env, camera, home } = await boot({ holo: true });
    home('p1').terrain = 'dense_nebula';
    ml.mapLayerForInput();
    const original = ml.provinceGeometry!.environment!;
    expect(original.tiles.length).toBeGreaterThan(0);
    const points = (scene: typeof original) => scene.tiles.flatMap(tile => tile.features.map(f => ({
      id: f.id,
      paths: f.paths.map(path => path.points.map(([x, y]) => [
        Math.round(x * 1e5) / 1e5, Math.round(y * 1e5) / 1e5,
      ])),
    })));
    const boundaries = (scene: typeof original) => scene.clipPolygons.map(poly => poly.map(([x, y]) => [
      Math.round(x * 1e5) / 1e5, Math.round(y * 1e5) / 1e5,
    ]));
    for (const view of [{ scale: 2.3, x: 47.25, y: -21.5, width: 1600, height: 900 },
      { scale: 1, x: 0, y: 0, width: 390, height: 844 }]) {
      env.width = view.width;
      env.height = view.height;
      camera.setView(view);
      ml.forgetMapBake();
      ml.mapLayerForInput();
      const current = ml.provinceGeometry!.environment!;
      expect(points(current)).toEqual(points(original));
      expect(boundaries(current)).toEqual(boundaries(original));
    }
  });

  it('зум и сдвиг не пересобирают сцену среды: её пересобирает только новое знание', async () => {
    const { ml, fog, env, camera, home } = await boot({ holo: true });
    home('p1').terrain = 'dense_nebula';
    ml.mapLayerForInput();
    const environment = ml.provinceGeometry!.environment!;
    const { TerrainEnvironmentSceneCache } = await import('./terrainEnvironmentView');
    const prepare = vi.spyOn(TerrainEnvironmentSceneCache.prototype, 'prepare');
    for (const view of [{ scale: 2.3, x: 47.25, y: -21.5 }, { scale: 1.4, x: -120, y: 33 }]) {
      camera.setView(view);
      ml.forgetMapBake();
      ml.mapLayerForInput();
      expect(ml.provinceGeometry!.environment).toBe(environment);
    }
    expect(prepare).not.toHaveBeenCalled();
    const hidden = Object.values(env.world.planets).find(p => !fog.known(p.id))!;
    hidden.terrain = 'asteroid_field';
    fog.rememberScan([hidden.id]);
    ml.forgetMapBake();
    ml.mapLayerForInput();
    expect(prepare).toHaveBeenCalledTimes(1);
    expect(ml.provinceGeometry!.environment).not.toBe(environment);
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
