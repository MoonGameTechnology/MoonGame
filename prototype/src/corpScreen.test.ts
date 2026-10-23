import { describe, it, expect, beforeAll, afterEach, vi } from 'vitest';
import { setLocale, t } from '../../localization/runtime';
import {
  CORP_BATTLE_LABEL,
  CORP_TABS,
  CORP_AUDIT_RU,
  CORP_ROLE_DOT,
  SHOWCASE_SLOTS,
  corpBattles,
  corpRoleLabel,
  hqTile,
  initCorp,
  medalGalleryHtml,
  readShowcase,
  showcaseHtml,
  writeShowcase,
  type CorpHost,
} from './corpScreen';
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

  it('пустое/битое хранилище читается как пустые слоты, а не падает', () => {
    expect(readShowcase(null)).toEqual(['', '', '']);
    expect(readShowcase('first')).toEqual(['first', '', '']);
    expect(readShowcase(readShowcase(null).join(','))).toHaveLength(SHOWCASE_SLOTS);
  });

  it('запись и чтение — обратимы', () => {
    expect(readShowcase(writeShowcase(['a', 'b', 'c']))).toEqual(['a', 'b', 'c']);
  });

  it('в слоте показывается только ЗАРАБОТАННАЯ награда — протухший выбор гаснет', () => {
    const html = showcaseHtml(['first', 'champ', ''], defs, ['first']);
    expect(html).toContain('Первая кровь');
    expect(html).not.toContain('Чемпион'); // не получена — слот пуст, а не «есть»
    expect((html.match(/data-corpcup=/g) ?? []).length).toBe(SHOWCASE_SLOTS);
  });

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

  it('Back закрывает СНАЧАЛА витрину и только потом кабинет', () => {
    const { api, root, shown } = wire();
    api.open();
    root.fire({ closest: (s: string) => (s === '[data-corpcup]' ? { dataset: { corpcup: '1' } } : null) });
    api.close();
    expect(shown()).toBe('flex'); // ушла витрина — из корпорации игрока не выбросило
    api.close();
    expect(shown()).toBe('none');
  });

  it('крестик закрывает кабинет целиком, даже из открытой витрины', () => {
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
    };
  }

  /** Нажатие по кнопке с такими `data-*`: делегат ищет её через `closest`. */
  function press(attrs: Record<string, string>): unknown {
    const button = { dataset: attrs, disabled: false };
    const names = Object.keys(attrs).map((k) => `[data-${k.replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`)}]`);
    return { closest: (sel: string) => (names.includes(sel) ? button : null) };
  }

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
    api.showSection('members');
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
    api.showSection('members');
    api.showHub();
    await tick();
    const disband = press({ corpconfirm: 'disband', corpact: 'disband' });
    hubRoot.fire(disband);
    hubRoot.fire(press({ corpsec: 'treasury' }));
    api.showSection('members');
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
});
