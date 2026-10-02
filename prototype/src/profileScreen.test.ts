import { describe, it, expect, beforeAll, afterEach, vi } from 'vitest';
import { setLocale } from '../../localization/runtime';
import { EMPTY_STATS, type MetaStats } from './meta';
import { defaultAppearance } from '../../packages/protocol/src/playerProfile';
import { PORTRAITS } from './profileArt';
import {
  parseMedalCache,
  parseMedalCatalog,
  pfCell,
  profileCareerHtml,
  profileHtml,
  initProfile,
  type MedalEntry,
  type ProfileHost,
  type ProfileView,
} from './profileScreen';

// REFM-10: locale pinned RU (see format.test.ts — Node has no browser language, so the
// runtime would fall back to EN and the label assertions would drift).
beforeAll(() => setLocale('ru'));

const stats = (over: Partial<MetaStats> = {}): MetaStats => ({ ...EMPTY_STATS, ...over });

const view = (over: Partial<ProfileView> = {}): ProfileView => ({
  nick: 'Комета-2',
  xp: 0,
  stats: stats(),
  corp: null,
  sovereigns: 500,
  owned: [],
  catalog: [],
  ...over,
});

type FakeOverlay = HTMLElement & {
  html: () => string;
  fire: (t: unknown) => void;
  key: (t: unknown, key: string) => void;
  shown: () => boolean;
};

function fakeOverlay(): FakeOverlay {
  // Слушатели по типу события: оверлей слушает и клики, и клавиши вкладок.
  const handlers: Record<string, (ev: unknown) => void> = {};
  const classes = new Set<string>();
  const el = {
    innerHTML: '',
    closest: () => null, // сам оверлей — фон: ни одного предка-кнопки над ним нет
    classList: {
      add: (c: string) => classes.add(c),
      remove: (c: string) => classes.delete(c),
      contains: (c: string) => classes.has(c),
    },
    addEventListener: (type: string, h: (ev: unknown) => void) => {
      handlers[type] = h;
    },
    html: () => el.innerHTML,
    fire: (target: unknown) => handlers.click?.({ target }),
    key: (target: unknown, key: string) =>
      handlers.keydown?.({ target, key, preventDefault: () => {} }),
    shown: () => classes.has('show'),
  };
  return el as unknown as FakeOverlay;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('публичный профиль и устаревшие ответы', () => {
  const publicData = (login: string) => ({ ...defaultAppearance(), login, xp: 70, progress: { matches: 2, wins: 1 } });
  const tick = () => new Promise((r) => setTimeout(r, 0));
  function host(root: HTMLElement): ProfileHost {
    return { root: () => root, view: () => ({ nick: 'Owner', xp: 0, stats: stats(), corp: null, sovereigns: 9999 }), readCache: () => null, writeCache: () => {}, authorizedBase: async () => ({ base: 'https://server', token: 'session' }) };
  }
  it('чужая карточка читает именно чужой профиль и не показывает валюту владельца', async () => {
    const fetcher = vi.fn(async () => ({ ok: true, json: async () => publicData('Other') }));
    vi.stubGlobal('fetch', fetcher);
    const root = fakeOverlay(); const api = initProfile(host(root)); api.open('Other'); await tick();
    expect(fetcher).toHaveBeenCalledWith('https://server/profiles?login=Other', expect.anything());
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(root.html()).toContain('Other');
    expect(root.html()).not.toMatch(/pf-cur|data-portrait=|data-ps="save"|9999|Owner/);
  });
  it('запоздалый ответ предыдущей карточки не подменяет новую', async () => {
    let resolveOld!: (value: unknown) => void;
    vi.stubGlobal('fetch', vi.fn((url: string) => url.includes('Old')
      ? new Promise((resolve) => { resolveOld = resolve; })
      : Promise.resolve({ ok: true, json: async () => publicData('New') })));
    const root = fakeOverlay(); const api = initProfile(host(root));
    api.open('Old'); await tick(); api.open('New'); await tick();
    resolveOld({ ok: true, json: async () => publicData('Old') }); await tick();
    expect(root.html()).toContain('New'); expect(root.html()).not.toContain('Old');
    api.close(); expect(root.shown()).toBe(false);
  });
});

describe('профиль — «—» вместо правдоподобного нуля', () => {
  it('pfCell печатает прочерк ровно на null, а не на пустой строке или нуле', () => {
    expect(pfCell('матчи', null)).toContain('>—<');
    expect(pfCell('матчи', '0')).toContain('>0<');
    expect(pfCell('матчи', '')).not.toContain('—');
  });

  it('без сыгранных матчей винрейт и место — прочерки, а не 0% и 0.0', () => {
    const html = profileHtml(view({ stats: stats({ matches: 0 }) }));
    // именно это правило и есть смысл экрана: ничего не выдумываем
    const cell = (k: string): string =>
      new RegExp(`pf-k">${k}</span><span class="pf-v[^"]*">([^<]*)<`).exec(html)?.[1] ?? '';
    expect(cell('Winrate')).toBe('—');
    expect(cell('Ср. место')).toBe('—');
    expect(cell('Серия побед')).toBe('—');
    expect(cell('Матчей')).toBe('0'); // а вот НОЛЬ матчей — честный ноль, не прочерк
    expect(html).not.toContain('0%');
  });

  it('без корпорации влияние — прочерк, с корпорацией — число', () => {
    expect(profileHtml(view({ corp: null }))).toContain('>—<');
    const withCorp = profileHtml(view({ corp: { name: 'Стая', influence: 1234 } }));
    expect(withCorp.replace(/\s/g, ' ')).toContain('1 234');
  });

  it('сыгранные матчи дают живые числа', () => {
    const html = profileHtml(
      view({ stats: stats({ matches: 10, wins: 6, placeSum: 15, placed: 10, score: 4200, streak: 3 }) }),
    );
    expect(html).toContain('60%'); // 6 из 10
    expect(html).toContain('1.5'); // среднее место
    expect(html).toContain('×3'); // серия
    expect(html.replace(/\s/g, ' ')).toContain('4 200');
  });
});

describe('профиль — шапка', () => {
  it('подзаголовок без корпорации — только лига, с корпорацией — «корпа · Лига: …»', () => {
    const alone = profileHtml(view());
    const inCorp = profileHtml(view({ corp: { name: 'Стая', influence: 0 } }));
    expect(alone).toContain('Лига:');
    expect(alone).not.toContain(' · Лига:');
    expect(inCorp).toContain('Стая · Лига:');
  });

  it('лига растёт вместе с уровнем', () => {
    const low = profileHtml(view({ xp: 0 }));
    const high = profileHtml(view({ xp: 500_000 }));
    expect(low).not.toBe(high);
  });

  it('аватар — первая буква позывного; пустой позывной даёт подпись по умолчанию', () => {
    expect(profileHtml(view({ nick: 'комета' }))).toContain('>К<');
    const blank = profileHtml(view({ nick: '   ' }));
    expect(blank).not.toContain('pf-nm"></div>');
  });

  it('с портретом аватар шапки — лицо командира, а не буква (UIX-15.3)', () => {
    const html = profileHtml(view({ nick: 'комета', face: '/p.webp' }));
    expect(html).toContain('<div class="pf-av face"><img src="/p.webp" alt=""></div>');
    expect(html).not.toContain('>К<');
  });

  it('позывной и имя корпорации экранируются — их вводят люди (CWE-79)', () => {
    const html = profileHtml(
      view({ nick: '<img src=x onerror=alert(1)>', corp: { name: '<b>злая</b>', influence: 1 } }),
    );
    expect(html).toContain('&lt;img');
    expect(html).not.toContain('<img src=x');
    expect(html).toContain('&lt;b&gt;злая');
  });
});

describe('профиль — витрина медалей', () => {
  const catalog: MedalEntry[] = [
    { id: 'first-blood', name: 'Первая кровь' },
    { id: 'iron-will', name: 'Железная воля' },
  ];

  it('пустой каталог даёт подсказку, а не пустую сетку', () => {
    const html = profileHtml(view({ catalog: [], owned: [] }));
    expect(html).toContain('pf-hint');
    expect(html).not.toContain('pf-medals');
  });

  it('каталог рисуется целиком, но неполученные помечены', () => {
    const html = profileHtml(view({ catalog, owned: ['iron-will'] }));
    expect(html).toContain('Первая кровь');
    expect(html).toContain('Железная воля');
    expect([...html.matchAll(/pf-medal off/g)]).toHaveLength(1); // только одна не получена
  });

  it('имена медалей приходят с сервера как ТЕКСТ и экранируются', () => {
    const html = profileHtml(view({ catalog: [{ id: 'x', name: '<script>1</script>' }] }));
    expect(html).not.toContain('<script>');
    expect(html).toContain('&lt;script&gt;');
  });
});

describe('профиль — разбор кэша', () => {
  it('битый кэш вырождается в пустую витрину', () => {
    for (const raw of [null, 'мусор', 42, [], { owned: 'нет' }]) {
      expect(parseMedalCache(raw)).toEqual({ owned: [], catalog: [] });
    }
  });

  it('из каталога выбрасываются записи без строковых id/name', () => {
    expect(
      parseMedalCatalog([
        { id: 'ok', name: 'Годная' },
        { id: 42, name: 'Плохая' },
        { id: 'no-name' },
        null,
      ]),
    ).toEqual([{ id: 'ok', name: 'Годная' }]);
  });

  it('годный кэш проходит целиком', () => {
    expect(parseMedalCache({ owned: ['a', 1, 'b'], catalog: [{ id: 'a', name: 'А' }] })).toEqual({
      owned: ['a', 'b'],
      catalog: [{ id: 'a', name: 'А' }],
    });
  });
});

describe('профиль — оверлей', () => {
  function wire(over: Partial<ProfileHost> = {}) {
    const root = fakeOverlay();
    const written: unknown[] = [];
    const api = initProfile({
      root: () => root,
      view: () => ({ nick: 'Комета-2', xp: 0, stats: stats(), corp: null, sovereigns: 500 }),
      readCache: () => null,
      writeCache: (v) => written.push(v),
      authorizedBase: () => Promise.resolve(null),
      ...over,
    });
    return { api, root, written };
  }

  it('open() красит ДО показа и без авторизации в сеть не ходит', () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal('fetch', fetchSpy);
    const { api, root } = wire();
    api.open();
    expect(root.shown()).toBe(true);
    expect(root.html()).toContain('pf-grid');
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('кэш медалей красится сразу, ещё до ответа сервера', () => {
    const { api, root } = wire({
      readCache: () => ({ owned: ['a'], catalog: [{ id: 'a', name: 'Кэшевая' }] }),
    });
    api.open();
    expect(root.html()).toContain('Кэшевая');
  });

  it('успешный ответ заменяет витрину и пишет кэш', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn((url: string) =>
        Promise.resolve({
          ok: true,
          json: () =>
            Promise.resolve(
              url.endsWith('/medals')
                ? { medals: [{ id: 'srv', name: 'Серверная' }] }
                : { medals: [{ accountId: 'acc', medalId: 'srv', corpId: null, at: 1 }] },
            ),
        }),
      ),
    );
    const { api, root, written } = wire({
      authorizedBase: () => Promise.resolve({ base: 'https://srv', token: 'tok' }),
    });
    api.open();
    await new Promise((r) => setTimeout(r, 0));
    expect(root.html()).toContain('Серверная');
    expect(root.html()).not.toContain('pf-medal off'); // она получена
    expect(written).toHaveLength(1);
  });

  it('отказ сервера и обрыв сети оставляют кэш нетронутым', async () => {
    for (const stub of [
      () => Promise.resolve({ ok: false, json: () => Promise.resolve({}) }),
      () => Promise.reject(new Error('offline')),
    ]) {
      vi.stubGlobal('fetch', vi.fn(stub));
      const { api, root, written } = wire({
        readCache: () => ({ owned: [], catalog: [{ id: 'a', name: 'Кэшевая' }] }),
        authorizedBase: () => Promise.resolve({ base: 'https://srv', token: 'tok' }),
      });
      api.open();
      await new Promise((r) => setTimeout(r, 0));
      expect(root.html()).toContain('Кэшевая');
      expect(written).toEqual([]);
    }
  });

  it('крестик и фон закрывают, тап внутри карточки — нет', () => {
    const { api, root } = wire();
    api.open();
    root.fire({ closest: (s: string) => (s === '.pf-close' ? {} : null) });
    expect(root.shown()).toBe(false);
    api.open();
    root.fire(root); // сам фон
    expect(root.shown()).toBe(false);
    api.open();
    root.fire({ closest: () => null }); // что-то внутри листа
    expect(root.shown()).toBe(true);
  });
});

describe('профиль — вкладки и панель сохранения (UIX-15.3)', () => {
  const tick = () => new Promise((r) => setTimeout(r, 0));
  // Кнопка редактора: `closest('button')` находит её, остальные селекторы — null.
  const press = (dataset: Record<string, string>) => ({
    closest: (s: string) => (s === 'button' ? { dataset, disabled: false } : null),
  });
  // Вкладка — для клика и для клавиш одинаково.
  const onTab = (id: string) => ({
    closest: (s: string) => (s === '[data-pstab]' ? { dataset: { pstab: id } } : null),
  });
  const openTab = (html: string) =>
    /data-pstab="([a-z]+)"[^>]*aria-selected="true"/.exec(html)?.[1];
  function wire() {
    const root = fakeOverlay();
    const api = initProfile({
      root: () => root,
      view: () => ({ nick: 'Комета-2', xp: 0, stats: stats(), corp: null, sovereigns: 500 }),
      readCache: () => null,
      writeCache: () => {},
      authorizedBase: () => Promise.resolve(null), // гость: портрет сохраняется на устройстве
    });
    return { api, root };
  }

  it('карьера во вкладке без заголовка «Профиль», под карточкой — с ним', () => {
    expect(profileCareerHtml(view(), false)).not.toContain('class="pf-h"');
    expect(profileCareerHtml(view(), false)).toContain('pf-grid');
    expect(profileCareerHtml(view())).toContain('<div class="pf-h">Профиль</div>');
  });

  it('вкладка открывается кликом и остаётся открытой до следующего входа', () => {
    const { api, root } = wire();
    api.open();
    expect(openTab(root.html())).toBe('portrait');
    root.fire(onTab('career'));
    expect(openTab(root.html())).toBe('career');
    api.close();
    api.open();
    expect(openTab(root.html())).toBe('career');
  });

  it('стрелки и Home/End ходят по вкладкам по кругу', () => {
    const { api, root } = wire();
    api.open();
    root.fire(onTab('portrait'));
    root.key(onTab('portrait'), 'ArrowLeft');
    expect(openTab(root.html())).toBe('career');
    root.key(onTab('career'), 'ArrowRight');
    expect(openTab(root.html())).toBe('portrait');
    root.key(onTab('portrait'), 'End');
    expect(openTab(root.html())).toBe('career');
    root.key(onTab('career'), 'Home');
    expect(openTab(root.html())).toBe('portrait');
    root.key(onTab('portrait'), 'Enter'); // не стрелка — вкладка та же
    expect(openTab(root.html())).toBe('portrait');
  });

  it('«Сохранить» появляется с первым изменением и уходит с отменой', async () => {
    const { api, root } = wire();
    api.open();
    await tick();
    expect(root.html()).not.toContain('ps-savebar');
    root.fire(press({ portrait: '5' }));
    expect(root.html()).toContain('class="ps-savebar"');
    // шапка показывает выбранное лицо сразу, ещё до сохранения
    expect(root.html()).toContain(`<div class="pf-av face"><img src="${PORTRAITS[4]}"`);
    root.fire(press({ ps: 'cancel' }));
    expect(root.html()).not.toContain('ps-savebar');
    expect(root.html()).toContain(`<div class="pf-av face"><img src="${PORTRAITS[0]}"`);
  });
});
