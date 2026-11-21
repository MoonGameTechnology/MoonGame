/**
 * Окно «Шпионаж» (заказ владельца 2026-11-10): список шпионов, карточки заданий, выбор мира
 * на карте и вопрос «Да / Нет». Страница — заглушки элементов, как у окна дипломатии.
 */
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { hasKey, t } from '../../localization/runtime';
import type { Action, GameState } from '../../packages/shared-core/src/index';
import { SPY_CALLSIGNS, type SpyRecordView } from '../../decisions/spyRoster';
import { SPY_TASKS } from '../../decisions/spyTasks';
import { newGame, START_CANDIDATES } from './game';

interface El {
  id: string;
  innerHTML: string;
  classes: Set<string>;
  classList: {
    add(c: string): void;
    remove(c: string): void;
    toggle(c: string, on?: boolean): void;
  };
  style: Record<string, string>;
  addEventListener(type: string, fn: (ev: unknown) => void): void;
  fire(type: string, ev?: unknown): void;
  click(): void;
  querySelectorAll(sel: string): unknown[];
}

let page: Map<string, El>;
/** Слушатели клавиш документа (цифры 1–8 окна заданий). */
let keys: Array<(ev: unknown) => void>;
const key = (code: string, mods: Record<string, boolean> = {}): boolean => {
  let prevented = false;
  for (const fn of keys)
    fn({ code, ctrlKey: false, altKey: false, metaKey: false, repeat: false, target: null, ...mods, preventDefault: () => (prevented = true) });
  return prevented;
};
function stub(id: string): El {
  const on = new Map<string, Array<(ev: unknown) => void>>();
  const el: El = {
    id,
    innerHTML: '',
    classes: new Set(),
    classList: {
      add: (c) => void el.classes.add(c),
      remove: (c) => void el.classes.delete(c),
      toggle: (c, v = !el.classes.has(c)) => void (v ? el.classes.add(c) : el.classes.delete(c)),
    },
    style: {},
    addEventListener: (type, fn) => void on.set(type, [...(on.get(type) ?? []), fn]),
    fire: (type, ev = {}) => {
      for (const fn of on.get(type) ?? []) fn(ev);
    },
    click: () => el.fire('click', { target: { id: '', closest: () => null } }),
    querySelectorAll: () => [],
  };
  return el;
}
const el = (id: string): El => {
  if (!page.has(id)) page.set(id, stub(id));
  return page.get(id)!;
};
const tap = (root: string, hits: Record<string, Record<string, string>>): void =>
  el(root).fire('click', {
    target: { id: '', closest: (sel: string) => (sel in hits ? { dataset: hits[sel]! } : null) },
  });

function stubPage(): void {
  page = new Map();
  keys = [];
  vi.stubGlobal('document', {
    getElementById: el,
    addEventListener: (type: string, fn: (ev: unknown) => void) => void (type === 'keydown' && keys.push(fn)),
  });
  vi.stubGlobal('localStorage', { getItem: () => null, setItem: () => {}, removeItem: () => {} });
  vi.stubGlobal('location', { pathname: '/', href: '' });
  vi.stubGlobal('__PLAYER_BUILD__', false);
}
beforeAll(async () => {
  stubPage();
  await import('./spyWindow');
  vi.unstubAllGlobals();
}, 60_000);
beforeEach(stubPage);
afterEach(() => {
  vi.unstubAllGlobals();
  vi.doUnmock('./worldCard');
});

async function boot(spies: SpyRecordView[], opts?: { fog?: boolean }) {
  vi.resetModules();
  // Шанс считает карточка мира по туману; здесь он — база ядра.
  vi.doMock('./worldCard', () => ({ spyOddsFor: () => ({ success: 0.6, risk: 0.35 }) }));
  const win = await import('./spyWindow');
  const s = newGame({
    seats: [
      { id: 'p1', name: 'Orion', faction: 'azure', start: START_CANDIDATES[0]!, ai: false },
      { id: 'p2', name: 'Crimson', faction: 'crimson', start: START_CANDIDATES[1]!, ai: true },
    ],
  });
  const mine = Object.values(s.planets).find((p) => p.owner === 'p1')!.id;
  const enemy = Object.values(s.planets).find((p) => p.owner === 'p2')!.id;
  // SPY-24: the enemy capital is out of sight; a spy of p1 has been there, so p1 knows it.
  if (!opts?.fog) s.scouted = { p1: { [enemy]: { owner: 'p2', at: s.time } } };
  const env = {
    s: { ...s, spies: { p1: spies } } as GameState,
    orders: [] as Action[],
    notes: [] as string[],
    accept: true,
  };
  win.initSpyWindow({
    state: () => env.s,
    me: () => 'p1',
    placeName: (id) => `«${id}»`,
    note: (text) => void env.notes.push(text),
    playerOrder: (a) => (env.orders.push(a), env.accept),
    myIntel: () => [],
    sectorZeroToolsHidden: () => false,
    focusWorld: () => {},
  });
  return { win, env, mine, enemy };
}
const order = (a: Action) => ({ type: a.type, payload: a.payload });

describe('тексты окна заведены', () => {
  it('у каждого задания имя и описание, у каждого позывного и занятия — текст', () => {
    for (const task of SPY_TASKS) {
      expect(hasKey(`spy.task.${task}.name`)).toBe(true);
      expect(hasKey(`spy.task.${task}.desc`)).toBe(true);
    }
    for (let i = 0; i < SPY_CALLSIGNS; i++) expect(hasKey(`spy.callsign.${i}`)).toBe(true);
    for (const st of ['rest', 'wait', 'travel', 'work', 'return', 'recruit', 'hidden'])
      expect(hasKey(`spy.status.${st}`)).toBe(true);
    for (const b of ['here', 'unscouted', 'no-owner', 'owner-out', 'own-world', 'coalition'])
      expect(hasKey(`spy.block.${b}`)).toBe(true);
  });
});

describe('окно «Шпионаж»', () => {
  it('список: фото, имя, место, занятие и одна кнопка по занятию', async () => {
    await boot([
      { id: 1, state: 'rest', location: 'cap' },
      { id: 2, state: 'travel', location: 'w9', op: 'recon', arrivesAt: Date.UTC(2100, 0) },
    ]);
    el('rail-spy').click();
    const html = el('spywin').innerHTML;
    expect(el('spywin').classes.has('show')).toBe(true);
    expect(html).toContain('class="spy-photo"');
    expect(html).toContain(t('spy.callsign.0'));
    expect(html).toContain(t('spy.status.rest'));
    expect(html).toContain(t('spy.status.travel', { task: t('spy.task.recon.name') }));
    expect(html).toContain('data-spy-assign="1"');
    expect(html).toContain('data-spy-cancel="2"');
  });

  it('список: счётчик свободных в шапке, полоса хода, пустой журнал не рисуется', async () => {
    const { env } = await boot([{ id: 1, state: 'rest', location: 'cap' }]);
    const now = env.s.time;
    env.s = {
      ...env.s,
      spies: {
        p1: [
          { id: 1, state: 'rest', location: 'cap' },
          { id: 2, state: 'travel', location: 'w9', op: 'recon', departedAt: now - 1000, arrivesAt: now + 3000 },
          { id: 3, state: 'recruit', location: 'cap', arrivesAt: now + 3000 },
        ],
      },
    } as unknown as GameState;
    el('rail-spy').click();
    const html = el('spywin').innerHTML;
    expect(html).toContain(t('spy.win.free', { n: 1, m: 3 }));
    expect(html).toContain('class="sp-bar" style="width:25%"');
    expect(html.match(/class="sp-bar"/g)).toHaveLength(1); // вербовка без начала — без полосы
    expect(html).toContain('sp-st-travel');
    expect(html).not.toContain(t('spy.log.title'));
    expect(html).not.toContain(t('spy.windows.title'));
    expect(html).toContain(t('spy.windows.empty'));
  });

  it('телефон: плитка выбирает задание, кнопка панели ведёт к выбору мира', async () => {
    const { win } = await boot([{ id: 1, state: 'rest', location: 'cap' }]);
    el('rail-spy').click();
    tap('spywin', { '[data-spy-assign]': { spyAssign: '1' } });
    let html = el('spywin').innerHTML;
    expect(html.match(/class="sp-tile[ "]/g)).toHaveLength(SPY_TASKS.length);
    expect(html).toContain('data-spy-go="recon"'); // по умолчанию разведка
    expect(html).toContain(t('spy.btn.pick-world'));
    tap('spywin', { '[data-spy-sel]': { spySel: 'theft' } });
    html = el('spywin').innerHTML;
    expect(html).toContain('data-spy-go="theft"');
    expect(html).toContain(t('spy.task.kind.hot'));
    expect(win.spyPicking()).toBe(false); // выбор плитки ещё не отправляет
    tap('spywin', { '[data-spy-go]': { spyGo: 'theft' } });
    expect(win.spyPicking()).toBe(true);
    expect(el('spypick').innerHTML).toContain(t('spy.task.theft.name'));
  });

  it('из меню: задание → выбор мира на карте → «Нет» к выбору → «Да» отдаёт приказ', async () => {
    const { win, env, enemy } = await boot([{ id: 1, state: 'rest', location: 'cap' }]);
    el('rail-spy').click();
    tap('spywin', { '[data-spy-assign]': { spyAssign: '1' } });
    const cards = el('spywin').innerHTML;
    expect(cards.match(/class="sp-card"/g)).toHaveLength(SPY_TASKS.length);
    expect(cards).not.toContain('disabled'); // мир ещё не выбран
    tap('spywin', { '[data-spy-task]': { spyTask: 'theft' } });
    expect(el('spywin').classes.has('show')).toBe(false);
    expect(el('spypick').classes.has('show')).toBe(true);
    expect(el('spypick').innerHTML).toContain('data-spy-pick-cancel');
    expect(win.spyPicking()).toBe(true);
    win.spyPickTap(enemy);
    expect(el('spywin').innerHTML).toContain('data-spy-yes');
    expect(el('spywin').innerHTML).toContain(t('side.scan.odds', { s: 60, r: 35 }));
    tap('spywin', { '[data-spy-no]': {} });
    expect(win.spyPicking()).toBe(true);
    expect(env.orders).toEqual([]);
    win.spyPickTap(enemy);
    tap('spywin', { '[data-spy-yes]': {} });
    expect(env.orders.map(order)).toEqual([
      { type: 'espionage.spy', payload: { spyId: 1, planetId: enemy, op: 'theft' } },
    ]);
    expect(win.spyPicking()).toBe(false);
    expect(el('spypick').classes.has('show')).toBe(false);
  });

  it('ПК: цифра 1–8 нажимает карточку по порядку, номер виден на карточке, в списке цифры молчат', async () => {
    const { win } = await boot([{ id: 1, state: 'rest', location: 'cap' }]);
    el('rail-spy').click();
    expect(key('Digit5')).toBe(false); // список шпионов: заданий нет
    tap('spywin', { '[data-spy-assign]': { spyAssign: '1' } });
    const cards = el('spywin').innerHTML;
    SPY_TASKS.forEach((_, i) => expect(cards).toContain(`<kbd class="sp-key">${i + 1}</kbd>`));
    expect(key('Digit5', { ctrlKey: true })).toBe(false);
    expect(win.spyPicking()).toBe(false);
    expect(key('Digit5')).toBe(true);
    expect(win.spyPicking()).toBe(true);
    expect(el('spypick').innerHTML).toContain(t(`spy.task.${SPY_TASKS[4]}.name`));
  });

  it('ПК: цифра погашенного задания на выбранном мире ничего не делает', async () => {
    const { win, enemy } = await boot([{ id: 1, state: 'rest', location: 'cap' }], { fog: true });
    win.openSpyWindow(enemy);
    tap('spywin', { '[data-spy-assign]': { spyAssign: '1' } });
    key(`Digit${SPY_TASKS.indexOf('theft') + 1}`); // мир в тумане: кража погашена
    expect(el('spywin').innerHTML).not.toContain('data-spy-yes');
    key(`Digit${SPY_TASKS.indexOf('recon') + 1}`);
    expect(el('spywin').innerHTML).toContain('data-spy-yes');
  });

  it('SPY-24: мир в тумане, где не бывал свой шпион, — только разведка и переезд', async () => {
    const { win, enemy } = await boot([{ id: 1, state: 'rest', location: 'cap' }], { fog: true });
    win.openSpyWindow(enemy);
    tap('spywin', { '[data-spy-assign]': { spyAssign: '1' } });
    const cards = el('spywin').innerHTML;
    expect(cards).toContain('data-spy-task="theft" disabled');
    expect(cards).toContain('data-spy-task="counter" disabled');
    expect(cards).not.toContain('data-spy-task="recon" disabled');
    expect(cards).not.toContain('data-spy-task="relocate" disabled');
  });

  it('хозяин мира выбыл — только разведка и переезд: остальное ядро отвергнет (E_NO_PLAYER)', async () => {
    const { win, env, enemy } = await boot([{ id: 1, state: 'rest', location: 'cap' }]);
    env.s.players.p2!.status = 'defeated';
    win.openSpyWindow(enemy);
    tap('spywin', { '[data-spy-assign]': { spyAssign: '1' } });
    const cards = el('spywin').innerHTML;
    expect(cards).toContain('data-spy-task="theft" disabled');
    expect(cards).toContain('data-spy-task="counter" disabled');
    expect(cards).toContain(t('spy.block.owner-out'));
    expect(cards).not.toContain('data-spy-task="recon" disabled');
    expect(cards).not.toContain('data-spy-task="relocate" disabled');
  });

  it('невозможный мир объясняется в ленте, а «Отменить выдачу» закрывает выбор', async () => {
    const { win, env, mine } = await boot([{ id: 1, state: 'rest', location: 'cap' }]);
    el('rail-spy').click();
    tap('spywin', { '[data-spy-assign]': { spyAssign: '1' } });
    tap('spywin', { '[data-spy-task]': { spyTask: 'sabotage' } });
    win.spyPickTap(mine);
    expect(env.notes).toEqual([t('spy.block.own-world')]);
    expect(el('spywin').innerHTML).not.toContain('data-spy-yes');
    tap('spypick', { '[data-spy-pick-cancel]': {} });
    expect(win.spyPicking()).toBe(false);
    expect(env.orders).toEqual([]);
  });

  it('с карточки мира: невозможные задания серые, после задания сразу вопрос', async () => {
    const { win, env, mine } = await boot([{ id: 1, state: 'rest', location: 'cap' }]);
    win.openSpyWindow(mine);
    tap('spywin', { '[data-spy-assign]': { spyAssign: '1' } });
    const cards = el('spywin').innerHTML;
    expect(cards).toContain('data-spy-task="sabotage" disabled');
    expect(cards).not.toContain('data-spy-task="counter" disabled');
    expect(cards).not.toContain('data-spy-task="relocate" disabled');
    tap('spywin', { '[data-spy-task]': { spyTask: 'counter' } });
    expect(win.spyPicking()).toBe(false);
    tap('spywin', { '[data-spy-yes]': {} });
    expect(env.orders.map(order)).toEqual([
      { type: 'espionage.spy', payload: { spyId: 1, planetId: mine, op: 'counter' } },
    ]);
  });

  it('«Отменить задание» спрашивает и только после «Да» отдаёт приказ', async () => {
    const { env } = await boot([
      { id: 3, state: 'work', location: 'w9', op: 'counter', arrivesAt: Number.MAX_SAFE_INTEGER },
    ]);
    el('rail-spy').click();
    tap('spywin', { '[data-spy-cancel]': { spyCancel: '3' } });
    expect(el('spywin').innerHTML).toContain('data-spy-yes');
    tap('spywin', { '[data-spy-no]': {} });
    expect(env.orders).toEqual([]);
    tap('spywin', { '[data-spy-cancel]': { spyCancel: '3' } });
    tap('spywin', { '[data-spy-yes]': {} });
    expect(env.orders.map(order)).toEqual([{ type: 'espionage.cancel', payload: { spyId: 3 } }]);
  });

  it('путь шпиона звучит в журнале его позывным и миром', async () => {
    const { win } = await boot([{ id: 1, state: 'wait', location: 'w9' }]);
    expect(win.spyJourneyLine('espionage.arrived', { owner: 'p1', spyId: 1, planetId: 'w9' })).toBe(
      t('log.spy.arrived', { who: t('spy.callsign.0'), at: '«w9»', task: '' }),
    );
    expect(
      win.spyJourneyLine('espionage.waiting', {
        owner: 'p1',
        spyId: 1,
        planetId: 'w9',
        kind: 'theft',
      }),
    ).toContain(t('spy.task.theft.name'));
    expect(win.spyJourneyLine('espionage.home', { owner: 'p2', spyId: 1 })).toBeNull();
  });
});
