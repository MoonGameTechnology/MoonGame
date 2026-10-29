import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { setLocale } from '../../localization/runtime';
import type { CommerceOffer } from '../../packages/protocol/src/commerce';
import type { MetaCorpStyleView } from '../../packages/protocol/src/corpStyle';
import type {
  MetaEconomyView,
  MetaStoreOfferView,
} from '../../packages/protocol/src/metaEconomyView';
import { CORP_ART_BUILDINGS, corpArt } from './corpArt';
import { initShop, shopDetailHtml, shopHtml, type ShopHost, type ShopState } from './shopScreen';

beforeAll(() => setLocale('ru'));
afterEach(() => vi.unstubAllGlobals());

const NOW = Date.UTC(2026, 9, 20, 12);
const DAY = 86_400_000;

const pack = (id: string, sovereigns: number, bonus = 0): CommerceOffer => ({
  productId: id,
  catalogVersion: 'v',
  source: 'payment',
  nameKey: `commerce.offer.${id}.name`,
  contentsKey: `commerce.offer.${id}.contents`,
  contents: { soulbound: true, sovereigns, ...(bonus ? { bonusSovereigns: bonus } : {}) },
  available: false,
  unavailableReason: 'E_COMMERCE_UNAVAILABLE',
});
const OFFERS: CommerceOffer[] = [
  pack('sovereigns_100', 100),
  pack('sovereigns_1440', 1200, 240),
  {
    productId: 'rewarded_supply',
    catalogVersion: 'v',
    source: 'rewarded_ad',
    nameKey: 'commerce.offer.rewarded_supply.name',
    contentsKey: 'commerce.offer.rewarded_supply.contents',
    contents: { soulbound: true, materials: { ferroalloys: 2, energy_cells: 1 } },
    dailyLimit: 2,
    available: false,
  },
];

const STORE: MetaStoreOfferView[] = [
  { id: 'premium_7', category: 'premium', price: 149, premiumDays: 7, bought: 0 },
  { id: 'premium_30', category: 'premium', price: 449, premiumDays: 30, bought: 0 },
  {
    id: 'season_frontier_fleet',
    category: 'premium',
    price: 690,
    premiumSeason: 'frontier',
    bought: 0,
  },
  {
    id: 'pack_defense',
    category: 'modules',
    price: 153,
    fullPrice: 180,
    modules: [
      { defId: 'shield_booster', owned: true },
      { defId: 'repair_tender', owned: false },
    ],
    bought: 0,
  },
  {
    id: 'module_tractor_beam',
    category: 'modules',
    price: 220,
    modules: [{ defId: 'tractor_beam', owned: false }],
    bought: 0,
  },
  {
    id: 'module_rocket_mine_layer',
    category: 'modules',
    price: 360,
    modules: [{ defId: 'rocket_mine_layer', owned: false }],
    bought: 0,
  },
  {
    id: 'module_shield_booster',
    category: 'modules',
    price: 0,
    modules: [{ defId: 'shield_booster', owned: true }],
    bought: 1,
    blocked: 'owned',
  },
  {
    id: 'materials_ferroalloys',
    category: 'materials',
    price: 120,
    materials: { ferroalloys: 30 },
    bought: 0,
  },
  {
    id: 'corp_style_imperial_gothic',
    category: 'styles',
    price: 490,
    corpStyle: 'imperial_gothic',
    bought: 0,
  },
  { id: 'corp_style_high_tech', category: 'styles', price: 490, corpStyle: 'high_tech', bought: 0 },
  { id: 'corp_backdrop_nebula', category: 'styles', price: 290, corpBackdrop: 'nebula', bought: 0 },
];

function view(over: Partial<MetaEconomyView> = {}): MetaEconomyView {
  return {
    catalogVersion: 'v',
    materials: [
      { id: 'ferroalloys', nameKey: 'meta.material.ferroalloys', tradable: 0, soulbound: 0 },
      { id: 'energy_cells', nameKey: 'meta.material.energy_cells', tradable: 0, soulbound: 0 },
    ],
    recipes: [
      {
        id: 'siege_platform',
        defId: 'siege_platform',
        ingredients: [
          { materialId: 'ferroalloys', required: 25, tradable: 0, soulbound: 0 },
          { materialId: 'energy_cells', required: 8, tradable: 0, soulbound: 0 },
        ],
        canCraft: false,
        requiresSoulbound: true,
        salvage: [],
      },
    ],
    supplyGoal: null,
    items: [],
    salvageableItemIds: [],
    seasons: [],
    cosmetics: [],
    sovereigns: 300,
    premiumUntil: null,
    store: STORE,
    premiumPerks: { dailySovereigns: 5, extraDailyAds: 1 },
    premiumDaily: null,
    ads: { used: 1, limit: 2 },
    ...over,
  };
}

function state(over: Partial<ShopState> = {}): ShopState {
  return {
    view: view(),
    offers: OFFERS,
    guest: false,
    canSignIn: true,
    busy: false,
    tab: 'sovereigns',
    pick: undefined,
    confirm: false,
    status: null,
    notice: null,
    dailyNotice: null,
    wide: true,
    warrants: 340,
    now: NOW,
    corpStyle: null,
    ...over,
  };
}

/** Корпорация игрока, как её отдаёт `/meta-economy/corp-style`. */
const corp = (head: boolean, owned: string[] = [], active = 'standard'): MetaCorpStyleView => ({
  head,
  active,
  backdrop: 'orbit',
  owned,
});

describe('магазин — разметка', () => {
  it('Суверены: пакеты видны, оплата честно недоступна, подарок и метка лучшей цены', () => {
    const html = shopHtml(state());
    expect(html).toContain('1\u00a0200 + 240 в подарок');
    expect(html).toContain('Лучшая цена');
    expect(html).toContain('Скоро');
    expect(html).toContain('data-sh-pick="sovereigns_100"');
    const detail = shopDetailHtml(state());
    expect(detail).toContain('Оплата пока недоступна');
    expect(detail).toMatch(/<button[^>]*disabled>Оплата пока недоступна/);
    // Кошелёк: ◆ из ответа сервера и ⌖ аукциона.
    expect(html).toMatch(/sh-cur sov[^]*300/);
    expect(html).toMatch(/sh-cur war[^]*340/);
  });

  it('модули: цена без уже открытых, скидка, «Уже есть» вместо кнопки', () => {
    const html = shopHtml(state({ tab: 'modules' }));
    expect(html).toContain('−15%');
    expect(html).toContain('<s>180</s>');
    const owned = shopDetailHtml(state({ tab: 'modules', pick: 'module_shield_booster' }));
    expect(owned).toMatch(/<button[^>]*disabled>Уже есть/);
    expect(owned).not.toContain('data-sh-buy=');
    const pack = shopDetailHtml(state({ tab: 'modules', pick: 'pack_defense' }));
    expect(pack).toContain('Уже открытые модули в цену не входят.');
    expect(pack).toContain('data-sh-buy="pack_defense"');
  });

  it('не хватает ◆: кнопка называет недостачу и ведёт к Суверенам', () => {
    const html = shopDetailHtml(state({ tab: 'modules', pick: 'module_rocket_mine_layer' }));
    expect(html).toMatch(/<button[^>]*disabled>Не хватает <b class="sh-sov">60/);
    expect(html).toContain('data-sh-tab="sovereigns"');
  });

  it('по умолчанию открыт первый товар, который можно купить', () => {
    expect(shopDetailHtml(state({ tab: 'modules' }))).toContain('data-sh-buy="pack_defense"');
  });

  it('премиум: бонусы с числами из каталога, без премиума — без кнопки «Забрать»', () => {
    const html = shopHtml(state({ tab: 'premium' }));
    // ◆ из строки локали рисуется иконкой Суверенов, как на плашке хаба.
    expect(html).toMatch(
      /\+5 <i class="sh-gem" aria-hidden="true"><svg[\s\S]*?<\/svg><\/i> каждый день/,
    );
    expect(html).toContain('+1 снабжение за рекламу в день');
    expect(html).toContain('Не активен');
    expect(html).toContain('Выгоднее на 30%');
    expect(html).not.toContain('data-sh-daily');
    const running = view({
      premiumUntil: NOW + 3 * DAY,
      premiumDaily: { amount: 5, claimed: false },
    });
    const on = shopHtml(state({ tab: 'premium', view: running }));
    expect(on).toContain('Активен · ещё 3 дня');
    expect(on).toContain('data-sh-daily');
    expect(on).toMatch(/data-sh-daily>Забрать \+5 <i class="sh-gem"/);
    expect(shopDetailHtml(state({ tab: 'premium', view: running }))).toContain(
      'Срок прибавится к текущему.',
    );
  });

  it('материалы: снабжение за рекламу с остатком дня и доля рецепта', () => {
    const html = shopHtml(state({ tab: 'materials' }));
    expect(html).toContain('Осталось сегодня: 1 из 2');
    const detail = shopDetailHtml(state({ tab: 'materials', pick: 'materials_ferroalloys' }));
    expect(detail).toContain('Закрывает рецепт');
    expect(detail).toMatch(/Осадная платформа[^]*75%/);
  });

  it('гость видит вход вместо полок', () => {
    const html = shopHtml(state({ guest: true, view: null }));
    expect(html).toContain('data-sh-sign-in');
    expect(html).not.toContain('sh-grid');
  });
});

describe('магазин — «Стили»: стили базы корпорации (CORP-14)', () => {
  const styles = (over: Partial<ShopState> = {}): ShopState =>
    state({ tab: 'styles', view: view({ sovereigns: 600 }), corpStyle: corp(true), ...over });

  it('полка: стиль с ценой и завершённым штабом, вкладка подписана', () => {
    const html = shopHtml(styles());
    expect(html).toContain('data-sh-tab="styles"');
    expect(html).toContain('Стили');
    expect(html).toContain('Имперская готика');
    expect(html).toContain('Хайтек');
    expect(html).toContain('Стиль базы корпорации');
    expect(html).toMatch(/data-sh-pick="corp_style_high_tech"[^]*?sh-sov">490/);
    expect(html).toContain(`href="${corpArt('headquarters', 5, 'high_tech')!.src}"`);
    expect(html).not.toContain(`<img src="${corpArt('headquarters', 5, 'high_tech')!.src}"`);
    // Чужие полки стили не показывают.
    expect(shopHtml(styles({ tab: 'modules' }))).not.toContain('corp_style_');
  });

  it('глава покупает за свои ◆: «Купить», а без денег — недостача', () => {
    const detail = shopDetailHtml(styles({ pick: 'corp_style_high_tech' }));
    expect(detail).toContain('data-sh-buy="corp_style_high_tech"');
    expect(detail).toContain('Стиль принадлежит корпорации и остаётся при смене главы.');
    // В описании — все здания базы в этом стиле.
    expect(detail.match(/class="spr"/g)).toHaveLength(7);
    for (const id of CORP_ART_BUILDINGS) {
      const art = corpArt(id, id === 'headquarters' ? 5 : 3, 'high_tech')!;
      expect(detail).toContain(`href="${art.src}"`);
      if (art.frame) {
        const f = art.frame;
        expect(detail).toContain(`viewBox="${f.sx} ${f.sy} ${f.sw} ${f.sh}"`);
        expect(detail).not.toContain(`<img src="${art.src}"`);
      }
    }
    const poor = shopDetailHtml(styles({ view: view(), pick: 'corp_style_high_tech' }));
    expect(poor).toMatch(/<button[^>]*disabled>Не хватает <b class="sh-sov">190/);
    expect(poor).not.toContain('data-sh-buy=');
  });

  it('стиль у корпорации: глава применяет, применённый — без кнопки, цены нет', () => {
    const owned = styles({ corpStyle: corp(true, ['high_tech']), pick: 'corp_style_high_tech' });
    expect(shopDetailHtml(owned)).toContain('data-sh-apply="high_tech"');
    expect(shopHtml(owned)).toMatch(/data-sh-pick="corp_style_high_tech"[^]*?Есть у корпорации/);
    const applied = styles({
      corpStyle: corp(true, ['high_tech'], 'high_tech'),
      pick: 'corp_style_high_tech',
    });
    expect(shopDetailHtml(applied)).toMatch(/<button[^>]*disabled>Применён/);
    expect(shopHtml(applied)).toMatch(/data-sh-pick="corp_style_high_tech"[^]*?Применён/);
  });

  it('не глава, без корпорации, без ответа о ней: кнопка погашена и говорит почему', () => {
    const reason = (corpStyle: ShopState['corpStyle']): string =>
      shopDetailHtml(styles({ corpStyle, pick: 'corp_style_imperial_gothic' }));
    expect(reason(corp(false))).toMatch(/<button[^>]*disabled>Покупает глава корпорации/);
    expect(reason(corp(false, ['imperial_gothic']))).toMatch(
      /<button[^>]*disabled>Есть у корпорации/,
    );
    expect(reason(null)).toMatch(/<button[^>]*disabled>Нужна корпорация/);
    expect(reason(undefined)).toMatch(/<button[^>]*disabled>Корпорация не отвечает/);
    for (const c of [corp(false), null, undefined]) {
      expect(reason(c)).not.toContain('data-sh-buy=');
      expect(reason(c)).not.toContain('data-sh-apply=');
    }
  });

  it('вкладка «Корпорация» открывает стиль по его id, а не по id товара', () => {
    const detail = shopDetailHtml(styles({ pick: 'high_tech' }));
    expect(detail).toContain('<h3 id="sh-dt-title">Хайтек</h3>');
    expect(detail).toContain('data-sh-buy="corp_style_high_tech"');
  });

  it('фон базы рядом со стилями: панорама без зданий, покупка и применение тем же путём (CORP-15)', () => {
    const html = shopHtml(styles());
    expect(html).toContain('Туманность');
    expect(html).toContain('Фон базы корпорации');
    expect(html).toMatch(/data-sh-pick="corp_backdrop_nebula"[^]*?sh-sov">290/);
    expect(html).toContain('<image data-corp-backdrop="nebula"');
    const detail = shopDetailHtml(styles({ pick: 'nebula' }));
    expect(detail).toContain('data-sh-buy="corp_backdrop_nebula"');
    expect(detail).toContain('Фон принадлежит корпорации');
    const owned = shopDetailHtml(
      styles({ corpStyle: corp(true, ['nebula']), pick: 'corp_backdrop_nebula' }),
    );
    expect(owned).toContain('data-sh-apply="nebula"');
  });
});

// --- wiring ---------------------------------------------------------------------------

type Fake = HTMLElement & { fire: (dataset: Record<string, string>, disabled?: boolean) => void };

/** Node has no DOM: the tab paints innerHTML and delegates clicks — that is the whole contract. */
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
type FakeHost = Omit<ShopHost, 'root' | 'sheet'> & { root(): Fake; sheet(): Fake };

function hostOf(over: Partial<ShopHost> = {}): FakeHost {
  const root = fakeEl();
  const sheet = fakeEl();
  let id = 0;
  return {
    root: () => root,
    sheet: () => sheet,
    narrow: () => false,
    authorizedBase: async () => ({ base: 'https://srv', token: 'tok' }),
    canSignIn: () => true,
    signIn: () => {},
    warrants: () => 0,
    now: () => NOW,
    accountChanged: () => {},
    requestId: () => `intent-${++id}`,
    ...over,
  } as FakeHost;
}

type Post = { path: string; body: Record<string, unknown> };

/** `corpOf` answers `/meta-economy/corp-style` from the commands sent so far. */
function server(
  current: () => MetaEconomyView = () => view(),
  corpOf: (posts: readonly Post[]) => unknown = () => ({ corp: null }),
) {
  const posts: Post[] = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init?: { body?: string }) => {
      const path = url.replace('https://srv', '');
      if (init?.body) {
        posts.push({ path, body: JSON.parse(init.body) as Record<string, unknown> });
        return response({ ok: true, receipt: { id: 'r' } });
      }
      if (path === '/meta-economy/corp-style') return response(corpOf(posts));
      return response(path === '/commerce/offers' ? { offers: OFFERS } : current());
    }),
  );
  return posts;
}

describe('магазин — вкладка', () => {
  it('гость: в сеть не ходит, кошелёк хаба узнаёт, что баланса нет', async () => {
    const fetcher = vi.fn();
    vi.stubGlobal('fetch', fetcher);
    const seen: unknown[] = [];
    const signIn = vi.fn();
    const host = hostOf({
      authorizedBase: async () => null,
      signIn,
      accountChanged: (v) => seen.push(v),
    });
    const shop = initShop(host);
    await shop.refresh();
    expect(fetcher).not.toHaveBeenCalled();
    expect(shop.sovereigns()).toBeNull();
    expect(seen).toEqual([null]);
    host.root().fire({ shSignIn: '' });
    expect(signIn).toHaveBeenCalledOnce();
  });

  it('покупка в два нажатия: подтверждение, затем команда, текст успеха и перечитка', async () => {
    const posts = server();
    const changed = vi.fn(async () => {});
    const seen: Array<MetaEconomyView | null> = [];
    const host = hostOf({ changed, accountChanged: (v) => seen.push(v) });
    const shop = initShop(host);
    shop.show('modules');
    await shop.refresh();
    expect(shop.sovereigns()).toBe(300);
    expect(seen.at(-1)?.sovereigns).toBe(300);
    host.root().fire({ shBuy: 'module_tractor_beam' });
    expect(posts).toEqual([]);
    expect(host.root().innerHTML).toMatch(
      /Списать 220 <i class="sh-gem"[\s\S]*?<\/i> за «Тяговый луч»\?/,
    );
    host.root().fire({ shBuyDo: 'module_tractor_beam' });
    await vi.waitFor(() => expect(host.root().innerHTML).toContain('Модули в Арсенале.'));
    expect(posts).toEqual([
      {
        path: '/meta-economy/store/buy',
        body: { offerId: 'module_tractor_beam', requestId: 'intent-1' },
      },
    ]);
    expect(changed).toHaveBeenCalledOnce();
  });

  it('без подтверждения и без денег команда не уходит', async () => {
    const posts = server();
    const host = hostOf();
    const shop = initShop(host);
    shop.show('modules');
    await shop.refresh();
    host.root().fire({ shBuyDo: 'module_tractor_beam' });
    host.root().fire({ shBuy: 'module_rocket_mine_layer' });
    host.root().fire({ shBuyDo: 'module_rocket_mine_layer' });
    await Promise.resolve();
    expect(posts).toEqual([]);
  });

  it('ежедневные ◆ премиума забираются одной командой', async () => {
    const posts = server(() =>
      view({ premiumUntil: NOW + DAY, premiumDaily: { amount: 5, claimed: false } }),
    );
    const host = hostOf();
    const shop = initShop(host);
    shop.show('premium');
    await shop.refresh();
    host.root().fire({ shDaily: '' });
    await vi.waitFor(() => expect(host.root().innerHTML).toContain('Суверены зачислены.'));
    // Итог — под кнопкой «Забрать», а не в карточке выбранного срока.
    const html = host.root().innerHTML;
    const box = html.slice(html.indexOf('<section class="sh-prem">'), html.indexOf('</section>'));
    expect(box).toContain('Суверены зачислены.');
    expect(html.slice(html.indexOf('<aside'))).not.toContain('Суверены зачислены.');
    expect(posts).toEqual([
      { path: '/meta-economy/premium/daily', body: { requestId: 'intent-1' } },
    ]);
  });

  it('стиль базы: глава покупает в два нажатия, затем применяет купленный (CORP-14)', async () => {
    const sent = (posts: readonly Post[], path: string): boolean =>
      posts.some((p) => p.path === path);
    const posts = server(
      () => view({ sovereigns: 600 }),
      (done) => ({
        corp: corp(
          true,
          sent(done, '/meta-economy/corp-style/buy') ? ['imperial_gothic'] : [],
          sent(done, '/meta-economy/corp-style/apply') ? 'imperial_gothic' : 'standard',
        ),
      }),
    );
    const host = hostOf();
    const shop = initShop(host);
    // Так магазин открывает вкладка «Корпорация»: по id стиля.
    shop.show('styles', 'imperial_gothic');
    await shop.refresh();
    host.root().fire({ shBuy: 'corp_style_imperial_gothic' });
    expect(posts).toEqual([]);
    expect(host.root().innerHTML).toMatch(
      /Списать 490 <i class="sh-gem"[\s\S]*?<\/i> за «Имперская готика»\?/,
    );
    host.root().fire({ shBuyDo: 'corp_style_imperial_gothic' });
    await vi.waitFor(() => expect(host.root().innerHTML).toContain('Стиль куплен.'));
    expect(host.root().innerHTML).toContain('data-sh-apply="imperial_gothic"');
    host.root().fire({ shApply: 'imperial_gothic' });
    await vi.waitFor(() => expect(host.root().innerHTML).toContain('Стиль применён.'));
    expect(host.root().innerHTML).toMatch(/<button[^>]*disabled>Применён/);
    expect(posts).toEqual([
      {
        path: '/meta-economy/corp-style/buy',
        body: { offerId: 'corp_style_imperial_gothic', requestId: 'intent-1' },
      },
      {
        path: '/meta-economy/corp-style/apply',
        body: { styleId: 'imperial_gothic', requestId: 'intent-2' },
      },
    ]);
  });

  it('стиль базы: не глава не покупает и не применяет — команды не уходят', async () => {
    const posts = server(
      () => view({ sovereigns: 600 }),
      () => ({ corp: corp(false, ['high_tech']) }),
    );
    const host = hostOf();
    const shop = initShop(host);
    shop.show('styles');
    await shop.refresh();
    host.root().fire({ shBuy: 'corp_style_imperial_gothic' });
    host.root().fire({ shBuyDo: 'corp_style_imperial_gothic' });
    host.root().fire({ shApply: 'high_tech' });
    await Promise.resolve();
    expect(posts).toEqual([]);
    expect(host.root().innerHTML).not.toContain('sh-confirm');
  });

  it('стиль базы: сбой корпораций гасит кнопку стиля, но не прячет магазин', async () => {
    server(
      () => view({ sovereigns: 600 }),
      () => ({ ok: false, error: 'E_CORPORATIONS_UNAVAILABLE' }),
    );
    const host = hostOf();
    const shop = initShop(host);
    shop.show('styles', 'high_tech');
    await shop.refresh();
    expect(shop.sovereigns()).toBe(600);
    expect(host.root().innerHTML).toMatch(/<button[^>]*disabled>Корпорация не отвечает/);
  });

  it('телефон: товар из Арсенала ждёт загрузки и открывается шторкой', async () => {
    server();
    const host = hostOf({ narrow: () => true });
    const shop = initShop(host);
    shop.show('modules', 'module_tractor_beam');
    expect(shop.isOpen()).toBe(false);
    await shop.refresh();
    expect(shop.isOpen()).toBe(true);
    expect(host.sheet().innerHTML).toContain('data-sh-buy="module_tractor_beam"');
    host.sheet().fire({ shClose: '' });
    expect(shop.isOpen()).toBe(false);
    expect(host.sheet().innerHTML).toBe('');
  });
});
