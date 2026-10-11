/**
 * Композер цепочек «Приказ» (REFM-229) — прямой тест владельца: режим, тап карты, меню
 * точки и запросы, на которых стоит план, на живом мире прототипа.
 *
 * Что пункт меню делает с черновиком, держит `chainPlanner.ts` со своим тестом; приоритет
 * цели под пальцем — `chainTarget.ts`. Здесь — то, что текстом не проверить: вход берёт
 * только свои флоты и живой план одним жестом, тап по миру открывает меню у точки, тап в
 * пустоту закрывает его, нажатие пункта дописывает шаг и закрывает меню (или оставляет —
 * у наращиваемых), переполненный черновик слышен в ленте, двери правят черновик, маршрут
 * берётся из кэша до смены матча. Каждый тест — свежая загрузка модулей.
 */
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';

import type { GameState } from '../../packages/shared-core/src/index';
import { orbitSeats } from '../../decisions/orbitSeats';
import { isEmplacementFleet } from '../../decisions/emplacement';
import { t, tData } from '../../localization/runtime';
import type { MapNode } from './game';
import { data } from './gameData';

beforeAll(async () => {
  await import('./chainComposer');
}, 60_000);
beforeEach(() => {
  vi.resetModules();
});
afterEach(() => {
  vi.unstubAllGlobals();
});

/** Кусок страницы, который трогает композер: бокс меню и класс режима на `body`. */
function fakePage() {
  const listeners: Array<(ev: Event) => void> = [];
  const classes = new Set<string>();
  const menu = {
    innerHTML: '',
    style: { left: '', top: '' },
    classList: { add: (c: string) => classes.add(c), remove: (c: string) => classes.delete(c) },
    addEventListener: (_: string, fn: (ev: Event) => void) => listeners.push(fn),
    getBoundingClientRect: () => ({ width: 200, top: Number.parseFloat(menu.style.top) || 0 }),
  };
  const body = new Set<string>(['chain-mode']);
  vi.stubGlobal('document', {
    getElementById: (id: string) => (id === 'tgted' ? menu : null),
    body: { classList: { remove: (c: string) => body.delete(c) } },
  });
  vi.stubGlobal('window', { innerWidth: 1600 });
  /** Нажать кнопку меню с такими `data-*`. */
  const press = (dataset: Record<string, string>, disabled = false) => {
    const btn = { dataset, disabled, closest: () => btn };
    for (const fn of listeners) fn({ target: btn } as unknown as Event);
  };
  return { menu, shown: () => classes.has('show'), body, press };
}

async function boot() {
  const page = fakePage();
  const game = await import('./game');
  const world: GameState = game.newGame({
    seats: [
      { id: 'p1', name: 'A', faction: 'azure', start: game.START_CANDIDATES[0]!, ai: false },
      { id: 'p2', name: 'B', faction: 'crimson', start: game.START_CANDIDATES[1]!, ai: false },
    ],
  });
  const env = {
    world,
    notes: [] as string[],
    bar: 0,
    panel: 0,
    touch: false,
    capturable: true,
  };
  const camera = await import('./mapCamera');
  camera.initMapCamera({
    vw: () => 1600,
    vh: () => 900,
    mobile: () => false,
    console: () => false,
    world: () => env.world,
    me: () => 'p1',
    select: () => {},
    closeDiplo: () => {},
    ring: () => {},
  });
  camera.frameMap(Object.values(world.planets).map((p) => p.position));
  const fog = await import('./mapFog');
  fog.initMapFog({
    world: () => env.world,
    me: () => 'p1',
    net: () => false,
    contacts: () => [],
    sight: () => [],
  });
  const geo = await import('./fleetGeometry');
  geo.initFleetGeometry({
    world: () => env.world,
    me: () => 'p1',
    now: () => 0,
    lod: () => ({ scale: 2, art: 1, detail: 1, provinceDetail: 1, markerRadius: 3 }),
    forkMarks: () => [],
    orbits: () => orbitSeats(Object.values(env.world.fleets), (g) => isEmplacementFleet(g, data)),
  });
  const nodes = Object.values(world.planets).map((p) => ({ id: p.id, ...p.position }));
  const ch = await import('./chainComposer');
  ch.initChainComposer({
    world: () => env.world,
    me: () => 'p1',
    note: (text) => env.notes.push(text),
    nodes: () => nodes as unknown as MapNode[],
    capturable: () => env.capturable,
    touchTap: () => env.touch,
    screenPoint: (p) => p,
    invalidateCmdBar: () => env.bar++,
    invalidatePanel: () => env.panel++,
  });
  const home = Object.values(world.planets).find((p) => p.owner === 'p1')!;
  const fleet = Object.values(world.fleets).find((f) => f.owner === 'p1')!;
  /** Экранная точка мира — туда и тапают. */
  const at = (id: string) => camera.world(env.world.planets[id]!.position);
  /** Приблизить камеру к середине дороги: на карте целиком флот на дороге лежит в пальце от мира. */
  const zoomOnLane = (a: string, b: string) => {
    const pa = env.world.planets[a]!.position;
    const pb = env.world.planets[b]!.position;
    camera.centerOn({ x: (pa.x + pb.x) / 2, y: (pa.y + pb.y) / 2 }, camera.cam.scale * 8);
  };
  return { ch, env, page, home, fleet, at, camera, zoomOnLane };
}

describe('REFM-229 — режим', () => {
  it('вход берёт только свои флоты и живой план одним жестом; чужие режим не открывают', async () => {
    const { ch, env, fleet, home } = await boot();
    ch.enterChainMode(['p2-1']);
    expect(ch.chainMode).toBeNull();
    const plan = [
      { kind: 'move', to: home.links![0]! },
      { kind: 'move', to: home.id },
    ];
    env.world = { ...env.world, orders: { [fleet.id]: { steps: plan } } } as GameState;
    const inter = await import('./interaction');
    inter.arm('aiming', true as never);
    ch.enterChainMode([fleet.id, 'p2-1']);
    expect(ch.chainMode).toEqual({ fleetIds: [fleet.id], steps: plan, gestures: [2], menu: null });
    expect(inter.aiming).toBeFalsy(); // прицел курса гаснет — карта теперь собирает план
    expect(env.notes).toEqual([t('hint.pick-order')]);
    expect([env.bar, env.panel]).toEqual([1, 1]);
  });

  it('выход: черновик забыт, меню и класс режима сняты, ряд и панель пересобираются', async () => {
    const { ch, env, page, fleet, home, at } = await boot();
    ch.enterChainMode([fleet.id]);
    const p = at(home.links![0]!);
    ch.chainMapTap(p.x, p.y);
    expect(page.shown()).toBe(true);
    ch.exitChainMode();
    expect(ch.chainMode).toBeNull();
    expect(page.shown()).toBe(false);
    expect(page.body.has('chain-mode')).toBe(false);
    expect([env.bar, env.panel]).toEqual([2, 2]);
  });
});

describe('REFM-229 — тап карты и меню точки', () => {
  it('тап по миру открывает меню у точки, тап в пустоту закрывает его', async () => {
    const { ch, page, fleet, home, at } = await boot();
    ch.chainMapTap(0, 0); // вне режима — ничего
    expect(page.shown()).toBe(false);
    ch.enterChainMode([fleet.id]);
    const to = home.links![0]!;
    const p = at(to);
    ch.chainMapTap(p.x, p.y);
    expect(ch.chainMode?.menu).toEqual({ id: to, kind: expect.any(String) });
    expect(page.shown()).toBe(true);
    expect(page.menu.innerHTML).toContain(`${to} · 0/`);
    expect(page.menu.innerHTML).toContain('data-ch="move"');
    expect(page.menu.style.left).toBe(`${Math.round(p.x)}px`);
    expect(ch.chainMenuAnchor()).toEqual(p);
    ch.chainMapTap(p.x + 5000, p.y + 5000);
    expect(ch.chainMode?.menu).toBeNull();
    expect(page.shown()).toBe(false);
  });

  it('пальцем попадание шире, чем мышью', async () => {
    const { ch, env, fleet, at } = await boot();
    ch.enterChainMode([fleet.id]);
    const { tapRadius } = await import('../../decisions/tapPriority');
    const off = (tapRadius('node', false) + tapRadius('node', true)) / 2;
    // Мир и сторона, где в пальцевом радиусе от точки тапа нет другого мира: карта плотная.
    const ids = Object.keys(env.world.planets);
    const spot = ids
      .flatMap((id) =>
        [0, 1, 2, 3].map((k) => {
          const p = at(id);
          const x = p.x + off * Math.cos((k * Math.PI) / 2);
          const y = p.y + off * Math.sin((k * Math.PI) / 2);
          const clear = ids.every(
            (o) => o === id || Math.hypot(at(o).x - x, at(o).y - y) > tapRadius('node', true),
          );
          return { id, x, y, clear };
        }),
      )
      .find((c) => c.clear)!;
    ch.chainMapTap(spot.x, spot.y);
    expect(ch.chainMode?.menu).toBeNull();
    env.touch = true;
    ch.chainMapTap(spot.x, spot.y);
    expect(ch.chainMode?.menu?.id).toBe(spot.id);
  });

  it('пункт дописывает шаг и закрывает меню; наращиваемый оставляет его открытым', async () => {
    const { ch, env, page, fleet, home, at } = await boot();
    ch.enterChainMode([fleet.id]);
    const to = home.links![0]!;
    const p = at(to);
    ch.chainMapTap(p.x, p.y);
    const bar = env.bar;
    page.press({ ch: 'move' });
    expect(ch.chainMode?.steps).toEqual([{ kind: 'move', to }]);
    expect(ch.chainMode?.gestures).toEqual([1]);
    expect(ch.chainMode?.menu).toBeNull();
    expect(page.shown()).toBe(false);
    expect(env.bar).toBe(bar + 1);
    ch.chainMapTap(p.x, p.y);
    page.press({ ch: 'wait', keep: '1' });
    expect(ch.chainMode?.steps.at(-1)?.kind).toBe('wait');
    expect(ch.chainMode?.menu?.id).toBe(to);
    expect(page.shown()).toBe(true);
    // Нажатие неактивной кнопки и кнопки без действия ничего не меняет.
    const before = ch.chainMode?.steps;
    page.press({ ch: 'wait', keep: '1' }, true);
    page.press({});
    expect(ch.chainMode?.steps).toBe(before);
  });

  it('полный черновик: шаг не дописан, в ленте отказ', async () => {
    const { ch, env, page, fleet, home, at } = await boot();
    ch.enterChainMode([fleet.id]);
    const { MAX_CHAIN_STEPS } = await import('./game');
    const full = Array.from({ length: MAX_CHAIN_STEPS }, (_, i) => ({
      kind: 'move' as const,
      to: i % 2 ? home.id : home.links![0]!,
    }));
    ch.setChainDraft({ steps: full, gestures: full.map(() => 1) });
    const p = at(home.links![1]!);
    ch.chainMapTap(p.x, p.y);
    page.press({ ch: 'move' });
    expect(ch.chainMode?.steps).toBe(full);
    expect(env.notes.at(-1)).toBe('✖ ' + t('chain.full'));
  });
});

describe('REFM-229 — чья точка под пальцем', () => {
  it('свой мир, чужой мир со штурмом (если сектор берут), чужой флот — у каждого своё меню', async () => {
    const { ch, env, page, fleet, home, at } = await boot();
    ch.enterChainMode([fleet.id]);
    const own = at(home.id);
    ch.chainMapTap(own.x, own.y);
    expect(ch.chainMode?.menu).toEqual({ id: home.id, kind: 'own' });
    expect(page.menu.innerHTML).not.toContain('data-ch="assault"');
    const foeHome = Object.values(env.world.planets).find((p) => p.owner === 'p2')!;
    const enemy = at(foeHome.id);
    ch.chainMapTap(enemy.x, enemy.y);
    expect(ch.chainMode?.menu).toEqual({ id: foeHome.id, kind: 'enemy' });
    expect(page.menu.innerHTML).toContain('data-ch="assault"');
    env.capturable = false; // сектор, который не берут, штурма не предлагает
    ch.chainMapTap(enemy.x, enemy.y);
    expect(page.menu.innerHTML).not.toContain('data-ch="assault"');
  });

  it('чужой флот на дороге — цель «флот», меню едет за ним; свой флот целью не бывает', async () => {
    const { ch, env, page, fleet, home, zoomOnLane } = await boot();
    const geo = await import('./fleetGeometry');
    const foe = env.world.fleets['p2-1']!;
    const lane = { from: home.id, to: home.links![0]!, t: 0.5 };
    zoomOnLane(lane.from, lane.to);
    env.world = {
      ...env.world,
      fleets: { ...env.world.fleets, [foe.id]: { ...foe, location: null, edge: lane } },
    } as GameState;
    ch.enterChainMode([fleet.id]);
    const p = geo.fleetAnchor(env.world.fleets[foe.id]!)!;
    ch.chainMapTap(p.x, p.y);
    expect(ch.chainMode?.menu).toEqual({ id: foe.id, kind: 'fleet' });
    expect(page.shown()).toBe(true);
    expect(page.menu.innerHTML).not.toContain('data-ch="move"'); // у флота нет «лететь сюда»
    expect(ch.chainMenuAnchor()).toEqual(p);
    // Тот же флот — свой: тап мимо всего, меню закрыто.
    env.world = {
      ...env.world,
      fleets: { ...env.world.fleets, [foe.id]: { ...env.world.fleets[foe.id]!, owner: 'p1' } },
    } as GameState;
    ch.chainMapTap(p.x, p.y);
    expect(ch.chainMode?.menu).toBeNull();
  });

  it('по флоту палец тоже бьёт шире мыши', async () => {
    const { ch, env, fleet, home, at, zoomOnLane } = await boot();
    const geo = await import('./fleetGeometry');
    const { tapRadius } = await import('../../decisions/tapPriority');
    zoomOnLane(home.id, home.links![0]!);
    const foe = env.world.fleets['p2-1']!;
    env.world = {
      ...env.world,
      fleets: {
        ...env.world.fleets,
        [foe.id]: { ...foe, location: null, edge: { from: home.id, to: home.links![0]!, t: 0.5 } },
      },
    } as GameState;
    ch.enterChainMode([fleet.id]);
    const p = geo.fleetAnchor(env.world.fleets[foe.id]!)!;
    const off = (tapRadius('fleet', false) + tapRadius('fleet', true)) / 2;
    // Сторона, где мира под пальцем нет — иначе мир перехватит тап.
    const spot = [0, 1, 2, 3]
      .map((k) => ({
        x: p.x + off * Math.cos((k * Math.PI) / 2),
        y: p.y + off * Math.sin((k * Math.PI) / 2),
      }))
      .find((q) =>
        Object.keys(env.world.planets).every(
          (id) => Math.hypot(at(id).x - q.x, at(id).y - q.y) > tapRadius('node', true),
        ),
      )!;
    ch.chainMapTap(spot.x, spot.y);
    expect(ch.chainMode?.menu).toBeNull();
    env.touch = true;
    ch.chainMapTap(spot.x, spot.y);
    expect(ch.chainMode?.menu?.id).toBe(foe.id);
  });

  it('меню у края экрана зажимается в вьюпорт', async () => {
    const { ch, page, fleet, home, at } = await boot();
    ch.enterChainMode([fleet.id]);
    const p = at(home.id);
    vi.stubGlobal('window', { innerWidth: Math.round(p.x) + 50 }); // бокс 200px за край
    ch.chainMapTap(p.x, p.y);
    // Бокс центрован на точке: правая половина обязана влезть в экран.
    const left = Number.parseFloat(page.menu.style.left);
    expect(left).toBeLessThan(Math.round(p.x));
    expect(left + 100).toBeLessThanOrEqual(Math.round(p.x) + 50);
  });
});

describe('REFM-229 — двери и запросы', () => {
  it('двери: черновик, флоты режима, меню; вне режима — ничего', async () => {
    const { ch, fleet, home } = await boot();
    ch.setChainDraft({ steps: [], gestures: [] });
    ch.keepChainFleets([]);
    ch.dropChainMenu();
    expect(ch.chainMode).toBeNull();
    ch.enterChainMode([fleet.id]);
    const steps = [{ kind: 'move' as const, to: home.id }];
    ch.setChainDraft({ steps, gestures: [1] });
    expect(ch.chainMode).toMatchObject({ steps, gestures: [1] });
    ch.keepChainFleets([]);
    expect(ch.chainMode?.fleetIds).toEqual([]);
    ch.chainMode!.menu = { id: home.id, kind: 'own' as never };
    ch.dropChainMenu();
    expect(ch.chainMode?.menu).toBeNull();
  });

  it('маршрут из кэша до смены матча', async () => {
    const { ch, home } = await boot();
    const to = home.links![0]!;
    const first = ch.chainRoute(home.id, to);
    expect(first?.at(-1)).toBe(to);
    expect(ch.chainRoute(home.id, to)).toBe(first);
    ch.forgetChainRoutes();
    const again = ch.chainRoute(home.id, to);
    expect(again).not.toBe(first);
    expect(again).toEqual(first);
  });

  it('план, форс-марш, ближайший свой мир и старт плана читаются из мира', async () => {
    const { ch, env, fleet, home } = await boot();
    expect(ch.chainStepsOf(fleet.id)).toBeNull();
    expect(ch.marchFlagged(fleet.id)).toBe(false);
    expect(ch.nearestOwnWorld(home.links![0]!)).toBe(home.id);
    const fog = await import('./mapFog');
    expect(ch.chainStart(fleet)).toEqual({ fromId: fog.fleetNode(fleet), baseH: 0 });
    const steps = [{ kind: 'wait', hours: 1 }];
    env.world = {
      ...env.world,
      orders: { [fleet.id]: { steps } },
      forcedMarch: { [fleet.id]: true },
    } as GameState;
    expect(ch.chainStepsOf(fleet.id)).toEqual(steps);
    expect(ch.marchFlagged(fleet.id)).toBe(true);
  });

  it('летящий начинает план в конце пути; форс-марш сокращает перелёт', async () => {
    const { ch, env, fleet, home } = await boot();
    const far = home.links![0]!;
    const { order, moveFleet } = await import('./game');
    env.world = order(env.world, moveFleet('p1', fleet.id, far), env.world.time).state;
    const flying = env.world.fleets[fleet.id]!;
    const st = ch.chainStart(flying);
    expect(st.fromId).toBe(far);
    expect(st.baseH).toBeGreaterThan(0);
    const slow = ch.chainTravelH(flying)(far, home.id)!;
    env.world = { ...env.world, forcedMarch: { [fleet.id]: true } } as GameState;
    const fast = ch.chainTravelH(flying)(far, home.id)!;
    expect(fast).toBeLessThan(slow);
  });

  it('путь в два перехода: старт плана — после всего пути, форс-марш сокращает остаток', async () => {
    const { ch, env, fleet, home } = await boot();
    const { order, moveFleet, HOUR } = await import('./game');
    const near = new Set([home.id, ...home.links!]);
    const far2 = home
      .links!.flatMap((l) => env.world.planets[l]!.links ?? [])
      .find((id) => !near.has(id) && env.world.planets[id]!.owner === null)!;
    env.world = order(env.world, moveFleet('p1', fleet.id, far2), env.world.time).state;
    const flying = env.world.fleets[fleet.id]!;
    const firstHopH = (flying.movement!.arrivesAt - env.world.time) / HOUR;
    const plain = ch.chainStart(flying);
    expect(plain.fromId).toBe(far2);
    expect(plain.baseH).toBeGreaterThan(firstHopH); // хвост пути сверх головы
    env.world = { ...env.world, forcedMarch: { [fleet.id]: true } } as GameState;
    expect(ch.chainStart(flying).baseH).toBeLessThan(plain.baseH);
  });

  it('стоящий на дороге флот начинает план с ближнего к нему мира', async () => {
    const { ch, fleet, home } = await boot();
    const parked = {
      ...fleet,
      location: null,
      edge: { from: home.id, to: home.links![0]!, t: 0.1 },
    };
    expect(ch.chainStart(parked as never)).toEqual({ fromId: home.id, baseH: 0 });
  });

  it('способности героя на борту — имена, описания и кулдаун из каталога, только надетое', async () => {
    const { ch, env, page, fleet, home, at } = await boot();
    const { HOUR } = await import('./game');
    const hero = {
      id: 'h-test',
      owner: 'p1',
      fleetId: fleet.id,
      equipped: ['corridor', 'rally', 'no-such-ability'],
      cooldowns: { path: env.world.time + 2 * HOUR },
    };
    env.world = { ...env.world, heroes: { [hero.id]: hero } } as unknown as GameState;
    const corridor = data.heroAbilities['corridor']!;
    const abilities = ch.chainAbilitiesFor([fleet.id]);
    expect(abilities).toEqual([
      {
        id: 'corridor',
        name: tData(corridor.name),
        cdH: 2,
        ranged: true,
        desc: t(corridor.description!),
      },
      expect.objectContaining({ id: 'rally', cdH: 0, ranged: false }),
    ]);
    expect(ch.chainAbilitiesFor(['nobody'])).toEqual([]);
    const hold = ch.chainAbilityHoldH([fleet.id]);
    expect([hold('corridor'), hold('rally'), hold('no-such-ability')]).toEqual([2, 0, 0]);
    // В меню точки — те же пункты: на кулдауне погашен, готовый жмётся в шаг плана.
    ch.enterChainMode([fleet.id]);
    const p = at(home.links![0]!);
    ch.chainMapTap(p.x, p.y);
    expect(page.menu.innerHTML).toContain('data-chab="corridor"');
    expect(page.menu.innerHTML).toContain('data-chab="rally"');
    page.press({ ch: 'ability', chab: 'rally' });
    expect(ch.chainMode?.steps.at(-1)).toMatchObject({ kind: 'ability', abilityId: 'rally' });
  });
});

describe('REFM-229 — стык с main.ts', () => {
  const MAIN = readFileSync(new URL('./main.ts', import.meta.url), 'utf8');
  const CHAIN = readFileSync(new URL('./chainComposer.ts', import.meta.url), 'utf8');
  const init = /initChainComposer\(\{([\s\S]*?)\n\}\);/.exec(MAIN)?.[1] ?? '';

  it('хуки — мир, место, лента, узлы, тип сектора, тап, экран, перерисовка', () => {
    for (const hook of [
      'world: () => s,',
      'me: () => ME,',
      'note,',
      'nodes: () => MAP,',
      'capturable: (id) => sectorTypeOf(id)?.capturable ?? false,',
      'touchTap: () => tapByTouch,',
      'screenPoint: (p) => toScreen(p, canvas.getBoundingClientRect(), VW, VH),',
      'invalidateCmdBar,',
      'invalidatePanel,',
    ]) {
      expect(init, hook).toContain(hook);
    }
  });

  it('чужие зоны правят черновик только дверями', () => {
    expect(MAIN).not.toMatch(/\bchainMode\.(fleetIds|steps|gestures|menu) =/);
    expect(MAIN).not.toMatch(/\bchainMode = /);
    expect(MAIN).not.toMatch(/\bchainRouteCache\b/);
    expect(MAIN.match(/forgetChainRoutes\(\);/g)).toHaveLength(2); // смена матча и впуск в сеть
  });

  it('композер живёт у владельца, `main.ts` только зовёт его', () => {
    expect(MAIN).not.toMatch(
      /\bfunction (enterChainMode|exitChainMode|chainMapTap|chainMenuAnchor|renderChainMenu|positionChainMenu|chainStepsOf|chainStart|chainTravelH|chainRoute|chainAbilitiesFor|castOptionsOf|marchFlagged|nearestOwnWorld)\(/,
    );
    expect(MAIN).not.toContain("getElementById('tgted')?.addEventListener('click'");
    expect(CHAIN).not.toMatch(/from '\.\/main'/);
  });
});
