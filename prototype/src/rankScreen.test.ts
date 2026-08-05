import { readFileSync } from 'node:fs';
import { describe, it, expect, beforeAll } from 'vitest';
import { setLocale } from '../../localization/runtime';
import { boardHtml, initRank, rankMark, EMPTY_BOARD, type BoardView } from './rankScreen';

// Локаль прибита к RU (как в format.test.ts): у Node нет языка браузера, рантайм
// свалился бы в EN и утверждения по подписям поехали бы.
beforeAll(() => setLocale('ru'));

const view = (over: Partial<BoardView> = {}): BoardView => ({
  rows: [
    { rank: 1, name: 'Vasya', score: 900 },
    { rank: 2, name: 'Petya', score: 400 },
  ],
  me: { rank: 2, score: 400, name: 'Petya' },
  total: 2,
  ...over,
});

describe('рейтинги — номер места', () => {
  it('тройка призёров читается значком, дальше — номером', () => {
    expect(rankMark(1)).toBe('🥇');
    expect(rankMark(3)).toBe('🥉');
    expect(rankMark(4)).toBe('4');
    expect(rankMark(128)).toBe('128');
  });
});

describe('рейтинги — разметка доски', () => {
  it('рисует обе подвкладки и подсвечивает открытую', () => {
    const html = boardHtml('corps', view());
    expect(html).toContain('data-rktab="players"');
    expect(html).toContain('<button class="rk-tab on" data-rktab="corps">');
  });

  it('своя строка подсвечена НА СВОЁМ месте, а не поднята наверх', () => {
    const html = boardHtml('players', view({ rows: [
      { rank: 1, name: 'Vasya', score: 900 },
      { rank: 2, name: 'Petya', score: 400, me: true },
    ] }));
    // порядок не тронут: первым идёт лидер, своя строка стоит второй и помечена
    expect(html.indexOf('Vasya')).toBeLessThan(html.indexOf('Petya'));
    expect(html).toContain('rk-row me');
    expect(html).not.toContain('rk-mine'); // я в странице — прикреплять нечего
  });

  it('моё место ВНЕ страницы прикрепляется снизу с настоящим номером', () => {
    // Иначе игрок вне топа читал бы доску как «меня в рейтинге нет» — а он есть.
    const html = boardHtml('players', view({ me: { rank: 137, score: 12, name: 'Petya' } }));
    expect(html).toContain('rk-mine');
    expect(html).toContain('rk-row me pin');
    expect(html).toContain('137');
  });

  it('без единого доигранного матча — «нет места», а не последняя строка', () => {
    const html = boardHtml('players', view({ me: { rank: null, score: 0, name: 'Petya' } }));
    expect(html).toContain('rk-none');
    expect(html).not.toContain('rk-row me pin');
  });

  it('доска корпораций печатает численность, доска игроков — нет', () => {
    const corps = boardHtml('corps', view({
      rows: [{ rank: 1, name: 'Флот', score: 50, members: 7 }],
    }));
    expect(corps).toContain('7');
    expect(corps).toContain('вл'); // влияние, а не опыт
    const players = boardHtml('players', view());
    expect(players).toContain('оп');
    expect(players).not.toContain('вл');
  });

  it('гость видит ПРИЧИНУ, а не пустую доску: место живёт на аккаунте', () => {
    const html = boardHtml('players', EMPTY_BOARD, { signedIn: false });
    expect(html).not.toContain('rank.guest'); // ключ наружу не течёт
    expect(html).toContain('Нужен аккаунт');
    expect(html).toContain('data-rktab="corps"'); // подвкладки на месте и у гостя
  });

  it('пустая доска говорит СВОЮ причину для каждой вкладки — и заголовком, и пояснением', () => {
    // «Место появляется после первого матча» верно для игроков и бессмысленно для
    // корпораций: пустые доски пусты по РАЗНЫМ причинам.
    const players = boardHtml('players', EMPTY_BOARD);
    expect(players).toContain('Доска пока пуста');
    expect(players).toContain('доигранного матча');
    const corps = boardHtml('corps', EMPTY_BOARD);
    expect(corps).toContain('Корпораций пока нет');
    expect(corps).toContain('соберут корпорации');
  });

  it('чужое имя экранируется — доска печатает ЧУЖОЙ ввод', () => {
    const html = boardHtml('players', view({
      rows: [{ rank: 1, name: '<img src=x onerror=alert(1)>', score: 1 }],
    }));
    expect(html).not.toContain('<img');
    expect(html).toContain('&lt;img');
  });
});

describe('рейтинги — разговор с сервером', () => {
  /** Фейковый корень (у Node нет DOM — как в techTree.test.ts) со счётчиком запросов. */
  function wire(reply: { status: number; body?: unknown }) {
    let handler: ((ev: unknown) => void) | null = null;
    const el = {
      innerHTML: '',
      addEventListener: (_t: string, h: (ev: unknown) => void) => {
        handler = h;
      },
    } as unknown as HTMLElement & { innerHTML: string };
    /** Тап по подвкладке: делегат ищет `closest('[data-rktab]')`. */
    const tap = (rktab: string): void =>
      handler?.({ target: { closest: (q: string) => (q === '[data-rktab]' ? { dataset: { rktab } } : null) } });
    let calls = 0;
    const realFetch = globalThis.fetch;
    globalThis.fetch = (() => {
      calls += 1;
      return Promise.resolve({
        ok: reply.status >= 200 && reply.status < 300,
        status: reply.status,
        json: () => Promise.resolve(reply.body ?? {}),
      } as Response);
    }) as typeof fetch;
    const api = initRank({
      root: () => el,
      authorizedBase: () => Promise.resolve({ base: 'http://x', token: 'tk' }),
    });
    return { api, el, tap, calls: () => calls, restore: () => (globalThis.fetch = realFetch) };
  }

  it('401 читается как «вы не вошли», а НЕ как пустая доска', async () => {
    // Токен есть, но сервер его не признаёт (перезапуск/сброс пароля). Молчаливое
    // «пусто» заставило бы игрока ждать строк, которых для него никто не спрашивал.
    const w = wire({ status: 401 });
    await w.api.refresh();
    expect(w.el.innerHTML).toContain('Нужен аккаунт');
    w.restore();
  });

  it('переключение подвкладки не стоит запроса — обе доски пришли разом', async () => {
    const w = wire({
      status: 200,
      body: {
        players: { rows: [{ rank: 1, name: 'A', score: 5 }], me: { rank: 1, score: 5, name: 'A' }, total: 1 },
        corps: { rows: [{ rank: 1, name: 'К', score: 9, members: 2 }], me: { rank: null, score: 0, name: null }, total: 1 },
      },
    });
    await w.api.refresh();
    expect(w.calls()).toBe(1);
    w.tap('corps');
    expect(w.calls()).toBe(1); // перерисовка, а не поход на сервер
    expect(w.el.innerHTML).toContain('К');
    w.restore();
  });
});

// Подключение вкладки к хабу живёт в `main.ts`, у которого нет юнит-обвязки —
// поэтому сканом исходника, как в cmdVisibility.test.ts. Без обновления при входе
// на вкладку доска показывала бы прошлый снимок (или пустоту при первом открытии).
describe('рейтинги — подключение вкладки к хабу', () => {
  const src = readFileSync(new URL('./main.ts', import.meta.url), 'utf8');

  it('вход на вкладку «Рейтинги» перечитывает доски с сервера', () => {
    expect(src).toContain("if (tab === 'rank') void rank.refresh()");
  });

  it('панель вкладки — та же, что в разметке хаба', () => {
    expect(src).toContain("root: () => $('hp-rank')");
    expect(src).toContain("rank: 'hp-rank'");
  });
});
