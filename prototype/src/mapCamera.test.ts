/**
 * Камера карты и рамка (REFM-231, первый PR) — прямой тест владельца вида.
 *
 * Камеру снаружи только читают, менять её можно дверями модуля, поэтому здесь проверено то,
 * что текстом не проверить: рамка встаёт по узлам и меняется со сменой карты, поле игры
 * следит за раскладкой (телефон, консоль, широкий экран), перевод «карта ↔ экран» обратим,
 * двери двигают камеру ровно так, как обещают, стартовый вид выбирает дом или обзор, а
 * переход из текста и из панели зовёт свои побочные действия. Каждый тест — свежая
 * загрузка модуля: у камеры своё состояние.
 */
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';

import type { GameState } from '../../packages/shared-core/src/index';
import { GOTO_MIN_ZOOM, PING_ZOOM } from './mapJump';
import { HOME_ZOOM, RUN_HOME_ZOOM } from './openingView';

// Первая загрузка тянет ядро и данные игры — секунды под нагрузкой полного гейта. Граф
// греется один раз; тесты после `vi.resetModules()` берут его из кеша трансформаций.
beforeAll(async () => {
  await import('./mapCamera');
}, 60_000);
beforeEach(() => {
  vi.resetModules();
});

/** Карта 1000×500 в единицах карты: на широком экране её вписывает высота поля. */
const NODES = [
  { x: 0, y: 0 },
  { x: 1000, y: 500 },
];

interface Planet {
  owner: string | null;
  buildings: unknown[];
  position: { x: number; y: number };
}

async function boot(
  screen: { vw?: number; vh?: number; mobile?: boolean; console?: boolean } = {},
  planets: Record<string, Planet> = {},
  mapId?: string,
) {
  const env = {
    vw: 1600,
    vh: 900,
    mobile: false,
    console: false,
    ...screen,
    selected: [] as string[],
    diploClosed: 0,
    rings: [] as string[],
  };
  const w = { planets, mapId } as unknown as GameState;
  const camera = await import('./mapCamera');
  camera.initMapCamera({
    vw: () => env.vw,
    vh: () => env.vh,
    mobile: () => env.mobile,
    console: () => env.console,
    world: () => w,
    me: () => 'p1',
    select: (id) => void env.selected.push(id),
    closeDiplo: () => void env.diploClosed++,
    ring: (id) => void env.rings.push(id),
  });
  camera.frameMap(NODES);
  return { camera, env };
}

/** Центр поля игры — туда стартовый вид и переходы ставят свою точку. */
function middle(vp: { left: number; right: number; top: number; bottom: number }) {
  return { x: (vp.left + vp.right) / 2, y: (vp.top + vp.bottom) / 2 };
}

const home = (x: number, y: number): Planet => ({
  owner: 'p1',
  buildings: [1],
  position: { x, y },
});

describe('REFM-231 — рамка карты и поле игры', () => {
  it('рамка — границы узлов, и смена карты ставит новую', async () => {
    const { camera } = await boot();
    expect(camera.mapBounds()).toEqual({ minX: 0, minY: 0, maxX: 1000, maxY: 500 });
    camera.frameMap([
      { x: -40, y: 10 },
      { x: 300, y: 900 },
      { x: 120, y: -5 },
    ]);
    expect(camera.mapBounds()).toEqual({ minX: -40, minY: -5, maxX: 300, maxY: 900 });
  });

  it('широкий экран держит полосу слева и колонку панели справа по размеру окна', async () => {
    const { camera } = await boot();
    expect(camera.insets()).toEqual({ left: 130, right: 1344, top: 130, bottom: 756 });
  });

  it('телефон отдаёт карте левую полосу; низкий экран поднимает верх поля', async () => {
    const { camera, env } = await boot({ vw: 400, vh: 800, mobile: true });
    expect(camera.insets()).toEqual({ left: 14, right: 376, top: 104, bottom: 704 });
    env.vw = 800;
    env.vh = 500;
    expect(camera.insets()).toEqual({ left: 14, right: 776, top: 86, bottom: 404 });
  });

  it('у консоли своё поле — и оно главнее телефонного', async () => {
    const { camera, env } = await boot({ console: true, mobile: true });
    expect(camera.insets()).toEqual({ left: 20, right: 1580, top: 138, bottom: 824 });
    env.vw = 1000;
    expect(camera.insets().top).toBe(182);
  });

  it('видимость меряется по живому экрану с запасом', async () => {
    const { camera, env } = await boot();
    expect(camera.visible({ x: 1680, y: 980 })).toBe(true);
    expect(camera.visible({ x: 1681, y: 0 })).toBe(false);
    expect(camera.visible({ x: 1700, y: 0 }, 100)).toBe(true);
    env.vw = 2000;
    expect(camera.visible({ x: 1681, y: 0 })).toBe(true);
  });

  it('без страницы панель и подсказка первого боя запаса не дают', async () => {
    const { camera } = await boot();
    expect(camera.pirateIntroRect()).toBeNull();
    expect(camera.panelSlack()).toEqual({});
  });
});

describe('REFM-231 — перевод «карта ↔ экран»', () => {
  it('на общем плане середина карты стоит в середине поля, и перевод обратим', async () => {
    const { camera } = await boot();
    expect(camera.world({ x: 500, y: 250 })).toEqual(middle(camera.insets()));
    camera.setView({ scale: 2.5, x: -700, y: -300 });
    const p = { x: 321, y: 123 };
    const back = camera.unworld(camera.world(p));
    expect(back.x).toBeCloseTo(p.x, 9);
    expect(back.y).toBeCloseTo(p.y, 9);
  });

  it('дальность карты в пикселях — тот же множитель, что у перевода, и растёт с зумом', async () => {
    const { camera } = await boot();
    const span = camera.world({ x: 100, y: 0 }).x - camera.world({ x: 0, y: 0 }).x;
    expect(camera.worldDist(100)).toBeCloseTo(span, 9);
    camera.setView({ scale: 2, x: 0, y: 0 });
    expect(camera.worldDist(100)).toBeCloseTo(2 * span, 9);
  });
});

describe('REFM-231 — двери камеры', () => {
  it('сдвиг не зажимает: зажим зовёт тот, кто тянет', async () => {
    const { camera } = await boot();
    camera.setView({ scale: 2, x: 0, y: 0 });
    camera.panBy(10_000, -7);
    expect(camera.cam).toEqual({ scale: 2, x: 10_000, y: -7 });
    camera.clampCam();
    expect(camera.cam.scale).toBe(2);
    expect(camera.cam.x).toBeLessThan(10_000);
  });

  it('вид ставится целиком, и камера для чтения — тот же живой объект', async () => {
    const { camera } = await boot();
    const seen = camera.cam;
    camera.setView({ scale: 3, x: 11, y: -22 });
    expect(seen).toEqual({ scale: 3, x: 11, y: -22 });
    // Снаружи камера только для чтения: убери `Readonly` — и эта строка перестанет быть
    // ошибкой, а typecheck уронит неиспользованную директиву.
    const write = (): void => {
      // @ts-expect-error — поля камеры меняют только двери модуля
      camera.cam.x = 1;
    };
    expect(typeof write).toBe('function');
  });

  it('зум держит точку под пальцем на месте', async () => {
    const { camera } = await boot();
    const focus = { x: 600, y: 400 };
    const under = camera.unworld(focus);
    camera.zoomAt(focus.x, focus.y, 2);
    expect(camera.cam.scale).toBe(2);
    const now = camera.world(under);
    expect(now.x).toBeCloseTo(focus.x, 9);
    expect(now.y).toBeCloseTo(focus.y, 9);
  });

  it('центровка ставит точку в середину поля на заданном масштабе', async () => {
    const { camera } = await boot();
    camera.centerOn({ x: 500, y: 250 }, 3);
    expect(camera.cam.scale).toBe(3);
    const at = camera.world({ x: 500, y: 250 });
    const mid = middle(camera.insets());
    expect(at.x).toBeCloseTo(mid.x, 9);
    expect(at.y).toBeCloseTo(mid.y, 9);
  });
});

describe('REFM-231 — стартовый вид', () => {
  it('широкий экран вне забега — общий план, даже когда дом есть', async () => {
    const { camera } = await boot({}, { h: home(500, 250) });
    camera.setView({ scale: 4, x: 900, y: -900 });
    camera.defaultView();
    expect(camera.cam.scale).toBe(1);
    expect(camera.world({ x: 500, y: 250 })).toEqual(middle(camera.insets()));
  });

  it('телефон открывается у дома', async () => {
    const { camera } = await boot({ vw: 400, vh: 800, mobile: true }, { h: home(500, 250) });
    camera.defaultView();
    expect(camera.cam.scale).toBe(HOME_ZOOM);
    const at = camera.world({ x: 500, y: 250 });
    expect(at.x).toBeCloseTo(middle(camera.insets()).x, 9);
  });

  it('домом считается свой мир, а без своих телефон тоже берёт общий план', async () => {
    const theirs = { ...home(500, 250), owner: 'p2' };
    const { camera } = await boot({ vw: 400, vh: 800, mobile: true }, { h: theirs });
    camera.defaultView();
    expect(camera.cam.scale).toBe(1);
  });

  it('забег узнаётся по режиму матча: широкий экран встаёт у дома ближе к обзору', async () => {
    const { camera } = await boot({}, { h: home(500, 250) });
    (await import('./protoKernel')).setMatchMode('pve_waves');
    camera.defaultView();
    expect(camera.cam.scale).toBe(RUN_HOME_ZOOM);
  });

  it('на большой карте фронтира приближение к дому — впятеро', async () => {
    const { camera } = await boot(
      { vw: 400, vh: 800, mobile: true },
      { h: home(4000, 4000) },
      'frontier-50',
    );
    camera.frameMap([
      { x: 0, y: 0 },
      { x: 8000, y: 8000 },
    ]);
    camera.defaultView();
    expect(camera.cam.scale).toBe(HOME_ZOOM * 5);
  });
});

describe('REFM-231 — переходы к миру', () => {
  const worlds = { a: home(500, 250) };

  it('из текста: крупно, выбор мира, диплоокно закрыто, без кольца', async () => {
    const { camera, env } = await boot({}, worlds);
    camera.jumpToPing('a');
    expect(camera.cam.scale).toBe(PING_ZOOM);
    expect([env.selected, env.diploClosed, env.rings]).toEqual([['a'], 1, []]);
  });

  it('из панели: не мельче порога, выбор не трогает, отмечает кольцом', async () => {
    const { camera, env } = await boot({}, worlds);
    camera.focusWorld('a');
    expect(camera.cam.scale).toBe(GOTO_MIN_ZOOM);
    expect([env.selected, env.diploClosed, env.rings]).toEqual([[], 0, ['a']]);
  });

  it('из панели вид не отдаляется', async () => {
    const { camera } = await boot({}, worlds);
    camera.setView({ scale: 4, x: 0, y: 0 });
    camera.jumpTo('a', 'goto');
    expect(camera.cam.scale).toBe(4);
  });

  it('по мёртвой ссылке не двигается ничего', async () => {
    const { camera, env } = await boot({}, worlds);
    camera.setView({ scale: 2, x: 5, y: 6 });
    camera.jumpTo('gone', 'ping');
    camera.jumpTo('gone', 'goto');
    expect(camera.cam).toEqual({ scale: 2, x: 5, y: 6 });
    expect([env.selected, env.diploClosed, env.rings]).toEqual([[], 0, []]);
  });
});

describe('REFM-231 — стык с main.ts', () => {
  const MAIN = readFileSync(new URL('./main.ts', import.meta.url), 'utf8');
  const CAMERA = readFileSync(new URL('./mapCamera.ts', import.meta.url), 'utf8');
  const init = /initMapCamera\(\{([\s\S]*?)\n\}\);/.exec(MAIN)?.[1] ?? '';

  it('хуки камеры — экран, раскладка, мир, своё место и побочные действия перехода', () => {
    for (const hook of [
      'vw: () => VW,',
      'vh: () => VH,',
      'mobile: () => MOBILE,',
      'console: () => holographic.active(),',
      'world: () => s,',
      'me: () => ME,',
      'closeDiplo: () => closeDiplo(),',
    ]) {
      expect(init, hook).toContain(hook);
    }
    // Переход с выбором сбрасывает кэш разметки панели (правило 4 `mapJump.ts`).
    expect(init).toMatch(/select: \(id\) => \{\s*pickWorld\(id\);\s*invalidatePanel\(\);\s*\}/);
    expect(init).toMatch(/ring: \(id\) => \{\s*goFlash = \{ id, at: performance\.now\(\) \};\s*\}/);
  });

  it('камеру и рамку меняют только двери владельца', () => {
    expect(MAIN).not.toMatch(/\bcam\.(scale|x|y)\s*[-+]?=[^=]/);
    expect(MAIN).not.toContain('Object.assign(cam');
    expect(MAIN).not.toMatch(/\b(MINX|MAXX|MINY|MAXY)\b/);
    expect(MAIN).not.toMatch(
      /\bfunction (insets|world|unworld|worldDist|visible|panelSlack|pirateIntroRect|zoomAt|clampCam|centerOn|defaultView|jumpTo|focusWorld|jumpToPing)\(/,
    );
    // Рамку ставят старт и смена карты; камеру целиком — щипок и подгонка под новое окно.
    expect(MAIN.match(/\bframeMap\(MAP\);/g)).toHaveLength(2);
    expect(MAIN).toContain('setView(camPinchAt(');
    expect(MAIN).toContain(
      'setView(reframePresentation(cam, previousViewport, insets(), mapBounds()));',
    );
    expect(MAIN.match(/\bpanBy\(/g)).toHaveLength(3);
  });

  it('модуль не тянет `main.ts`', () => {
    expect(CAMERA).not.toMatch(/from '\.\/main'/);
  });
});
