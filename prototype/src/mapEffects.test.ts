/**
 * Вспышки и залпы карты (REFM-234) — прямой тест владельца на живом мире прототипа.
 *
 * Жизнь, затухание и радиусы — `flashFx.ts`, вид залпа по тиру — `flakTiers.ts`, у них свои
 * тесты. Здесь — то, что собирается только вместе: дверь ставит вспышку в очередь, кадр
 * рисует её в той точке экрана, где стоит её мир, своим цветом и размером на своём отрезке
 * жизни, а погасшую снимает. Холст поддельный и записывает вызовы вместе с цветом и шириной
 * линии в момент вызова; мир, камера и палитра — настоящие. Часы `performance.now` и клетку
 * провинции из выпечки слоя карты подставляет тест. Каждый тест — свежая загрузка модулей.
 */
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';

import type { GameState } from '../../packages/shared-core/src/index';
import { rgba } from '../../packages/client/src/holoDraw';
import { toBake } from '../../decisions/mapLayerView';
import { AA_SHOTS_MAX } from './fireEffects';
import { FLAK_LIFE_MS, flakBurstRadius, flakDashOffset, flakLook, type FlakTier } from './flakTiers';
import { fadeOf, growRadius, noticeRing, waveRadius } from './flashFx';

interface Call {
  name: string;
  args: unknown[];
  stroke: unknown;
  fill: unknown;
  width: unknown;
}

/** Холст, чей контекст записывает каждый вызов с цветом и шириной линии в момент вызова. */
function fakeCanvas() {
  const calls: Call[] = [];
  const props: Record<string, unknown> = { globalAlpha: 1, lineWidth: 1, strokeStyle: '#000', fillStyle: '#000' };
  const ctx = new Proxy(props, {
    get(target, name) {
      if (typeof name !== 'string') return undefined;
      if (name in target) return target[name];
      return (...args: unknown[]) => {
        calls.push({ name, args, stroke: target.strokeStyle, fill: target.fillStyle, width: target.lineWidth });
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
  await import('./mapCamera');
  await import('./game');
  vi.unstubAllGlobals();
}, 60_000);
beforeEach(() => {
  vi.resetModules();
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

type XY = { x: number; y: number };

/** Клетка провинции в координатах выпечки: квадрат со стороной 100 у центра мира. */
const square = (c: XY): Array<[number, number]> => [
  [c.x - 50, c.y - 50],
  [c.x + 50, c.y - 50],
  [c.x + 50, c.y + 50],
  [c.x - 50, c.y + 50],
];

async function boot() {
  vi.stubGlobal('__PLAYER_BUILD__', false);
  const game = await import('./game');
  const world: GameState = game.newGame({
    seats: [
      { id: 'p1', name: 'A', faction: 'azure', start: game.START_CANDIDATES[0]!, ai: false },
      { id: 'p2', name: 'B', faction: 'crimson', start: game.START_CANDIDATES[1]!, ai: false },
    ],
  });
  const env = { world, now: 10_000, polys: {} as Record<string, Array<[number, number]>> };
  vi.spyOn(performance, 'now').mockImplementation(() => env.now);
  // Сдвиг и масштаб выпечки берутся у слоя карты: здесь — нарочно не единичные.
  const view = { k: 2, tx: 30, ty: -40 };
  vi.doMock('./mapLayer', () => ({
    mapView: view,
    provincePolygon: (id: string) => env.polys[id],
  }));
  const frame = fakeCanvas();
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
  const palette = await import('./mapPalette');
  palette.initMapPalette({ world: () => env.world, me: () => 'p1', ctx: () => frame.ctx, dpr: () => 1 } as never);
  const fx = await import('./mapEffects');
  fx.initMapEffects({ world: () => env.world, ctx: () => frame.ctx });
  const home = Object.values(world.planets).find((p) => p.owner === 'p1')!;
  const next = world.planets[home.links![0]!]!;
  /** Экранная точка мира. */
  const at = (p: XY) => camera.world(p);
  return { fx, camera, palette, env, frame, view, home, next, at };
}

/** Есть ли дуга радиуса `r` с центром в `c` (с точностью до 1e-6). */
const arcAt = (calls: Call[], c: XY, r: number) =>
  calls.some(
    (k) =>
      k.name === 'arc' &&
      Math.abs((k.args[0] as number) - c.x) < 1e-6 &&
      Math.abs((k.args[1] as number) - c.y) < 1e-6 &&
      Math.abs((k.args[2] as number) - r) < 1e-6,
  );

const FAR = { x: 1e7, y: 1e7 };

describe('REFM-234 — залпы огня', () => {
  it('залп: трасса от источника к цели видом своего тира и вспышка у цели; погасший уходит из очереди', async () => {
    const { fx, env, frame, home, next, at } = await boot();
    for (const tier of ['orbital', 'close', 'intercept', 'pointDefense', 'strike'] as FlakTier[]) {
      frame.calls.length = 0;
      fx.addFlak({ from: { ...home.position }, to: { ...next.position }, at: env.now, tier });
      env.now += FLAK_LIFE_MS / 2; // середина жизни
      fx.drawFlak();
      const look = flakLook(tier);
      const fade = fadeOf(0.5);
      expect(frame.named('moveTo')[0]!.args).toEqual([at(home.position).x, at(home.position).y]);
      expect(frame.named('lineTo')[0]!.args).toEqual([at(next.position).x, at(next.position).y]);
      const stroke = frame.named('stroke')[0]!;
      expect([stroke.stroke, stroke.width]).toEqual([rgba(look.color, look.alpha * fade), look.width]);
      expect(frame.named('setLineDash')[0]!.args).toEqual([[...look.dash]]);
      expect(frame.props.lineDashOffset).toBe(flakDashOffset(FLAK_LIFE_MS / 2));
      expect(arcAt(frame.calls, at(next.position), flakBurstRadius(look, 0.5))).toBe(true);
      expect(frame.named('fill')[0]!.fill).toBe(rgba(look.burstColor, 0.8 * fade));
      // Отгорел — снят и больше не рисуется.
      env.now += FLAK_LIFE_MS / 2;
      frame.calls.length = 0;
      fx.drawFlak();
      expect(fx.aaShots).toHaveLength(0);
      expect(frame.named('stroke')).toHaveLength(0);
    }
  });

  it('залп целиком за экраном не рисуется, но живёт до конца; виден хоть один конец — рисуется', async () => {
    const { fx, env, frame, home } = await boot();
    fx.addFlak({ from: FAR, to: FAR, at: env.now, tier: 'orbital' });
    fx.drawFlak();
    expect(frame.named('stroke')).toHaveLength(0);
    expect(fx.aaShots).toHaveLength(1);
    fx.addFlak({ from: FAR, to: { ...home.position }, at: env.now, tier: 'orbital' });
    fx.drawFlak();
    expect(frame.named('stroke')).toHaveLength(1);
  });

  it('очередь залпов ограничена — старые уходят первыми; смена партии её очищает', async () => {
    const { fx, home } = await boot();
    for (let i = 0; i < AA_SHOTS_MAX + 3; i++) fx.addFlak({ from: home.position, to: home.position, at: i, tier: 'close' });
    expect(fx.aaShots).toHaveLength(AA_SHOTS_MAX);
    expect(fx.aaShots[0]!.at).toBe(3);
    fx.clearFlak();
    expect(fx.aaShots).toHaveLength(0);
  });
});

describe('REFM-234 — вспышки на карте', () => {
  it('захват: клетка заливается цветом нового хозяина, волна идёт из центра мира в выпечке и гаснет', async () => {
    const { fx, env, frame, view, palette, next, at } = await boot();
    const c = toBake(view, at(next.position).x, at(next.position).y);
    env.polys[next.id] = square(c);
    fx.flashProvince(next.id, 'p2');
    env.now += 750; // середина жизни волны (1,5 с)
    fx.drawCaptureFlashes(env.now);
    const col = palette.ownerColor('p2');
    const fade = fadeOf(0.5);
    expect(frame.named('fill')[0]!.fill).toBe(rgba(col, 0.3 * fade));
    expect(frame.named('clip')).toHaveLength(1);
    expect(arcAt(frame.calls, c, waveRadius(0.5, Math.hypot(50, 50), 1.25))).toBe(true);
    expect(frame.named('stroke').map((k) => k.stroke)).toEqual([rgba(col, 0.85 * fade), rgba(col, 0.9 * fade)]);
    // Повторный захват начинает волну заново: та же середина жизни — с нового момента.
    fx.flashProvince(next.id, 'p1');
    env.now += 750;
    frame.calls.length = 0;
    fx.drawCaptureFlashes(env.now);
    expect(frame.named('fill')[0]!.fill).toBe(rgba(palette.ownerColor('p1'), 0.3 * fade));
    // Отгорела — снята.
    env.now += 750;
    frame.calls.length = 0;
    fx.drawCaptureFlashes(env.now);
    expect(fx.captureFlashes.size).toBe(0);
    expect(frame.calls).toHaveLength(0);
  });

  it('захват без клетки в выпечке не рисуется и не теряется', async () => {
    const { fx, env, frame, next } = await boot();
    fx.flashProvince(next.id, 'p2');
    fx.drawCaptureFlashes(env.now);
    expect(frame.calls).toHaveLength(0);
    expect(fx.captureFlashes.has(next.id)).toBe(true);
  });

  it('мины: кольцо у узла или у точки на дороге, растёт и гаснет; за экраном — не рисуется', async () => {
    const { fx, env, frame, home, next, at } = await boot();
    fx.flashMines(next.id, undefined);
    const road = { x: (home.position.x + next.position.x) / 2, y: (home.position.y + next.position.y) / 2 };
    fx.flashMines(home.id, road);
    fx.flashMines('nowhere', FAR);
    env.now += 600; // середина жизни (1,2 с)
    fx.drawMineFlashes(env.now);
    const r = waveRadius(0.5, 60, 1);
    expect(arcAt(frame.calls, at(next.position), r)).toBe(true);
    expect(arcAt(frame.calls, at(road), r)).toBe(true);
    expect(frame.named('arc')).toHaveLength(2);
    expect(frame.named('stroke').every((k) => k.stroke === `rgba(255,179,71,${0.9 * fadeOf(0.5)})` && k.width === 3)).toBe(true);
    env.now += 600;
    fx.drawMineFlashes(env.now);
    expect(fx.mineFlashes.size).toBe(0);
  });

  it('переход по ссылке плана: пунктирное кольцо над миром сжимается к нему и гаснет', async () => {
    const { fx, env, frame, palette, next, at } = await boot();
    fx.drawGoFlash(env.now);
    expect(frame.calls).toHaveLength(0);
    fx.flashGo(next.id);
    env.now += 400; // четверть жизни (1,6 с)
    fx.drawGoFlash(env.now);
    const k = fadeOf(0.25);
    expect(arcAt(frame.calls, at(next.position), growRadius(14, 10, 1 - k))).toBe(true);
    expect(frame.named('setLineDash')[0]!.args).toEqual([[4, 4]]);
    expect(frame.named('stroke')[0]!.stroke).toBe(rgba(palette.LOCK, 0.25 + 0.55 * k));
    env.now += 1200;
    fx.drawGoFlash(env.now);
    expect(fx.goFlash).toBeNull();
  });

  it('малая вспышка: точка копируется, кольцо растёт и гаснет за 200 мс; пустая точка не ставится; очередь — 16', async () => {
    const { fx, env, frame, palette, home, at } = await boot();
    fx.noticeFlash(null);
    fx.noticeFlash(undefined);
    expect(fx.noticeFlashes).toHaveLength(0);
    const p = { ...home.position };
    fx.noticeFlash(p);
    p.x += 500; // источник двигается — вспышка стоит, где встала
    env.now += 100;
    fx.drawNoticeFlashes(env.now);
    const ring = noticeRing(0.5, true, 12, 10);
    expect(arcAt(frame.calls, at(home.position), ring.r)).toBe(true);
    expect(frame.named('stroke')[0]!.stroke).toBe(rgba(palette.LOCK, 0.9 * ring.alpha));
    env.now += 100;
    fx.drawNoticeFlashes(env.now);
    expect(fx.noticeFlashes).toHaveLength(0);
    // За экраном — не рисуется.
    frame.calls.length = 0;
    fx.noticeFlash(FAR);
    fx.drawNoticeFlashes(env.now);
    expect(frame.calls).toHaveLength(0);
    fx.noticeFlashes.length = 0;
    for (let i = 0; i < 20; i++) fx.noticeFlash({ x: i, y: 0 });
    expect(fx.noticeFlashes).toHaveLength(16);
    expect(fx.noticeFlashes[0]!.at.x).toBe(4);
  });
});

describe('REFM-234 — стык вспышек с main.ts', () => {
  const MAIN = readFileSync(new URL('./main.ts', import.meta.url), 'utf8');
  const SRC = readFileSync(new URL('./mapEffects.ts', import.meta.url), 'utf8');
  const init = /initMapEffects\(\{([\s\S]*?)\n\}\);/.exec(MAIN)?.[1] ?? '';

  it('хуки — мир и кадр', () => {
    for (const hook of ['world: () => s,', 'ctx: () => cx,']) expect(init, hook).toContain(hook);
  });

  it('очереди вспышек живут только в модуле: события и смена партии пишут их дверями', () => {
    expect(MAIN).not.toMatch(/\b(aaShots|captureFlashes|mineFlashes|goFlash|noticeFlashes)\b/);
    expect(MAIN).not.toMatch(/\bfunction (drawFlak|drawCaptureFlashes|drawMineFlashes|drawGoFlash|drawNoticeFlashes|noticeFlash)\(/);
    // Четыре тира огня из событий: ПКО, перехват, корабельное ПВО, удар шаттлов.
    expect(MAIN.match(/\baddFlak\(\{/g)).toHaveLength(4);
    // Захват — событие и предпросмотр волны в инструментах разработчика.
    expect(MAIN.match(/\bflashProvince\(/g)).toHaveLength(2);
    expect(MAIN).toContain('flashMines(at, p.position as { x: number; y: number } | undefined);');
    expect(MAIN).toMatch(/battleLosses\.clear\(\);\s*clearFlak\(\);/);
    expect(MAIN).toContain('ring: flashGo,');
  });

  it('кадр зовёт рисовалки модуля', () => {
    for (const call of [
      'drawCaptureFlashes(now);',
      'drawGoFlash(now);',
      'drawNoticeFlashes(now);',
      'drawFlak();',
      'drawMineFlashes(now);',
    ])
      expect(MAIN, call).toContain(call);
  });

  it('модуль не тянет `main.ts`, робот телефона считает вспышки у модуля', () => {
    expect(SRC).not.toMatch(/from '\.\/main'/);
    const robot = readFileSync(new URL('../mobiletest.mjs', import.meta.url), 'utf8');
    expect(robot).toContain("import { noticeFlashes as __noticeFlashes } from './mapEffects';");
  });
});
