/**
 * Слой живых границ (REFM-232, часть 2) — прямой тест владельца на живом мире прототипа.
 *
 * Что делать со слоем в кадре, решают чистые правила `decisions/livingBorderLayer.ts`, и у
 * них свой тест. Здесь — то, что собирается только вместе: слой стоит на выпечке слоя карты,
 * рисуется целиком в покое и потом по полосе за кадр на часах голограммы, едет за камерой в
 * панораме, растягивается в зуме, забывает картинку дверью и при потере своего холста, а
 * без выпечки или над малым числом границ отдаёт обводку кадру. Холсты поддельные и
 * записывают вызовы; мир, камера, туман и выпечка карты — настоящие. Каждый тест — свежая
 * загрузка модулей.
 */
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';

import { pairKey, type GameState } from '../../packages/shared-core/src/index';
import { fitTransform } from '../../packages/client/src/camera';
import { mapLod, mapSpacing } from '../../packages/client/src/mapLod';
import { rgba } from '../../packages/client/src/holoDraw';
import { SETTLE_MS } from '../../decisions/mapLayerView';
import { LIVING_BANDS } from '../../decisions/livingBorderLayer';

type Listener = () => void;
interface Call {
  name: string;
  args: unknown[];
  op: unknown;
  style: unknown;
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

/** Холст, чей контекст записывает каждый вызов, режим наложения и цвет линии в момент вызова. */
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
        c.calls.push({ name, args, op: target.globalCompositeOperation, style: target.strokeStyle });
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
  await import('./borderLayer');
  vi.unstubAllGlobals();
}, 60_000);
beforeEach(() => {
  vi.resetModules();
});
afterEach(() => {
  vi.unstubAllGlobals();
});

async function boot() {
  const made: FakeCanvas[] = [];
  vi.stubGlobal('__PLAYER_BUILD__', false); // туман читает профиль сборки
  const page = fakeCanvas(); // #map
  page.width = 1600;
  page.height = 900;
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
  const env = { world, clock: 0, vw: 1600, vh: 900, segment: 26 };
  const nodes = (await import('./mapCatalog')).mapNodesFromState(world);
  const camera = await import('./mapCamera');
  camera.initMapCamera({
    vw: () => env.vw,
    vh: () => env.vh,
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
  const ctx = () => frame.getContext() as CanvasRenderingContext2D;
  (await import('./mapPalette')).initMapPalette({ world: () => env.world, me: () => 'p1', ctx, dpr: () => 1 } as never);
  const ml = await import('./mapLayer');
  const bl = await import('./borderLayer');
  ml.initMapLayer({
    world: () => env.world,
    me: () => 'p1',
    nodes: () => nodes,
    ctx,
    vw: () => env.vw,
    vh: () => env.vh,
    dpr: () => 1,
    mobile: () => false,
    fps: () => 60,
    outline: () => [],
    holographic: () => true,
    sectorType: (id) => game.SECTOR_TYPES[nodes.find((n) => n.id === id)?.sector ?? ''],
    wave: () => {
      const fit = fitTransform(camera.insets(), camera.mapBounds()).scale;
      return { amp: 11 * fit, wavelength: 190 * fit, segment: env.segment * fit };
    },
    lod: () => mapLod(camera.worldDist(mapSpacing(nodes)), camera.cam.scale),
    surfacesLost: bl.forgetBorderLayer,
  });
  bl.initBorderLayer({ ctx, vw: () => env.vw, vh: () => env.vh, dpr: () => 1, clock: () => env.clock });
  const border = made[3]!;
  /** Кадр: слой карты под живыми границами, потом сами границы при полной детализации. */
  const show = (now: number, detail = 1): boolean => {
    ml.blitStaticLayer(now);
    const borders = ml.livingBorders();
    return borders !== null && bl.blitBorderLayer(detail, borders);
  };
  /** Сколько раз слой стёрт целиком и сколько полос перерисовано с прошлого вопроса. */
  const painted = () => {
    const clears = border.calls.filter((c) => c.name === 'clearRect');
    border.calls.length = 0;
    const whole = clears.filter((c) => c.args[0] === 0 && c.args[1] === 0 && c.args[2] === border.width && c.args[3] === border.height);
    return { whole: whole.length, rects: clears.length - whole.length };
  };
  /** Пиксели слоя, положенные в кадр. */
  const blits = () => {
    const out = frame.calls.filter((c) => c.name === 'drawImage' && c.args[0] === border);
    frame.calls.length = 0;
    return out;
  };
  return { ml, bl, fog, camera, env, page, frame, border, show, painted, blits };
}

describe('REFM-232 — слой живых границ', () => {
  it('без выпечки слоя нет: границы обводит кадр', async () => {
    const { ml, bl } = await boot();
    const borders = ml.livingBorders();
    expect(borders).toBeNull();
    const fake = { ownedFront: new Map(), neutralEdge: [] } as unknown as Parameters<typeof bl.blitBorderLayer>[1];
    expect(bl.blitBorderLayer(1, fake)).toBe(false);
  });

  it('в покое слой рисуется целиком, потом по полосе за кадр на часах голограммы', async () => {
    const { show, painted, blits, border, page, frame, env } = await boot();
    expect(show(1000)).toBe(true);
    expect(border.width).toBe(page.width);
    expect(border.height).toBe(page.height);
    // Обводка слоя — в своём прямоугольнике и в стекле: два отсечения на одну перерисовку.
    expect(border.calls.filter((c) => c.name === 'clip')).toHaveLength(2);
    expect(border.calls.some((c) => c.name === 'stroke')).toBe(true);
    let p = painted();
    expect(p.whole).toBe(1);
    // Слой ложится в кадр пиксель в пиксель, мимо преобразования выпечки.
    const at = frame.calls.findIndex((c) => c.name === 'drawImage' && c.args[0] === border);
    expect(frame.calls[at - 1]).toMatchObject({ name: 'setTransform', args: [1, 0, 0, 1, 0, 0] });
    expect(blits()).toHaveLength(1);
    // Часы стоят — слою нечего обновлять, кадр берёт его пиксели как есть.
    expect(show(1000 + SETTLE_MS)).toBe(true);
    p = painted();
    expect(p).toEqual({ whole: 0, rects: 0 });
    expect(blits()).toHaveLength(1);
    // Часы пошли — по одной полосе за кадр, пока не обойдёт все.
    env.clock = 1;
    for (let i = 0; i < LIVING_BANDS; i++) {
      show(1100 + SETTLE_MS + i);
      expect(painted(), `полоса ${i}`).toEqual({ whole: 0, rects: 1 });
    }
    show(2000);
    expect(painted()).toEqual({ whole: 0, rects: 0 });
    // Часы идут каждый кадр — полосы обновляются по очереди, а не первая раз за разом.
    const rows = new Set<unknown>();
    for (let i = 0; i < LIVING_BANDS; i++) {
      env.clock = 2 + i;
      show(2100 + i);
      rows.add(border.calls.find((c) => c.name === 'clearRect')?.args[1]);
      painted();
    }
    expect(rows.size).toBe(LIVING_BANDS);
  });

  it('границы дышат на часах голограммы: та же картинка в другой миг ложится иначе', async () => {
    const { bl, show, border, env } = await boot();
    const points = () => {
      const out = border.calls.filter((c) => c.name === 'lineTo').map((c) => c.args);
      border.calls.length = 0;
      return out;
    };
    show(1000);
    const before = points();
    env.clock = 3;
    bl.forgetBorderLayer();
    show(1100);
    const after = points();
    expect(after.length).toBe(before.length);
    expect(after).not.toEqual(before);
  });

  it('детализация: в покое слой берёт её у кадра, в движении держит свою', async () => {
    const { show, painted, border, camera } = await boot();
    const neutral = (detail: number) => {
      const yes = border.calls.some((c) => c.name === 'stroke' && c.style === rgba('#5fb0c5', 0.55 * detail));
      painted();
      return yes;
    };
    camera.zoomAt(800, 450, 2);
    show(1000, 1);
    show(1000 + SETTLE_MS, 1);
    // Нейтральные края провинций — в детализации слоя.
    expect(neutral(1)).toBe(true);
    expect(show(1001 + SETTLE_MS, 2)).toBe(true);
    expect(border.calls.some((c) => c.name === 'clearRect' && c.args[2] === border.width && c.args[3] === border.height)).toBe(true);
    expect(neutral(2)).toBe(true);
    // Жест: кадр просит другую детализацию, а слой едет со своей и целиком не перерисовывается.
    camera.panBy(37, -21);
    expect(show(2000, 1)).toBe(true);
    const p = painted();
    expect(p.whole).toBe(0);
    expect(p.rects).toBeGreaterThan(0);
  });

  it('дверь, потеря поверхностей карты и потеря своего холста забывают картинку', async () => {
    const { ml, bl, show, painted, border } = await boot();
    show(1000);
    show(1000 + SETTLE_MS);
    painted();
    bl.forgetBorderLayer();
    show(1100 + SETTLE_MS);
    expect(painted().whole).toBe(1);
    // Слой карты потерял поверхности — его хук сбрасывает и этот слой.
    ml.invalidateMapSurfaces();
    show(1200 + SETTLE_MS);
    show(1200 + 2 * SETTLE_MS);
    expect(painted().whole).toBe(1);
    const lost = ml.backgroundContextEvents.lost;
    border.fire('contextlost');
    expect(ml.backgroundContextEvents.lost).toBe(lost + 1);
    show(1300 + 2 * SETTLE_MS);
    expect(painted().whole).toBe(1);
    border.fire('contextrestored');
    expect(ml.backgroundContextEvents.restored).toBe(1);
    show(1400 + 2 * SETTLE_MS);
    expect(painted().whole).toBe(1);
    // Холст без контекста — слоя нет, обводит кадр; вернулся — его пиксели пропали.
    border.lost = true;
    expect(show(1500 + 2 * SETTLE_MS)).toBe(false);
    border.lost = false;
    expect(show(1600 + 2 * SETTLE_MS)).toBe(true);
    expect(painted().whole).toBe(1);
  });

  it('картинка слоя помнит экран и цвета владельцев: их смена перерисовывает его целиком', async () => {
    const { ml, fog, show, painted, border, page, env } = await boot();
    show(1000);
    show(1000 + SETTLE_MS);
    painted();
    // Экран стал ниже, а карта всё так же видна целиком: стекло в единицах карты то же.
    env.vh = page.height = 800;
    show(2000);
    show(2000 + SETTLE_MS);
    expect(painted().whole).toBeGreaterThan(0);
    expect(border.height).toBe(800);
    // Сосед по фронту на виду: союз с ним перекрашивает его границы сразу, без новой выпечки.
    const near = Object.keys(env.world.planets).find((id) => ml.knownOwner(id) === null && fog.known(id))!;
    env.world = { ...env.world, planets: { ...env.world.planets, [near]: { ...env.world.planets[near]!, owner: 'p2' } } };
    show(3000);
    show(3000 + SETTLE_MS);
    painted();
    env.world = { ...env.world, diplomacy: { ...env.world.diplomacy, [pairKey('p1', 'p2')]: 'alliance' } };
    const geo = ml.provinceGeometry;
    show(3001 + SETTLE_MS);
    expect(ml.provinceGeometry).toBe(geo);
    expect(painted().whole).toBe(1);
  });

  it('мало границ — слой ничего не держит, их обводит кадр', async () => {
    const { show, painted } = await boot();
    show(1000, 0);
    expect(show(1000 + SETTLE_MS, 0)).toBe(false);
    expect(painted().whole).toBe(0);
  });

  it('панорама везёт слой копией и дорисовывает открывшуюся полосу', async () => {
    const { show, painted, blits, camera, border, env } = await boot();
    // Стекло шире экрана: панорама открывает его край, которого на слое ещё нет.
    camera.zoomAt(800, 450, 2);
    show(1000);
    show(1000 + SETTLE_MS);
    painted();
    blits();
    camera.panBy(37, -21);
    expect(show(2000)).toBe(true);
    const moved = border.calls.filter((c) => c.name === 'drawImage' && c.args[0] === border);
    expect(moved.map((c) => c.op)).toEqual(['copy']);
    const p = painted();
    expect(p.whole).toBe(0);
    expect(p.rects).toBeGreaterThan(0);
    expect(blits()).toHaveLength(1);
    // Слой встал там, куда приехал: камера стоит — копировать и дорисовывать нечего, а полосы
    // в жесте не делятся заново.
    show(2001);
    expect(border.calls.filter((c) => c.name === 'drawImage')).toHaveLength(0);
    expect(painted()).toEqual({ whole: 0, rects: 0 });
    // Покой делит полосы заново там, где слой стоит, и обходит их, хоть часы и стоят.
    const after = [];
    for (let i = 0; i <= LIVING_BANDS; i++) {
      show(2000 + SETTLE_MS + i);
      after.push(painted());
    }
    expect(after.slice(0, LIVING_BANDS)).toEqual(Array(LIVING_BANDS).fill({ whole: 0, rects: 1 }));
    expect(after[LIVING_BANDS]).toEqual({ whole: 0, rects: 0 });
    expect(env.clock).toBe(0);
  });

  it('слой, перерисованный после сдвига, заново полосы в покое не делит', async () => {
    const { bl, show, painted, camera } = await boot();
    camera.zoomAt(800, 450, 2);
    show(1000);
    show(1000 + SETTLE_MS);
    camera.panBy(37, -21);
    show(2000);
    painted();
    bl.forgetBorderLayer();
    show(2001);
    expect(painted().whole).toBe(1);
    show(2000 + SETTLE_MS);
    show(2001 + SETTLE_MS);
    expect(painted()).toEqual({ whole: 0, rects: 0 });
  });

  it('зум растягивает слой, не перерисовывая его', async () => {
    const { show, painted, blits, camera, env } = await boot();
    show(1000);
    show(1000 + SETTLE_MS);
    painted();
    blits();
    camera.zoomAt(800, 450, 1.25);
    // Растянутый слой полос не обновляет, даже когда часы идут: его перерисует покой.
    env.clock = 1;
    expect(show(2000)).toBe(true);
    expect(painted()).toEqual({ whole: 0, rects: 0 });
    const [b] = blits();
    // Источник — пиксели слоя, кадр — те же, растянутые в 1,25 раза.
    const [, , , sw, sh, , , dw, dh] = b!.args as number[];
    expect(dw! / sw!).toBeCloseTo(1.25, 6);
    expect(dh! / sh!).toBeCloseTo(1.25, 6);
  });

  it('в кадре новой выпечки слой не рисуется, а ждёт следующего (правило 4)', async () => {
    const { ml, show, painted, blits, camera } = await boot();
    show(1000);
    show(1000 + SETTLE_MS);
    painted();
    camera.zoomAt(800, 450, 1.25);
    show(2000);
    painted();
    blits();
    // Покой допекает резкость в фоне; новая выпечка встаёт в каком-то из следующих кадров.
    const frames: Array<{ baked: boolean; whole: number; blits: number }> = [];
    for (let i = 0; i < 40; i++) {
      const geo = ml.provinceGeometry;
      show(2000 + SETTLE_MS + i * 16);
      frames.push({ baked: geo !== ml.provinceGeometry, whole: painted().whole, blits: blits().length });
    }
    const at = frames.findIndex((f) => f.baked);
    expect(at).toBeGreaterThanOrEqual(0);
    expect(frames.slice(0, at).every((f) => f.whole === 0)).toBe(true);
    // В кадре выпечки слой показан растянутым как был, в следующем — нарисован заново.
    expect(frames[at]).toEqual({ baked: true, whole: 0, blits: 1 });
    expect(frames[at + 1]).toEqual({ baked: false, whole: 1, blits: 1 });
    expect(frames.slice(at + 2).every((f) => f.whole === 0 && !f.baked)).toBe(true);
  });

  it('покой с растянутым слоем — ещё жест: другой детализации слой до выпечки не берёт', async () => {
    const { show, painted, camera } = await boot();
    show(1000);
    show(1000 + SETTLE_MS);
    camera.zoomAt(800, 450, 1.25);
    show(2000);
    painted();
    // Камера встала, но выпечка под ней ещё растянута: слой держит свою детализацию.
    expect(show(2000 + SETTLE_MS, 2)).toBe(true);
    expect(painted().whole).toBe(0);
  });

  it('прорежённые границы: слой узнаёт свои в следующем кадре и не перерисовывается', async () => {
    const { ml, show, painted, env } = await boot();
    // Короткие отрезки волны на экране — граница рисуется прорежённой (`territoryLod.ts`).
    env.segment = 2;
    show(1000);
    expect(ml.livingLevel(ml.provinceGeometry!)).toBeGreaterThan(0);
    show(1000 + SETTLE_MS);
    painted();
    show(1001 + SETTLE_MS);
    expect(painted()).toEqual({ whole: 0, rects: 0 });
  });

  it('отдаление сжимает слой, а открывшиеся края стекла обводит кадр', async () => {
    const { show, painted, blits, camera, frame } = await boot();
    camera.zoomAt(800, 450, 2);
    show(1000);
    show(1000 + SETTLE_MS);
    painted();
    blits();
    camera.zoomAt(800, 450, 0.8);
    expect(show(2000)).toBe(true);
    expect(painted()).toEqual({ whole: 0, rects: 0 });
    expect(frame.calls.filter((c) => c.name === 'clip').length).toBeGreaterThan(0);
    const [b] = blits();
    const [, , , sw, , , , dw] = b!.args as number[];
    expect(dw! / sw!).toBeCloseTo(0.8, 6);
  });
});

describe('REFM-232 — стык слоя живых границ с main.ts', () => {
  const MAIN = readFileSync(new URL('./main.ts', import.meta.url), 'utf8');
  const SRC = readFileSync(new URL('./borderLayer.ts', import.meta.url), 'utf8');
  const SURFACE = readFileSync(new URL('./mapSurface.ts', import.meta.url), 'utf8');
  const init = /initBorderLayer\(\{([\s\S]*?)\n\}\);/.exec(MAIN)?.[1] ?? '';

  it('хуки — кадр, экран и часы голограммы; сброс — дверью из слоя карты', () => {
    for (const hook of ['ctx: () => cx,', 'vw: () => VW,', 'vh: () => VH,', 'dpr: () => DPR,', 'clock: () => hologramTime,'])
      expect(init, hook).toContain(hook);
    expect(MAIN).toContain('surfacesLost: forgetBorderLayer,');
    // Кадр кладёт слой из поверхности карты (`mapSurface.ts`, REFM-235).
    expect(SURFACE).toContain('blitBorderLayer(lod.provinceDetail, borders)');
  });

  it('холст слоя и его память живут только в модуле', () => {
    expect(MAIN).not.toMatch(/\bfunction (blitBorderLayer|scrollBorderLayer|borderBands|paintBorderRect|strokeBordersIn)\(/);
    expect(MAIN).not.toMatch(/\b(let|const) (borderLayer|borderLayerX|borderHeld|borderAt|borderEdges|borderClocks|borderBake)\b/);
  });

  it('модуль не тянет `main.ts`', () => {
    expect(SRC).not.toMatch(/from '\.\/main'/);
  });
});
