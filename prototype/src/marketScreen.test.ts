import { describe, it, expect, beforeAll } from 'vitest';
import { setLocale } from '../../localization/runtime';
import { newGame, order, marketList, MARKET_COMMISSION } from './game';
import type { Action, GameState } from '../../packages/shared-core/src/index';
import {
  netNoteText,
  marketBoxHtml,
  initMarket,
  type MarketHost,
} from './marketScreen';

// REFM-6: locale pinned RU (see format.test.ts — Node has no browser language, so the
// runtime would fall back to EN and the label assertions would drift).
beforeAll(() => setLocale('ru'));

/** A state where both seats can actually trade, with a couple of lots on the book. */
function booked(): GameState {
  let s = newGame();
  for (const id of Object.keys(s.players)) {
    const p = s.players[id]!;
    p.resources = { ...p.resources, credits: 5000, metal: 500, food: 500 };
  }
  const place = (action: ReturnType<typeof marketList>): void => {
    const r = order(s, action, s.time);
    if (r.error) throw new Error(r.error);
    s = r.state;
  };
  // p1 asks 10 metal @ 4; p2 asks the same at a WORSE price and bids for metal too
  place(marketList('p1', 'sell', 'metal', 10, 4));
  place(marketList('p2', 'sell', 'metal', 10, 9));
  place(marketList('p2', 'buy', 'metal', 5, 2));
  place(marketList('p2', 'buy', 'metal', 5, 7));
  return s;
}

/** Node has no DOM — the window only paints innerHTML, toggles a class and delegates
 *  clicks, so a stand-in with those three is the whole contract. */
function fakeWin(): HTMLElement & {
  html: () => string;
  net: () => string;
  fire: (target: unknown) => void;
  shown: () => boolean;
} {
  let handler: ((ev: unknown) => void) | null = null;
  const classes = new Set<string>();
  const net = { textContent: '' };
  const el = {
    innerHTML: '',
    // the window scopes every lookup to itself; the box is a string here, so the
    // stub answers the two inputs and the net line with plain objects
    querySelector: (sel: string) =>
      sel === '#mk-amt'
        ? { value: '10', addEventListener: () => {} }
        : sel === '#mk-price'
          ? { value: '3', addEventListener: () => {} }
          : sel === '#mk-net'
            ? net
            : null,
    classList: {
      add: (c: string) => classes.add(c),
      remove: (c: string) => classes.delete(c),
      contains: (c: string) => classes.has(c),
    },
    addEventListener: (_t: string, h: (ev: unknown) => void) => {
      handler = h;
    },
    html: () => el.innerHTML,
    net: () => net.textContent,
    fire: (target: unknown) => handler?.({ target }),
    shown: () => classes.has('show'),
  };
  return el as unknown as HTMLElement & {
    html: () => string;
    net: () => string;
    fire: (t: unknown) => void;
    shown: () => boolean;
  };
}

/** A click whose `closest(sel)` answers only for the selector we mean to hit. */
function click(sel: string, dataset: Record<string, string> = {}): unknown {
  return { closest: (q: string) => (q === sel ? { dataset } : null) };
}

function hostOf(over: Partial<MarketHost> = {}): MarketHost {
  return {
    root: () => fakeWin(),
    state: () => booked(),
    me: () => 'p1',
    order: () => {},
    onOpen: () => {},
    ...over,
  };
}

describe('рынок — «к получению» под формой', () => {
  it('продажа показывает NET после сгорающей комиссии', () => {
    // 10 × 4 = 40 gross, 15% сгорает → 34 (CONV-9: комиссия сведена к одной, 15%)
    const text = netNoteText('sell', 10, 4);
    expect(text).toContain('34');
    expect(text).toContain(String(Math.round(MARKET_COMMISSION * 100)));
  });

  it('покупка показывает ЭСКРОУ — сумму, которая замораживается сейчас', () => {
    expect(netNoteText('buy', 10, 4)).toContain('40');
  });

  it('дробные суммы: продавец округляется вниз, эскроу — вверх', () => {
    // 3 × 7 = 21 → продавцу floor(17.85) = 17, а в эскроу ceil(21) = 21
    expect(netNoteText('sell', 3, 7)).toContain('17');
    expect(netNoteText('buy', 3, 7)).toContain('21');
  });

  it('пустая форма не показывает мусор вместо нуля', () => {
    expect(netNoteText('sell', 0, 0)).toContain('0');
  });
});

describe('рынок — книга заявок', () => {
  const s = booked();

  it('аски идут от дешёвых, биды — от дорогих (лучшее предложение сверху)', () => {
    const html = marketBoxHtml(s, 'p1', 'metal', 'sell');
    const asks = [...html.matchAll(/@ (\d+) /g)].map((m) => Number(m[1]));
    // первые два числа — аски (4, 9), следующие два — биды (7, 2)
    expect(asks.slice(0, 2)).toEqual([4, 9]);
    expect(asks.slice(2, 4)).toEqual([7, 2]);
  });

  it('свой лот предлагает ОТМЕНУ, чужой — исполнение', () => {
    const mine = marketBoxHtml(s, 'p1', 'metal', 'sell');
    expect(mine).toContain('data-mkcancel');
    expect(mine).toContain('data-mktake');
    // с другого места за столом отменяемым становится другой набор
    const theirs = marketBoxHtml(s, 'p2', 'metal', 'sell');
    const cancels = (html: string) => [...html.matchAll(/data-mkcancel="([^"]+)"/g)].length;
    expect(cancels(mine)).toBe(1); // p1 держит один аск
    expect(cancels(theirs)).toBe(3); // p2 держит аск и два бида
  });

  it('кнопка гаснет, когда исполнить нечем', () => {
    const broke = booked();
    broke.players.p1!.resources = { credits: 0, metal: 0 };
    const html = marketBoxHtml(broke, 'p1', 'metal', 'sell');
    // чужой аск за 9 кредитов при нулевой казне — недоступен
    expect(html).toMatch(/data-mktake="[^"]+" disabled/);
  });

  it('в биде видно, сколько исполнитель получит ЧИСТЫМИ', () => {
    const html = marketBoxHtml(s, 'p1', 'metal', 'sell');
    // бид p2 на 5 @ 7 = 35 gross → исполнителю floor(29.75) = 29
    expect(html).toContain('→ 29 ');
  });

  it('пустая книга по товару читается как «нет заявок», а не как пустота', () => {
    const html = marketBoxHtml(s, 'p1', 'energy', 'sell');
    expect(html).not.toContain('data-mktake');
    expect(html).toContain('mk-empty');
  });

  it('открытая вкладка и сторона формы подсвечены', () => {
    const html = marketBoxHtml(s, 'p1', 'food', 'buy');
    expect(html).toContain('<button class="mk-tab on" data-mtab="food">');
    expect(html).toContain('class="on" data-mkside="buy"');
  });

  it('имя владельца экранируется — это ник живого игрока (CWE-79)', () => {
    const evil = booked();
    evil.players.p2!.name = '<img src=x onerror=alert(1)>';
    const html = marketBoxHtml(evil, 'p1', 'metal', 'sell');
    expect(html).toContain('&lt;img');
    expect(html).not.toContain('<img src=x');
  });
});

describe('рынок — окно', () => {
  it('open() показывает окно, красит и дёргает интро один раз', () => {
    const win = fakeWin();
    let intros = 0;
    const { open } = initMarket(hostOf({ root: () => win, onOpen: () => intros++ }));
    expect(win.shown()).toBe(false);
    open();
    expect(win.shown()).toBe(true);
    expect(win.html()).toContain('mkbox');
    expect(intros).toBe(1);
  });

  it('строка «к получению» заполняется сразу при отрисовке, а не после первого ввода', () => {
    const win = fakeWin();
    const { open } = initMarket(hostOf({ root: () => win }));
    open();
    // значения формы по умолчанию 10 × 3 = 30 → продавцу floor(25.5) = 25
    expect(win.net()).toContain('25');
    win.fire(click('.mk-seg button', { mkside: 'buy' }));
    expect(win.net()).toContain('30'); // в эскроу уходит вся сумма
  });

  it('крестик закрывает окно', () => {
    const win = fakeWin();
    const { open } = initMarket(hostOf({ root: () => win }));
    open();
    win.fire(click('.mk-close'));
    expect(win.shown()).toBe(false);
  });

  it('переключение вкладки перерисовывает книгу другого товара', () => {
    const win = fakeWin();
    const { open } = initMarket(hostOf({ root: () => win }));
    open();
    expect(win.html()).toContain('<button class="mk-tab on" data-mtab="metal">');
    win.fire(click('.mk-tab', { mtab: 'food' }));
    expect(win.html()).toContain('<button class="mk-tab on" data-mtab="food">');
  });

  it('переключение стороны формы меняет подсветку сегмента', () => {
    const win = fakeWin();
    const { open } = initMarket(hostOf({ root: () => win }));
    open();
    win.fire(click('.mk-seg button', { mkside: 'buy' }));
    expect(win.html()).toContain('class="on" data-mkside="buy"');
  });

  it('исполнение и отмена уходят приказами от ТЕКУЩЕГО игрока', () => {
    const win = fakeWin();
    const sent: Action[] = [];
    const { open } = initMarket(
      hostOf({ root: () => win, me: () => 'p2', order: (a) => sent.push(a) }),
    );
    open();
    win.fire(click('[data-mktake]', { mktake: 'lot-1' }));
    win.fire(click('[data-mkcancel]', { mkcancel: 'lot-2' }));
    expect(sent).toHaveLength(2);
    expect(sent.every((a) => a.playerId === 'p2')).toBe(true);
    expect(sent[0]!.type).toBe('market.take');
    expect(sent[1]!.type).toBe('market.cancel');
  });
});
