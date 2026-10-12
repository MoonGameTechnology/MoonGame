/**
 * Поверхность карты (REFM-235, часть 2) — прямой тест владельца.
 *
 * Сами слои (живые границы, стекло, блики рельефа, выделение провинции, волна захвата) —
 * у своих владельцев, и у них свои тесты. Здесь — то, что собирает только поверхность:
 * В КАКОМ пространстве и В КАКОМ порядке слои ложатся поверх выпечки, кто из них молчит на
 * плоской карте и на схеме, и с какого момента пульсирует выделение. Поэтому рисовалки
 * соседей подменены и записывают вызов в общую ленту вместе с холстом; холст поддельный,
 * выбор — настоящий. Каждый тест — свежая загрузка модулей.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';

import type { MapLod } from '../../packages/client/src/mapLod';
import { visibleInBake } from '../../decisions/mapLayerView';

interface Call {
  name: string;
  args: unknown[];
  alpha: unknown;
}

/** Холст, чей контекст записывает каждый вызов с прозрачностью в момент вызова. */
function fakeCanvas() {
  const calls: Call[] = [];
  const props: Record<string, unknown> = { globalAlpha: 1 };
  const stack: Array<Record<string, unknown>> = [];
  const ctx = new Proxy(props, {
    get(target, name) {
      if (typeof name !== 'string') return undefined;
      if (name in target) return target[name];
      return (...args: unknown[]) => {
        if (name === 'save') stack.push({ ...target });
        if (name === 'restore') Object.assign(target, stack.pop() ?? {});
        calls.push({ name, args, alpha: target.globalAlpha });
      };
    },
    set(target, name, value) {
      target[name as string] = value;
      return true;
    },
  }) as unknown as CanvasRenderingContext2D;
  return { ctx, calls, props };
}

const VW = 1600;
const VH = 900;
const DPR = 2;
const VIEW = { k: 2, tx: -100, ty: -60 };
const FRAME = { kind: 'frame' };
const PLACE = { kind: 'place' };
const SIGHT = visibleInBake(VIEW, VW, VH);

/** Детализация карты: по умолчанию — крупная карта во всей красе. */
const LOD = (over: Partial<MapLod> = {}): MapLod =>
  ({ scale: 1, art: 1, detail: 1, provinceDetail: 0.7, markerRadius: 3, ...over }) as MapLod;

/** Поле рельефа по рамке. */
const field = (x: number, y: number, width = 10, height = 10) => ({ box: { x, y, width, height } });

beforeEach(() => {
  vi.resetModules();
});
afterEach(() => {
  vi.unstubAllGlobals();
  for (const m of ['./mapLayer', './borderLayer', './holographicSurface', './mapEffects', '../../packages/client/src/livingBorder', '../../packages/client/src/provinceSelection'])
    vi.doUnmock(m);
});

/** Мир теста. */
function makeEnv() {
  return {
    holographic: true,
    clock: 777,
    borders: { kind: 'borders' } as object | null,
    layered: false,
    geometry: { place: PLACE } as object | null,
    fields: [] as Array<ReturnType<typeof field>>,
    polys: { C0R1: { kind: 'poly' } } as Record<string, object>,
  };
}

// Подмены соседей держатся загрузчиком дольше одного теста, поэтому смотрят они не в
// замыкание первой загрузки, а в живые холст и мир — те, что подняла последняя `boot()`.
let live = { frame: fakeCanvas(), env: makeEnv() };
/** Рисовалка соседа: пишет вызов в ту же ленту, что и холст. */
const mark = (name: string, ret?: () => unknown) => (...args: unknown[]) => {
  live.frame.calls.push({ name, args, alpha: live.frame.props.globalAlpha });
  return ret?.();
};

async function boot() {
  vi.stubGlobal('__PLAYER_BUILD__', false);
  vi.stubGlobal('document', { getElementById: () => null });
  live = { frame: fakeCanvas(), env: makeEnv() };
  const { frame, env } = live;
  vi.doMock('./mapLayer', () => ({
    mapView: VIEW,
    holographicFrame: FRAME,
    livingBorders: () => live.env.borders,
    get provinceGeometry() {
      return live.env.geometry;
    },
    provincePolygon: (id: string) => live.env.polys[id],
    get terrainFields() {
      return live.env.fields;
    },
  }));
  vi.doMock('./borderLayer', () => ({ blitBorderLayer: mark('blitBorderLayer', () => live.env.layered) }));
  vi.doMock('./holographicSurface', () => ({
    clipGlassSurface: mark('clipGlassSurface'),
    drawGlassRim: mark('drawGlassRim'),
    drawGlassWave: mark('drawGlassWave'),
    drawTerrainField: mark('drawTerrainField'),
  }));
  vi.doMock('./mapEffects', () => ({ drawCaptureFlashes: mark('drawCaptureFlashes') }));
  vi.doMock('../../packages/client/src/livingBorder', () => ({ drawLivingBorders: mark('drawLivingBorders') }));
  vi.doMock('../../packages/client/src/provinceSelection', () => ({
    drawProvinceSelection: mark('drawProvinceSelection'),
    selectionPulse: (ms: number, motion: boolean) => ({ ms, motion }),
  }));
  const surface = await import('./mapSurface');
  surface.initMapSurface({
    ctx: () => frame.ctx,
    vw: () => VW,
    vh: () => VH,
    dpr: () => DPR,
    clock: () => env.clock,
    holographic: () => env.holographic,
  });
  const interaction = await import('./interaction');
  const prefs = await import('./graphicsPrefs');
  const palette = await import('./mapPalette');
  const names = () => frame.calls.map((c) => c.name);
  const find = (name: string) => frame.calls.find((c) => c.name === name);
  return { surface, interaction, prefs, palette, env, frame, names, find };
}

describe('REFM-235 — поверхность карты', () => {
  it('голографическая карта: в пространстве выпечки — границы, стекло, блики, волна, выделение, захват, обод', async () => {
    const { surface, interaction, prefs, palette, env, frame, names, find } = await boot();
    env.fields = [field(SIGHT.x + 10, SIGHT.y + 10)];
    interaction.pickWorld('C0R1');
    surface.drawMapSurface(1000, LOD());
    expect(names()).toEqual([
      'save', 'setTransform', 'blitBorderLayer',
      'save', 'clipGlassSurface', 'drawLivingBorders',
      'save', 'drawTerrainField', 'restore',
      'drawGlassWave', 'drawProvinceSelection', 'drawCaptureFlashes',
      'restore', 'drawGlassRim', 'restore',
    ]);
    expect(find('setTransform')!.args).toEqual([DPR * VIEW.k, 0, 0, DPR * VIEW.k, DPR * VIEW.tx, DPR * VIEW.ty]);
    expect(find('blitBorderLayer')!.args).toEqual([0.7, env.borders]);
    expect(find('clipGlassSurface')!.args).toEqual([frame.ctx, FRAME]);
    const living = find('drawLivingBorders')!.args;
    expect(living[0]).toBe(frame.ctx);
    expect(living[1]).toBe(env.borders);
    expect(living[2]).toEqual({ ownerColor: palette.ownerColor, hideOwnedInner: true, provinceDetail: 0.7 });
    expect(living.slice(3)).toEqual([FRAME, 777, SIGHT, PLACE]);
    expect(find('drawTerrainField')!.args).toEqual([frame.ctx, env.fields[0], 777, true]);
    expect(find('drawGlassWave')!.args).toEqual([frame.ctx, FRAME, VW, VH, 777, prefs.glowOn()]);
    expect(find('drawProvinceSelection')!.args).toEqual([frame.ctx, env.polys.C0R1, { ms: 0, motion: prefs.motionOn() }, palette.LOCK]);
    expect(find('drawCaptureFlashes')!.args).toEqual([1000]);
    expect(find('drawGlassRim')!.args).toEqual([frame.ctx, FRAME, 777, prefs.glowOn()]);
    // Свечение и движение выключены — стекло без свечения, пульс выделения без движения.
    frame.calls.length = 0;
    prefs.setGlowFx(false);
    prefs.setMotion(false);
    surface.drawMapSurface(1000, LOD());
    expect(find('drawGlassWave')!.args[5]).toBe(false);
    expect(find('drawGlassRim')!.args[3]).toBe(false);
    expect(find('drawProvinceSelection')!.args[2]).toEqual({ ms: 0, motion: false });
  });

  it('слой границ готов — живые границы не рисуются второй раз; без границ и без геометрии — тоже', async () => {
    const { surface, env, frame, names } = await boot();
    env.layered = true;
    surface.drawMapSurface(0, LOD());
    expect(names()).toContain('blitBorderLayer');
    expect(names()).not.toContain('drawLivingBorders');
    frame.calls.length = 0;
    env.layered = false;
    env.borders = null;
    surface.drawMapSurface(0, LOD());
    expect(names()).not.toContain('blitBorderLayer');
    expect(names()).not.toContain('drawLivingBorders');
    frame.calls.length = 0;
    env.borders = { kind: 'borders' };
    env.geometry = null;
    surface.drawMapSurface(0, LOD());
    expect(names()).toContain('blitBorderLayer');
    expect(names()).not.toContain('drawLivingBorders');
  });

  it('блики рельефа — только у видимых полей и с прозрачностью детализации; на схеме их нет', async () => {
    const { surface, env, frame } = await boot();
    const right = SIGHT.x + SIGHT.width;
    const bottom = SIGHT.y + SIGHT.height;
    const inside = field(SIGHT.x + 10, SIGHT.y + 10);
    const edge = field(right, bottom); // касается края — виден
    env.fields = [
      inside,
      edge,
      field(right + 1, SIGHT.y + 10), // правее экрана
      field(SIGHT.x + 10, bottom + 1), // ниже экрана
      field(SIGHT.x - 11, SIGHT.y + 10), // левее экрана
      field(SIGHT.x + 10, SIGHT.y - 11), // выше экрана
    ];
    surface.drawMapSurface(0, LOD({ detail: 0.5 }));
    const drawn = frame.calls.filter((c) => c.name === 'drawTerrainField');
    expect(drawn.map((c) => c.args[1])).toEqual([inside, edge]);
    expect(drawn.map((c) => c.alpha)).toEqual([0.5, 0.5]);
    frame.calls.length = 0;
    surface.drawMapSurface(0, LOD({ detail: 0 }));
    expect(frame.calls.filter((c) => c.name === 'drawTerrainField')).toEqual([]);
    expect(frame.calls.filter((c) => c.name === 'save')).toHaveLength(2);
  });

  it('плоская карта: ни стекла, ни живых границ — только выделение и волна захвата', async () => {
    const { surface, interaction, env, frame, names } = await boot();
    env.holographic = false;
    env.fields = [field(SIGHT.x + 10, SIGHT.y + 10)];
    surface.drawMapSurface(0, LOD());
    expect(names()).toEqual(['save', 'setTransform', 'drawCaptureFlashes', 'restore']);
    frame.calls.length = 0;
    interaction.pickWorld('C0R1');
    surface.drawMapSurface(0, LOD());
    expect(names()).toEqual(['save', 'setTransform', 'drawProvinceSelection', 'drawCaptureFlashes', 'restore']);
    // Мир без провинции — выделять нечего.
    frame.calls.length = 0;
    interaction.pickWorld('nowhere');
    surface.drawMapSurface(0, LOD());
    expect(names()).toEqual(['save', 'setTransform', 'drawCaptureFlashes', 'restore']);
  });

  it('пульс выделения — с момента выбора: другой мир и повторный тап начинают его заново', async () => {
    const { surface, interaction, env, frame } = await boot();
    env.polys.C0R2 = { kind: 'poly2' };
    const pulse = () => {
      const sel = frame.calls.filter((c) => c.name === 'drawProvinceSelection').at(-1)!;
      return (sel.args[2] as { ms: number }).ms;
    };
    interaction.pickWorld('C0R1');
    surface.drawMapSurface(1000, LOD());
    expect(pulse()).toBe(0);
    surface.drawMapSurface(1600, LOD());
    expect(pulse()).toBe(600);
    surface.markSelection(1500); // тот же мир тапнули ещё раз
    surface.drawMapSurface(1700, LOD());
    expect(pulse()).toBe(200);
    interaction.pickWorld('C0R2');
    surface.drawMapSurface(2000, LOD());
    expect(pulse()).toBe(0);
    expect(frame.calls.filter((c) => c.name === 'drawProvinceSelection').at(-1)!.args[1]).toBe(env.polys.C0R2);
  });
});

describe('REFM-235 — стык поверхности с main.ts', () => {
  const MAIN = readFileSync(new URL('./main.ts', import.meta.url), 'utf8');
  const SURFACE = readFileSync(new URL('./mapSurface.ts', import.meta.url), 'utf8');

  it('хуки — кадр, экран, плотность, часы и вид голограммы', () => {
    const init = MAIN.slice(MAIN.indexOf('initMapSurface({'), MAIN.indexOf('});', MAIN.indexOf('initMapSurface({')));
    for (const hook of ['ctx: () => cx', 'vw: () => VW', 'vh: () => VH', 'dpr: () => DPR', 'clock: () => hologramTime', 'holographic: holographicMapOn'])
      expect(init, hook).toContain(hook);
  });

  it('пульс выделения живёт в модуле: повторный тап зовёт дверь; кадр кладёт поверхность между выпечкой и радаром', () => {
    expect(MAIN).not.toMatch(/paintedSelection|selectionStarted/);
    expect(MAIN.match(/markSelection\(lastReal\);/g)).toHaveLength(2);
    const order = ['blitStaticLayer(now);', 'drawMapSurface(now, lod);', 'drawScanSweep(now);'].map((s) => MAIN.indexOf(s));
    expect(order.every((i) => i > 0)).toBe(true);
    expect([...order].sort((a, b) => a - b)).toEqual(order);
  });

  it('модуль не тянет `main.ts`', () => {
    expect(SURFACE).not.toMatch(/from '\.\/main'/);
  });
});
