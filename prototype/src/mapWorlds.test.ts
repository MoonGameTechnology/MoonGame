/**
 * Миры карты (REFM-235) — прямой тест владельца на живом мире прототипа.
 *
 * Что показать, решают чистые модели (`fogView.ts`, `kindBadge.ts`, `buildChips.ts`,
 * `nodeCallout.ts`, `semanticZoom.ts`, `radarSources.ts`, `decisions/regionName.ts`), и у
 * них свои тесты. Здесь — то, что собирается только вместе: мир, туман и камера дают холсту
 * ровно то искусство узла, ту метку тумана и ту подпись, что обещают модели, своим цветом и
 * в той точке экрана, где стоит мир. Холст поддельный и записывает вызовы вместе с цветом,
 * шириной линии, прозрачностью, шрифтом и пунктиром в момент вызова; мир, туман, камера,
 * геометрия флотов, палитра, выбор и дороги — настоящие. Каждый тест — свежая загрузка
 * модулей.
 */
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';

import type { Fleet, GameState, Planet } from '../../packages/shared-core/src/index';
import { rgba } from '../../packages/client/src/holoDraw';
import type { MapLod } from '../../packages/client/src/mapLod';
import { BADGE_R, badgeBob, badgeCenterY, badgeLook, badgeTether } from './kindBadge';
import { chipFontPx, chipGlyph, chipMetrics, chipXs, chipY } from './buildChips';
import { asteroidsFor, bracketStrokes, polyPoints } from './mapShapes';
import { phaseAt } from './pulseFx';
import type { MapNode } from './game';

interface Call {
  name: string;
  args: unknown[];
  stroke: unknown;
  fill: unknown;
  width: unknown;
  alpha: unknown;
  font: unknown;
  dash: unknown;
  offset: unknown;
}

/** Холст, чей контекст записывает каждый вызов с цветом, шириной, прозрачностью и шрифтом.
 *  `save`/`restore` держат стек состояния, как настоящий холст: прозрачность слоя не должна
 *  утекать в следующий кадр теста. */
function fakeCanvas() {
  const calls: Call[] = [];
  const props: Record<string, unknown> = {
    globalAlpha: 1,
    lineWidth: 1,
    strokeStyle: '#000',
    fillStyle: '#000',
    font: '',
    lineDashOffset: 0,
  };
  let dash: unknown = [];
  const stack: Array<[Record<string, unknown>, unknown]> = [];
  const ctx = new Proxy(props, {
    get(target, name) {
      if (typeof name !== 'string') return undefined;
      if (name in target) return target[name];
      if (name === 'getContextAttributes') return () => ({});
      return (...args: unknown[]) => {
        if (name === 'setLineDash') dash = args[0];
        if (name === 'save') stack.push([{ ...target }, dash]);
        if (name === 'restore') {
          const top = stack.pop();
          if (top) {
            Object.assign(target, top[0]);
            dash = top[1];
          }
        }
        calls.push({
          name,
          args,
          stroke: target.strokeStyle,
          fill: target.fillStyle,
          width: target.lineWidth,
          alpha: target.globalAlpha,
          font: target.font,
          dash,
          offset: target.lineDashOffset,
        });
        if (name.startsWith('create')) return { addColorStop() {} };
        if (name === 'measureText') return { width: 40 };
        return undefined;
      };
    },
    set(target, name, value) {
      target[name as string] = value;
      return true;
    },
  }) as unknown as CanvasRenderingContext2D;
  const named = (name: string) => calls.filter((c) => c.name === name);
  return { ctx, calls, props, named };
}

beforeAll(async () => {
  vi.stubGlobal('__PLAYER_BUILD__', false);
  vi.stubGlobal('document', { createElement: () => fakeCanvas().ctx, getElementById: () => null });
  await import('./mapWorlds');
  await import('./game');
  vi.unstubAllGlobals();
}, 60_000);
beforeEach(() => {
  vi.resetModules();
});
afterEach(() => {
  vi.unstubAllGlobals();
});

type XY = { x: number; y: number };
const MONO = 'ui-monospace,Menlo,monospace';

/** Детализация карты: по умолчанию — крупная карта во всей красе. */
const LOD = (over: Partial<MapLod> = {}): MapLod =>
  ({ scale: 1, art: 1, detail: 1, provinceDetail: 1, markerRadius: 3, ...over }) as MapLod;

async function boot() {
  vi.stubGlobal('__PLAYER_BUILD__', false); // туман читает профиль сборки
  vi.stubGlobal('Path2D', class {}); // корпуса кораблей — пути холста
  // Спрайты свечения и сфер — холсты страницы: здесь они поддельные.
  const sprite = () => ({ width: 0, height: 0, getContext: () => fakeCanvas().ctx });
  vi.stubGlobal('document', { createElement: sprite, getElementById: () => null });
  const game = await import('./game');
  const world: GameState = game.newGame({
    seats: [
      { id: 'p1', name: 'A', faction: 'azure', start: game.START_CANDIDATES[0]!, ai: false },
      { id: 'p2', name: 'B', faction: 'crimson', start: game.START_CANDIDATES[1]!, ai: false },
    ],
  });
  const frame = fakeCanvas();
  const catalog = await import('./mapCatalog');
  const env = {
    world,
    nodes: catalog.mapNodesFromState(world) as MapNode[],
    clock: 1234,
    holographic: false,
  };
  const camera = await import('./mapCamera');
  camera.initMapCamera({
    vw: () => 1600,
    vh: () => 900,
    mobile: () => false,
    console: () => false,
    world: () => env.world,
    me: () => 'p1',
  } as never);
  camera.frameMap(env.nodes);
  camera.setView({ scale: 1, x: 0, y: 0 });
  const fog = await import('./mapFog');
  const { sightCircles } = await import('../../packages/shared-core/src/index');
  fog.initMapFog({
    world: () => env.world,
    me: () => 'p1',
    net: () => false,
    contacts: () => [],
    sight: () => sightCircles(env.world, 'p1', game.data),
  });
  fog.refreshVision();
  const geo = await import('./fleetGeometry');
  geo.initFleetGeometry({
    world: () => env.world,
    me: () => 'p1',
    now: () => env.world.time,
    lod: () => LOD(),
    forkMarks: () => [],
    orbits: () => [],
  } as never);
  const palette = await import('./mapPalette');
  palette.initMapPalette({ world: () => env.world, me: () => 'p1', ctx: () => frame.ctx, dpr: () => 1 } as never);
  (await import('./mapOverlays')).initMapOverlays({ ctx: () => frame.ctx } as never);
  // Дальность радара мира — у радара (REFM-239): ему нужны мир и своё место.
  (await import('./mapRadar')).initMapRadar({ world: () => env.world, me: () => 'p1' } as never);
  const worlds = await import('./mapWorlds');
  const sectorOf = (id: string) => env.nodes.find((n) => n.id === id)?.sector ?? '';
  worlds.initMapWorlds({
    world: () => env.world,
    me: () => 'p1',
    nodes: () => env.nodes,
    ctx: () => frame.ctx,
    clock: () => env.clock,
    holographic: () => env.holographic,
    sectorType: (id) => game.SECTOR_TYPES[sectorOf(id)],
  });
  const interaction = await import('./interaction');
  const prefs = await import('./graphicsPrefs');
  const { worldName } = await import('./planetName');
  const { t, tData } = await import('../../localization/runtime');
  const icons = await import('./icons');
  const home = Object.values(world.planets).find((p) => p.owner === 'p1')!;
  const next = world.planets[home.links![0]!]!; // опознанный нейтральный сосед
  /** Узел карты по id. */
  const node = (id: string) => env.nodes.find((n) => n.id === id)!;
  /** Экранная точка мира. */
  const at = (p: XY) => camera.world(p);
  /** Дыхание цвета владельца у узла — тем же законом, что у карты. */
  const pulse = (n: MapNode, now: number) =>
    prefs.fxBreath(now, { period: 620, base: 0.64, amp: 0.36, phase: phaseAt(n.x, n.y) });
  /** Сменить тип сектора узла. */
  const asSector = (id: string, sector: string) => {
    env.nodes = env.nodes.map((n) => (n.id === id ? { ...n, sector } : n));
  };
  /** Изменить мир в узле. */
  const patchPlanet = (id: string, extra: Partial<Planet>) => {
    env.world = { ...env.world, planets: { ...env.world.planets, [id]: { ...env.world.planets[id]!, ...extra } } };
  };
  const name = (id: string) => worldName(env.world, id);
  return {
    worlds, camera, fog, geo, palette, interaction, prefs, game, env, frame, home, next,
    node, at, pulse, asSector, patchPlanet, name, t, tData, icons, catalog,
  };
}

const near = (a: number, b: number) => Math.abs(a - b) < 1e-6;
/** Вызов `name` с аргументами `args` (числа — с точностью до 1e-6). */
const call = (calls: Call[], fn: string, ...args: unknown[]) =>
  calls.find(
    (k) =>
      k.name === fn &&
      args.every((a, i) => (typeof a === 'number' ? near(k.args[i] as number, a) : k.args[i] === a)),
  );
/** Дуга радиуса `r` с центром в `c`. */
const arcAt = (calls: Call[], c: XY, r: number) => call(calls, 'arc', c.x, c.y, r);
/** Кэшированный диск свечения радиуса `r` с центром в `c` (`holoDraw.blitGlow`). */
const glowAt = (calls: Call[], c: XY, r: number) => {
  const rad = Math.max(4, Math.round(r));
  return calls.find(
    (k) => k.name === 'drawImage' && k.args.length === 5 && near(k.args[1] as number, c.x - rad) &&
      near(k.args[2] as number, c.y - rad) && near(k.args[3] as number, rad * 2),
  );
};
/** Уголки цели вокруг `c` радиуса `r` (`mapOverlays.targetBrackets`). */
const bracketsAt = (calls: Call[], c: XY, r: number) => {
  const i = calls.findIndex((k) => k.name === 'translate' && near(k.args[0] as number, c.x) && near(k.args[1] as number, c.y));
  if (i < 0) return false;
  const first = bracketStrokes(r, 6)[0]!.from;
  const move = calls.slice(i).find((k) => k.name === 'moveTo');
  return !!move && near(move.args[0] as number, first.x) && near(move.args[1] as number, first.y);
};

describe('REFM-235 — мир на карте', () => {
  it('свой мир: аура, кольцо радара, ряд построек, сфера, засечки, бейдж типа и выноска с гарнизоном', async () => {
    const { worlds, palette, frame, home, node, at, pulse, name, t, icons, game } = await boot();
    worlds.drawWorlds(0, LOD());
    const n = node(home.id);
    const c = at(n);
    const R = 13;
    const col = palette.ownerColor('p1');
    expect(glowAt(frame.calls, c, R + 20)?.alpha).toBeCloseTo(0.13);
    // Кольцо радара: пунктир на часах голограммы, дышит цветом владельца.
    const ring = arcAt(frame.calls, c, R + 14 + 2 * pulse(n, 0))!;
    expect([ring.dash, ring.offset, ring.width]).toEqual([[3, 5], -1234 / 240, 0.75]);
    expect(ring.stroke).toBe(rgba(col, 0.12 + 0.05 * pulse(n, 0)));
    // Ряд построек: плитки по центру под узлом, значок — цветом владельца.
    const xs = chipXs(home.buildings.length, c.x, 1);
    const by = chipY(c.y, R, 1);
    const { half } = chipMetrics(1);
    home.buildings.forEach((b, i) => {
      expect(call(frame.calls, 'rect', xs[i]! - half, by - half, half * 2, half * 2)?.stroke).toBe(rgba(col, 0.55));
      const glyph = call(frame.calls, 'fillText', chipGlyph(icons.BUILD_ICON[b.type]), xs[i]!, by + 0.5)!;
      expect([glyph.fill, glyph.font]).toEqual([rgba(col, 0.9), `${chipFontPx(1)}px ${MONO}`]);
    });
    // Проволочная сфера мира: кадр атласа в квадрат 2R, приглушённая на обзорном зуме.
    const sphere = frame.named('drawImage').find((k) => k.args.length === 9)!;
    expect(sphere.args.slice(5)).toEqual([c.x - R, c.y - R, 2 * R, 2 * R]);
    expect(sphere.alpha).toBeCloseTo(0.65);
    for (const [dx, dy] of [[0, -1], [0, 1], [-1, 0], [1, 0]] as const) {
      expect(call(frame.calls, 'moveTo', c.x + dx * (R - 3), c.y + dy * (R - 3)), `засечка ${dx},${dy}`).toBeTruthy();
      expect(call(frame.calls, 'lineTo', c.x + dx * (R + 5), c.y + dy * (R + 5))).toBeTruthy();
    }
    // Бейдж типа висит над узлом и тянет к нему луч проектора.
    const bob = badgeCenterY(c.y - R, badgeBob(0, n.x, n.y));
    const tether = badgeTether(c.y - R, bob);
    expect(call(frame.calls, 'moveTo', c.x, tether.from)?.dash).toEqual([...badgeLook().tetherDash]);
    expect(call(frame.calls, 'lineTo', c.x, tether.to)).toBeTruthy();
    // Капсула: заливка и обод одним радиусом.
    const capsule = frame.named('arc').filter((k) => arcAt([k], { x: c.x, y: bob }, BADGE_R));
    expect(capsule).toHaveLength(2);
    expect(capsule[0]!.fill).toBe(rgba(game.SECTOR_TYPES.planet!.color, badgeLook().fillAlpha));
    expect(call(frame.calls, 'fillText', icons.KIND_ICON.planet, c.x, bob + 0.5)?.font).toBe(`700 15px ${MONO}`);
    // Выноска: имя ярко, вторая строка — гарнизон словами и значки построек.
    const title = call(frame.calls, 'fillText', name(home.id), c.x + R + 12, c.y - 1)!;
    expect([title.fill, title.font, title.alpha]).toEqual([col, `700 12px ${MONO}`, 1]);
    const g = home.garrison.reduce((a, st) => a + st.count, 0);
    const stats = [t('map.callout.garrison', { n: g }), home.buildings.map((b) => icons.BUILD_ICON[b.type]).join('')].join('  ');
    const line = call(frame.calls, 'fillText', stats, c.x + R + 12, c.y + 12)!;
    expect([line.fill, line.font]).toEqual([rgba('#96d2cd', 0.6), `10px ${MONO}`]);
  });

  it('нейтральный мир: аура тусклее, имя нейтральным цветом, без радара нет кольца, без построек нет ряда', async () => {
    const { worlds, palette, frame, next, node, at, pulse, name, t } = await boot();
    worlds.drawWorlds(0, LOD());
    const n = node(next.id);
    const c = at(n);
    const R = 13;
    expect(glowAt(frame.calls, c, R + 20)?.alpha).toBeCloseTo(0.045);
    expect(arcAt(frame.calls, c, R + 14 + 2 * pulse(n, 0))).toBeUndefined();
    expect(frame.named('rect').some((k) => near(k.args[1] as number, chipY(c.y, R, 1) - chipMetrics(1).half) && Math.abs((k.args[0] as number) - c.x) < 20)).toBe(false);
    expect(call(frame.calls, 'fillText', name(next.id), c.x + R + 12, c.y - 1)?.fill).toBe('#9fc9c4');
    const g = next.garrison.reduce((a, st) => a + st.count, 0);
    expect(call(frame.calls, 'fillText', t('map.callout.garrison', { n: g }), c.x + R + 12, c.y + 12)).toBeTruthy();
    expect(palette.ownerColor(null)).not.toBe(palette.ownerColor('p1'));
  });

  it('форт — шестигранник вокруг мира; выбранный мир — в уголках цели', async () => {
    const { worlds, palette, frame, home, next, node, at, interaction, patchPlanet } = await boot();
    patchPlanet(home.id, { buildings: [...home.buildings, { type: 'fort', level: 1, hp: 10 }] });
    interaction.pickWorld(next.id);
    worlds.drawWorlds(0, LOD());
    const c = at(node(home.id));
    const hex = polyPoints(c.x, c.y, 13 + 6, 6, Math.PI / 6);
    expect(call(frame.calls, 'moveTo', hex[0]!.x, hex[0]!.y)).toBeTruthy();
    const stroke = frame.calls.findIndex((k) => k.name === 'moveTo' && near(k.args[0] as number, hex[0]!.x) && near(k.args[1] as number, hex[0]!.y));
    expect(frame.calls.slice(stroke).find((k) => k.name === 'stroke')?.stroke).toBe(rgba(palette.ownerColor('p1'), 0.5));
    expect(bracketsAt(frame.calls, at(node(next.id)), 13 + 10)).toBe(true);
    expect(bracketsAt(frame.calls, c, 13 + 10)).toBe(false);
  });

  it('LOD: на отдалении узел мельче, бейдж и ряд построек гаснут, подпись чужого тает, своя — остаётся', async () => {
    const { worlds, frame, home, next, node, at, name, icons } = await boot();
    worlds.drawWorlds(0, LOD({ detail: 0.4 }));
    const ns = 0.45 + 0.55 * 0.4;
    const R = 13 * ns;
    const mine = call(frame.calls, 'fillText', name(home.id), at(node(home.id)).x + R + 12, at(node(home.id)).y - 1)!;
    expect(mine.alpha).toBeCloseTo(0.9);
    const theirs = call(frame.calls, 'fillText', name(next.id), at(node(next.id)).x + R + 12, at(node(next.id)).y - 1)!;
    expect(theirs.alpha).toBeCloseTo(0.4);
    // Ряд построек — по своему масштабу; бейдж — прозрачностью детализации.
    const c = at(node(home.id));
    expect(call(frame.calls, 'fillText', chipGlyph(icons.BUILD_ICON[home.buildings[0]!.type]), chipXs(home.buildings.length, c.x, ns)[0]!, chipY(c.y, R, ns) + 0.5)?.alpha).toBeCloseTo(0.4);
    expect(frame.named('fillText').find((k) => k.args[0] === icons.KIND_ICON.planet)?.alpha).toBeCloseTo(0.4);
    // Аура, сфера и бейдж — по масштабу узла.
    expect(glowAt(frame.calls, c, R + 20 * ns)?.alpha).toBeCloseTo(0.13);
    expect(frame.named('drawImage').find((k) => k.args.length === 9)?.args.slice(5)).toEqual([c.x - R, c.y - R, 2 * R, 2 * R]);
    const n = node(home.id);
    const bob = badgeCenterY(c.y - R, badgeBob(0, n.x, n.y));
    expect(call(frame.calls, 'fillText', icons.KIND_ICON.planet, c.x, bob + 0.5)).toBeTruthy();
    // Совсем мелкий узел: кегль значков постройки упирается в пол.
    frame.calls.length = 0;
    worlds.drawWorlds(0, LOD({ detail: 0.1 }));
    const tiny = 0.45 + 0.55 * 0.1;
    expect(chipFontPx(tiny)).not.toBe(chipFontPx(1));
    expect(frame.named('fillText').find((k) => k.args[0] === chipGlyph(icons.BUILD_ICON[home.buildings[0]!.type]))?.font).toBe(`${chipFontPx(tiny)}px ${MONO}`);
    // Детализация ноль: чужой мир молчит, бейджей и рядов нет.
    frame.calls.length = 0;
    worlds.drawWorlds(0, LOD({ detail: 0 }));
    const R0 = 13 * 0.45;
    expect(call(frame.calls, 'fillText', name(next.id), at(node(next.id)).x + R0 + 12, at(node(next.id)).y - 1)).toBeUndefined();
    expect(call(frame.calls, 'fillText', name(home.id), c.x + R0 + 12, c.y - 1)?.alpha).toBeCloseTo(0.9);
    expect(frame.named('fillText').filter((k) => k.args[0] === icons.KIND_ICON.planet || k.font === `${chipFontPx(0.45)}px ${MONO}`)).toEqual([]);
    // Вторая строка выноски на нуле не пишется даже у своего.
    expect(frame.named('fillText').filter((k) => k.font === `10px ${MONO}`)).toEqual([]);
  });

  it('голографическая карта: бейджа типа нет, материал сектора несёт точку, мир — сферу', async () => {
    const { worlds, env, palette, frame, home, next, node, at, asSector, icons } = await boot();
    env.holographic = true;
    asSector(next.id, 'nebula');
    worlds.drawWorlds(0, LOD());
    expect(frame.named('fillText').some((k) => Object.values(icons.KIND_ICON).includes(k.args[0] as string))).toBe(false);
    const dot = arcAt(frame.calls, at(node(next.id)), 2.4)!;
    expect(dot.fill).toBe(rgba(palette.ownerColor(null), 0.7));
    const c = at(node(home.id));
    expect(frame.named('drawImage').find((k) => k.args.length === 9)?.args.slice(5)).toEqual([c.x - 13, c.y - 13, 26, 26]);
  });
});

describe('REFM-235 — схема и области', () => {
  it('схема: искусство узлов гаснет, имена своих миров остаются цветом владельца у кольца схемы', async () => {
    const { worlds, palette, frame, home, next, node, at, name } = await boot();
    worlds.drawWorlds(0, LOD({ art: 0, detail: 0 }));
    const c = at(node(home.id));
    expect(frame.named('fillText').map((k) => k.args)).toEqual([[name(home.id), c.x + 3 + 6, c.y - 1]]);
    const label = frame.named('fillText')[0]!;
    expect([label.fill, label.font, label.alpha]).toEqual([palette.ownerColor('p1'), `700 12px ${MONO}`, 1]);
    expect(frame.named('drawImage')).toEqual([]);
    // Наполовину погасшее искусство: имя схемы светит оставшейся долей.
    frame.calls.length = 0;
    worlds.drawWorlds(0, LOD({ art: 0.25, detail: 0 }));
    expect(call(frame.calls, 'fillText', name(home.id), c.x + 9, c.y - 1)?.alpha).toBeCloseTo(0.75);
    expect(call(frame.calls, 'fillText', name(next.id), at(node(next.id)).x + 9, at(node(next.id)).y - 1)).toBeUndefined();
    // Искусство гаснет на четверть — имя схемы светит на четверть, искусство узла — на три.
    frame.calls.length = 0;
    worlds.drawWorlds(0, LOD({ art: 0.75 }));
    expect(call(frame.calls, 'fillText', name(home.id), c.x + 9, c.y - 1)?.alpha).toBeCloseTo(0.25);
    expect(glowAt(frame.calls, c, 13 + 20)?.alpha).toBeCloseTo(0.13 * 0.75);
    // Полная детализация — подписи схемы нет.
    frame.calls.length = 0;
    worlds.drawWorlds(0, LOD());
    expect(call(frame.calls, 'fillText', name(home.id), c.x + 9, c.y - 1)).toBeUndefined();
  });

  it('имена областей проступают при отдалении и гаснут вблизи; карта без областей молчит', async () => {
    const { worlds, env, camera, frame, game, catalog } = await boot();
    worlds.drawWorlds(0, LOD({ art: 0, provinceDetail: 0.25 }));
    expect(frame.named('strokeText')).toEqual([]); // у Фронтира областей нет
    const { provingGroundState, mapRegions } = await import('../../packages/client/src/gameData');
    const { regionLabels } = await import('../../decisions/regionName');
    env.world = provingGroundState(game.data);
    env.nodes = catalog.mapNodesFromState(env.world) as MapNode[];
    camera.frameMap(env.nodes);
    camera.setView({ scale: 1, x: 0, y: 0 });
    const labels = regionLabels(env.world.mapId, mapRegions(env.world.mapId), (id) => env.world.planets[id]?.position)
      .filter((l) => camera.visible(camera.world(l), 240));
    expect(labels.length).toBeGreaterThan(0);
    frame.calls.length = 0;
    worlds.drawWorlds(0, LOD({ art: 0, provinceDetail: 0.25 }));
    for (const l of labels) {
      const c = camera.world(l);
      const text = l.text.toUpperCase();
      const halo = call(frame.calls, 'strokeText', text, c.x, c.y)!;
      expect([halo.stroke, halo.width, halo.alpha]).toEqual(['rgba(4,10,12,.85)', 4, 0.75]);
      const ink = call(frame.calls, 'fillText', text, c.x, c.y)!;
      expect([ink.fill, ink.font]).toEqual(['rgba(214,236,244,.92)', '600 15px ui-sans-serif, system-ui, sans-serif']);
    }
    expect(frame.named('strokeText')).toHaveLength(labels.length);
    // Имя области за экраном не пишется.
    frame.calls.length = 0;
    camera.setView({ scale: 1, x: 1e6, y: 1e6 });
    worlds.drawWorlds(0, LOD({ art: 0, provinceDetail: 0.25 }));
    expect(frame.named('strokeText')).toEqual([]);
    camera.setView({ scale: 1, x: 0, y: 0 });
    frame.calls.length = 0;
    worlds.drawWorlds(0, LOD({ art: 0, provinceDetail: 1 }));
    expect(frame.named('strokeText')).toEqual([]);
  });

  it('за экраном не рисуется ничего', async () => {
    const { worlds, camera, frame } = await boot();
    camera.setView({ scale: 1, x: 1e6, y: 1e6 });
    worlds.drawWorlds(0, LOD());
    worlds.drawWorlds(0, LOD({ art: 0.5, detail: 0 }));
    expect(frame.calls.filter((k) => !['save', 'restore'].includes(k.name))).toEqual([]);
  });
});

describe('REFM-235 — туман', () => {
  it('никогда не виденный — кольцо и «?» только вблизи; на схеме — кольцо схемы', async () => {
    const { worlds, env, fog, frame, node, at } = await boot();
    const dark = env.nodes.find((n) => !fog.known(n.id) && n.sector === 'planet' && !fog.memory.has(n.id))!;
    const c = at(node(dark.id));
    worlds.drawWorlds(0, LOD({ detail: 0.5 }));
    expect(arcAt(frame.calls, c, 3 + (6 - 3) * 0.5)?.stroke).toBe('rgba(125,161,176,0.5)');
    const mark = call(frame.calls, 'fillText', '?', c.x, c.y + 3)!;
    expect([mark.alpha, mark.fill]).toEqual([0.5, 'rgba(125,161,176,0.65)']);
    // Метка тумана — и всё: ни ауры, ни сферы, ни подписи мира.
    const ns = 0.45 + 0.55 * 0.5;
    expect(glowAt(frame.calls, c, 13 * ns + 20 * ns)).toBeUndefined();
    expect(frame.named('drawImage').some((k) => k.args.length === 9 && near(k.args[5] as number, c.x - 13 * ns))).toBe(false);
    frame.calls.length = 0;
    worlds.drawWorlds(0, LOD({ detail: 0, art: 0.5 }));
    const ring = arcAt(frame.calls, c, 3)!;
    expect([ring.stroke, ring.width]).toEqual(['#506773', 0.85]);
    expect(frame.named('fillText').some((k) => k.args[0] === '?')).toBe(false);
  });

  it('помнимый — пунктир цветом прежнего владельца, имя и последние данные: гарнизон, постройки, «старое»', async () => {
    const { worlds, env, fog, palette, frame, node, at, name, patchPlanet, t, icons } = await boot();
    const dark = env.nodes.find((n) => !fog.known(n.id) && n.sector === 'planet')!;
    patchPlanet(dark.id, { owner: 'p2', buildings: [{ type: 'mine', level: 1, hp: 20 }], garrison: [{ unit: 'militia', count: 5 }] });
    fog.rememberScan([dark.id]);
    // Мир с тех пор сменил хозяина — память этого не знает.
    patchPlanet(dark.id, { owner: null });
    const c = at(node(dark.id));
    const col = palette.ownerColor('p2');
    worlds.drawWorlds(0, LOD());
    const ring = arcAt(frame.calls, c, 9)!;
    expect([ring.stroke, ring.dash]).toEqual([rgba(col, 0.34), [2, 4]]);
    expect(arcAt(frame.calls, c, 1.6)?.fill).toBe(rgba(col, 0.4));
    expect(call(frame.calls, 'fillText', name(dark.id), c.x + 13, c.y - 1)?.fill).toBe(rgba(col, 0.5));
    const stats = [t('map.callout.garrison', { n: 5 }), icons.BUILD_ICON.mine, t('map.fog.old')].join(' ');
    expect(call(frame.calls, 'fillText', stats, c.x + 13, c.y + 10)?.font).toBe(`9px ${MONO}`);
    // Вполовину крупная карта — кольцо меньше, подпись бледнее.
    frame.calls.length = 0;
    worlds.drawWorlds(0, LOD({ detail: 0.5 }));
    expect(arcAt(frame.calls, c, 3 + (9 - 3) * 0.5)).toBeTruthy();
    expect(call(frame.calls, 'fillText', name(dark.id), c.x + 13, c.y - 1)?.alpha).toBeCloseTo(0.5);
  });
});

describe('REFM-235 — искусство секторов', () => {
  it('чёрная дыра и пустота — без подписи; поле астероидов — камни, ступица и подпись вида сектора', async () => {
    const { worlds, palette, frame, next, node, at, pulse, asSector, patchPlanet, name, tData, game, interaction } = await boot();
    const n = node(next.id);
    const c = at(n);
    asSector(next.id, 'black_hole');
    worlds.drawWorlds(0, LOD({ detail: 0.5 }));
    const half = 0.45 + 0.55 * 0.5;
    const hole = arcAt(frame.calls, c, 20 * half)!;
    expect([hole.fill, hole.stroke, hole.width]).toEqual(['#03030a', '#8764ce', 3]);
    expect(call(frame.calls, 'ellipse', c.x, c.y, 31 * half, 10 * half, -0.3)).toBeTruthy();
    expect(frame.named('fillText').some((k) => k.args[0] === name(next.id))).toBe(false);
    frame.calls.length = 0;
    asSector(next.id, 'empty');
    worlds.drawWorlds(0, LOD());
    const { VOID_COLOR } = await import('./sideColors');
    expect(call(frame.calls, 'moveTo', c.x + 1.5, c.y)?.stroke).toBe(rgba(VOID_COLOR, 0.5));
    expect(arcAt(frame.calls, c, 1)?.fill).toBe(rgba(VOID_COLOR, 0.6));
    expect(frame.named('fillText').some((k) => k.args[0] === name(next.id))).toBe(false);
    frame.calls.length = 0;
    asSector(next.id, 'asteroid');
    interaction.pickWorld(next.id);
    worlds.drawWorlds(9000, LOD());
    expect(bracketsAt(frame.calls, c, 15)).toBe(true);
    const col = palette.ownerColor(null);
    for (const rk of asteroidsFor(n.id, n.x, n.y)) {
      expect(call(frame.calls, 'translate', c.x + rk.dx, c.y + rk.dy)).toBeTruthy();
      expect(call(frame.calls, 'rotate', rk.rot + 1)).toBeTruthy();
    }
    expect(arcAt(frame.calls, c, 4.2)?.fill).toBe(rgba(col, 0.92));
    expect(arcAt(frame.calls, c, 7.5 + 0.6 * pulse(n, 9000))?.stroke).toBe(rgba(col, 0.75));
    expect(call(frame.calls, 'fillText', name(next.id), c.x + 16, c.y - 1)?.fill).toBe('rgba(150,190,196,0.5)');
    expect(call(frame.calls, 'fillText', tData(game.SECTOR_TYPES.asteroid!.name), c.x + 16, c.y + 11)).toBeTruthy();
    // У поля астероидов нет мира: ни ауры, ни подписи мира.
    expect(glowAt(frame.calls, c, 13 + 20)).toBeUndefined();
    // Своё плотное скопление — подпись цветом владельца, вид сектора — из данных.
    frame.calls.length = 0;
    asSector(next.id, 'asteroid_cluster');
    patchPlanet(next.id, { owner: 'p1' });
    worlds.drawWorlds(9000, LOD());
    expect(call(frame.calls, 'fillText', name(next.id), c.x + 16, c.y - 1)?.fill).toBe(rgba(palette.ownerColor('p1'), 0.72));
    expect(call(frame.calls, 'fillText', tData(game.SECTOR_TYPES.asteroid_cluster!.name), c.x + 16, c.y + 11)).toBeTruthy();
  });

  it('разлом, туманность, буря, вспышка, кладбище, мёртвый мир и незнакомый тип — каждый своим знаком', async () => {
    const { worlds, palette, frame, next, node, at, pulse, asSector, game, t } = await boot();
    const n = node(next.id);
    const c = at(n);
    const R = 13;
    const p = pulse(n, 0);
    const kc = (sector: string) => game.SECTOR_TYPES[sector]!.color;
    const draw = (sector: string) => {
      frame.calls.length = 0;
      asSector(next.id, sector);
      worlds.drawWorlds(0, LOD());
    };
    draw('rift');
    for (const side of [-1, 1]) expect(call(frame.calls, 'moveTo', c.x - R * 0.3 + side * 2, c.y - R)?.stroke).toBe('#c7a0ed');
    draw('nebula');
    expect(call(frame.calls, 'moveTo', c.x, c.y - R * 0.85)?.fill).toBe(rgba(kc('nebula'), 0.12 + 0.08 * p));
    expect(call(frame.calls, 'moveTo', c.x, c.y - R * 0.85 * 0.55)?.stroke).toBe(rgba(kc('nebula'), 0.3));
    expect(arcAt(frame.calls, c, 2)?.fill).toBe(rgba(kc('nebula'), 0.7 + 0.3 * p));
    // Не мир — подпись приглушена, а вторая строка есть, пока в секторе стоит гарнизон.
    const g = next.garrison.reduce((a, st) => a + st.count, 0);
    const stats = call(frame.calls, 'fillText', t('map.callout.garrison', { n: g }), c.x + R + 12, c.y + 11)!;
    expect([stats.fill, stats.font]).toEqual([rgba('#96d2cd', 0.42), `9px ${MONO}`]);
    draw('dense_nebula');
    expect(call(frame.calls, 'moveTo', c.x, c.y - R * 0.85)?.stroke).toBe(rgba(kc('dense_nebula'), 0.7));
    for (const [sector, spikes] of [['ion_storm', 5], ['solar_flare', 8]] as const) {
      draw(sector);
      const tip = call(frame.calls, 'moveTo', c.x, c.y - R * 0.9)!;
      expect(tip.fill).toBe(rgba(kc(sector), 0.1 + 0.06 * p));
      const i = frame.calls.indexOf(tip);
      const rest = frame.calls.slice(i + 1, frame.calls.findIndex((k, j) => j > i && k.name === 'closePath'));
      expect(rest.filter((k) => k.name === 'lineTo')).toHaveLength(spikes * 2 - 1);
      const inner = rest[0]!;
      const a = (1 / (spikes * 2)) * Math.PI * 2 - Math.PI / 2;
      expect(inner.args).toEqual([c.x + Math.cos(a) * R * 0.4, c.y + Math.sin(a) * R * 0.4]);
      expect(arcAt(frame.calls, c, 2)?.fill).toBe(rgba(kc(sector), 0.7 + 0.3 * p));
    }
    draw('graveyard');
    expect(arcAt(frame.calls, c, 3)?.fill).toBe(rgba(kc('graveyard'), 0.5 + 0.2 * p));
    expect(arcAt(frame.calls, c, 7)?.stroke).toBe(rgba(kc('graveyard'), 0.4));
    expect(call(frame.calls, 'moveTo', c.x + 5, c.y)?.stroke).toBe(rgba(kc('graveyard'), 0.5));
    const r0 = 5 + 2 * Math.sin(0.7 * 3.7);
    expect(call(frame.calls, 'moveTo', c.x + Math.cos(0.7) * r0, c.y + Math.sin(0.7) * r0)).toBeTruthy();
    draw('dead_world');
    const rim = arcAt(frame.calls, c, R * 0.8)!;
    expect([rim.stroke, rim.dash]).toEqual([rgba(kc('dead_world'), 0.6), [4, 4]]);
    expect(call(frame.calls, 'moveTo', c.x - R * 0.45, c.y - R * 0.45)?.stroke).toBe(rgba(kc('dead_world'), 0.45));
    expect(arcAt(frame.calls, c, 2)?.fill).toBe(rgba(kc('dead_world'), 0.5 + 0.2 * p));
    draw('wormhole');
    const hex = polyPoints(c.x, c.y, R * 0.7, 6, Math.PI / 6);
    // Незнакомого типа в данных нет — знак красится цветом владельца.
    expect(call(frame.calls, 'moveTo', hex[0]!.x, hex[0]!.y)?.fill).toBe(rgba(palette.ownerColor(null), 0.08));
    expect(arcAt(frame.calls, c, 2)?.fill).toBe(rgba(palette.ownerColor(null), 0.5 + 0.2 * p));
  });

  it('станция: каркас и корпус с полосой ядра; корпус не ложится второй раз, если его рисует юнит крепости', async () => {
    const { worlds, palette, frame, next, node, at, asSector, patchPlanet, game, env, geo } = await boot();
    const c = at(node(next.id));
    const R = 13;
    const col = palette.ownerColor('p1');
    const full = game.hpOfLevel('starfort', 1);
    asSector(next.id, 'void_station');
    patchPlanet(next.id, { owner: 'p1', buildings: [{ type: 'starfort', level: 1, hp: full * 0.3 }] });
    worlds.drawWorlds(0, LOD());
    for (const dy of [-3, 3]) expect(call(frame.calls, 'ellipse', c.x, c.y + dy, R, R * 0.45)?.stroke).toBe(rgba(col, 0.7));
    expect(call(frame.calls, 'translate', c.x - 12, c.y - 12)).toBeTruthy();
    expect(call(frame.calls, 'fillRect', c.x - 12, c.y - 22, 24, 3)?.fill).toBe('rgba(2,9,13,.7)');
    // Ядро ниже трети — полоса красная.
    expect(call(frame.calls, 'fillRect', c.x - 12, c.y - 22, 24 * 0.3, 3)?.fill).toBe(rgba('#ff5a4d', 0.9));
    frame.calls.length = 0;
    patchPlanet(next.id, { buildings: [{ type: 'starfort', level: 1, hp: full * 0.8 }] });
    const guns = { id: 'fg', owner: 'p1', location: next.id, units: [{ unit: 'fortress_guns', count: 1 }] } as Fleet;
    env.world = { ...env.world, fleets: { ...env.world.fleets, fg: guns } };
    expect(Math.hypot(geo.fleetAnchor(guns)!.x - c.x, geo.fleetAnchor(guns)!.y - c.y)).toBeLessThan(4);
    worlds.drawWorlds(0, LOD());
    expect(call(frame.calls, 'translate', c.x - 12, c.y - 12)).toBeUndefined();
    expect(call(frame.calls, 'fillRect', c.x - 12, c.y - 22, 24 * 0.8, 3)?.fill).toBe(rgba(col, 0.9));
    // Каркас — по масштабу узла.
    frame.calls.length = 0;
    worlds.drawWorlds(0, LOD({ detail: 0.5 }));
    const ns = 0.45 + 0.55 * 0.5;
    for (const dy of [-3, 3]) expect(call(frame.calls, 'ellipse', c.x, c.y + dy * ns, R * ns, R * ns * 0.45)).toBeTruthy();
  });
});

describe('REFM-235 — крепости на развилках', () => {
  it('своя — силуэтом поменьше; чужая неопознанная — нет; выбранная площадка и развилка — в уголках', async () => {
    const { worlds, palette, frame, home, env, at, interaction, game } = await boot();
    const { forkSiteId } = await import('../../packages/shared-core/src/index');
    const { roadDrawingOf } = await import('./mapLayer');
    const R = 13;
    const site = (owner: string, dx: number): Planet => ({
      ...home,
      id: forkSiteId(home.id, dx),
      owner,
      fork: { province: home.id, trail: dx },
      position: { x: home.position.x + dx * 40, y: home.position.y + 60 },
      buildings: [{ type: 'starfort', level: 1, hp: game.hpOfLevel('starfort', 1) }],
    }) as Planet;
    const mine = site('p1', 1);
    const foe = site('p2', 2);
    env.world = { ...env.world, planets: { ...env.world.planets, [mine.id]: mine, [foe.id]: foe } };
    // Развилка с соседкой на той же провинции: рамка встаёт у своей тропы, а не у первой.
    const marks = roadDrawingOf(env.world).marks;
    const mark = marks.find((m, i) => marks.findIndex((o) => o.province === m.province) !== i)!;
    expect(mark).toBeTruthy();
    interaction.pickWorld(mine.id);
    worlds.drawWorlds(0, LOD());
    const c = at(mine.position);
    expect(call(frame.calls, 'ellipse', c.x, c.y - 3, R * 0.7, R * 0.7 * 0.45)?.stroke).toBe(rgba(palette.ownerColor('p1'), 0.7));
    expect(bracketsAt(frame.calls, c, R)).toBe(true);
    const f = at(foe.position);
    expect(call(frame.calls, 'ellipse', f.x, f.y - 3, R * 0.7, R * 0.7 * 0.45)).toBeUndefined();
    // Развилка без крепости — рамкой у её ромба.
    frame.calls.length = 0;
    interaction.pickFork({ province: mark.province, trail: mark.trail });
    worlds.drawWorlds(0, LOD());
    expect(bracketsAt(frame.calls, at(mark.at), 10)).toBe(true);
    const first = marks.find((m) => m.province === mark.province)!;
    expect(bracketsAt(frame.calls, at(first.at), 10)).toBe(false);
    // Искусства нет вовсе — нет и крепостей.
    frame.calls.length = 0;
    worlds.drawWorlds(0, LOD({ art: 0, detail: 0 }));
    expect(frame.named('ellipse')).toEqual([]);
    expect(frame.named('translate')).toEqual([]);
  });
});

describe('REFM-235 — стык миров с main.ts', () => {
  const MAIN = readFileSync(new URL('./main.ts', import.meta.url), 'utf8');
  const SRC = readFileSync(new URL('./mapWorlds.ts', import.meta.url), 'utf8');
  const init = /initMapWorlds\(\{([\s\S]*?)\n\}\);/.exec(MAIN)?.[1] ?? '';

  it('хуки — мир, место, узлы, кадр, часы и вид голограммы, тип сектора', () => {
    for (const hook of [
      'world: () => s,',
      'me: () => ME,',
      'nodes: () => MAP,',
      'ctx: () => cx,',
      'clock: () => hologramTime,',
      'holographic: holographicMapOn,',
      'sectorType: sectorTypeOf,',
    ])
      expect(init, hook).toContain(hook);
  });

  it('миры живут только в модуле; кадр зовёт их между дальномером радара и орбитами флотов', () => {
    expect(MAIN).not.toMatch(/\bfunction (poly|drawFogMarker|drawRegionLabels)\(/);
    expect(MAIN).not.toMatch(/\bconst (drawStationArt|fortressUnits)\b/);
    const range = MAIN.indexOf('drawRadarRange(now);');
    const worlds = MAIN.indexOf('drawWorlds(now, lod);');
    const orbits = MAIN.indexOf('const stationed: Record<string, Fleet[]> = {};');
    expect(range).toBeGreaterThan(-1);
    expect(worlds).toBeGreaterThan(range);
    expect(orbits).toBeGreaterThan(worlds);
  });

  it('модуль не тянет `main.ts`', () => {
    expect(SRC).not.toMatch(/from '\.\/main'/);
  });
});
