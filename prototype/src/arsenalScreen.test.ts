import { readFileSync } from 'node:fs';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { setLocale } from '../../localization/runtime';
import type { ArsenalItem } from '../../packages/shared-core/src/index';
import type {
  MetaDropOddsView,
  MetaEconomyView,
} from '../../packages/protocol/src/metaEconomyView';
import {
  arsenalDetailHtml,
  arsenalHtml,
  arsenalItemName,
  initArsenal,
  originLabel,
  starterPreview,
  type ArsenalHost,
  type ArsenalState,
} from './arsenalScreen';

// REFM-5: locale pinned RU (see format.test.ts — under Node there is no browser
// language, so the runtime would fall back to EN and the name assertions would drift).
beforeAll(() => setLocale('ru'));
afterEach(() => vi.unstubAllGlobals());

const drops = JSON.parse(
  readFileSync(new URL('../../data/dropTables.json', import.meta.url), 'utf8'),
) as MetaDropOddsView;

const copy = (over: Partial<ArsenalItem> & Pick<ArsenalItem, 'itemId' | 'defId'>): ArsenalItem => ({
  kind: 'module',
  form: 'blueprint',
  soulbound: false,
  origin: 'drop',
  acquiredAt: Date.UTC(2026, 9, 9),
  ...over,
});
const dropA = copy({ itemId: 'drop-a', defId: 'targeting_array' });
const dropB = copy({
  itemId: 'drop-b',
  defId: 'targeting_array',
  acquiredAt: Date.UTC(2026, 9, 16),
});
const crafted = copy({ itemId: 'craft-1', defId: 'shield_booster', origin: 'craft' });
const owned = (): ArsenalItem[] => [...starterPreview(), dropA, dropB, crafted];

function view(over: Partial<MetaEconomyView> = {}): MetaEconomyView {
  return {
    catalogVersion: 'meta-v0.1',
    materials: [
      { id: 'ferroalloys', nameKey: 'meta.material.ferroalloys', tradable: 17, soulbound: 5 },
      {
        id: 'control_circuits',
        nameKey: 'meta.material.control_circuits',
        tradable: 13,
        soulbound: 0,
      },
    ],
    recipes: [
      {
        id: 'tractor',
        defId: 'tractor_beam',
        ingredients: [
          { materialId: 'ferroalloys', required: 15, tradable: 17, soulbound: 5 },
          { materialId: 'control_circuits', required: 20, tradable: 13, soulbound: 0 },
        ],
        canCraft: false,
        requiresSoulbound: false,
        salvage: [{ materialId: 'ferroalloys', quantity: 3 }],
      },
      {
        id: 'siege',
        defId: 'siege_platform',
        ingredients: [{ materialId: 'ferroalloys', required: 20, tradable: 17, soulbound: 5 }],
        canCraft: true,
        requiresSoulbound: true,
        salvage: [{ materialId: 'ferroalloys', quantity: 6 }],
      },
      {
        id: 'targeting',
        defId: 'targeting_array',
        ingredients: [{ materialId: 'control_circuits', required: 25, tradable: 13, soulbound: 0 }],
        canCraft: false,
        requiresSoulbound: false,
        salvage: [{ materialId: 'control_circuits', quantity: 6 }],
      },
    ],
    supplyGoal: 'tractor',
    items: owned(),
    salvageableItemIds: ['drop-a', 'drop-b'],
    cosmetics: [],
    seasons: [
      {
        id: 'frontier',
        nameKey: 'meta.season.frontier_fleet',
        startsAt: 0,
        endsAt: 1,
        levels: 50,
        xpPerLevel: 200,
        xp: 0,
        level: 7,
        premium: false,
        active: true,
        started: true,
        archived: false,
        contracts: [],
        milestones: [
          {
            level: 10,
            free: 'meta.reward.blueprint_choice',
            premium: 'meta.reward.ship_skin',
            freeClaimed: false,
            premiumClaimed: false,
            choices: ['mine_layer', 'targeting_array', 'shield_booster'],
          },
        ],
      },
    ],
    drops,
    ...over,
  };
}

function state(over: Partial<ArsenalState> = {}): ArsenalState {
  return {
    items: owned(),
    view: view(),
    guest: false,
    canSignIn: true,
    busy: false,
    tab: 'modules',
    module: 'tractor_beam',
    hull: 'cruiser',
    confirm: null,
    status: null,
    notice: null,
    wide: true,
    ...over,
  };
}

describe('арсенал — имена и источники', () => {
  it('корпус читается как юнит, модуль — по своему каталогу', () => {
    expect(arsenalItemName({ ...dropA, kind: 'hull', defId: 'cruiser' })).toBe('Крейсер');
    expect(arsenalItemName({ ...dropA, defId: 'cargo_bay' })).toBe('Грузовой отсек');
  });

  it('незнакомый defId не роняет имя — уходит как есть', () => {
    expect(arsenalItemName({ ...dropA, defId: 'laser' })).toBe('laser');
  });

  it('у всех источников есть подпись — ключ наружу не течёт', () => {
    for (const o of [
      'starter',
      'drop',
      'craft',
      'auction',
      'lootbox',
      'rent',
      'commerce',
      'ad',
      'season',
    ] as const) {
      expect(originLabel(o), o).not.toContain('arsenal.origin');
      const html = arsenalDetailHtml(
        state({
          items: [copy({ itemId: 'x', defId: 'targeting_array', origin: o })],
          module: 'targeting_array',
        }),
      );
      expect(html, o).not.toContain('arsenal.from');
    }
  });
});

describe('арсенал — список', () => {
  it('сверху правило верфи, во вкладках счёт коллекции', () => {
    const html = arsenalHtml(state());
    expect(html).toContain('В сетевой партии верфь строит только то, что есть в арсенале.');
    expect(html).toMatch(
      /data-ar-tab="modules" aria-selected="true">Модули<small>\d+ из 15<\/small>/,
    );
    expect(html).toContain(
      'data-ar-tab="hulls" aria-selected="false">Корабли<small>12 из 12</small>',
    );
  });

  it('модули разложены по отсекам, недостающий — пунктиром с прогрессом материалов', () => {
    const html = arsenalHtml(state());
    const order = ['Оружие', 'Защита', 'Системы'].map((g) => html.indexOf(`</span>${g}<small`));
    expect(order.every((i) => i > 0)).toBe(true);
    expect([...order].sort((a, b) => a - b)).toEqual(order);
    expect(html).toContain('class="ar-mc r-unique miss goal" data-ar-module="tractor_beam"');
    expect(html).toContain('Материалы 28/35');
    expect(html).toContain('Хватает материалов'); // осадная платформа: сервер разрешает сборку
    expect(html).toContain('+4 атака');
  });

  it('копии сведены в одну карточку со счётом, цель помечена', () => {
    const html = arsenalHtml(state());
    expect(html.match(/data-ar-module="targeting_array"/g)).toHaveLength(1);
    expect(html).toContain('<span class="ar-tag">×2</span>');
    expect(html).toContain('<span class="ar-tag goal">Цель</span>');
  });

  it('цель мастерской: материалы, прогресс и сборка, погашенная без материалов', () => {
    const html = arsenalHtml(state());
    expect(html).toContain('Цель мастерской');
    expect(html).toContain('Микросхемы управления <b>13/20</b>');
    expect(html).toContain('data-ar-craft="tractor" disabled');
    const none = arsenalHtml(state({ view: view({ supplyGoal: null }) }));
    expect(none).toContain('Цель мастерской не выбрана');
    expect(none).toContain('data-ar-pick');
  });

  it('гостю — стартовый набор и вход вместо пустого экрана', () => {
    const html = arsenalHtml(state({ guest: true, view: null, items: starterPreview() }));
    expect(html).toContain('Арсенал хранится в аккаунте');
    expect(html).toContain('data-ar-sign-in');
    expect(html).toContain('После входа');
    expect(html).not.toContain('data-ar-craft');
    expect(arsenalHtml(state({ guest: true, view: null, canSignIn: false }))).not.toContain(
      'data-ar-sign-in',
    );
  });

  it('корабли — портретами и группами «Производства», с отсеками', () => {
    const html = arsenalHtml(state({ tab: 'hulls' }));
    for (const g of ['Боевые корабли', 'Поддержка', 'Шаттлы']) expect(html).toContain(`${g}<small`);
    expect(html).toContain('data-ar-hull="cruiser"');
    expect(html).toContain('ship-art');
    expect(html).toContain('Универсальный 4');
    expect(html).toContain('Без отсеков');
    expect(html).not.toContain('Цель мастерской');
  });

  it('на ПК подробности стоят рядом со списком, на телефоне — нет', () => {
    expect(arsenalHtml(state())).toContain('<aside class="ar-detail">');
    expect(arsenalHtml(state({ wide: false }))).not.toContain('ar-detail');
  });

  it('строки сервера экранируются (CWE-79)', () => {
    const evil = view();
    evil.materials[0]!.nameKey = '<img src=x onerror=alert(1)>';
    evil.recipes[0]!.ingredients[0]!.materialId = 'ferroalloys';
    const html = arsenalHtml(state({ view: evil })) + arsenalDetailHtml(state({ view: evil }));
    expect(html).not.toContain('<img src=x');
    expect(html).toContain('&lt;img src=x');
  });
});

describe('арсенал — подробности модуля', () => {
  it('недостающий: мастерская, награда с шансами, сезон, аукцион и корабли', () => {
    const html = arsenalDetailHtml(state({ module: 'targeting_array', items: starterPreview() }));
    expect(html).toContain('Нет в арсенале');
    expect(html).toContain('Мастерская');
    expect(html).toContain('Не хватает: Микросхемы управления 12.');
    expect(html).toContain(
      'Шанс награды: 60% за 1-е место, 35% за 2–3-е, 20% за остальные. После 3 партий подряд без награды следующая даёт её наверняка.',
    );
    expect(html).toContain('Уровень 10 даёт модуль на выбор из 3. Ваш уровень: 7 из 50.');
    expect(html).toContain('data-ar-auction');
    expect(html).toContain('data-ar-hull="cruiser"');
    expect(html).toContain('Флагман');
    expect(html).toContain('data-ar-codex="md:targeting_array"');
  });

  it('ракетная мина встаёт только на флагман', () => {
    const html = arsenalDetailHtml(state({ module: 'rocket_mine_layer' }));
    expect(html).toContain('Встаёт только на флагман.');
    expect(html).not.toContain('data-ar-hull=');
  });

  it('копии: откуда каждая, продать и разобрать; лишние — по правилу верфи', () => {
    const html = arsenalDetailHtml(state({ module: 'targeting_array' }));
    expect(html).toContain('2 копии');
    expect(html).toContain('Награда за партию, 16 окт.');
    expect(html).toContain('data-ar-sell="drop-a"');
    expect(html).toContain('data-ar-salvage="drop-b"');
    expect(html).toContain('Верфи хватает одной копии.');
  });

  it('одна копия предупреждает, что продажа уберёт модуль с верфи', () => {
    const html = arsenalDetailHtml(
      state({
        module: 'targeting_array',
        items: [dropA],
        view: view({ salvageableItemIds: ['drop-a'] }),
      }),
    );
    expect(html).toContain('Копия одна.');
  });

  it('стартовый модуль не продаётся и не разбирается', () => {
    const html = arsenalDetailHtml(state({ module: 'cargo_bay' }));
    expect(html).toContain('Стартовый набор: модуль открыт навсегда');
    expect(html).not.toContain('data-ar-sell');
    expect(html).not.toContain('data-ar-salvage');
  });

  it('гостю — без действий, только где модуль встаёт', () => {
    const html = arsenalDetailHtml(
      state({ guest: true, view: null, module: 'targeting_array', items: starterPreview() }),
    );
    expect(html).toContain('Способы получить модуль видны после входа.');
    expect(html).not.toContain('data-ar-craft');
    expect(html).toContain('data-ar-hull="cruiser"');
  });

  it('подтверждение сборки из личных материалов и разбора последней копии', () => {
    const craft = arsenalDetailHtml(
      state({ module: 'siege_platform', confirm: { kind: 'craft', recipeId: 'siege' } }),
    );
    expect(craft).toContain('Собрать «Осадная платформа»? Уйдут: Ферросплавы 20.');
    expect(craft).toContain('модуль станет личным');
    expect(craft).toContain('Эти материалы нужны и цели «Тяговый луч».');
    expect(craft).toContain('data-ar-craft-do="siege"');
    const salvage = arsenalDetailHtml(
      state({
        module: 'targeting_array',
        items: [dropA],
        confirm: { kind: 'salvage', itemId: 'drop-a' },
      }),
    );
    expect(salvage).toContain(
      'Разобрать копию «Система наведения»? Получите: Микросхемы управления 6.',
    );
    expect(salvage).toContain('Копия последняя.');
  });
});

describe('арсенал — подробности корабля', () => {
  it('характеристики, отсеки и модули для него', () => {
    const html = arsenalDetailHtml(state({ tab: 'hulls', hull: 'cruiser' }));
    expect(html).toContain('Атака / Оборона');
    expect(html).toContain('Оружие<b>×1</b>');
    expect(html).toContain('data-ar-module="targeting_array"');
    expect(html).toContain('ar-mchip r-unique miss" data-ar-module="siege_platform"');
    expect(html).toContain('data-ar-codex="u:cruiser"');
  });

  it('корабль без отсеков так и говорит', () => {
    const html = arsenalDetailHtml(state({ tab: 'hulls', hull: 'landing_shuttle' }));
    expect(html).toContain('Отсеков нет');
    expect(html).not.toContain('ar-mchip');
  });
});

// --- wiring ---------------------------------------------------------------------------

type Fake = HTMLElement & { fire: (dataset: Record<string, string>, disabled?: boolean) => void };

/** Node has no DOM: the tab paints innerHTML and delegates clicks, so a stand-in with those
 *  two is the whole contract. `fire` clicks a button carrying the given data attributes. */
function fakeEl(): Fake {
  let handler: ((ev: unknown) => void) | null = null;
  const classes = new Set<string>();
  const el = {
    innerHTML: '',
    classList: {
      toggle: (c: string, on: boolean) => (on ? classes.add(c) : classes.delete(c)),
      contains: (c: string) => classes.has(c),
    },
    addEventListener: (_type: string, h: (ev: unknown) => void) => {
      handler = h;
    },
    fire: (dataset: Record<string, string>, disabled = false) =>
      handler?.({ target: { closest: () => ({ dataset, disabled }) } }),
  };
  return el as unknown as Fake;
}

const response = (value: unknown) => ({ ok: true, json: async () => value });

type FakeHost = Omit<ArsenalHost, 'root' | 'sheet'> & { root(): Fake; sheet(): Fake };

function hostOf(over: Partial<ArsenalHost> = {}): FakeHost {
  const root = fakeEl();
  const sheet = fakeEl();
  let id = 0;
  return {
    root: () => root,
    sheet: () => sheet,
    narrow: () => false,
    readCache: () => [],
    writeCache: () => {},
    openCodex: () => {},
    authorizedBase: async () => ({ base: 'https://srv', token: 'tok' }),
    canSignIn: () => true,
    signIn: () => {},
    openAuction: () => {},
    sell: () => {},
    openSeason: () => {},
    openStore: () => {},
    requestId: () => `intent-${++id}`,
    ...over,
  } as FakeHost;
}

/** The server: the economy view, the store, and a craft endpoint the test can script. */
function server(craft?: (body: Record<string, unknown>) => unknown) {
  const posts: Array<{ path: string; body: Record<string, unknown> }> = [];
  const fetcher = vi.fn(async (url: string, init?: { body?: string }) => {
    const path = url.replace('https://srv', '');
    if (init?.body) {
      const body = JSON.parse(init.body) as Record<string, unknown>;
      posts.push({ path, body });
      const out = craft?.(body);
      if (out instanceof Error) throw out;
      return response(out ?? { ok: true, receipt: { id: 'r' } });
    }
    return response(path === '/commerce/offers' ? { offers: [] } : view());
  });
  vi.stubGlobal('fetch', fetcher);
  return { posts, fetcher };
}

describe('арсенал — вкладка', () => {
  it('гость: в сеть не ходит, видит стартовый набор и вход', async () => {
    const fetcher = vi.fn();
    vi.stubGlobal('fetch', fetcher);
    const signIn = vi.fn();
    const host = hostOf({ authorizedBase: async () => null, signIn });
    await initArsenal(host).refresh();
    expect(fetcher).not.toHaveBeenCalled();
    expect(host.root().innerHTML).toContain('Арсенал хранится в аккаунте');
    host.root().fire({ arSignIn: '' });
    expect(signIn).toHaveBeenCalledOnce();
  });

  it('кэш красится до сети, ответ сервера заменяет коллекцию и пишет кэш', async () => {
    server();
    const written: ArsenalItem[][] = [];
    const painted: string[] = [];
    const host = hostOf({ readCache: () => [dropA], writeCache: (i) => written.push([...i]) });
    const arsenal = initArsenal(host);
    const loading = arsenal.refresh();
    painted.push(host.root().innerHTML);
    await loading;
    expect(painted[0]).toContain('data-ar-module="targeting_array"');
    expect(arsenal.items()).toHaveLength(owned().length);
    expect(written).toHaveLength(1);
    expect(host.root().innerHTML).toContain('Цель мастерской');
  });

  it('сбой сервера оставляет кэш и говорит об этом', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => Promise.reject(new Error('offline'))),
    );
    const written: unknown[] = [];
    const host = hostOf({ readCache: () => [dropA], writeCache: (i) => written.push(i) });
    const arsenal = initArsenal(host);
    await arsenal.refresh();
    expect(arsenal.items()).toEqual([dropA]);
    expect(written).toEqual([]);
    expect(host.root().innerHTML).toContain('Сервер не ответил');
    expect(host.root().innerHTML).toContain('data-ar-refresh');
  });

  it('сборка: сначала подтверждение, потом команда с согласием на личные материалы', async () => {
    const { posts } = server();
    const host = hostOf();
    await initArsenal(host).refresh();
    host.root().fire({ arCraft: 'siege' });
    expect(posts).toEqual([]);
    expect(host.root().innerHTML).toContain('data-ar-craft-do="siege"');
    host.root().fire({ arCraftDo: 'siege' });
    await vi.waitFor(() => expect(host.root().innerHTML).toContain('Модуль собран.'));
    expect(posts).toEqual([
      {
        path: '/meta-economy/craft',
        body: { recipeId: 'siege', allowSoulbound: true, requestId: 'intent-1' },
      },
    ]);
  });

  it('сборка без подтверждения не уходит, а та, которой не хватает материалов, — тем более', async () => {
    const { posts } = server();
    const host = hostOf();
    await initArsenal(host).refresh();
    host.root().fire({ arCraftDo: 'siege' });
    host.root().fire({ arCraft: 'tractor' });
    host.root().fire({ arCraftDo: 'tractor' });
    expect(posts).toEqual([]);
  });

  it('неясный исход повторяется с тем же id, двойное нажатие не уходит', async () => {
    let calls = 0;
    const { posts } = server(() =>
      ++calls === 1 ? new Error('disconnected after commit') : undefined,
    );
    const host = hostOf();
    await initArsenal(host).refresh();
    host.root().fire({ arCraft: 'siege' });
    host.root().fire({ arCraftDo: 'siege' });
    host.root().fire({ arCraftDo: 'siege' });
    await vi.waitFor(() => expect(host.root().innerHTML).toContain('Действие не выполнено'));
    expect(posts).toHaveLength(1);
    host.root().fire({ arCraft: 'siege' });
    host.root().fire({ arCraftDo: 'siege' });
    await vi.waitFor(() => expect(posts).toHaveLength(2));
    expect(posts.map((p) => p.body.requestId)).toEqual(['intent-1', 'intent-1']);
  });

  it('команда прежнего аккаунта не уходит после смены сессии', async () => {
    const { posts } = server();
    let token = 'one';
    const host = hostOf({ authorizedBase: async () => ({ base: 'https://srv', token }) });
    await initArsenal(host).refresh();
    host.root().fire({ arCraft: 'siege' });
    token = 'two';
    host.root().fire({ arCraftDo: 'siege' });
    await vi.waitFor(() => expect(host.root().innerHTML).toContain('Арсенал хранится в аккаунте'));
    expect(posts).toEqual([]);
  });

  it('разбор и цель уходят командами мастерской', async () => {
    const { posts } = server();
    const host = hostOf();
    await initArsenal(host).refresh();
    host.root().fire({ arModule: 'targeting_array' });
    host.root().fire({ arSalvage: 'drop-a' });
    expect(host.root().innerHTML).toContain('data-ar-salvage-do="drop-a"');
    host.root().fire({ arSalvageDo: 'drop-a' });
    await vi.waitFor(() => expect(host.root().innerHTML).toContain('Материалы добавлены.'));
    host.root().fire({ arGoal: 'siege' });
    await vi.waitFor(() => expect(posts).toHaveLength(2));
    expect(posts.map((p) => [p.path, p.body.itemId ?? p.body.recipeId])).toEqual([
      ['/meta-economy/salvage', 'drop-a'],
      ['/meta-economy/supply-goal', 'siege'],
    ]);
  });

  it('продажа ведёт в аукцион с этой копией, стартовую продать нельзя', async () => {
    server();
    const sell = vi.fn();
    const host = hostOf({ sell });
    await initArsenal(host).refresh();
    host.root().fire({ arSell: 'starter:module:cargo_bay' });
    host.root().fire({ arSell: 'drop-b' });
    expect(sell.mock.calls).toEqual([['drop-b']]);
  });

  it('телефон: карточка открывает шторку, крестик её закрывает', async () => {
    server();
    const host = hostOf({ narrow: () => true });
    const arsenal = initArsenal(host);
    await arsenal.refresh();
    expect(host.root().innerHTML).not.toContain('ar-detail');
    expect(arsenal.isOpen()).toBe(false);
    host.root().fire({ arHull: 'frigate' });
    expect(host.sheet().classList.contains('open')).toBe(true);
    // Шторка — ступень лестницы «Назад» (main.ts): там её и спрашивают, открыта ли.
    expect(arsenal.isOpen()).toBe(true);
    expect(host.sheet().innerHTML).toContain('role="dialog"');
    expect(host.sheet().innerHTML).toContain('Фрегат');
    host.sheet().fire({ arClose: '' });
    expect(host.sheet().classList.contains('open')).toBe(false);
    expect(arsenal.isOpen()).toBe(false);
    expect(host.sheet().innerHTML).toBe('');
  });

  it('уход с вкладки и расширение экрана закрывают шторку', async () => {
    server();
    let narrow = true;
    const host = hostOf({ narrow: () => narrow });
    const arsenal = initArsenal(host);
    await arsenal.refresh();
    host.root().fire({ arModule: 'cargo_bay' });
    arsenal.close();
    expect(host.sheet().classList.contains('open')).toBe(false);
    host.root().fire({ arModule: 'cargo_bay' });
    narrow = false;
    arsenal.relayout();
    expect(host.sheet().classList.contains('open')).toBe(false);
    expect(host.root().innerHTML).toContain('<aside class="ar-detail">');
  });
});
