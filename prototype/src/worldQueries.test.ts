/**
 * Запросы к миру и очередь стройки (REFM-242) — прямой тест владельца.
 *
 * Здесь проверено то, что раньше держал только живой матч: запросы читают мир и своё
 * место через хуки (смена матча подменяет оба), очередь полосы и цена ждущего заказа
 * берутся из ядра, подписи стройки собираются из данных и локали, а заказ проходит
 * замок одноэкземплярного здания, предсказывает тост «в очередь» только при занятой
 * полосе и уходит приказом игрока.
 */
import { readFileSync } from 'node:fs';
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Action, GameState } from '../../packages/shared-core/src/index';
import { setLocale, t, tData } from '../../localization/runtime';
import { buildBuilding, buildUnit, upgradeBuilding } from '../../decisions/actions';
import { refusalText } from '../../decisions/refusalText';
import { newGame, order } from './game';
import { data } from './gameData';
import { queuedCost } from './buildOrders';
import {
  buildDurationHours as coreDurationHours,
  hoursLeft,
  progressPct as corePct,
} from './buildProgress';
import type { TileLock } from './catalogTile';
import { displayUnit, fmtEta } from './format';
import { BUILD_ICON, unitIcon } from './icons';
import { HOUR } from './time';

// ПК-подача подписи заказа зависит от указателя; в Node его нет, поэтому флаг — свой.
const ui = vi.hoisted(() => ({ pc: false }));
vi.mock('./graphicsPrefs', async (orig) => ({
  ...(await orig<typeof import('./graphicsPrefs')>()),
  pcUi: () => ui.pc,
}));

import {
  activeConstruction,
  afford,
  buildCost,
  buildDurationHours,
  constructionLabel,
  coreQueue,
  enqueueBuild,
  initWorldQueries,
  myRes,
  planet,
  progressPct,
  queuedAction,
  queuedLabel,
  timeLeft,
} from './worldQueries';

// Локаль прибита к RU: у Node нет языка браузера, и подписи уехали бы в EN.
beforeAll(() => setLocale('ru'));

/** Мой домашний мир — на старте на нём уже что-то стоит. */
function home(s: GameState, me = 'p1'): string {
  const p = Object.values(s.planets).find((x) => x.owner === me && x.buildings.length > 0);
  if (!p) throw new Error('нет домашнего мира с постройками');
  return p.id;
}

/** Мир после приказа: ошибку ядра тест видит сразу, а не по пустой очереди. */
function after(s: GameState, a: Action): GameState {
  const r = order(s, a, s.time);
  if (r.error) throw new Error(`ядро отбило приказ: ${r.error}`);
  return r.state;
}

/** Намерение приказа без его порядкового id — id растёт с каждым построенным приказом. */
const intent = ({ id: _id, ...rest }: Action) => rest;
const intents = (as: Action[]) => as.map(intent);

/** Хост с живыми ручками: мир, место, лента тостов и ушедшие приказы. */
function host(world: GameState, opts: { me?: string; lock?: TileLock } = {}) {
  const h = {
    world,
    me: opts.me ?? 'p1',
    lock: opts.lock ?? null,
    notes: [] as string[],
    orders: [] as Action[],
  };
  initWorldQueries({
    world: () => h.world,
    me: () => h.me,
    note: (msg) => h.notes.push(msg),
    placeName: (id) => `«${id}»`,
    playerOrder: (a) => {
      h.orders.push(a);
      return true;
    },
    buildingLocked: () => h.lock,
  });
  return h;
}

/** Любой юнит каталога — подписи проверяют сборку, а не конкретное имя. */
const UNIT = Object.keys(data.units)[0]!;

beforeEach(() => {
  ui.pc = false;
});

describe('REFM-242 — запросы к миру', () => {
  it('мир по id читается из мира хоста, пустой id — без мира', () => {
    const s = newGame();
    host(s);
    const pid = home(s);
    expect(planet(pid)).toBe(s.planets[pid]);
    expect(planet(null)).toBeUndefined();
    expect(planet(undefined)).toBeUndefined();
    expect(planet('')).toBeUndefined();
    expect(planet('нет-такого')).toBeUndefined();
  });

  it('смена матча подменяет мир и место: запросы идут в новый мир, а не в старый', () => {
    const a = newGame();
    const h = host(a);
    const pid = home(a);
    const b = structuredClone(a);
    b.players.p1!.resources = { metal: 7 };
    b.players.p2!.resources = { metal: 3 };
    h.world = b;
    expect(planet(pid)).toBe(b.planets[pid]);
    expect(myRes()).toEqual({ metal: 7 });
    h.me = 'p2';
    expect(myRes()).toEqual({ metal: 3 });
  });

  it('казна — своего места; у места без игрока она пустая', () => {
    const s = newGame();
    const h = host(s);
    expect(myRes()).toBe(s.players.p1!.resources);
    h.me = 'зритель';
    expect(myRes()).toEqual({});
  });

  it('хватит ли казны — по своему месту: нехватка любого ресурса — нет, пустая цена — да', () => {
    const s = newGame();
    host(s);
    s.players.p1!.resources = { metal: 100, crystal: 5 };
    expect(afford({ metal: 100 })).toBe(true);
    expect(afford({ metal: 100, crystal: 6 })).toBe(false);
    expect(afford({ fuel: 1 })).toBe(false);
    expect(afford(undefined)).toBe(true);
  });
});

describe('REFM-242 — очередь стройки из ядра', () => {
  /** Шахта улучшается, радар ждёт за ней в полосе зданий. */
  function busy() {
    const s0 = newGame();
    const pid = home(s0);
    const s = after(
      after(s0, upgradeBuilding('p1', pid, 'mine')),
      upgradeBuilding('p1', pid, 'radar'),
    );
    return { s, pid };
  }

  it('очередь полосы — ждущие заказы ядра этой полосы, а у пустой полосы — ничего', () => {
    const { s, pid } = busy();
    host(s);
    expect(coreQueue(pid, 'buildings').map((q) => [q.kind, q.building])).toEqual([
      ['upgrade', 'radar'],
    ]);
    expect(coreQueue(pid, 'units')).toEqual([]);
    expect(coreQueue('нет-такого', 'buildings')).toEqual([]);
  });

  it('цена ждущего заказа — правилом `buildOrders.ts` для мира хоста', () => {
    const { s, pid } = busy();
    host(s);
    const q = coreQueue(pid, 'buildings')[0]!;
    expect(buildCost(pid, q)).toEqual(
      queuedCost(s, data, pid, { kind: 'upgrade', id: 'radar', count: 1 }),
    );
    // Заказ без здания и юнита цены не имеет — строка «ждём» её не покажет.
    expect(buildCost(pid, { ...q, building: undefined, unit: undefined })).toBeUndefined();
  });

  it('идущая стройка — у занятой полосы; свободная полоса — без стройки', () => {
    const { s, pid } = busy();
    host(s);
    const active = activeConstruction(pid, 'buildings');
    expect(active?.payload).toMatchObject({ kind: 'upgrade', building: 'mine' });
    expect(activeConstruction(pid, 'units')).toBeNull();
  });

  it('остаток и процент стройки считаются по часам мира хоста', () => {
    const { s, pid } = busy();
    host(s);
    const active = activeConstruction(pid, 'buildings')!;
    expect(timeLeft(active.at)).toBe(fmtEta(hoursLeft(active.at, s.time, HOUR)));
    expect(progressPct(active)).toBe(corePct(active, s.time, data, HOUR));
    expect(progressPct(active)).toBe(0);
    // Полпути: мир хоста ушёл вперёд — процент и остаток идут за ним.
    const half = structuredClone(s);
    half.time = active.at - (coreDurationHours(active.payload, data) * HOUR) / 2;
    host(half);
    expect(progressPct(active)).toBe(corePct(active, half.time, data, HOUR));
    expect(progressPct(active)).toBeGreaterThan(0);
    expect(timeLeft(active.at)).toBe(fmtEta(hoursLeft(active.at, half.time, HOUR)));
    expect(buildDurationHours(active.payload)).toBe(coreDurationHours(active.payload, data));
  });

  it('приказ головы очереди — от своего места', () => {
    const s = newGame();
    const h = host(s);
    const pid = home(s);
    expect(intent(queuedAction(pid, { kind: 'building', id: 'fort', count: 1 }))).toEqual(
      intent(buildBuilding('p1', pid, 'fort')),
    );
    h.me = 'p2';
    expect(intent(queuedAction(pid, { kind: 'upgrade', id: 'mine', count: 1 }))).toEqual(
      intent(upgradeBuilding('p2', pid, 'mine')),
    );
    expect(intent(queuedAction(pid, { kind: 'unit', id: UNIT, count: 3 }))).toEqual(
      intent(buildUnit('p2', pid, UNIT, 3)),
    );
  });
});

describe('REFM-242 — подписи стройки', () => {
  const b = (id: string) => `${BUILD_ICON[id] ?? '▣'} ${tData(data.buildings[id]!.name)}`;

  it('идущая стройка: юниты — числом и именем, улучшение — с уровнем, здание — именем', () => {
    host(newGame());
    expect(constructionLabel({ kind: 'unit', unit: UNIT, count: 2 })).toBe(
      `2× ${unitIcon(UNIT, data)} ${displayUnit(UNIT)}`,
    );
    expect(constructionLabel({ kind: 'unit', unit: UNIT })).toBe(
      `1× ${unitIcon(UNIT, data)} ${displayUnit(UNIT)}`,
    );
    expect(constructionLabel({ kind: 'upgrade', building: 'mine', level: 3 })).toBe(
      `${b('mine')} → L3`,
    );
    expect(constructionLabel({ kind: 'upgrade', building: 'mine' })).toBe(`${b('mine')} → L?`);
    expect(constructionLabel({ kind: 'building', building: 'fort' })).toBe(b('fort'));
    expect(constructionLabel({})).toBe(t('queue.unknown'));
    expect(t('queue.unknown')).toBe('неизвестный заказ');
  });

  it('ждущий заказ: на телефоне юнит полным именем, на ПК — значком и числом', () => {
    host(newGame());
    const unit = { kind: 'unit' as const, id: UNIT, count: 4 };
    expect(queuedLabel(unit)).toBe(`4× ${unitIcon(UNIT, data)} ${displayUnit(UNIT)}`);
    ui.pc = true;
    expect(queuedLabel(unit)).toBe(`${unitIcon(UNIT, data)} 4`);
  });

  it('ждущее улучшение и здание — именем здания; улучшение — фразой локали', () => {
    host(newGame());
    expect(queuedLabel({ kind: 'upgrade', id: 'mine', count: 1 })).toBe(`${b('mine')} — улучшение`);
    expect(queuedLabel({ kind: 'building', id: 'fort', count: 1 })).toBe(b('fort'));
    // Здание вне каталога не роняет подпись: остаётся его id и запасной значок.
    expect(queuedLabel({ kind: 'building', id: 'нет-такого', count: 1 })).toBe('▣ нет-такого');
  });
});

describe('REFM-242 — заказ стройки', () => {
  it('свободная полоса: заказ уходит приказом своего места, тоста нет', () => {
    const s = newGame();
    const h = host(s);
    const pid = home(s);
    enqueueBuild(pid, { kind: 'building', id: 'fort', count: 1 });
    expect(intents(h.orders)).toEqual(intents([buildBuilding('p1', pid, 'fort')]));
    expect(h.notes).toEqual([]);
  });

  it('занятая полоса: тост «в очередь» с подписью и именем места, и тот же приказ', () => {
    const s0 = newGame();
    const pid = home(s0);
    const s = after(s0, upgradeBuilding('p1', pid, 'mine'));
    const h = host(s);
    enqueueBuild(pid, { kind: 'upgrade', id: 'radar', count: 1 });
    expect(h.notes).toEqual([
      t('queue.added', {
        what: queuedLabel({ kind: 'upgrade', id: 'radar', count: 1 }),
        at: `«${pid}»`,
      }),
    ]);
    expect(intents(h.orders)).toEqual(intents([upgradeBuilding('p1', pid, 'radar')]));
  });

  it('полоса юнитов своя: стройка здания не делает заказ юнитов «в очередь»', () => {
    const s0 = newGame();
    const pid = home(s0);
    const s = after(s0, upgradeBuilding('p1', pid, 'mine'));
    const h = host(s);
    enqueueBuild(pid, { kind: 'unit', id: UNIT, count: 2 });
    expect(h.notes).toEqual([]);
    expect(intents(h.orders)).toEqual(intents([buildUnit('p1', pid, UNIT, 2)]));
  });

  it('одноэкземплярное здание уже стоит или уже ждёт: отказ в ленту, приказа нет', () => {
    const s = newGame();
    const pid = home(s);
    const built = host(s, { lock: 'built' });
    enqueueBuild(pid, { kind: 'building', id: 'spaceport', count: 1 });
    expect(built.notes).toEqual(['✖ ' + refusalText('E_ALREADY_BUILT')]);
    expect(built.orders).toEqual([]);
    const queued = host(s, { lock: 'queued' });
    enqueueBuild(pid, { kind: 'building', id: 'spaceport', count: 1 });
    expect(queued.notes).toEqual(['✖ ' + refusalText('E_ALREADY_QUEUED')]);
    expect(queued.orders).toEqual([]);
  });

  it('замок здания не держит улучшение и юнитов — их судит ядро', () => {
    const s = newGame();
    const pid = home(s);
    const h = host(s, { lock: 'built' });
    enqueueBuild(pid, { kind: 'upgrade', id: 'mine', count: 1 });
    enqueueBuild(pid, { kind: 'unit', id: UNIT, count: 1 });
    expect(intents(h.orders)).toEqual(
      intents([upgradeBuilding('p1', pid, 'mine'), buildUnit('p1', pid, UNIT, 1)]),
    );
  });

  it('десантный боец едет в приказ вместе с машиной', () => {
    const s = newGame();
    const h = host(s);
    const pid = home(s);
    enqueueBuild(pid, { kind: 'unit', id: UNIT, count: 1, troop: 'marine' });
    expect(intents(h.orders)).toEqual(intents([buildUnit('p1', pid, UNIT, 1, 'marine')]));
  });
});

describe('REFM-242 — стык с main.ts', () => {
  const MAIN = readFileSync(new URL('./main.ts', import.meta.url), 'utf8');
  const OWNER = readFileSync(new URL('./worldQueries.ts', import.meta.url), 'utf8');
  const init = /initWorldQueries\(\{([\s\S]*?)\n\}\);/.exec(MAIN)?.[1] ?? '';

  it('хуки — мир, своё место, лента, имя места, путь приказа и замок здания', () => {
    for (const hook of [
      'world: () => s,',
      'me: () => ME,',
      'note,',
      'placeName,',
      'playerOrder,',
      'buildingLocked,',
    ]) {
      expect(init, hook).toContain(hook);
    }
  });

  it('запросы и очередь живут у владельца, и модуль не тянет `main.ts`', () => {
    expect(MAIN).not.toMatch(
      /\bfunction (myRes|afford|coreQueue|buildCost|queuedAction|activeConstruction|constructionLabel|buildDurationHours|timeLeft|progressPct|queuedLabel|enqueueBuild)\(/,
    );
    expect(MAIN).not.toMatch(/^const planet = /m);
    expect(MAIN).toMatch(/import \{[^}]*\benqueueBuild\b[^}]*\} from '\.\/worldQueries';/);
    expect(OWNER).not.toMatch(/from '\.\/main'/);
  });
});
