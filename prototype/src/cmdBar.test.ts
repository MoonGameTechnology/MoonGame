/**
 * Ряд команд (REFM-226) — прямой тест владельца: что ряд показывает выделению, его поповеры,
 * полоска «Приказ» на его месте и кэш разметки, на живом мире прототипа.
 *
 * Что именно складывает состав ряда, держат чистые решения со своими тестами
 * (`cmdPresence`, `cmdAvailability`, `popoverLife`, `chainStripState`). Здесь — то, что
 * собирается только вместе: выделение и взведённые флаги доходят до кнопок, поповеры живут,
 * пока живо их основание, DOM трогается только при новой разметке, а дверь заставляет
 * собрать ряд заново. Каждый тест — свежая загрузка модулей.
 */
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';

import type { Fleet, GameState } from '../../packages/shared-core/src/index';
import { orbitSeats } from '../../decisions/orbitSeats';
import { isEmplacementFleet } from '../../decisions/emplacement';
import { t, tData } from '../../localization/runtime';
import { data } from './gameData';
import type { MapNode } from './game';
import type { MobileOrderKind, MobileOrderTarget } from './mobileOrders';

beforeAll(async () => {
  await import('./cmdBar');
}, 60_000);
beforeEach(() => {
  vi.resetModules();
});
afterEach(() => {
  vi.unstubAllGlobals();
});

/** Узел `#cmdbar` с учётом записей разметки, бокс меню точки и `body`. */
function fakePage() {
  const classes = new Set<string>();
  const eta = { textContent: '' };
  const pop = { scrolled: 0, scrollIntoView: () => pop.scrolled++ };
  let html = '';
  const bar = {
    writes: 0,
    get innerHTML() {
      return html;
    },
    set innerHTML(v: string) {
      html = v;
      bar.writes++;
    },
    classList: {
      add: (c: string) => classes.add(c),
      remove: (c: string) => classes.delete(c),
    },
    querySelector: (sel: string) =>
      sel === '.ch-eta' && html.includes('class="ch-eta"')
        ? eta
        : sel === '.cmdpop' && html.includes('class="cmdpop')
          ? pop
          : null,
  };
  const menuClasses = new Set<string>();
  const menu = {
    innerHTML: '',
    style: { left: '', top: '' },
    classList: {
      add: (c: string) => menuClasses.add(c),
      remove: (c: string) => menuClasses.delete(c),
      contains: (c: string) => menuClasses.has(c),
    },
    addEventListener: () => {},
    getBoundingClientRect: () => ({ width: 200, top: 100 }),
  };
  const body = new Set<string>();
  vi.stubGlobal('document', {
    getElementById: (id: string) => (id === 'cmdbar' ? bar : id === 'tgted' ? menu : null),
    body: {
      classList: { add: (c: string) => body.add(c), remove: (c: string) => body.delete(c) },
    },
  });
  vi.stubGlobal('window', { innerWidth: 1600 });
  return { bar, eta, pop, menu, body, shown: () => classes.has('show') };
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
    mobile: false,
    holo: false,
    console: null as Fleet | null,
    land: false,
    capturable: true,
    orderKind: null as MobileOrderKind | null,
    targetOk: true,
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
  const go = await import('./groupOrders');
  go.initGroupOrders({
    world: () => env.world,
    me: () => 'p1',
    note: () => {},
    seatName: () => undefined,
    selectFleets: () => {},
  });
  const ch = await import('./chainComposer');
  ch.initChainComposer({
    world: () => env.world,
    me: () => 'p1',
    note: () => {},
    nodes: () => [] as MapNode[],
    capturable: () => true,
    touchTap: () => false,
    screenPoint: (p) => p,
    invalidateCmdBar: () => {},
    invalidatePanel: () => {},
  });
  const cb = await import('./cmdBar');
  cb.initCmdBar({
    world: () => env.world,
    me: () => 'p1',
    mobile: () => env.mobile,
    holo: () => env.holo,
    consoleFleet: () => env.console,
    fleetLandShown: () => env.land,
    capturable: () => env.capturable,
    placeName: (id) => `«${id}»`,
    mobileOrderKind: () => env.orderKind,
    mobileTargetAvailable: () => env.targetOk,
    mobileTargetLabel: (target: MobileOrderTarget) => `цель ${target.kind}`,
  });
  const inter = await import('./interaction');
  const home = Object.values(world.planets).find((p) => p.owner === 'p1')!;
  const foe = Object.values(world.planets).find((p) => p.owner === 'p2')!;
  const fleet = Object.values(world.fleets).find((f) => f.owner === 'p1')!;
  /** Выбрать свои флоты, как рамка или тап. */
  const select = (...ids: string[]) =>
    inter.pickFleets(ids, (id) => env.world.fleets[id]?.owner === 'p1');
  /** Поправить флот в мире. */
  const patch = (id: string, change: Partial<Fleet>) => {
    env.world = {
      ...env.world,
      fleets: { ...env.world.fleets, [id]: { ...env.world.fleets[id]!, ...change } },
    };
  };
  /** Кнопки ряда по `data-cmd` — с классом и признаком гашения. */
  const buttons = () =>
    [...page.bar.innerHTML.matchAll(/<button data-cmd="([\w-]+)"([^>]*)>/g)].map((m) => ({
      cmd: m[1]!,
      on: /class="[^"]*\bon\b/.test(m[2]!),
      off: /\bdisabled\b|aria-disabled="true"/.test(m[2]!),
    }));
  const cmds = () => buttons().map((b) => b.cmd);
  return { cb, ch, go, inter, page, env, home, foe, fleet, select, patch, buttons, cmds };
}

/** Второй свой флот рядом с первым. */
function twin(from: Fleet, id: string): Fleet {
  return { ...from, id, units: [{ unit: 'cruiser', count: 1 }] };
}

describe('REFM-226 — что ряд показывает выделению', () => {
  it('без выделения ряд спрятан, а его поповеры и прицелы гаснут вместе с ним', async () => {
    const { cb, inter, page, fleet, select } = await boot();
    select(fleet.id);
    cb.renderCmdBar();
    expect(page.shown()).toBe(true);
    select();
    inter.arm('castMenu', true);
    inter.arm('aiming', true);
    cb.renderCmdBar();
    expect(page.shown()).toBe(false);
    expect(inter.castMenu).toBe(false);
    expect(inter.aiming).toBe(false);
  });

  it('один стоящий флот: «Курс» главная, без «Стопа», штурма и слияния — их нечем делать', async () => {
    const { cb, page, fleet, select, cmds, buttons } = await boot();
    select(fleet.id);
    cb.renderCmdBar();
    expect(page.shown()).toBe(true);
    expect(page.bar.innerHTML).toContain(t('cmd.selection.one'));
    expect(cmds()).toEqual(expect.arrayContaining(['move', 'engage', 'target', 'split', 'more']));
    for (const absent of ['stop', 'attack', 'merge', 'rocket-mine', 'boost'])
      expect(cmds()).not.toContain(absent);
    expect(page.bar.innerHTML).toContain('data-cmd="move" class="btn-main"');
    expect(buttons().find((b) => b.cmd === 'split')?.off).toBe(false);
  });

  it('класс режима «Приказ» на странице не переживает обычный ряд', async () => {
    const { cb, page, fleet, select } = await boot();
    page.body.add('chain-mode');
    select(fleet.id);
    cb.renderCmdBar();
    expect(page.body.has('chain-mode')).toBe(false);
  });

  it('серая кнопка с причиной жмётся и называет причину, а не глотает нажатие', async () => {
    const { cb, page, fleet, select, patch } = await boot();
    patch(fleet.id, { units: [{ unit: 'cruiser', count: 1 }] });
    select(fleet.id);
    cb.renderCmdBar();
    const split = /<button data-cmd="split"[^>]*>/.exec(page.bar.innerHTML)![0];
    expect(split).toContain('aria-disabled="true"');
    expect(split).toContain('data-why="cmd.split.why.single"');
    expect(split).toContain(t('cmd.split.why.single'));
    expect(split).not.toMatch(/\sdisabled[\s>]/);
  });

  it('летящему флоту — «Стоп»; взведённый курс подсвечен', async () => {
    const { cb, inter, env, fleet, home, select, buttons } = await boot();
    const { order, moveFleet } = await import('./game');
    env.world = order(env.world, moveFleet('p1', fleet.id, home.links![0]!), env.world.time).state;
    select(fleet.id);
    inter.arm('aiming', true);
    cb.renderCmdBar();
    expect(buttons().find((b) => b.cmd === 'stop')).toMatchObject({ off: false });
    expect(buttons().find((b) => b.cmd === 'move')?.on).toBe(true);
  });

  it('группа из двух своих флотов: подпись с числом и «Слить»', async () => {
    const { cb, env, page, fleet, select, cmds } = await boot();
    env.world = { ...env.world, fleets: { ...env.world.fleets, x: twin(fleet, 'x') } };
    select(fleet.id, 'x');
    cb.renderCmdBar();
    expect(page.bar.innerHTML).toContain(t('cmd.selection.many', { n: 2 }));
    expect(cmds()).toContain('merge');
    expect(page.bar.innerHTML).toContain(t('cmd.merge'));
  });

  it('штурм есть только с десантом; у планшета его гасит мир под флотом', async () => {
    const { cb, env, fleet, foe, select, patch, buttons } = await boot();
    select(fleet.id);
    patch(fleet.id, { landing: [{ unit: 'militia', count: 2 }] });
    cb.renderCmdBar();
    // Свой мир под флотом — штурмовать нечего.
    expect(buttons().find((b) => b.cmd === 'attack')).toMatchObject({ off: true });
    patch(fleet.id, { location: foe.id, orbit: 'near' });
    cb.invalidateCmdBar();
    cb.renderCmdBar();
    expect(buttons().find((b) => b.cmd === 'attack')).toMatchObject({ off: false });
    env.capturable = false; // сектор, который не берут
    cb.renderCmdBar();
    expect(buttons().find((b) => b.cmd === 'attack')).toMatchObject({ off: true });
    // Телефон целится после нажатия: цель неизвестна, кнопка не гаснет.
    env.mobile = true;
    cb.renderCmdBar();
    expect(buttons().find((b) => b.cmd === 'attack')).toMatchObject({ off: false });
  });

  it('☰ раскрывает стоячие приказы; подсвечено то, что стоит на всей группе', async () => {
    const { cb, go, inter, env, fleet, select, cmds, buttons } = await boot();
    const { RETREAT_THRESHOLDS } = await import('./game');
    select(fleet.id);
    cb.renderCmdBar();
    expect(cmds()).not.toContain('qauto');
    inter.arm('cmdMore', true);
    cb.renderCmdBar();
    expect(buttons().filter((b) => ['boost', 'qauto', 'qretr'].includes(b.cmd))).toEqual([
      { cmd: 'boost', on: false, off: false },
      { cmd: 'qauto', on: false, off: false },
      { cmd: 'qretr', on: false, off: false },
    ]);
    go.restoreAutoAssault([fleet.id]);
    env.world = {
      ...env.world,
      forcedMarch: { [fleet.id]: true },
      autoRetreat: { [fleet.id]: { at: RETREAT_THRESHOLDS[0]! } },
    } as GameState;
    cb.renderCmdBar();
    expect(
      buttons()
        .filter((b) => b.on)
        .map((b) => b.cmd),
    ).toEqual(expect.arrayContaining(['boost', 'qauto', 'qretr', 'more']));
  });

  it('минный заградитель получает свою кнопку', async () => {
    const { cb, fleet, select, patch, cmds } = await boot();
    patch(fleet.id, { units: [{ unit: 'cruiser', count: 1, modules: ['rocket_mine_layer'] }] });
    select(fleet.id);
    cb.renderCmdBar();
    expect(cmds()).toContain('rocket-mine');
  });
});

describe('REFM-226 — поповеры ряда', () => {
  /** Герой на борту: коридор на кулдауне два часа, сбор готов. */
  async function withHero(env: { world: GameState }, fleetId: string) {
    const { HOUR } = await import('./game');
    const hero = {
      id: 'h-test',
      owner: 'p1',
      fleetId,
      equipped: ['corridor', 'rally'],
      cooldowns: { path: env.world.time + 2 * HOUR },
    };
    env.world = { ...env.world, heroes: { [hero.id]: hero } } as unknown as GameState;
  }

  it('✨ только у флота с героем; поповер — по пункту на навык, на кулдауне погашен', async () => {
    const { cb, inter, env, page, fleet, select, cmds } = await boot();
    const { esc, fmtHrs } = await import('./format');
    select(fleet.id);
    env.world = { ...env.world, heroes: {} } as GameState;
    inter.arm('castMenu', true);
    cb.renderCmdBar();
    expect(cmds()).not.toContain('cast');
    expect(inter.castMenu).toBe(false); // основание поповера пропало — пропал и он
    await withHero(env, fleet.id);
    inter.arm('castMenu', true);
    cb.renderCmdBar();
    const casts = [
      ...page.bar.innerHTML.matchAll(/<button data-cmd="castdo"[^>]*>[\s\S]*?<\/button>/g),
    ].map((m) => m[0]);
    expect(casts).toHaveLength(2);
    const corridor = data.heroAbilities['corridor']!;
    expect(casts[0]).toContain('data-ab="corridor" data-hero="h-test" data-desc="ab:corridor"');
    expect(casts[0]).toContain(' disabled');
    expect(casts[0]).toContain(t('cmd.cast.cooldown', { h: fmtHrs(2) }));
    expect(casts[0]).toContain(tData(corridor.name));
    expect(casts[0]).toContain(`title="${esc(t(corridor.description!))}"`);
    expect(casts[1]).not.toContain(' disabled');
    expect(casts[1]).toContain(t('cmd.cast.self'));
    expect(page.bar.innerHTML).toContain('data-cmd="cast" class="btn-second on"');
  });

  it('⮐ поповер порога отхода: «выкл» и пороги, текущий подсвечен', async () => {
    const { cb, inter, env, page, fleet, select } = await boot();
    const { RETREAT_THRESHOLDS } = await import('./game');
    select(fleet.id);
    env.world = {
      ...env.world,
      autoRetreat: { [fleet.id]: { at: RETREAT_THRESHOLDS[1]! } },
    } as GameState;
    inter.arm('retreatMenu', true);
    cb.renderCmdBar();
    const rows = [
      ...page.bar.innerHTML.matchAll(/data-cmd="retrset" data-at="([\d.]+)" class="([^"]*)"/g),
    ];
    expect(rows.map((m) => Number(m[1]))).toEqual([0, ...RETREAT_THRESHOLDS]);
    expect(rows.filter((m) => m[2]!.includes(' on')).map((m) => Number(m[1]))).toEqual([
      RETREAT_THRESHOLDS[1],
    ]);
    expect(page.bar.innerHTML).toContain(t('cmd.retreat.title'));
  });

  it('⇅ меню десанта живёт у своего флота; выбор другого флота его закрывает', async () => {
    const { cb, inter, env, page, fleet, select, cmds } = await boot();
    env.world = { ...env.world, fleets: { ...env.world.fleets, x: twin(fleet, 'x') } };
    select(fleet.id);
    cb.renderCmdBar();
    expect(cmds()).toContain('troops');
    inter.arm('troopsPlan', { fleetId: fleet.id, plan: {} });
    cb.renderCmdBar();
    expect(page.bar.innerHTML).toContain('class="trow');
    select('x');
    cb.renderCmdBar();
    expect(inter.troopsPlan).toBeNull();
    expect(page.bar.innerHTML).not.toContain('class="trow');
  });
});

describe('REFM-226 — телефон и окно ПК', () => {
  it('телефон с взведённым приказом: полоска приказа вместо ряда, черновик сверяется с целью', async () => {
    const { cb, inter, env, page, fleet, home, select } = await boot();
    const { fleetCallsign } = await import('./fleetName');
    env.mobile = true;
    select(fleet.id);
    inter.arm('aiming', true);
    env.orderKind = 'move';
    cb.renderCmdBar();
    expect(page.bar.innerHTML).toContain(`${t('cmd.move')} · ${fleetCallsign(fleet.id)}`);
    expect(page.bar.innerHTML).toContain(t('hud.mobile.target-none'));
    const target = { kind: 'planet', id: home.links![0]! } as const;
    inter.stageDraft({ order: 'move', fleetIds: [fleet.id], target });
    cb.renderCmdBar();
    expect(page.bar.innerHTML).toContain('цель planet');
    env.targetOk = false; // цель перестала годиться — черновик сброшен
    cb.renderCmdBar();
    expect(inter.mobileDraft).toBeNull();
    expect(page.bar.innerHTML).toContain(t('hud.mobile.target-none'));
  });

  it('окно ПК: шапка — позывной и место; консоль своего флота — заголовок «Приказы», ⇅ уходит в лист', async () => {
    const { cb, inter, env, page, fleet, home, select, cmds } = await boot();
    const { fleetCallsign } = await import('./fleetName');
    const { esc } = await import('./format');
    env.holo = true;
    select(fleet.id);
    cb.renderCmdBar();
    expect(page.bar.innerHTML).toContain(`<b>${esc(fleetCallsign(fleet.id))}</b>`);
    expect(page.bar.innerHTML).toContain(esc(`«${home.id}»`));
    expect(page.bar.innerHTML).not.toContain('fc-orders');
    env.console = env.world.fleets[fleet.id]!;
    env.land = true;
    inter.arm('troopsPlan', { fleetId: fleet.id, plan: {} });
    cb.renderCmdBar();
    expect(page.bar.innerHTML).toContain(
      `<div class="fc-title fc-orders"><b>${esc(t('fleet.console.orders'))}</b></div>`,
    );
    expect(cmds()).not.toContain('troops');
    // Меню десанта встаёт поверх колонки листа, а не в ряд.
    const [row, aside] = page.bar.innerHTML.split('</div><div class="cmdpop');
    expect(row).not.toContain('class="trow');
    expect(aside ?? page.bar.innerHTML).toContain('class="trow');
    // Набор группы без флотов — это режим, а не «0 флотов».
    env.console = null;
    select();
    inter.arm('pickMode', true);
    cb.renderCmdBar();
    expect(page.bar.innerHTML).toContain(`<b>${esc(t('cmd.multiselect'))}</b>`);
  });

  it('только что открытый поповер окна ПК докручивается в вид, дальше прокрутка за игроком', async () => {
    const { cb, inter, env, page, fleet, select } = await boot();
    env.holo = true;
    select(fleet.id);
    inter.arm('retreatMenu', true);
    cb.renderCmdBar();
    expect(page.pop.scrolled).toBe(1);
    inter.arm('cmdMore', true); // разметка новая, поповер уже был
    cb.renderCmdBar();
    expect(page.pop.scrolled).toBe(1);
    env.holo = false;
    inter.drop('retreatMenu');
    cb.renderCmdBar();
    inter.arm('retreatMenu', true);
    cb.renderCmdBar();
    expect(page.pop.scrolled).toBe(1); // без окна ПК ряд не прокручивается
  });
});

describe('REFM-226 — полоска «Приказ» на месте ряда', () => {
  it('режим «Приказ» рисует полоску плана со сроком; выход возвращает ряд', async () => {
    const { cb, ch, page, fleet, home, select, cmds, buttons } = await boot();
    select(fleet.id);
    ch.enterChainMode([fleet.id]);
    ch.setChainDraft({ steps: [{ kind: 'move', to: home.links![0]! }], gestures: [1] });
    cb.renderCmdBar();
    expect(cmds()).toEqual(expect.arrayContaining(['chundo', 'chsend', 'chexit']));
    expect(page.body.has('chain-mode')).toBe(true);
    // «Домой» есть, пока у конца плана есть другой свой мир; дома оно гаснет.
    expect(buttons().find((b) => b.cmd === 'chhome')?.off).toBe(false);
    ch.setChainDraft({ steps: [], gestures: [] });
    cb.renderCmdBar();
    expect(buttons().find((b) => b.cmd === 'chhome')?.off).toBe(true);
    ch.setChainDraft({ steps: [{ kind: 'move', to: home.links![0]! }], gestures: [1] });
    cb.renderCmdBar();
    expect(page.eta.textContent).toMatch(/^~/);
    expect(page.eta.textContent).not.toBe('~ —');
    ch.exitChainMode();
    cb.renderCmdBar();
    expect(page.body.has('chain-mode')).toBe(false);
    expect(cmds()).toContain('move');
  });

  it('флоты режима пропали — режим гаснет сам, и ряд собирается обычным', async () => {
    const { cb, ch, env, fleet, select, cmds } = await boot();
    env.world = { ...env.world, fleets: { ...env.world.fleets, x: twin(fleet, 'x') } };
    select(fleet.id);
    ch.enterChainMode(['x']);
    cb.renderCmdBar();
    expect(cmds()).toContain('chsend');
    const x = env.world.fleets['x']!;
    env.world = { ...env.world, fleets: { ...env.world.fleets, x: { ...x, owner: 'p2' } } };
    cb.renderCmdBar();
    expect(ch.chainMode).toBeNull();
    expect(cmds()).not.toContain('chsend');
    expect(cmds()).toContain('move'); // тот же кадр собрал обычный ряд
  });

  it('пока каст целится, полоска уходит с экрана', async () => {
    const { cb, ch, inter, page, fleet, select } = await boot();
    select(fleet.id);
    ch.enterChainMode([fleet.id]);
    inter.arm('heroAim', { heroId: 'h', abilityId: 'corridor' } as never);
    cb.renderCmdBar();
    expect(page.shown()).toBe(false);
    inter.drop('heroAim');
    cb.renderCmdBar();
    expect(page.shown()).toBe(true);
  });

  it('цель меню точки исчезла — меню гаснет, режим живёт', async () => {
    const { cb, ch, env, page, fleet, select } = await boot();
    select(fleet.id);
    ch.enterChainMode([fleet.id]);
    ch.chainMode!.menu = { id: 'p2-1', kind: 'fleet' };
    page.menu.classList.add('show');
    cb.renderCmdBar();
    expect(ch.chainMode?.menu).toEqual({ id: 'p2-1', kind: 'fleet' }); // цель на месте
    const { ['p2-1']: _gone, ...rest } = env.world.fleets;
    env.world = { ...env.world, fleets: rest };
    cb.renderCmdBar();
    expect(ch.chainMode).not.toBeNull();
    expect(ch.chainMode?.menu).toBeNull();
    expect(page.menu.classList.contains('show')).toBe(false);
  });
});

describe('REFM-226 — кэш разметки и дверь', () => {
  it('та же разметка DOM не трогает; дверь заставляет собрать ряд заново', async () => {
    const { cb, page, fleet, select } = await boot();
    select(fleet.id);
    cb.renderCmdBar();
    cb.renderCmdBar();
    expect(page.bar.writes).toBe(1);
    cb.invalidateCmdBar();
    cb.renderCmdBar();
    expect(page.bar.writes).toBe(2);
  });
});

describe('REFM-226 — стык с main.ts', () => {
  const MAIN = readFileSync(new URL('./main.ts', import.meta.url), 'utf8');
  const BAR = readFileSync(new URL('./cmdBar.ts', import.meta.url), 'utf8');
  const init = /initCmdBar\(\{([\s\S]*?)\n\}\);/.exec(MAIN)?.[1] ?? '';

  it('хуки — мир, место, раскладка, окно флота, сектор, имя места, мобильный черновик', () => {
    for (const hook of [
      'world: () => s,',
      'me: () => ME,',
      'mobile: () => MOBILE,',
      'holo: () => holographic.active(),',
      'consoleFleet,',
      'fleetLandShown,',
      'capturable: (id) => !!sectorTypeOf(id)?.capturable,',
      'placeName,',
      'mobileOrderKind,',
      'mobileTargetAvailable,',
      'mobileTargetLabel,',
    ])
      expect(init).toContain(hook);
  });

  it('ряд и его кэш уехали целиком; модуль не тянет main.ts', () => {
    expect(MAIN).not.toMatch(/\blastCmdHtml\b/);
    for (const fn of [
      'cmdBtn',
      'renderChainBar',
      'updateChainDom',
      'invalidateCmdBar',
      'renderCmdBar',
      'troopsPopHtml',
    ])
      expect(MAIN).not.toMatch(new RegExp(`function ${fn}\\(`));
    expect(BAR).not.toMatch(/from '\.\/main'/);
  });
});
