import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { setLocale } from '../../localization/runtime';
import type { MetaEconomyView } from '../../packages/protocol/src/metaEconomyView';
import { initMetaEconomy, metaEconomyHtml, type MetaEconomyHost } from './metaEconomyScreen';

function fixture(): MetaEconomyView {
  return {
    catalogVersion: 'meta-v0.1',
    materials: [
      { id: 'ferroalloys', nameKey: 'meta.material.ferroalloys', tradable: 5, soulbound: 20 },
    ],
    recipes: [
      {
        id: 'shield',
        defId: 'shield_booster',
        ingredients: [{ materialId: 'ferroalloys', required: 10, tradable: 5, soulbound: 20 }],
        canCraft: true,
        requiresSoulbound: true,
        salvage: [{ materialId: 'ferroalloys', quantity: 3 }],
      },
    ],
    supplyGoal: 'shield',
    items: [
      {
        itemId: 'owned',
        kind: 'module',
        form: 'blueprint',
        defId: 'shield_booster',
        grade: 0,
        soulbound: true,
        origin: 'craft',
        acquiredAt: 1,
      },
    ],
    salvageableItemIds: ['owned'],
    seasons: [
      {
        id: 'frontier',
        nameKey: 'meta.season.frontier_fleet',
        startsAt: 1,
        endsAt: 2,
        levels: 50,
        xpPerLevel: 100,
        xp: 1000,
        level: 10,
        premium: false,
        active: true,
        started: true,
        archived: true,
        contracts: [],
        milestones: [
          {
            level: 10,
            free: 'meta.reward.blueprint_choice',
            premium: 'meta.reward.ship_skin',
            freeClaimed: false,
            premiumClaimed: false,
            choices: ['shield_booster'],
          },
        ],
      },
    ],
    cosmetics: [],
  };
}

function fakeRoot() {
  let click: ((event: { target: unknown }) => void) | undefined;
  const root = {
    innerHTML: '',
    addEventListener: (_name: string, cb: typeof click) => {
      click = cb;
    },
    querySelector: () => ({ value: 'shield_booster' }),
    fire: (dataset: Record<string, string>) => {
      const button = {
        dataset,
        disabled: false,
        hasAttribute: (name: string) =>
          name === 'data-me-refresh' && dataset.meRefresh !== undefined,
      };
      click?.({ target: { closest: () => button } });
    },
  };
  return root;
}

function host(
  root: ReturnType<typeof fakeRoot>,
  overrides: Partial<MetaEconomyHost> = {},
): MetaEconomyHost {
  let id = 0;
  return {
    root: () => root as unknown as HTMLElement,
    authorizedBase: async () => ({ base: 'https://server', token: 'session' }),
    changed: async () => {},
    confirm: () => true,
    requestId: () => `intent-${++id}`,
    ...overrides,
  };
}
const response = (value: unknown) => ({ ok: true, json: async () => value });

beforeEach(() => setLocale('ru'));
afterEach(() => vi.unstubAllGlobals());

describe('main-game supply screen', () => {
  it('separates personal material balances and warns before a bound recipe', () => {
    const html = metaEconomyHtml(fixture(), []);
    expect(html).toContain('Торгуемые <b>5</b>');
    expect(html).toContain('Личные <b>20</b>');
    expect(html).toContain('Личные материалы делают результат личным.');
    expect(html).toContain('Материалы останутся личными.');
    expect(html).toContain('Текущая цель');
    expect(html).toContain('Архивная дорожка');
  });

  it('shows known store contents without a fake purchase button or fabricated price', () => {
    const html = metaEconomyHtml(fixture(), [
      {
        productId: 'supply_personal',
        catalogVersion: 'v1',
        source: 'payment',
        nameKey: 'commerce.offer.supply_personal.name',
        contentsKey: 'commerce.offer.supply_personal.contents',
        available: false,
        unavailableReason: 'E_COMMERCE_UNAVAILABLE',
        contents: { soulbound: true, materials: { ferroalloys: 5 } },
      },
    ]);
    expect(html).toContain('Ферросплавы ×5');
    expect(html).toContain('Покупки временно недоступны.');
    expect(html).not.toContain('data-me-purchase');
  });

  // Плашка Суверенов ведёт в магазин: экран открывается прокрученным к нему, но только
  // когда раздел уже нарисован, и только один раз.
  it('the Sovereigns plate opens the supply screen scrolled to the store once it loads', async () => {
    const root = fakeRoot();
    const scrolled: string[] = [];
    root.querySelector = ((selector: string) => ({
      value: 'shield_booster',
      scrollIntoView: () => {
        scrolled.push(selector);
      },
    })) as unknown as typeof root.querySelector;
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string) => response(url.endsWith('/offers') ? { offers: [] } : fixture())),
    );
    const screen = initMetaEconomy(host(root));
    const loading = screen.refresh();
    screen.showStore();
    expect(scrolled).toEqual([]);
    await loading;
    expect(root.innerHTML).toContain('data-me-store');
    expect(scrolled).toEqual(['[data-me-store]']);
    await screen.refresh();
    expect(scrolled).toHaveLength(1);
  });

  it('escapes server-controlled identifiers and names', () => {
    const view = fixture();
    view.recipes[0]!.id = 'x" onclick="alert(1)';
    view.recipes[0]!.defId = '<script>bad</script>';
    const html = metaEconomyHtml(view, []);
    expect(html).not.toContain('onclick="alert');
    expect(html).not.toContain('<script>');
    expect(html).toContain('&lt;script&gt;');
  });

  it('a guest gets a sign-in state without fetching or storing any value', async () => {
    const root = fakeRoot();
    const fetcher = vi.fn();
    vi.stubGlobal('fetch', fetcher);
    await initMetaEconomy(host(root, { authorizedBase: async () => null })).refresh();
    expect(fetcher).not.toHaveBeenCalled();
    expect(root.innerHTML).toContain('после входа в аккаунт');
  });

  it('declining the personal-material confirmation sends no craft command', async () => {
    const root = fakeRoot();
    const fetcher = vi.fn(async (url: string) =>
      response(url.endsWith('/offers') ? { offers: [] } : fixture()),
    );
    vi.stubGlobal('fetch', fetcher);
    const confirm = vi.fn(() => false);
    await initMetaEconomy(host(root, { confirm })).refresh();
    root.fire({ meCraft: 'shield' });
    expect(confirm).toHaveBeenCalledOnce();
    expect(fetcher).toHaveBeenCalledTimes(2);
  });

  it('retries an ambiguous craft with the same request id and blocks double submits', async () => {
    const root = fakeRoot();
    const bodies: Array<Record<string, unknown>> = [];
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string, init: { body?: string }) => {
        if (url.endsWith('/craft')) {
          bodies.push(JSON.parse(init.body!) as Record<string, unknown>);
          if (bodies.length === 1) throw new Error('disconnected after commit');
          return response({ ok: true, receipt: { id: 'receipt' } });
        }
        return response(url.endsWith('/offers') ? { offers: [] } : fixture());
      }),
    );
    await initMetaEconomy(host(root)).refresh();
    root.fire({ meCraft: 'shield' });
    root.fire({ meCraft: 'shield' });
    await vi.waitFor(() => expect(root.innerHTML).toContain('Действие не выполнено'));
    expect(bodies).toHaveLength(1);
    root.fire({ meCraft: 'shield' });
    await vi.waitFor(() => expect(root.innerHTML).toContain('Предмет добавлен в арсенал.'));
    expect(bodies).toEqual([
      { recipeId: 'shield', allowSoulbound: true, requestId: 'intent-1' },
      { recipeId: 'shield', allowSoulbound: true, requestId: 'intent-1' },
    ]);
  });

  it('a confirmed craft followed by a failed refresh removes stale craft controls', async () => {
    const root = fakeRoot();
    let writes = 0;
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string) => {
        if (url.endsWith('/craft')) {
          writes++;
          return response({ ok: true, receipt: { id: 'receipt' } });
        }
        if (url.endsWith('/me') && writes > 0) throw new Error('offline');
        return response(url.endsWith('/offers') ? { offers: [] } : fixture());
      }),
    );
    await initMetaEconomy(host(root)).refresh();
    root.fire({ meCraft: 'shield' });
    await vi.waitFor(() => expect(root.innerHTML).toContain('Действие не выполнено'));
    expect(root.innerHTML).not.toContain('data-me-craft');
    root.fire({ meCraft: 'shield' });
    expect(writes).toBe(1);
  });

  it('does not execute a previous account’s craft after switching sessions', async () => {
    const root = fakeRoot();
    let token = 'one';
    const fetcher = vi.fn(async (url: string) =>
      response(url.endsWith('/offers') ? { offers: [] } : fixture()),
    );
    vi.stubGlobal('fetch', fetcher);
    await initMetaEconomy(
      host(root, { authorizedBase: async () => ({ base: 'https://server', token }) }),
    ).refresh();
    token = 'two';
    root.fire({ meCraft: 'shield' });
    await vi.waitFor(() => expect(root.innerHTML).toContain('после входа в аккаунт'));
    expect(fetcher).toHaveBeenCalledTimes(2);
  });
});
