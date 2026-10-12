/**
 * Метки карты (REFM-234) — прямой тест владельца на живом мире прототипа.
 *
 * Что метить, решают чистые модели (`missionRing.ts`, `devourSiege.ts`, `pingPulse.ts`,
 * `chainBadges.ts`, `chainPathLayout.ts` и соседи), и у них свои тесты. Здесь — то, что
 * собирается только вместе: мир, туман, камера и режим «Приказ» дают холсту ровно те кольца,
 * знаки, булавки и линии, что обещает метка, своим цветом и в той точке экрана, где стоит её
 * мир или флот, а тапу — хитбоксы ровно там, где нарисовано. Холст поддельный и записывает
 * вызовы вместе с цветом и шириной линии в момент вызова; мир, туман, камера, геометрия
 * флотов и композер «Приказ» — настоящие. Признак забега и вид панели союзника подставляет
 * тест: их пишут забег и сценарий главы, у которых свои тесты. Каждый тест — свежая
 * загрузка модулей.
 */
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';

import type { Fleet, GameState } from '../../packages/shared-core/src/index';
import { rgba } from '../../packages/client/src/holoDraw';
import { countdownHMS } from './format';
import { isEmplacementFleet } from '../../decisions/emplacement';
import { missionRingFrame, missionRingPhase, RING_R, RING_W } from '../../decisions/missionRing';
import { orbitSeats } from '../../decisions/orbitSeats';
import { BADGE_DY, badgePulse } from './chainBadges';
import { capsuleAt } from './chainPathLayout';
import { pinPulse, pingPhase } from './pingPulse';

interface Call {
  name: string;
  args: unknown[];
  stroke: unknown;
  fill: unknown;
  width: unknown;
  alpha: unknown;
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
        calls.push({
          name,
          args,
          stroke: target.strokeStyle,
          fill: target.fillStyle,
          width: target.lineWidth,
          alpha: target.globalAlpha,
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
  await import('./chainComposer');
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

async function boot() {
  vi.stubGlobal('__PLAYER_BUILD__', false); // туман читает профиль сборки
  vi.stubGlobal('Path2D', class {}); // корпуса кораблей — пути холста
  // Композер «Приказ» вешает меню точки на страницу: здесь страницы нет.
  vi.stubGlobal('document', { getElementById: () => null, body: { classList: { remove() {}, add() {} } } });
  const game = await import('./game');
  const world: GameState = game.newGame({
    seats: [
      { id: 'p1', name: 'A', faction: 'azure', start: game.START_CANDIDATES[0]!, ai: false },
      { id: 'p2', name: 'B', faction: 'crimson', start: game.START_CANDIDATES[1]!, ai: false },
    ],
  });
  const env = {
    world,
    run: true,
    clock: 1234,
    holographic: false,
    ownPings: true,
    pings: [] as Array<{ from: string; ping: string }>,
    rows: [] as Array<{ targets: string[] }>,
    chain: null as Array<{ active: boolean; target?: string }> | null,
    ally: null as unknown,
  };
  // Признак забега пишет забег, вид панели союзника — сценарий главы: здесь их ставит тест.
  vi.doMock('./sectorRun', () => ({
    get sectorRunActive() {
      return env.run;
    },
  }));
  vi.doMock('../../decisions/allyPanel', () => ({ allyPanelView: () => env.ally }));
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
    lod: () => ({ scale: 1, art: 1, detail: 1, provinceDetail: 1, markerRadius: 3 }),
    forkMarks: () => [],
    orbits: () => orbitSeats(Object.values(env.world.fleets), (g) => isEmplacementFleet(g, game.data)),
  });
  const palette = await import('./mapPalette');
  palette.initMapPalette({ world: () => env.world, me: () => 'p1', ctx: () => frame.ctx, dpr: () => 1 } as never);
  const composer = await import('./chainComposer');
  composer.initChainComposer({
    world: () => env.world,
    me: () => 'p1',
    note: () => {},
    nodes: () => nodes,
    capturable: () => true,
    touchTap: () => false,
    screenPoint: (p) => p,
    invalidateCmdBar: () => {},
    invalidatePanel: () => {},
  });
  const marks = await import('./mapMarks');
  marks.initMapMarks({
    world: () => env.world,
    me: () => 'p1',
    ctx: () => frame.ctx,
    clock: () => env.clock,
    holographic: () => env.holographic,
    ownPings: () => env.ownPings,
    pings: () => env.pings as never,
    missionRows: () => env.rows as never,
    chain: () => env.chain as never,
  });
  const prefs = await import('./graphicsPrefs');
  const sides = await import('./sideColors');
  const { t } = await import('../../localization/runtime');
  const home = Object.values(world.planets).find((p) => p.owner === 'p1')!;
  const next = world.planets[home.links![0]!]!;
  const own = Object.values(world.fleets).find((f) => f.owner === 'p1' && f.location === home.id)!;
  /** Экранная точка мира. */
  const at = (p: XY) => camera.world(p);
  /** Поставить флот в мир и обновить обзор. */
  const put = (f: Fleet) => {
    env.world = { ...env.world, fleets: { ...env.world.fleets, [f.id]: f } };
    fog.refreshVision();
    return env.world.fleets[f.id]!;
  };
  /** Изменить мир (поля, которых нет в типе, — тоже). */
  const patch = (extra: Record<string, unknown>) => {
    env.world = { ...env.world, ...extra } as GameState;
  };
  return { marks, camera, fog, geo, palette, composer, prefs, sides, t, env, frame, home, next, own, at, put, patch };
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

/** Отряд одного вида у мира. */
const squad = (id: string, owner: string, location: string, unit: string, count = 1): Fleet =>
  ({ id, owner, location, units: [{ unit, count }] }) as Fleet;

describe('REFM-234 — метки забега', () => {
  it('цели задач: мятное кольцо и флажок у каждого мира задач и шага цепочки главы — по разу; вне забега — ничего', async () => {
    const { marks, prefs, camera, env, frame, home, next, at } = await boot();
    env.rows = [{ targets: [next.id, 'nowhere'] }, { targets: [next.id] }];
    env.chain = [
      { active: false, target: next.id },
      { active: true, target: home.id },
    ];
    marks.drawMissionTargets();
    for (const p of [home, next]) {
      const { breath, waves } = missionRingFrame(env.clock, prefs.motionOn(), missionRingPhase(p.position));
      const ring = frame.calls.find((k) => k.name === 'arc' && arcAt([k], at(p.position), RING_R))!;
      expect([ring.width]).toEqual([RING_W]);
      for (const w of waves) expect(arcAt(frame.calls, at(p.position), w.r)).toBe(true);
      expect(frame.named('stroke').some((k) => k.stroke === `rgba(143,245,200,${0.55 + 0.35 * breath})`)).toBe(true);
      // Флажок: древко от мира вверх-вправо.
      const c = at(p.position);
      expect(frame.named('moveTo').some((k) => k.args[0] === c.x + 17 && k.args[1] === c.y - 34 + 20)).toBe(true);
    }
    expect(frame.named('fill').every((k) => k.fill === '#8ff5c8')).toBe(true);
    expect(frame.named('fill')).toHaveLength(2);
    // Нет задач и шага — нечего метить; вне забега — тоже.
    frame.calls.length = 0;
    env.rows = [];
    env.chain = null;
    marks.drawMissionTargets();
    expect(frame.calls).toHaveLength(0);
    env.rows = [{ targets: [next.id] }];
    // Мир за экраном — метки нет.
    camera.setView({ scale: 1, x: 1e6, y: 1e6 });
    marks.drawMissionTargets();
    expect(frame.named('arc')).toHaveLength(0);
    camera.setView({ scale: 1, x: 0, y: 0 });
    frame.calls.length = 0;
    env.run = false;
    marks.drawMissionTargets();
    expect(frame.calls).toHaveLength(0);
  });

  it('союзник: пунктирное кольцо и эмблема у цели его операции, приглушённое у своей; знак ◈ над носителем, пока груз в пути', async () => {
    const { marks, sides, geo, env, frame, own, next, at, patch } = await boot();
    const { ALLY_EMBLEM } = await import('./allyScreen');
    env.ally = { op: { source: 'order', planet: next.id } };
    marks.drawAllyMarks();
    const c = at(next.position);
    expect(arcAt(frame.calls, c, RING_R + 6)).toBe(true);
    expect(frame.named('stroke')[0]!.stroke).toBe(sides.COLOR.ally);
    expect(frame.named('setLineDash')[0]!.args).toEqual([[4, 4]]);
    expect(frame.named('fillText')[0]!.args).toEqual([ALLY_EMBLEM, c.x - RING_R - 4, c.y - RING_R - 2]);
    // Своя операция союзника — тот же знак, приглушённым кольцом.
    frame.calls.length = 0;
    env.ally = { op: { source: 'own', planet: next.id } };
    marks.drawAllyMarks();
    expect(frame.named('stroke')[0]!.stroke).toBe('rgba(74,140,255,.45)');
    // Цель-флот — мир, где он стоит.
    frame.calls.length = 0;
    env.ally = { op: { source: 'order', fleet: own.id } };
    marks.drawAllyMarks();
    expect(arcAt(frame.calls, at(env.world.planets[own.location!]!.position), RING_R + 6)).toBe(true);
    // Носитель накопителя: ◈, пока груз не доставлен; пленного — пока не доставлен и не потерян.
    env.ally = null;
    const carrierMarks = () => frame.named('fillText').filter((k) => k.args[0] === '◈');
    for (const [extra, shown] of [
      [{ extraction: { carrier: own.id } }, 1],
      [{ extraction: { carrier: own.id, deliveredAt: 1 } }, 0],
      [{ extraction: undefined, captive: { carrier: own.id } }, 1],
      [{ captive: { carrier: own.id, lostAt: 1 } }, 0],
      [{ captive: { carrier: own.id, deliveredAt: 1 } }, 0],
    ] as const) {
      frame.calls.length = 0;
      patch(extra);
      marks.drawAllyMarks();
      expect(carrierMarks(), JSON.stringify(extra)).toHaveLength(shown);
      if (shown) {
        // Знак — над значком носителя на кольце орбиты: `fleetAnchor` уже экранная точка.
        const anchor = geo.fleetAnchor(own)!;
        expect(carrierMarks()[0]!.args).toEqual(['◈', anchor.x, anchor.y - 20]);
        expect(carrierMarks()[0]!.fill).toBe('#ffb43a');
      }
    }
    // Вне забега — ничего.
    frame.calls.length = 0;
    env.run = false;
    patch({ extraction: { carrier: own.id } });
    marks.drawAllyMarks();
    expect(frame.named('fillText')).toHaveLength(0);
  });

  it('осада «Поглощения»: дуга-часы тает к гибели мира, отсчёт на плашке; чужая осада — не моя метка', async () => {
    const { marks, palette, env, frame, home, at, patch } = await boot();
    const t0 = env.world.time;
    // Выдержана четверть осады: час из четырёх.
    patch({ heroes: { h: { archetype: 'devourer', alive: true, siege: { victim: 'p1', target: home.id, since: t0 - 3_600_000, until: t0 + 3 * 3_600_000 } } } });
    marks.drawDevourSieges();
    const c = at(home.position);
    const arc = frame.named('arc').find((k) => k.args[3] === -Math.PI / 2)!;
    expect(arc.args).toEqual([c.x, c.y, 31, -Math.PI / 2, -Math.PI / 2 + 2 * Math.PI * 0.75]);
    expect(arc.stroke).toBe(palette.HOSTILE);
    expect(frame.named('fillText')[0]!.args).toEqual([`☠ ${countdownHMS(3 * 3_600_000)}`, c.x, Math.round(c.y + 31 + 5) + 3]);
    frame.calls.length = 0;
    patch({ heroes: { h: { archetype: 'devourer', alive: true, siege: { victim: 'p2', target: home.id, since: t0, until: t0 + 1 } } } });
    marks.drawDevourSieges();
    expect(frame.calls).toHaveLength(0);
  });
});

describe('REFM-234 — ракеты и мины', () => {
  it('летящая ракета: пунктир от неё к точке цели цветом владельца; чужая подписана, пока карта крупна; без полёта и в тумане — нет', async () => {
    const { marks, palette, geo, camera, t, env, frame, home, next, at, put } = await boot();
    const flight = { from: { ...home.position }, to: { ...next.position }, departedAt: env.world.time, arrivesAt: env.world.time + 3_600_000 };
    const foe = put({ ...squad('m:p2', 'p2', home.id, 'missile'), flight } as Fleet);
    marks.drawMissiles();
    const from = at(geo.fleetPos(foe)!);
    expect(frame.named('moveTo')[0]!.args).toEqual([from.x, from.y]);
    expect(frame.named('lineTo')[0]!.args).toEqual([at(next.position).x, at(next.position).y]);
    expect(frame.named('stroke')[0]!.stroke).toBe(palette.ownerColor('p2'));
    expect(frame.named('fillText').map((k) => k.args[0])).toEqual([t('mine.incoming')]);
    // Мелкая карта — без подписи.
    frame.calls.length = 0;
    camera.setView({ scale: 0.7, x: 0, y: 0 });
    marks.drawMissiles();
    expect(frame.named('fillText')).toHaveLength(0);
    camera.setView({ scale: 1, x: 0, y: 0 });
    // Своя — без подписи; стоящая на месте ракета — не летящая.
    frame.calls.length = 0;
    put({ ...foe, owner: 'p1' });
    marks.drawMissiles();
    expect(frame.named('stroke')[0]!.stroke).toBe(palette.ownerColor('p1'));
    expect(frame.named('fillText')).toHaveLength(0);
    frame.calls.length = 0;
    put({ ...foe, flight: undefined });
    marks.drawMissiles();
    expect(frame.calls).toHaveLength(0);
    // Чужая ракета вдали от моих глаз не видна.
    const far = Object.values(env.world.planets).find((p) => p.owner === 'p2')!;
    put({ ...foe, location: far.id, flight: { ...flight, from: { ...far.position }, to: { ...far.position } } });
    marks.drawMissiles();
    expect(frame.calls).toHaveLength(0);
  });

  it('мины: сфера у отряда мин с числом зарядов — своя бирюзой, чужая янтарём; ракетная без числа; установка — пунктиром и «◷»', async () => {
    const { marks, geo, env, frame, home, next, own, put, patch } = await boot();
    const mine = put(squad('mine:p1', 'p1', home.id, 'mine', 3));
    const foeMine = put(squad('mine:p2', 'p2', home.id, 'mine', 2));
    const rocket = put(squad('rmine:p1', 'p1', home.id, 'rocket_mine'));
    marks.drawMinefields();
    const shifts = frame.named('translate').map((k) => k.args);
    const texts = frame.named('fillText').map((k) => [...k.args, k.fill]);
    for (const [f, label, color] of [
      [mine, '×3', '#60dbe8'],
      [foeMine, '×2', '#ffac62'],
      [rocket, '', '#60dbe8'],
    ] as const) {
      const c = geo.fleetAnchor(f)!;
      expect(shifts, f.id).toContainEqual([c.x - 12, c.y - 12]);
      expect(texts, f.id).toContainEqual([label, 26, 15, color]);
    }
    expect(frame.named('setLineDash').filter((k) => (k.args[0] as number[]).length > 0)).toHaveLength(0);
    // Установка на узле — над миром носителя, пунктиром и «◷».
    frame.calls.length = 0;
    put({ ...mine, units: [] });
    put({ ...foeMine, units: [] });
    put({ ...rocket, units: [] });
    patch({ minefields: { installations: { [own.id]: { owner: 'p1', readyAt: 0, location: next.id, stack: { unit: 'mine', count: 2 } } } } });
    marks.drawMinefields();
    const c = env.world.planets[own.location!]!.position;
    const px = (await import('./mapCamera')).world(geo.fleetPos(own) ?? c);
    expect(frame.named('translate').map((k) => k.args)).toEqual([[px.x - 12, px.y - 44 - 12]]);
    expect(frame.named('fillText').map((k) => k.args[0])).toEqual(['◷']);
    expect(frame.named('setLineDash')[0]!.args).toEqual([[2, 2]]);
    // Чужая установка не моя метка.
    frame.calls.length = 0;
    patch({ minefields: { installations: { [own.id]: { owner: 'p2', readyAt: 0, location: next.id, stack: { unit: 'mine', count: 2 } } } } });
    marks.drawMinefields();
    expect(frame.calls).toHaveLength(0);
  });
});

describe('REFM-234 — метки коалиции', () => {
  it('булавка над миром цветом автора с волнами сонара; хитбокс — у её головки; свои прячет переключатель', async () => {
    const { marks, palette, env, frame, home, next, at } = await boot();
    env.pings = [
      { from: 'p2', ping: next.id },
      { from: 'p1', ping: home.id },
      { from: 'p2', ping: 'nowhere' },
    ];
    const now = 5000;
    marks.drawPings(now);
    const col = palette.ownerColor('p2');
    const a = at(next.position);
    const b = at(home.position);
    expect(marks.pingHits).toEqual([
      { loc: next.id, x: a.x, y: a.y - 22 - 1 },
      { loc: home.id, x: b.x, y: b.y - 22 - 1 },
    ]);
    // Остриё булавки смотрит в мир; головка дышит цветом автора.
    const tipAt = frame.calls.findIndex((k) => k.name === 'moveTo' && k.args[0] === a.x && k.args[1] === a.y - 22 + 14);
    expect(frame.calls[tipAt]!.stroke).toBe('rgba(4,10,12,.85)');
    const pulse = pinPulse(now, pingPhase(a.x));
    expect(pulse).toBeLessThan(0.99);
    expect(frame.calls.slice(tipAt).find((k) => k.name === 'fill')!.fill).toBe(rgba(col, pulse));
    // Свои метки спрятаны переключателем — рисуются и ловят тап только чужие.
    frame.calls.length = 0;
    env.ownPings = false;
    marks.drawPings(now);
    expect(marks.pingHits.map((h) => h.loc)).toEqual([next.id]);
  });

  it('голографическая карта: булавка — голограммой, хитбокс тот же; метка за экраном — ни булавки, ни хитбокса', async () => {
    const { marks, camera, env, frame, next, at } = await boot();
    env.pings = [{ from: 'p2', ping: next.id }];
    env.holographic = true;
    marks.drawPings(0);
    const a = at(next.position);
    expect(marks.pingHits).toEqual([{ loc: next.id, x: a.x, y: a.y - 23 }]);
    expect(frame.named('moveTo').some((k) => k.args[1] === a.y - 22 + 14)).toBe(false);
    camera.setView({ scale: 1, x: 1e6, y: 1e6 });
    frame.calls.length = 0;
    marks.drawPings(0);
    expect(marks.pingHits).toEqual([]);
    expect(frame.calls).toHaveLength(0);
  });
});

describe('REFM-234 — цепочки «Приказ»', () => {
  it('отправленный план: пунктир от флота до мира шага, капсула шага и ◎-бейдж над конечным миром — он же хитбокс', async () => {
    const { marks, palette, geo, env, frame, own, next, at, patch } = await boot();
    patch({ orders: { [own.id]: { steps: [{ kind: 'move', to: next.id }] }, 'x:p2': { steps: [{ kind: 'move', to: next.id }] } } });
    put2(env, own.id);
    const now = 700;
    marks.drawChainOverlay(now);
    const start = geo.fleetOriginPx(own)!;
    const c = at(next.position);
    expect(frame.named('moveTo')[0]!.args).toEqual([start.x, start.y]);
    expect(frame.named('lineTo').at(-1)!.args).toEqual([c.x, c.y]);
    expect(frame.named('stroke')[0]!.stroke).toBe(rgba(palette.LOCK, 0.75));
    expect(frame.named('stroke')[0]!.alpha).toBe(0.5); // отправленный план — приглушён
    const cap = capsuleAt(c, 0);
    expect(arcAt(frame.calls, cap, 9)).toBe(true);
    expect(frame.named('fillText').map((k) => k.args)).toContainEqual(['✈', cap.x, cap.y + 3.5]);
    expect(arcAt(frame.calls, { x: c.x, y: c.y + BADGE_DY }, 7.5)).toBe(true);
    const badge = frame.named('stroke').find((k) => k.stroke === rgba(palette.ownerColor('p1'), 0.9))!;
    expect(badge).toBeDefined();
    expect(marks.chainHits).toEqual([{ target: next.id, fleetIds: [own.id], x: c.x, y: c.y + BADGE_DY }]);
    // Хитбоксы пересобираются каждый кадр, а не копятся.
    marks.drawChainOverlay(now);
    expect(marks.chainHits).toHaveLength(1);
  });

  it('черновик открытого режима — ярче, план флота в режиме не дублируется; точка меню — кольцом', async () => {
    const { marks, composer, palette, env, frame, own, next, at, patch } = await boot();
    patch({ orders: { [own.id]: { steps: [{ kind: 'move', to: next.id }] } } });
    put2(env, own.id);
    composer.enterChainMode([own.id]);
    composer.setChainDraft({ steps: [{ kind: 'move', to: next.id }, { kind: 'wait', hours: 2 } as never], gestures: [1, 1] });
    marks.drawChainOverlay(0);
    // Отправленный план того же флота не рисуется: его заменил черновик.
    expect(frame.named('stroke').filter((k) => k.alpha === 0.5)).toHaveLength(0);
    expect(frame.named('stroke')[0]!.alpha).toBe(0.95);
    expect(marks.chainHits).toEqual([]);
    const c = at(next.position);
    expect(frame.named('fillText').map((k) => k.args[0])).toEqual(expect.arrayContaining(['✈', '⏱']));
    // Точка открытого меню — пунктирное кольцо r=17.
    frame.calls.length = 0;
    composer.chainMode!.menu = { id: next.id, kind: 'planet' } as never;
    marks.drawChainOverlay(450);
    const ring = frame.named('arc').find((k) => k.args[2] === 17)!;
    expect(ring.args.slice(0, 2)).toEqual([c.x, c.y]);
    expect(ring.stroke).toBe(rgba(palette.LOCK, 0.5 + 0.4 * badgePulse(450)));
    expect(frame.props.lineDashOffset).toBe(-(450 / 50) % 9);
  });
});

/** У отправленного плана владелец — флот в мире; чужой `x:p2` в мире появляется чужим. */
function put2(env: { world: GameState }, ownId: string): void {
  const own = env.world.fleets[ownId]!;
  env.world = { ...env.world, fleets: { ...env.world.fleets, 'x:p2': { ...own, id: 'x:p2', owner: 'p2' } } };
}

describe('REFM-234 — стык меток с main.ts', () => {
  const MAIN = readFileSync(new URL('./main.ts', import.meta.url), 'utf8');
  const SRC = readFileSync(new URL('./mapMarks.ts', import.meta.url), 'utf8');
  const init = /initMapMarks\(\{([\s\S]*?)\n\}\);/.exec(MAIN)?.[1] ?? '';

  it('хуки — мир, место, кадр, часы и вид голограммы, метки коалиции, задачи и цепочка главы', () => {
    for (const hook of [
      'world: () => s,',
      'me: () => ME,',
      'ctx: () => cx,',
      'clock: () => hologramTime,',
      'holographic: holographicMapOn,',
      'ownPings: () => showOwnPings,',
      'pings: () => pings?.drawable() ?? [],',
      'missionRows: runMissionRows,',
      'chain: runChain,',
    ])
      expect(init, hook).toContain(hook);
  });

  it('метки живут только в модуле; кадр зовёт их, тап ищет цель по их хитбоксам', () => {
    expect(MAIN).not.toMatch(
      /\bfunction (drawMissionTargets|drawAllyMarks|drawMissiles|drawMinefields|drawDevourSieges|drawPings|drawChainPath|drawChainOverlay)\(/,
    );
    expect(MAIN).not.toMatch(/\blet (pingHits|chainHits)\b/);
    for (const call of [
      'drawPings(now);',
      'drawChainOverlay(now);',
      'drawMissiles();',
      'drawMinefields();',
      'drawDevourSieges();',
    ])
      expect(MAIN, call).toContain(call);
    expect(MAIN).toMatch(/drawMissionTargets\(\);\s*drawAllyMarks\(\);/);
    const input = /initMapInput\(\{([\s\S]*?)\n\}\);/.exec(MAIN)?.[1] ?? '';
    for (const hook of ['chainHits: () => chainHits,', 'pingHits: () => pingHits,']) expect(input, hook).toContain(hook);
  });

  it('модуль не тянет `main.ts`', () => {
    expect(SRC).not.toMatch(/from '\.\/main'/);
  });
});
