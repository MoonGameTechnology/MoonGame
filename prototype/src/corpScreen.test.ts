import { describe, it, expect, beforeAll, afterEach, vi } from 'vitest';
import { setLocale, t } from '../../localization/runtime';
import {
  CORP_BATTLE_LABEL,
  CORP_TABS,
  CORP_AUDIT_RU,
  CORP_ROLE_DOT,
  corpBattles,
  corpRoleLabel,
  hqTile,
  initCorp,
  medalGalleryHtml,
  type CorpHost,
} from './corpScreen';
import type { CorpBattlesView } from '../../packages/protocol/src/corpBattles';
import type { AvaFeedEntry, CorpRole, MedalDef } from './corp';
import { updateCorpInfrastructure } from '../../packages/server/src/corpConstruction';

// REFM-11: locale pinned RU (see format.test.ts — Node has no browser language, so the
// runtime would fall back to EN and the label assertions would drift).
beforeAll(() => setLocale('ru'));

const ROLES: CorpRole[] = ['head', 'officer', 'member', 'recruit'];

/** The cabinet hides with `style.display`, not a class — the stand-in mirrors that. */
function fakeEl(): HTMLElement & { html: () => string; fire: (t: unknown) => void } {
  let handler: ((ev: unknown) => void) | null = null;
  const el = {
    innerHTML: '',
    style: { display: '' },
    addEventListener: (_t: string, h: (ev: unknown) => void) => {
      handler = h;
    },
    html: () => el.innerHTML,
    fire: (target: unknown) => handler?.({ target }),
  };
  return el as unknown as HTMLElement & { html: () => string; fire: (t: unknown) => void };
}

/** Панель и шторка вкладки хаба: перерисовка целиком, класс `open` и делегат нажатий. */
function fakeHubEl(): HTMLElement & { html: () => string; open: () => boolean; fire: (t: unknown) => void } {
  const classes = new Set<string>();
  const handlers: Record<string, (ev: unknown) => void> = {};
  const el = {
    innerHTML: '',
    classList: { add: (c: string) => classes.add(c), remove: (c: string) => classes.delete(c) },
    querySelector: () => null,
    querySelectorAll: () => [],
    addEventListener: (type: string, h: (ev: unknown) => void) => {
      handlers[type] = h;
    },
    html: () => el.innerHTML,
    open: () => classes.has('open'),
    fire: (target: unknown) => handlers.click?.({ target }),
  };
  return el as unknown as HTMLElement & { html: () => string; open: () => boolean; fire: (t: unknown) => void };
}

const closeCabinets: Array<() => void> = [];

function wire(over: Partial<CorpHost> = {}) {
  const root = fakeEl();
  const head = fakeEl();
  const tabs = fakeEl();
  const body = fakeEl();
  const hubRoot = fakeHubEl();
  const hubSheet = fakeHubEl();
  const notes: string[] = [];
  const hubNotes: string[] = [];
  const intros: string[] = [];
  const signIns: number[] = [];
  const api = initCorp({
    root: () => root,
    head: () => head,
    tabs: () => tabs,
    body: () => body,
    authorizedBase: () => Promise.resolve(null),
    note: (x) => notes.push(x),
    errText: (code) => `текст:${code}`,
    onIntro: (id) => intros.push(id),
    hub: {
      root: () => hubRoot,
      sheet: () => hubSheet,
      note: (x) => hubNotes.push(x),
      canSignIn: () => false,
      signIn: () => signIns.push(1),
    },
    ...over,
  });
  closeCabinets.push(() => {
    api.close();
    api.close();
    api.hideHub();
  });
  return {
    api,
    root,
    head,
    tabs,
    body,
    hubRoot,
    hubSheet,
    notes,
    hubNotes,
    intros,
    signIns,
    shown: () => root.style.display,
  };
}

afterEach(() => {
  for (const close of closeCabinets.splice(0)) close();
  vi.unstubAllGlobals();
});

describe('корпорации — словари', () => {
  it('у всех четырёх ролей есть подпись и свой цвет точки', () => {
    for (const r of ROLES) {
      expect(corpRoleLabel(r), r).not.toContain('corp.role');
      expect(corpRoleLabel(r), r).not.toBe('');
      expect(CORP_ROLE_DOT[r], r).toMatch(/^var\(--/);
    }
    // роли различимы — иначе список участников читался бы как однородный
    expect(new Set(ROLES.map(corpRoleLabel)).size).toBe(4);
  });

  it('у каждой вкладки есть локализованная подпись и своя иконка', () => {
    for (const tab of CORP_TABS) {
      expect(tab.label, tab.id).toMatch(/^corp\.tab\./);
      expect(t(tab.label), tab.id).not.toContain('corp.tab');
      expect(tab.icon, tab.id).not.toBe('');
    }
    // CORP-HUB: семь вкладок, и каждая ведёт на живой маршрут — заглушек-вкладок
    // больше нет (владения и чат стали честными строками в «Настройках»)
    expect(CORP_TABS.map((x) => x.id)).toEqual([
      'hq',
      'buildings',
      'members',
      'wars',
      'battles',
      'treasury',
      'settings',
    ]);
    // иконки различимы — иначе сетка читается как шесть одинаковых кнопок
    expect(new Set(CORP_TABS.map((x) => x.icon)).size).toBe(CORP_TABS.length);
  });

  it('каждый вид записи аудита переводится — сырой ключ игроку не покажут', () => {
    for (const [kind, key] of Object.entries(CORP_AUDIT_RU)) {
      expect(key, kind).toMatch(/^corp\.audit\./);
      expect(t(key), kind).not.toContain('corp.audit');
    }
  });
});

describe('корпорации — история боёв из публичной ленты', () => {
  const feed = (over: Partial<AvaFeedEntry>): AvaFeedEntry => ({
    id: 'f1',
    at: 1,
    kind: 'result',
    challengerCorp: 'me',
    challengerName: 'Мы',
    targetCorp: 'them',
    targetName: 'Они',
    ...over,
  });

  it('чужие бои и назначенные матчи в историю не попадают', () => {
    expect(
      corpBattles(
        [
          feed({ kind: 'matchup', winnerCorp: null }),
          feed({ challengerCorp: 'x', targetCorp: 'y', winnerCorp: 'x' }),
        ],
        'me',
      ),
    ).toEqual([]);
  });

  it('победа, поражение и ничья различаются — null-победитель это НЕ проигрыш', () => {
    const rows = corpBattles(
      [
        feed({ id: 'a', at: 3, winnerCorp: 'me' }),
        feed({ id: 'b', at: 2, winnerCorp: 'them' }),
        feed({ id: 'c', at: 1, winnerCorp: null }),
      ],
      'me',
    );
    expect(rows.map((r) => r.outcome)).toEqual(['win', 'loss', 'draw']);
    expect(rows.every((r) => r.foe === 'Они')).toBe(true); // противник — всегда ДРУГАЯ сторона
  });

  it('за сторону цели противником читается вызвавший', () => {
    const rows = corpBattles([feed({ challengerCorp: 'them', targetCorp: 'me', winnerCorp: 'me' })], 'me');
    expect(rows).toEqual([{ at: 1, foe: 'Мы', outcome: 'win' }]);
  });

  it('у каждого исхода своя локализованная плашка', () => {
    for (const [outcome, key] of Object.entries(CORP_BATTLE_LABEL)) {
      expect(key, outcome).toMatch(/^corp\.battle\./);
      expect(t(key), outcome).not.toContain('corp.battle');
    }
  });
});

describe('корпорации — витрина наград', () => {
  const defs: MedalDef[] = [
    { id: 'first', name: 'Первая кровь', description: 'первая победа' },
    { id: 'champ', name: 'Чемпион', description: 'пять побед' },
  ];

  it('в общей витрине неполученные видны, но не выбираются', () => {
    const html = medalGalleryHtml(defs, ['first']);
    expect(html).toContain('data-corppick="first"');
    expect(html).not.toContain('data-corppick="champ"');
    expect(html).toContain('Чемпион'); // видна как цель, вместе с условием
    expect(html).toContain('пять побед');
  });

  it('пустой каталог не рисует пустой список', () => {
    expect(medalGalleryHtml([], [])).not.toContain('cmg-list');
  });

  it('плитка «Штаба» печатает прочерк вместо нуля, когда числа нет', () => {
    expect(hqTile('Место', null)).toContain('—');
    expect(hqTile('Место', '#17')).toContain('#17');
  });
});

describe('корпорации — кабинет', () => {
  it('open() красит, показывает и дёргает интро; close() прячет', () => {
    const { api, body, intros, shown } = wire();
    expect(shown()).toBe('');
    api.open();
    expect(shown()).toBe('flex');
    expect(body.html()).not.toBe('');
    expect(intros).toEqual(['corp']);
    api.close();
    expect(shown()).toBe('none');
  });

  it('без корпорации `mine()` пуст — профиль по нему рисует прочерк', () => {
    const { api } = wire();
    api.open();
    expect(api.mine()).toEqual({ corp: null, membership: null });
  });

  it('без авторизации кабинет в сеть не ходит вовсе', async () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal('fetch', fetchSpy);
    const { api } = wire();
    api.open();
    await new Promise((r) => setTimeout(r, 0));
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('вкладка «Войны» дополнительно показывает своё интро', () => {
    const { api, tabs, intros } = wire();
    api.open();
    tabs.fire({ closest: (s: string) => (s === '[data-corptab]' ? { dataset: { corptab: 'wars' } } : null) });
    expect(intros).toEqual(['corp', 'ava']);
  });

  it('переключение вкладки перерисовывает тело', () => {
    const { api, tabs, body } = wire();
    api.open();
    const before = body.html();
    tabs.fire({
      closest: (s: string) =>
        s === '[data-corptab]' ? { dataset: { corptab: 'wars' } } : null,
    });
    expect(body.html()).not.toBe(before);
  });

  it('Back закрывает кабинет: витрина встроена в карточку здания', () => {
    const { api, shown } = wire();
    api.open();
    api.close();
    expect(shown()).toBe('none');
  });

  it('крестик закрывает кабинет целиком', () => {
    const { api, root, shown } = wire();
    api.open();
    root.fire({ closest: (s: string) => (s === '[data-corpcup]' ? { dataset: { corpcup: '0' } } : null) });
    root.fire({ id: 'corpclose', closest: () => null });
    expect(shown()).toBe('none');
  });

  it('крестик и фон закрывают кабинет', () => {
    const { api, root, shown } = wire();
    api.open();
    root.fire({ id: 'corpclose', closest: () => null });
    expect(shown()).toBe('none');
    api.open();
    root.fire({ id: 'corp', closest: () => null });
    expect(shown()).toBe('none');
  });

  it('серверный код ошибки становится тостом через errText, а не сырым E_*', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(() => Promise.resolve({ ok: false, json: () => Promise.resolve({ error: 'E_NO_CORP' }) })),
    );
    const { api, notes } = wire({
      authorizedBase: () => Promise.resolve({ base: 'https://srv', token: 'tok' }),
    });
    api.open();
    await new Promise((r) => setTimeout(r, 0));
    expect(notes.some((n) => n.includes('текст:E_NO_CORP'))).toBe(true);
    expect(notes.every((n) => !/^✖ E_/.test(n))).toBe(true);
  });

  it('обрыв сети не роняет кабинет и не сыплет тостами', async () => {
    vi.stubGlobal('fetch', vi.fn(() => Promise.reject(new Error('offline'))));
    const { api, notes, shown } = wire({
      authorizedBase: () => Promise.resolve({ base: 'https://srv', token: 'tok' }),
    });
    expect(() => api.open()).not.toThrow();
    await new Promise((r) => setTimeout(r, 0));
    expect(shown()).toBe('flex');
    expect(notes).toEqual([]); // молчаливая деградация: сеть упала — не вина игрока
  });
});

describe('корпорации — вкладка хаба (CORP-3)', () => {
  const tick = () => new Promise((r) => setTimeout(r, 0));
  const session = { authorizedBase: () => Promise.resolve({ base: 'https://srv', token: 'tok' }) };

  /** Сервер корпорации на ответах из таблицы (`путь` или `МЕТОД путь`); чего в ней нет —
   *  отказ с кодом. Возвращает журнал запросов. */
  function server(routes: Record<string, unknown>): string[] {
    const calls: string[] = [];
    vi.stubGlobal(
      'fetch',
      vi.fn((url: string, init?: { method?: string }) => {
        const path = url.replace('https://srv', '');
        const method = init?.method ?? 'GET';
        calls.push(`${method} ${path}`);
        const body = routes[`${method} ${path}`] ?? (method === 'GET' ? routes[path] : undefined);
        return Promise.resolve(
          body === undefined
            ? { ok: false, json: () => Promise.resolve({ error: 'E_NOPE' }) }
            : { ok: true, json: () => Promise.resolve(body) },
        );
      }),
    );
    return calls;
  }

  const CORP = { corpId: 'c1', name: 'Звёздный штиль', influence: 500 };
  const HEAD = { corpId: 'c1', accountId: 'a1', login: 'Арго', role: 'head' };
  function headCorp(): Record<string, unknown> {
    const saved = { levels: { headquarters: 1 }, construction: null, accruedAt: 0, remainder: 0 };
    const built = updateCorpInfrastructure('c1', 'a1', 'head', 500, saved, 0).result;
    if (!built.ok) throw new Error(built.code);
    return {
      '/corps/me': { corp: CORP, membership: HEAD, features: { ava: false, medals: false } },
      '/corps/c1': { corp: CORP, members: [HEAD, { ...HEAD, accountId: 'a2', login: 'Вега', role: 'member' }] },
      '/corps/c1/infrastructure': built.infrastructure,
      '/corps/c1/audit': { audit: [] },
      '/leaderboard': { corps: { me: { rank: 3 } } },
      '/meta-economy/corp-materials': { corp: { corpId: 'c1', pending: false, history: [], materials: ['construction_blocks', 'engineering_kits', 'command_cores'].map((id) => ({ id, nameKey: 'meta.material.' + id, personal: 10, available: 500, reserved: 0 })) } },
      '/meta-economy/corp-style': { corp: { head: true, active: 'standard', backdrop: 'orbit', owned: ['high_tech'] } },
    };
  }

  /** Нажатие по кнопке с такими `data-*`: делегат ищет её через `closest`. */
  function press(attrs: Record<string, string>): unknown {
    const button = { dataset: attrs, disabled: false };
    const names = Object.keys(attrs).map((k) => `[data-${k.replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`)}]`);
    return { closest: (sel: string) => (names.includes(sel) ? button : null) };
  }

  it('uses the server treasury and selected price when a challenge is underfunded', async () => {
    server({ ...headCorp(),
      '/corps/me': { corp: CORP, membership: HEAD, features: { ava: true, medals: false } },
      '/ava/battles': { corpId: 'c1', ready: { corp: true, formats: [3], player: false, players: [] }, challenges: [], results: [], tally: [], names: {} },
      '/ava/pool': { pool: [] },
    });
    const inner = globalThis.fetch;
    vi.stubGlobal('fetch', (url: string, init?: RequestInit) => url.endsWith('/ava/challenge')
      ? Promise.resolve(new Response(JSON.stringify({ error: 'E_INSUFFICIENT', requiredInfluence: 150, influence: 82 }), { status: 402 }))
      : inner(url, init));
    const { api, hubRoot, hubNotes } = wire(session);
    api.showHub();
    await tick();
    hubRoot.fire(press({ corpact: 'ava-challenge', corparg: 'c2', corpformat: '3' }));
    await tick();
    expect(hubNotes).toContain('✖ ' + t('corp.combat.insufficient', { required: 150, available: 82 }));
    expect(hubNotes.join(' ')).not.toContain('текст:E_INSUFFICIENT');
  });

  it('без входа: сначала загрузка, потом приглашение — и в сеть вкладка не ходит', async () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal('fetch', fetchSpy);
    const { api, hubRoot, intros } = wire();
    api.showHub();
    expect(hubRoot.html()).toContain(t('corp.hub.loading'));
    expect(intros).toEqual(['corp']);
    await tick();
    expect(hubRoot.html()).toContain(t('corp.hub.guest.title'));
    expect(hubRoot.html()).not.toContain('data-corphub="signin"');
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('гостю с аккаунтами — кнопка входа, и она ведёт ко входу', async () => {
    const hubRoot = fakeHubEl();
    const sheet = fakeHubEl();
    const signIns: number[] = [];
    const { api } = wire({
      hub: {
        root: () => hubRoot,
        sheet: () => sheet,
        note: () => undefined,
        canSignIn: () => true,
        signIn: () => signIns.push(1),
      },
    });
    api.showHub();
    await tick();
    expect(hubRoot.html()).toContain('data-corphub="signin"');
    hubRoot.fire(press({ corphub: 'signin' }));
    expect(signIns).toEqual([1]);
  });

  it('обрыв сети до первого ответа — «нет связи», а не «создайте корпорацию»', async () => {
    vi.stubGlobal('fetch', vi.fn(() => Promise.reject(new Error('offline'))));
    const { api, hubRoot, notes, hubNotes } = wire(session);
    api.showHub();
    await tick();
    expect(hubRoot.html()).toContain(t('corp.hub.offline'));
    expect(hubRoot.html()).not.toContain('corp-hub-name');
    expect([...notes, ...hubNotes]).toEqual([]);
  });

  it('отказ сервера при открытой вкладке — в строку хаба, а не в тосты под ней', async () => {
    server({});
    const { api, notes, hubNotes } = wire(session);
    api.showHub();
    await tick();
    expect(hubNotes).toEqual(['✖ текст:E_NOPE']);
    expect(notes).toEqual([]);
  });

  it('глава: шапка и база, шторка уровней; отказ при шторке — в саму шторку', async () => {
    const routes = headCorp();
    server(routes);
    const { api, hubRoot, hubSheet, hubNotes } = wire(session);
    api.showHub();
    await tick();
    expect(hubRoot.html()).toContain('Звёздный штиль');
    expect(hubRoot.html()).toContain('data-corpbld="headquarters"');
    hubRoot.fire(press({ corphub: 'levels' }));
    expect(api.hubSheetOpen()).toBe(true);
    expect(hubSheet.open()).toBe(true);
    expect(hubSheet.html()).toContain('cb-lvtable');
    delete routes['/corps/me'];
    hubRoot.fire(press({ corphub: 'refresh' }));
    await tick();
    expect(hubSheet.html()).toContain('✖ текст:E_NOPE');
    expect(hubNotes).toEqual([]);
    // Чтение не удалось — прежняя картина остаётся, а не «без корпорации».
    expect(hubRoot.html()).toContain('Звёздный штиль');
    api.closeHubSheet();
    expect(api.hubSheetOpen()).toBe(false);
    expect(hubSheet.open()).toBe(false);
  });

  it('«Расформировать»: первое нажатие спрашивает, второе отправляет', async () => {
    const calls = server({ ...headCorp(), 'POST /corps/c1/disband': {} });
    const { api, hubRoot } = wire(session);
    api.showSection('settings');
    api.showHub();
    await tick();
    const disband = press({ corpconfirm: 'disband', corpact: 'disband' });
    hubRoot.fire(disband);
    expect(hubRoot.html()).toContain(t('corp.hub.disband.confirm'));
    expect(calls).not.toContain('POST /corps/c1/disband');
    hubRoot.fire(disband);
    await tick();
    expect(calls).toContain('POST /corps/c1/disband');
  });

  it('любое другое нажатие снимает взвод — приказ не уходит', async () => {
    const calls = server({ ...headCorp(), 'POST /corps/c1/disband': {} });
    const { api, hubRoot } = wire(session);
    api.showSection('settings');
    api.showHub();
    await tick();
    const disband = press({ corpconfirm: 'disband', corpact: 'disband' });
    hubRoot.fire(disband);
    hubRoot.fire(press({ corpsec: 'treasury' }));
    api.showSection('settings');
    expect(hubRoot.html()).not.toContain(t('corp.hub.disband.confirm'));
    hubRoot.fire(disband);
    await tick();
    expect(calls).not.toContain('POST /corps/c1/disband');
  });

  it('уход с вкладки роняет шторку', async () => {
    server(headCorp());
    const { api, hubRoot, hubSheet } = wire(session);
    api.showHub();
    await tick();
    hubRoot.fire(press({ corpbld: 'headquarters' }));
    expect(hubSheet.open()).toBe(true);
    api.hideHub();
    expect(api.hubSheetOpen()).toBe(false);
    expect(hubSheet.open()).toBe(false);
  });

  it('настройки корпорации открывают стиль базы, глава применяет купленный', async () => {
    const calls = server({ ...headCorp(), 'POST /meta-economy/corp-style/apply': { ok: true } });
    const sent: unknown[] = [];
    const inner = globalThis.fetch;
    vi.stubGlobal('fetch', (url: string, init?: { method?: string; body?: string }) => {
      if (init?.body) sent.push(JSON.parse(init.body));
      return inner(url, init);
    });
    const { api, hubRoot, hubSheet } = wire(session);
    api.showHub();
    await tick();
    expect(hubRoot.html()).not.toContain('data-corphub="style"');
    hubRoot.fire(press({ corpsec: 'settings' }));
    expect(hubRoot.html()).toContain(t('corp.settings.appearance'));
    expect(hubRoot.html()).toContain('data-corphub="style"');
    hubRoot.fire(press({ corphub: 'style' }));
    expect(api.hubSheetOpen()).toBe(true);
    expect(hubSheet.html()).toContain('data-corpstyle="high_tech"');
    hubSheet.fire(press({ corpstyle: 'high_tech' }));
    await tick();
    expect(calls).toContain('POST /meta-economy/corp-style/apply');
    expect(sent).toEqual([{ requestId: expect.any(String), styleId: 'high_tech' }]);
  });

  it('стиль базы (CORP-14): некупленный ведёт в магазин, на этот стиль', async () => {
    server(headCorp());
    const hubRoot = fakeHubEl();
    const hubSheet = fakeHubEl();
    const shop: string[] = [];
    const { api } = wire({
      ...session,
      hub: {
        root: () => hubRoot,
        sheet: () => hubSheet,
        note: () => undefined,
        canSignIn: () => false,
        signIn: () => undefined,
        openShop: (style) => shop.push(style),
      },
    });
    api.showHub();
    await tick();
    hubRoot.fire(press({ corpsec: 'settings' }));
    hubRoot.fire(press({ corphub: 'style' }));
    expect(hubSheet.html()).toContain('data-corpshop="imperial_gothic"');
    hubSheet.fire(press({ corpshop: 'imperial_gothic' }));
    expect(shop).toEqual(['imperial_gothic']);
  });
  it('a delayed old refresh cannot restore the old ready formats after saving', async () => {
    const battles: CorpBattlesView = { corpId: 'c1', ready: { corp: true, formats: [2], player: false, players: [] }, challenges: [], results: [], tally: [], names: {} };
    const routes = { ...headCorp(), '/corps/me': { corp: CORP, membership: HEAD, features: { ava: true, medals: false } }, '/ava/battles': battles, '/ava/pool': { pool: [] }, 'POST /ava/ready/corp': { ok: true } };
    server(routes);
    const inner = globalThis.fetch;
    let delay = false;
    let release: (() => void) | undefined;
    const sent: unknown[] = [];
    vi.stubGlobal('fetch', (url: string, init?: { method?: string; body?: string }) => {
      if (url.endsWith('/ava/battles') && delay) {
        delay = false;
        const old = JSON.stringify(battles);
        return new Promise<Response>((resolve) => { release = () => resolve(new Response(old)); });
      }
      if (url.endsWith('/ava/ready/corp') && init?.method === 'POST') {
        sent.push(JSON.parse(init.body ?? '{}'));
        battles.ready.formats = [3];
      }
      return inner(url, init);
    });
    const { api, hubRoot } = wire(session);
    api.showHub();
    await tick();
    api.showSection('battles');
    hubRoot.fire(press({ battletab: 'ready' }));
    hubRoot.fire(press({ battleReadyFormat: '2' }));
    hubRoot.fire(press({ battleReadyFormat: '3' }));
    delay = true;
    hubRoot.fire(press({ corphub: 'refresh' }));
    await tick();
    expect(release).toBeDefined();
    hubRoot.fire(press({ corpact: 'ava-ready-save' }));
    release!();
    await tick();
    expect(hubRoot.html()).toContain('data-battle-ready-format="3" aria-pressed="true"');
    expect(hubRoot.html()).toContain('data-battle-ready-format="2" aria-pressed="false"');
    hubRoot.fire(press({ corpact: 'ava-ready-save' }));
    await tick();
    expect(sent).toEqual([{ formats: [3] }, { formats: [3] }]);
  });

  it('warehouse battle labels use the server name even when the rival left the ready pool', async () => {
    const corp = { ...CORP, warehouseItems: 2 };
    const matchup = { id: 'war', challengerCorp: 'c1', targetCorp: 'private-corp-id', format: 2, cost: 100, status: 'accepted', createdAt: 1, expiresAt: 9999999999999, pauseEndsAt: 9999999999999 };
    server({ ...headCorp(),
      '/corps/me': { corp, membership: HEAD, features: { ava: true, medals: false } },
      '/corps/c1': { corp, members: [HEAD] },
      '/ava/battles': { corpId: 'c1', ready: { corp: false, formats: [], player: false, players: [] }, challenges: [matchup], results: [], tally: [], names: { 'private-corp-id': 'Орден Ориона' } },
      '/ava/pool': { pool: [] },
      '/ava/matchup/war': { matchupId: 'war', side: 'challenger', status: 'accepted', mine: [], counts: { challenger: 0, target: 0 } },
      '/corp-arsenal/c1?matchupId=war': { capacity: 2, used: 0, canLend: true, fighters: [], items: [] },
    });
    const { api, hubRoot, hubSheet } = wire(session);
    api.showHub();
    await tick();
    hubRoot.fire(press({ corpbld: 'warehouse' }));
    expect(hubSheet.html()).toContain('Орден Ориона');
    expect(hubSheet.html()).not.toContain('private-corp-id');
  });

  it('CORP-10: reads private battles, sends selected formats, and opens the report sheet', async () => {
    const battles: CorpBattlesView = { corpId: 'c1', ready: { corp: false, formats: [], player: false, players: [] },
      challenges: [], results: [{ matchupId: 'ended', challengerCorp: 'c1', targetCorp: 'c2', winnerCorp: 'c1', at: 1, format: 2, side: 'challenger',
        report: { reason: 'score', provinces: 10, sides: { challenger: { score: 100, provinces: 6 }, target: { score: 20, provinces: 4 } }, seats: [] } }],
      tally: [], names: { c2: 'Вторая корпорация' } };
    const routes = { ...headCorp(), '/corps/me': { corp: CORP, membership: HEAD, features: { ava: true, medals: false } }, '/ava/battles': battles, '/ava/pool': { pool: [] }, 'POST /ava/ready/corp': { ok: true } };
    const calls = server(routes);
    const sent: unknown[] = [];
    const inner = globalThis.fetch;
    vi.stubGlobal('fetch', (url: string, init?: { method?: string; body?: string }) => {
      if (url.endsWith('/ava/ready/corp') && init?.method === 'POST') {
        sent.push(JSON.parse(init.body ?? '{}'));
        battles.ready.corp = true;
        battles.ready.formats = [3];
      }
      return inner(url, init);
    });
    const { api, hubRoot, hubSheet } = wire(session);
    api.showHub();
    await tick();
    api.showSection('battles');
    expect(calls).toContain('GET /ava/battles');
    expect(calls).not.toContain('GET /ava/feed?limit=40');
    hubRoot.fire(press({ battletab: 'ready' }));
    hubRoot.fire(press({ battleReadyFormat: '3' }));
    hubRoot.fire(press({ corpact: 'ava-ready-save' }));
    await tick();
    expect(sent).toEqual([{ formats: [3] }]);
    expect(hubRoot.html()).toContain('data-battle-ready-format="3" aria-pressed="true"');
    hubRoot.fire(press({ battletab: 'history' }));
    hubRoot.fire(press({ battleReport: 'ended' }));
    expect(api.hubSheetOpen()).toBe(true);
    expect(hubSheet.html()).toContain(t('corp.combat.report'));
    expect(hubSheet.html()).toContain('Вторая корпорация');
    api.closeHubSheet();
    expect(hubRoot.html()).toContain('data-battletab="history" aria-selected="true"');
    delete (routes as Record<string, unknown>)['/ava/battles'];
    hubRoot.fire(press({ corphub: 'refresh' }));
    await tick();
    expect(hubRoot.html()).toContain(t('corp.combat.unavailable'));
    expect(hubRoot.html()).not.toContain('data-battle-report=');
  });

});
