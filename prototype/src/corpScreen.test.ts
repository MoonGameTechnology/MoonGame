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

function wire(over: Partial<CorpHost> = {}) {
  const root = fakeEl();
  const head = fakeEl();
  const tabs = fakeEl();
  const body = fakeEl();
  const notes: string[] = [];
  const intros: string[] = [];
  const api = initCorp({
    root: () => root,
    head: () => head,
    tabs: () => tabs,
    body: () => body,
    authorizedBase: () => Promise.resolve(null),
    note: (x) => notes.push(x),
    errText: (code) => `текст:${code}`,
    onIntro: (id) => intros.push(id),
    ...over,
  });
  return { api, root, head, tabs, body, notes, intros, shown: () => root.style.display };
}

afterEach(() => {
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
    // CORP-HUB: шесть вкладок, и каждая ведёт на живой маршрут — заглушек-вкладок
    // больше нет (владения и чат стали честными строками в «Настройках»)
    expect(CORP_TABS.map((x) => x.id)).toEqual([
      'hq',
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
