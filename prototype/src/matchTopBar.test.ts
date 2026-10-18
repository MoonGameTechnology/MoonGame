/**
 * Верхняя полоса матча (REFM-222) — прямой тест владельца.
 *
 * Полоса рисует строку статуса, ряд 1 шапки, плашки ресурсов, значки внимания, тревогу «враг у
 * ваших рубежей», полосу скорости и досье Роя, а темп, мир, окна и паузу забега берёт у игры
 * хуками. Здесь проверено то, что текстом не проверить: строка статуса собирает чипы и не
 * трогает узел без перемен, ряд 1 печатает место и очки по живому счёту, плашка ресурса
 * переживает кадр тем же узлом (иначе клик по ней теряется), значки прячут ноль, тревога
 * звонит раз на эпизод и забывает старый матч, кнопки полосы ставят темп через игру, а «‖»
 * забега идёт через правило паузы. Каждый тест — свежая загрузка модуля над своей страницей:
 * у полосы свои кеши и память тревог. В конце — стык с `main.ts`.
 */
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';

import { setLocale, t } from '../../localization/runtime';
import {
  createInitialState,
  type Fleet,
  type GameState,
  type Planet,
  type Player,
} from '../../packages/shared-core/src/index';
import type { MissionRow } from '../../decisions/missionView';
import { clockHM, countdownHMS } from './format';
import { stewFmtDur } from './stewardScreen';
import { DAY, HOUR } from './time';

// Под Node нет языка браузера: рантайм свалился бы в EN, и подписи разъехались бы с ожиданиями.
beforeAll(() => setLocale('ru'));

/** Узел страницы: ровно то, что полоса трогает у DOM. `innerHTML` считает записи — по ним
 *  видно, перерисовал ли кадр узел. */
class FakeEl {
  textContent = '';
  title = '';
  hidden = false;
  scrollTop = 0;
  className = '';
  style: Record<string, string> = {};
  dataset: Record<string, string> = {};
  attrs: Record<string, string> = {};
  children: FakeEl[] = [];
  htmlWrites = 0;
  focused = 0;
  private html = '';
  private readonly classes = new Set<string>();
  private readonly listeners: Record<string, Array<(e: unknown) => void>> = {};
  readonly classList = {
    add: (n: string) => void this.classes.add(n),
    remove: (n: string) => void this.classes.delete(n),
    contains: (n: string) => this.classes.has(n),
    toggle: (n: string, force?: boolean) => {
      const on = force ?? !this.classes.has(n);
      if (on) this.classes.add(n);
      else this.classes.delete(n);
      return on;
    },
  };
  constructor(readonly id = '') {}
  get innerHTML(): string {
    return this.html;
  }
  set innerHTML(v: string) {
    this.html = v;
    this.htmlWrites++;
  }
  setAttribute(k: string, v: string): void {
    this.attrs[k] = v;
  }
  removeAttribute(k: string): void {
    delete this.attrs[k];
  }
  addEventListener(type: string, fn: (e: unknown) => void): void {
    (this.listeners[type] ??= []).push(fn);
  }
  replaceChildren(...kids: FakeEl[]): void {
    this.children = kids;
  }
  focus(): void {
    this.focused++;
  }
  querySelector(): null {
    return null;
  }
  /** Нажатие по узлу; `target` — во что попал палец (по умолчанию сам узел). */
  click(target: unknown = this): void {
    for (const fn of this.listeners.click ?? []) fn({ target });
  }
}

/** Цель нажатия внутри узла: `closest` находит только свой селектор. */
const hit = (selector: string, found: object = {}) => ({
  closest: (q: string) => (q === selector ? found : null),
});

// Плашка: `<span class title data-res><i>…</i><span class="rv">…</span></span>` — без вложенных
// плашек, поэтому граница одной плашки — первое `</span></span>` после её начала.
const CHIP = /<span class="([^"]*)" title="([^"]*)" data-res="([^"]*)">([\s\S]*?<\/span>)<\/span>/g;

/** `<template>` страницы: разбирает разметку плашек в узлы, как это сделал бы браузер. */
class FakeTemplate {
  content = { children: [] as FakeEl[] };
  set innerHTML(html: string) {
    this.content.children = [...html.matchAll(CHIP)].map(([, cls, title, res, inner]) => {
      const el = new FakeEl();
      el.className = cls!;
      el.title = title!;
      el.dataset.res = res!;
      el.innerHTML = inner!;
      return el;
    });
  }
}

const planet = (id: string, x: number, owner: string | null): Planet => ({
  id,
  owner,
  kind: 'planet',
  position: { x, y: 0 },
  resources: {},
  buildings: [],
  garrison: [],
  traits: [],
  links: [],
});

const player = (id: string, resources: Record<string, number> = {}): Player =>
  ({ id, name: id, faction: 'azure', status: 'active', resources }) as Player;

const fleet = (id: string, owner: string, location: string | null, extra: object = {}): Fleet =>
  ({
    id,
    owner,
    location,
    movement: null,
    units: [{ unit: 'frigate', count: 1 }],
    traits: [],
    battleId: null,
    ...extra,
  }) as unknown as Fleet;

/** Я — p1 на A; p2 и p3 — соперники. Третий час второго дня. */
function world(): GameState {
  const st = createInitialState({ seed: 'topbar', version: { data: '0.1.0', manifest: '1' } });
  return {
    ...st,
    time: DAY + 3 * HOUR,
    planets: { A: planet('A', 0, 'p1'), N: planet('N', 60, 'p2'), E: planet('E', 10_000, 'p3') },
    players: {
      p1: player('p1', { credits: 1500, metal: 40, food: 0, energy: 7, microelectronics: 0 }),
      p2: player('p2'),
      p3: player('p3'),
    },
    fleets: { F1: fleet('F1', 'p1', 'A') },
    match: {
      status: 'ongoing',
      winner: null,
      scores: { p1: { total: 120 }, p2: { total: 300 }, p3: { total: 40 } },
    },
  } as unknown as GameState;
}

const mission = (complete: boolean): MissionRow =>
  ({
    id: complete ? 'm1' : 'm2',
    kind: 'capture',
    done: 0,
    total: 1,
    complete,
  }) as unknown as MissionRow;

const PLAY = 1 / 3600;

/** Свежая загрузка полосы над страницей-заглушкой и игрой, которая записывает, что от неё просили. */
async function boot(
  over: Record<string, unknown> = {},
  opts: { dev?: boolean; folded?: boolean } = {},
) {
  vi.resetModules();
  const env = {
    s: world(),
    names: { p1: 'Орион', p2: 'Багровые', p3: 'Вега' } as Record<string, string>,
    inMatch: true,
    speed: PLAY,
    runPause: false,
    toolsHidden: false,
    scoreLimit: 1000,
    nick: '',
    income: { credits: 12, metal: -3 } as Record<string, number>,
    mobile: false,
    aiSeats: 2,
    speedControl: true,
    allyPulsing: false,
    missionsOpen: false,
    desktop: false,
    pc: true,
    net: false,
    unread: 0,
    run: false,
    sectorZero: false,
    dev: false,
    soloSave: false,
    allyStep: null as string | null,
    seen: true,
    engaged: new Set<string>(),
    ...over,
  };
  const rec = {
    speeds: [] as number[],
    clockRestarts: 0,
    pauses: [] as string[],
    sync: [] as unknown[][],
    phone: [] as Array<[number, number]>,
    pulses: 0,
    allyOpens: 0,
    missionToggles: 0,
    resources: [] as string[],
    restarts: 0,
    notes: [] as Array<[string, unknown]>,
    toasts: [] as string[],
    jumps: [] as string[],
    saves: [] as unknown[],
    wallet: 0,
    storage: { ...(opts.folded ? { 'vd.swarmDossier.folded': '1' } : {}) } as Record<
      string,
      string
    >,
  };

  // Лента (тосты и заметки), камера, туман, сеть и забег тянут холст, ядро и окна — подменены:
  // полоса берёт у них только эти зовы и флаги.
  vi.doMock('./eventFeed', () => ({
    note: (text: string, at?: unknown) => void rec.notes.push([text, at]),
    toast: (text: string) => void rec.toasts.push(text),
  }));
  vi.doMock('./mapCamera', () => ({ jumpToPing: (id: string) => void rec.jumps.push(id) }));
  vi.doMock('./mapFog', () => ({
    fleetSeen: () => env.seen,
    known: () => false,
    get vision() {
      return { identify: new Set<string>(), engaged: { battles: env.engaged } };
    },
  }));
  vi.doMock('./messageLog', () => ({
    get unreadMsgs() {
      return env.unread;
    },
  }));
  vi.doMock('./netSession', () => ({
    get NET() {
      return env.net;
    },
    get netWorld() {
      return env.net;
    },
  }));
  vi.doMock('./sectorRun', () => ({
    isSectorZeroRun: () => env.sectorZero,
    get sectorDevActive() {
      return env.dev;
    },
    get sectorRunActive() {
      return env.run;
    },
  }));
  vi.doMock('./sectorProfile', () => ({ sectorProgress: { chaptersWon: [] } }));
  vi.doMock('./sectorZeroShell', () => ({ runWallet: { render: () => void rec.wallet++ } }));
  vi.doMock('./soloCheckpoint', () => ({
    get soloSaveActive() {
      return env.soloSave;
    },
    saveSolo: (manual: unknown) => void rec.saves.push(manual),
  }));
  vi.doMock('./graphicsPrefs', () => ({ motionOn: () => true, pcUi: () => env.pc }));
  vi.doMock('./allyScreen', () => ({ ALLY_EMBLEM: '⬡' }));
  vi.doMock('../../decisions/allyPanel', () => ({
    allyPanelView: () => (env.allyStep ? { step: env.allyStep } : null),
  }));

  // Страница: узлы по id создаются по первому зову; ряд скорости и чипы множителя — свои.
  const els = new Map<string, FakeEl>();
  const el = (id: string): FakeEl => {
    let e = els.get(id);
    if (!e) els.set(id, (e = new FakeEl(id)));
    return e;
  };
  el('spd-pause').dataset.speed = '0';
  el('spd-play').dataset.speed = '0';
  el('spd-fast').dataset.speed = '0';
  const speedBtns = [el('spd-pause'), el('spd-play'), el('spd-fast')];
  if (opts.dev) speedBtns.push(el('spd-dev'));
  const mults = ['1', '10'].map((m) => {
    const chip = new FakeEl();
    chip.dataset.mult = m;
    return chip;
  });
  vi.stubGlobal('document', {
    getElementById: (id: string) => (id === 'spd-dev' && !opts.dev ? null : el(id)),
    querySelectorAll: (q: string) =>
      q === '[data-speed]' ? speedBtns : q === '[data-mult]' ? mults : [],
    createElement: () => new FakeTemplate(),
  });
  vi.stubGlobal('window', {
    matchMedia: () => ({
      get matches() {
        return env.desktop;
      },
    }),
  });
  vi.stubGlobal('localStorage', {
    getItem: (k: string) => rec.storage[k] ?? null,
    setItem: (k: string, v: string) => void (rec.storage[k] = v),
  });

  // Свежая загрузка берёт и свежий рантайм локали: без языка браузера он встал бы на EN.
  (await import('../../localization/runtime')).setLocale('ru');
  const m = await import('./matchTopBar');
  m.initTopBar({
    world: () => env.s,
    me: () => 'p1',
    names: () => env.names,
    placeName: (id) => `«${id}»`,
    inMatch: () => env.inMatch,
    speed: () => env.speed,
    setSpeed: (v) => {
      env.speed = v;
      rec.speeds.push(v);
    },
    restartRealClock: () => void rec.clockRestarts++,
    runPauseShown: () => env.runPause,
    runPauseEvent: (e) => void rec.pauses.push(e),
    toolsHidden: () => env.toolsHidden,
    scoreLimit: () => env.scoreLimit,
    nick: () => env.nick,
    income: () => env.income,
    mobile: () => env.mobile,
    aiSeats: () => env.aiSeats,
    speedControl: () => env.speedControl,
    phoneSpeed: () => ({ sync: (...args: unknown[]) => void rec.sync.push(args) }) as never,
    phoneBadges: (battles, unread) => void rec.phone.push([battles, unread]),
    allyPulsing: () => env.allyPulsing,
    pulseAlly: () => void rec.pulses++,
    openAlly: () => void rec.allyOpens++,
    toggleMissions: () => void rec.missionToggles++,
    missionsOpen: () => env.missionsOpen,
    openResource: (key) => void rec.resources.push(key),
    restart: () => void rec.restarts++,
  });
  return { m, env, rec, el, mults };
}

// Первая загрузка полосы тянет ядро, данные и решения — секунды под нагрузкой полного гейта.
// Граф греется один раз; тесты после `vi.resetModules()` берут его из кеша трансформаций.
beforeAll(async () => {
  vi.stubGlobal('__PLAYER_BUILD__', false);
  await boot();
  vi.unstubAllGlobals();
}, 60_000);
beforeEach(() => {
  vi.stubGlobal('__PLAYER_BUILD__', false);
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('строка статуса', () => {
  it('часы — время суток, в забеге Sector Zero — сколько забег идёт', async () => {
    const { m, el } = await boot();
    m.renderTopBar([]);
    expect(el('devline-head').innerHTML).toBe(`<span id="clock">${clockHM(DAY + 3 * HOUR)}</span>`);
    const run = await boot({ sectorZero: true });
    run.m.renderTopBar([]);
    expect(run.el('devline-head').innerHTML).not.toBe(
      `<span id="clock">${clockHM(DAY + 3 * HOUR)}</span>`,
    );
  });

  it('чип задач несёт счёт закрытых и открытость панели; ни одной задачи — чипа нет', async () => {
    const { m, el, env } = await boot({ missionsOpen: true });
    m.renderTopBar([mission(true), mission(false)]);
    const tail = el('devline-status').innerHTML;
    expect(tail).toContain('data-missions="1" aria-expanded="true"');
    expect(tail).toContain(`<span>${t('hud.missions.label')}</span><b>1/2</b>`);
    env.missionsOpen = false;
    m.renderTopBar([]);
    expect(el('devline-status').innerHTML).not.toContain('data-missions');
  });

  it('волна стоит у часов: номер, всего и отсчёт до следующей', async () => {
    const { m, el, env } = await boot();
    env.s = {
      ...env.s,
      pve: { waveNumber: 2, totalWaves: 5, nextWaveAt: env.s.time + 90 * 60_000 },
    } as GameState;
    m.renderTopBar([]);
    const tail = el('devline-status').innerHTML;
    expect(tail).toContain(t('hud.wave', { n: 2, m: 5 }));
    expect(tail).toContain(t('hud.wave.next', { in: countdownHMS(90 * 60_000) }));
  });

  it('чип союзника — только в забеге после встречи, мигает по хуку игры', async () => {
    const { m, el, env } = await boot({ allyStep: 'advance' });
    m.renderTopBar([]);
    expect(el('devline-status').innerHTML).not.toContain('data-ally-open');
    env.run = true;
    env.allyPulsing = true;
    m.renderTopBar([]);
    const tail = el('devline-status').innerHTML;
    expect(tail).toContain('class="dl-ally pulse" data-ally-open="1"');
    expect(tail).toContain(`<b>${t('ally.step.advance')}</b>`);
  });

  it('Суверены в строке статуса — без числа, в забеге их нет; кошелёк забега рисуется каждый кадр', async () => {
    const { m, el, env, rec } = await boot();
    m.renderTopBar([]);
    const status = el('devline-status').innerHTML;
    expect(status).toContain('class="dl-donate" data-donate="1"');
    expect(status).toContain(`aria-label="${t('donate.open')}"`);
    expect(status).not.toMatch(/dl-donate[^]*<b>/);
    env.toolsHidden = true;
    m.renderTopBar([]);
    expect(el('devline-status').innerHTML).not.toContain('data-donate');
    expect(rec.wallet).toBe(2);
  });

  it('сохранение одиночной партии: «сохранить» всегда, «продолжить» — только на паузе', async () => {
    const { m, el, env } = await boot({ soloSave: true });
    m.renderTopBar([]);
    expect(el('devline-status').innerHTML).toContain('data-solo-save="1"');
    expect(el('devline-status').innerHTML).not.toContain('data-solo-play');
    env.speed = 0;
    m.renderTopBar([]);
    expect(el('devline-status').innerHTML).toContain('data-solo-play="1"');
    env.net = true;
    m.renderTopBar([]);
    expect(el('devline-status').innerHTML).not.toContain('data-solo');
  });

  it('без перемен узел не перерисовывается; забытая строка рисуется заново', async () => {
    const { m, el } = await boot({ soloSave: true });
    m.renderTopBar([]);
    m.renderTopBar([]);
    expect(el('devline-status').htmlWrites).toBe(1);
    expect(el('devline-head').htmlWrites).toBe(1);
    m.forgetStatusLine();
    m.renderTopBar([]);
    expect(el('devline-status').htmlWrites).toBe(2);
  });

  it('нажатия строки ведут к игре: задачи, союзник, магазин, сохранение и «продолжить»', async () => {
    const { m, el, env, rec } = await boot({ soloSave: true, speed: 0 });
    m.applyTimeSpeed(10);
    env.speed = 0;
    rec.speeds.length = 0;
    const line = el('devline');
    line.click(hit('[data-missions]'));
    line.click(hit('[data-ally-open]'));
    line.click(hit('[data-donate]'));
    line.click(hit('[data-solo-save]'));
    line.click(hit('[data-solo-play]'));
    expect(rec.missionToggles).toBe(1);
    expect(rec.allyOpens).toBe(1);
    expect(rec.toasts).toEqual([t('donate.where')]);
    expect(rec.saves).toEqual([true]);
    // «Продолжить» — темп кнопки ▶ и без нагона: время паузы мир не отыгрывает.
    expect(rec.speeds).toEqual([PLAY * 10]);
    expect(rec.clockRestarts).toBe(1);
    expect(el('spd-play').classList.contains('on')).toBe(true);
  });
});

describe('ряд 1 шапки', () => {
  it('позывной, живое место, ✦-чип очков и день с отсчётом — цифрами', async () => {
    const { m, el } = await boot({ nick: '  Капитан ' });
    m.renderTopBar([]);
    expect(el('tbname').textContent).toBe('Капитан');
    expect(el('tbplace').textContent).toBe(t('hud.place', { p: 2, n: 3 }));
    expect(el('tbscore').textContent).toBe('✦ 120/1000');
    expect(el('tbscore').classList.contains('win')).toBe(false);
    expect(el('tbday').textContent).toBe(t('browser.day', { n: 2 }));
    expect(el('tbeta').textContent).toBe(countdownHMS(DAY - 3 * HOUR));
  });

  it('пустой ввод — имя дома; порог взят — чип светится; без счёта места нет', async () => {
    const { m, el, env } = await boot({ scoreLimit: 120 });
    m.renderTopBar([]);
    expect(el('tbname').textContent).toBe('Орион');
    expect(el('tbscore').classList.contains('win')).toBe(true);
    env.s = { ...env.s, match: { ...env.s.match, scores: {} } } as GameState;
    m.renderTopBar([]);
    expect(el('tbplace').textContent).toBe('');
  });

  it('✦-чип по нажатию объясняет счёт: очки, порог, миры и станции', async () => {
    const { el, rec } = await boot();
    el('top').click(hit('.dstat'));
    expect(rec.notes).toEqual([
      [t('hud.score.tip', { score: 120, limit: 1000, w: 1, s: 0 }), undefined],
    ]);
    el('top').click(hit('.who'));
    expect(rec.notes).toHaveLength(1);
  });
});

describe('плашки ресурсов', () => {
  it('пять ресурсов сессии; пустой и не текущий гаснет; биомасса — только когда она есть', async () => {
    const { m, el, env } = await boot();
    m.renderTopBar([]);
    const chips = el('purse').children;
    expect(chips.map((c) => c.dataset.res)).toEqual([
      'credits',
      'metal',
      'food',
      'energy',
      'microelectronics',
    ]);
    expect(chips[2]!.className).toBe('res dead');
    expect(chips[0]!.className).toBe('res');
    env.s.players.p1!.resources.biomass = 5;
    m.renderTopBar([]);
    expect(el('purse').children.map((c) => c.dataset.res)).toContain('biomass');
  });

  it('кадр меняет число на месте: узел плашки тот же, и клик по нему не теряется', async () => {
    const { m, el, env } = await boot();
    m.renderTopBar([]);
    const metal = el('purse').children[1]!;
    const before = metal.innerHTML;
    env.s.players.p1!.resources.metal = 41;
    m.renderTopBar([]);
    expect(el('purse').children[1]).toBe(metal);
    expect(metal.innerHTML).not.toBe(before);
    expect(metal.innerHTML).toContain('<b>41</b>');
  });

  it('долг по ресурсу — ⚠ вместо скорости', async () => {
    const { m, el, env } = await boot();
    env.s.players.p1!.arrears = ['energy'] as never;
    m.renderTopBar([]);
    const energy = el('purse').children.find((c) => c.dataset.res === 'energy')!;
    expect(energy.className).toBe('res short');
    expect(energy.innerHTML).toContain('<em class="dn">⚠</em>');
  });

  it('нажатие по плашке открывает карточку ресурса', async () => {
    const { el, rec } = await boot();
    el('purse').click(hit('[data-res]', { dataset: { res: 'metal' } }));
    el('purse').click(hit('.nothing'));
    expect(rec.resources).toEqual(['metal']);
  });
});

describe('значки внимания', () => {
  it('ноль прячет значок; мой бой и письма зеркалятся на гамбургер, пока панель закрыта', async () => {
    const { m, el, env, rec } = await boot();
    m.renderTopBar([]);
    expect(el('msgbadge').style.display).toBe('none');
    expect(el('alertbadge').style.display).toBe('none');
    // Зеркало скрыто разметкой и без внимания не трогается: пустая строка и есть «скрыть».
    expect(el('railalert').style.display).toBeUndefined();
    env.unread = 2;
    env.s = {
      ...env.s,
      battles: { b1: { id: 'b1', location: 'A', sides: [{ owner: 'p1' }, { owner: 'p2' }] } },
    } as unknown as GameState;
    m.renderTopBar([]);
    expect(el('msgbadge').style.display).toBe('');
    expect(el('msgbadge').textContent).toBe('2');
    expect(el('alertbadge').style.display).toBe('grid');
    expect(el('alertbadge').textContent).toBe('1');
    expect(el('railalert').style.display).toBe('grid');
    expect(el('railalert').textContent).toBe('3');
    expect(rec.phone.at(-1)).toEqual([1, 2]);
    el('rail').classList.add('open');
    m.renderTopBar([]);
    expect(el('railalert').style.display).toBe('none');
  });

  it('чужой бой в моём блоке зрения тоже зовёт на тревогу', async () => {
    const { m, el, env } = await boot();
    env.s = {
      ...env.s,
      battles: { b2: { id: 'b2', location: 'E', sides: [{ owner: 'p2' }, { owner: 'p3' }] } },
    } as unknown as GameState;
    m.renderTopBar([]);
    expect(el('alertbadge').style.display).toBe('none');
    env.engaged.add('b2');
    m.renderTopBar([]);
    expect(el('alertbadge').textContent).toBe('1');
  });
});

describe('тревога «враг у ваших рубежей»', () => {
  const hostileAtHome = (s: GameState): GameState =>
    ({ ...s, fleets: { ...s.fleets, X: fleet('X', 'p2', 'A') } }) as GameState;

  it('один звонок на эпизод и не чаще раза в игровой час', async () => {
    const { m, env, rec } = await boot();
    env.s = hostileAtHome(env.s);
    m.updateThreatAlerts();
    m.updateThreatAlerts();
    expect(rec.notes).toEqual([[t('threat.here', { node: '«A»' }), 'A']]);
    env.s = { ...env.s, time: env.s.time + HOUR };
    m.updateThreatAlerts(); // флот стоит дальше — тот же эпизод
    expect(rec.notes).toHaveLength(1);
  });

  it('флот на подходе — со сроком прибытия', async () => {
    const { m, env, rec } = await boot();
    const at = env.s.time;
    env.s = {
      ...env.s,
      fleets: {
        ...env.s.fleets,
        X: fleet('X', 'p2', null, {
          movement: { from: 'N', to: 'A', departedAt: at - HOUR, arrivesAt: at + 2 * HOUR },
        }),
      },
    } as GameState;
    m.updateThreatAlerts();
    expect(rec.notes).toHaveLength(1);
    const [text, node] = rec.notes[0]!;
    expect(node).toBe('A');
    expect(text).toBe(t('threat.incoming', { node: '«A»', dur: stewFmtDur(2 * HOUR) }));
  });

  it('смена матча забывает старый эпизод: тот же id мира и флота звонит снова', async () => {
    const { m, env, rec } = await boot();
    env.s = hostileAtHome(env.s);
    m.updateThreatAlerts();
    m.resetThreatAlerts();
    m.updateThreatAlerts();
    expect(rec.notes).toHaveLength(2);
  });

  it('выбывший игрок тревог не слышит', async () => {
    const { m, env, rec } = await boot();
    env.s = hostileAtHome(env.s);
    env.s.players.p1 = { ...env.s.players.p1!, status: 'defeated' } as Player;
    m.updateThreatAlerts();
    expect(rec.notes).toEqual([]);
  });

  it('курс главных сил к найденным докам — доклад союзника раз на флот и мигающий чип', async () => {
    const { m, env, rec } = await boot();
    const at = env.s.time;
    env.s = {
      ...env.s,
      planets: { ...env.s.planets, R: planet('R', 5_000, null) },
      fleets: {
        ...env.s.fleets,
        G: fleet('G', 'p3', null, {
          movement: { from: 'E', to: 'R', departedAt: at - HOUR, arrivesAt: at + 5 * HOUR },
        }),
      },
      operation: { forces: { main: { fleets: ['G'] } } },
      missionFacts: { found: { p1: ['R'] } },
    } as unknown as GameState;
    m.updateThreatAlerts();
    expect(rec.notes).toEqual([[t('refuge.threat'), 'R']]);
    expect(rec.pulses).toBe(1);
    env.s = { ...env.s, time: env.s.time + HOUR };
    m.updateThreatAlerts();
    expect(rec.notes).toHaveLength(1);
    expect(rec.pulses).toBe(1);
  });
});

describe('полоса скорости', () => {
  it('множитель настраивает пару «играть / ускорить» и пускает мир', async () => {
    const { m, el, mults, rec } = await boot();
    m.applyTimeSpeed(10);
    expect(Number(el('spd-play').dataset.speed)).toBeCloseTo(PLAY * 10);
    expect(Number(el('spd-fast').dataset.speed)).toBeCloseTo(PLAY * 30);
    expect(rec.speeds).toEqual([PLAY * 10]);
    expect(el('spd-play').classList.contains('on')).toBe(true);
    expect(mults.map((c) => c.classList.contains('on'))).toEqual([false, true]);
    m.applyTimeSpeed(1, 5); // у забега своё отношение ускорения
    expect(Number(el('spd-fast').dataset.speed)).toBeCloseTo(PLAY * 5);
    mults[0]!.click();
    expect(rec.speeds.at(-1)).toBeCloseTo(PLAY);
  });

  it('кнопка темпа ставит его через игру; «‖» забега идёт через правило паузы', async () => {
    const { m, el, env, rec } = await boot();
    m.applyTimeSpeed(1);
    el('spd-fast').click();
    expect(rec.speeds.at(-1)).toBeCloseTo(PLAY * 3);
    expect(el('spd-fast').classList.contains('on')).toBe(true);
    expect(el('spd-play').classList.contains('on')).toBe(false);
    el('spd-pause').click();
    expect(env.speed).toBe(0);
    env.runPause = true;
    const before = rec.speeds.length;
    el('spd-pause').click();
    expect(rec.pauses).toEqual(['toggle']);
    expect(rec.speeds).toHaveLength(before);
  });

  it('перезапуск — только в песочнице без ботов и вне сети; нажатие зовёт игру', async () => {
    const { m, el, env, rec } = await boot({ aiSeats: 0 });
    m.renderSpeedbar();
    expect(el('restart').style.display).toBe('');
    expect(el('restart-sep').style.display).toBe('');
    env.aiSeats = 1;
    m.renderSpeedbar();
    expect(el('restart').style.display).toBe('none');
    el('restart').click();
    expect(rec.restarts).toBe(1);
  });

  it('в забеге полоса несёт только его темп, а телефон получает темп без множителя', async () => {
    const { m, el, env, rec } = await boot({ mobile: true, pc: false, speedControl: false });
    m.applyTimeSpeed(10);
    m.renderSpeedbar();
    expect(el('speedbar').classList.contains('spd-run')).toBe(false);
    expect(rec.sync.at(-1)).toEqual([true, 'play', 10]);
    env.toolsHidden = true;
    m.renderSpeedbar();
    expect(el('speedbar').classList.contains('spd-run')).toBe(true);
    expect(rec.sync.at(-1)).toEqual([true, 'play', null]);
    env.inMatch = false;
    m.renderSpeedbar();
    expect(rec.sync.at(-1)![0]).toBe(false);
  });

  it('ПК без дев-управления временем прячет полосу: пустой коробки в углу карты нет', async () => {
    const { m, el } = await boot({ speedControl: false });
    m.renderSpeedbar();
    expect(el('speedbar').style.display).toBe('none');
    expect(el('spd-ctl').style.display).toBe('none');
  });

  it('в сети управления временем нет и на ПК с дев-выключателем — полоса гаснет целиком', async () => {
    const { m, el, env } = await boot({ speedControl: true });
    m.renderSpeedbar();
    expect(el('spd-ctl').style.display).toBe('');
    env.net = true;
    m.renderSpeedbar();
    expect(el('spd-ctl').style.display).toBe('none');
    expect(el('speedbar').style.display).toBe('none');
  });

  it('▶▶▶ дев-забега — свой темп и видна только в дев-забеге', async () => {
    const { m, el, env, rec } = await boot(
      { toolsHidden: true, mobile: true, pc: false },
      { dev: true },
    );
    expect(Number(el('spd-dev').dataset.speed)).toBeGreaterThan(0);
    m.renderSpeedbar();
    expect(el('spd-dev').hidden).toBe(true);
    env.dev = true;
    env.speed = Number(el('spd-dev').dataset.speed);
    m.renderSpeedbar();
    expect(el('spd-dev').hidden).toBe(false);
    expect(rec.sync.at(-1)![1]).toBe('dev');
  });
});

describe('досье Роя', () => {
  const pve = (s: GameState): GameState =>
    ({ ...s, pve: { waveNumber: 1, totalWaves: 3, nextWaveAt: s.time + HOUR } }) as GameState;

  it('на ПК досье приколото справа и открыто; вне матча прячется', async () => {
    const { m, el, env } = await boot({ desktop: true });
    env.s = pve(env.s);
    m.renderSwarmDossier(0);
    const win = el('swarm-dossier');
    expect(m.swarmDossierPinned).toBe(true);
    expect(win.classList.contains('pinned')).toBe(true);
    expect(win.classList.contains('show')).toBe(true);
    expect(win.attrs.role).toBe('complementary');
    expect(el('swarm-dossier-badge').textContent).toBe(t('swarm.intel.badge.none'));
    m.closeSwarmDossier(); // приколотое не закрывается
    expect(win.classList.contains('show')).toBe(true);
    env.inMatch = false;
    m.renderSwarmDossier(1_000);
    expect(win.classList.contains('show')).toBe(false);
  });

  it('на телефоне вход — язычок: он открывает досье диалогом, «Закрыть» возвращает фокус', async () => {
    const { m, el, env } = await boot();
    env.s = pve(env.s);
    m.renderTopBar([]);
    const tab = el('swarm-tab');
    expect(tab.hidden).toBe(false);
    expect(el('rail-dossier').style.display).toBe('');
    tab.click();
    const win = el('swarm-dossier');
    expect(win.classList.contains('show')).toBe(true);
    m.renderTopBar([]);
    expect(tab.hidden).toBe(true); // ручка уже выдвинутой панели не нужна
    m.closeSwarmDossier();
    expect(win.classList.contains('show')).toBe(false);
    expect(tab.focused).toBe(1);
  });

  it('свёрнутость приколотого досье переживает перезагрузку', async () => {
    const { m, el, env, rec } = await boot({ desktop: true });
    env.s = pve(env.s);
    m.renderSwarmDossier(0);
    el('swarm-dossier-fold').click();
    expect(el('swarm-dossier').classList.contains('folded')).toBe(true);
    expect(rec.storage['vd.swarmDossier.folded']).toBe('1');
    const again = await boot({ desktop: true }, { folded: true });
    again.env.s = pve(again.env.s);
    again.m.renderSwarmDossier(0);
    expect(again.el('swarm-dossier').classList.contains('folded')).toBe(true);
    expect(again.el('swarm-dossier-fold').title).toBe(t('swarm.intel.unfold'));
  });

  it('ссылка на мир в досье ведёт камеру; выдвинутая панель уступает карту', async () => {
    const { m, el, env, rec } = await boot();
    env.s = pve(env.s);
    el('swarm-tab').click();
    el('swarm-dossier-body').click(hit('[data-jump]', { dataset: { jump: 'N' } }));
    expect(rec.jumps).toEqual(['N']);
    expect(el('swarm-dossier').classList.contains('show')).toBe(false);
    m.renderTopBar([]);
  });

  it('смена матча прячет досье старого матча', async () => {
    const { m, el, env } = await boot();
    env.s = pve(env.s);
    el('swarm-tab').click();
    m.hideSwarmDossier();
    expect(el('swarm-dossier').classList.contains('show')).toBe(false);
  });
});

describe('стык с main.ts', () => {
  const MAIN = readFileSync(new URL('./main.ts', import.meta.url), 'utf8');

  it('main поднимает полосу один раз и зовёт её кадр', () => {
    expect(MAIN.match(/\ninitTopBar\(\{/g)).toHaveLength(1);
    expect(MAIN).toMatch(/\n {2}renderTopBar\(missions\);\n {2}missionPanel\.render\(missions\);/);
    expect(MAIN).toMatch(/renderEndScreen\(\);\s*renderSpeedbar\(\);/);
    expect(MAIN).toContain('updateThreatAlerts(); // «враг у ваших рубежей»');
    expect(MAIN).toContain('onToggle: forgetStatusLine,');
  });

  it('смена матча сбрасывает тревоги и прячет досье', () => {
    expect(MAIN).toMatch(/\n {2}hideSwarmDossier\(\);/);
    expect(MAIN).toMatch(/\n {2}resetThreatAlerts\(\);/);
  });

  it('копий полосы в main не осталось', () => {
    for (const gone of [
      'function renderSwarmDossier',
      'function patchPurse',
      'function applyTimeSpeed',
      'const threatMemory',
      'let timeMult',
      'tbEta',
      'lastHudHtml',
      'railAlert',
    ]) {
      expect(MAIN).not.toContain(gone);
    }
  });
});
