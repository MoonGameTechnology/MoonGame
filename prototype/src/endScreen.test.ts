import { describe, it, expect, beforeAll } from 'vitest';
import { setLocale } from '../../localization/runtime';
import { newGame } from './game';
import type { GameState } from '../../packages/shared-core/src/index';
import {
  placementOf,
  outcomeTitle,
  endScreenHtml,
  initEndScreen,
  type MatchEnd,
  type EndAction,
  type EndScreenHost,
} from './endScreen';

// REFM-20: locale pinned RU (see format.test.ts — Node has no browser language, so the
// runtime would fall back to EN and the label assertions would drift).
beforeAll(() => setLocale('ru'));

const endOf = (over: Partial<MatchEnd> = {}): MatchEnd => ({
  won: true,
  draw: false,
  why: 'порог очков взят',
  xp: 0,
  levelUp: null,
  ...over,
});

/** Матч с итоговой таблицей: три места с разными очками. */
function scored(): GameState {
  const s = newGame();
  s.match = {
    ...(s.match ?? {}),
    endedAt: s.time + 1000,
    scores: {
      p1: { total: 120, controlledPlanets: 4, fleets: 2, units: 7 },
      p2: { total: 300, controlledPlanets: 9, fleets: 5, units: 20 },
      p3: { total: 50, controlledPlanets: 1, fleets: 0, units: 1 },
    },
  } as GameState['match'];
  return s;
}

const view = { net: false, worldsFallback: 0, fmtStamp: (at: number) => `T${at}` };

/** Оверлей без DOM: стиль, разметка и делегированный клик — весь контракт панели. */
function fakeOverlay() {
  let handler: ((ev: unknown) => void) | null = null;
  const el = {
    innerHTML: '',
    style: { display: 'none' },
    addEventListener: (_t: string, h: (ev: unknown) => void) => {
      handler = h;
    },
  };
  return {
    el: el as unknown as HTMLElement,
    html: () => el.innerHTML,
    shown: () => el.style.display !== 'none',
    click: (which?: string) =>
      handler?.({ target: { closest: () => (which ? { dataset: { es: which } } : null) } }),
  };
}

function wired(over: Partial<EndScreenHost> = {}) {
  const ov = fakeOverlay();
  const state = scored();
  let end: MatchEnd | null = endOf();
  let hub = false;
  let net = false;
  const left: Array<[EndAction, boolean]> = [];
  const api = initEndScreen({
    root: () => ov.el,
    state: () => state,
    me: () => 'p1',
    end: () => end,
    dismiss: () => {
      if (end) end.dismissed = true;
    },
    clearEnd: () => {
      end = null;
    },
    hubVisible: () => hub,
    net: () => net,
    worldsFallback: () => 0,
    fmtStamp: (at) => `T${at}`,
    onLeave: (which, wasNet) => left.push([which, wasNet]),
    ...over,
  });
  return {
    api,
    ov,
    left,
    setHub: (v: boolean) => {
      hub = v;
    },
    setNet: (v: boolean) => {
      net = v;
    },
    setEnd: (v: MatchEnd | null) => {
      end = v;
    },
    getEnd: () => end,
  };
}

describe('итоги матча — место в таблице', () => {
  it('место считается по очкам, а не по порядку мест в объекте', () => {
    const r = placementOf({ p1: { total: 120 }, p2: { total: 300 }, p3: { total: 50 } }, 'p1');
    expect(r).toEqual({ place: 2, of: 3, total: 120 });
  });

  it('лидер — первый', () => {
    expect(placementOf({ p1: { total: 120 }, p2: { total: 300 } }, 'p2').place).toBe(1);
  });

  it('пустая таблица не делает вас «первым из ниоткуда»', () => {
    expect(placementOf({}, 'p1')).toEqual({ place: 0, of: 0, total: 0 });
  });

  it('вас нет в таблице — места нет', () => {
    expect(placementOf({ p2: { total: 10 } }, 'p1').place).toBe(0);
  });

  it('дробный счёт округляется — игроку показывают целое', () => {
    expect(placementOf({ p1: { total: 120.7 } }, 'p1').total).toBe(121);
  });
});

describe('итоги матча — заголовок исхода', () => {
  it('победа в одиночку и победа коалицией названы по-разному', () => {
    const solo = outcomeTitle(endOf({ won: true }), ['p1']);
    const coal = outcomeTitle(endOf({ won: true }), ['p1', 'p2']);
    expect(solo).not.toBe(coal);
  });

  it('ничья и поражение — свои заголовки', () => {
    const draw = outcomeTitle(endOf({ won: false, draw: true }), undefined);
    const loss = outcomeTitle(endOf({ won: false, draw: false }), undefined);
    expect(draw).not.toBe(loss);
    expect(loss).toBeTruthy();
  });
});

describe('итоги матча — разметка', () => {
  it('панель несёт исход, причину, счёт и три действия', () => {
    const html = endScreenHtml(scored(), 'p1', endOf(), view);
    expect(html).toContain('es-head win');
    expect(html).toContain('порог очков взят');
    expect(html).toContain('data-es="again"');
    expect(html).toContain('data-es="menu"');
    expect(html).toContain('data-es="board"');
  });

  it('числа берутся из счёта матча, а не досчитываются', () => {
    const html = endScreenHtml(scored(), 'p1', endOf(), view);
    expect(html).toContain('⬣ 4'); // провинции из снимка
    expect(html).toContain('⛴ 2');
    expect(html).toContain('⚔ 7');
  });

  it('без провинций в счёте берётся запасное значение хоста', () => {
    const s = scored();
    s.match!.scores!.p1 = { total: 10 } as never;
    const html = endScreenHtml(s, 'p1', endOf(), { ...view, worldsFallback: 42 });
    expect(html).toContain('⬣ 42');
  });

  it('строка опыта появляется только когда опыт начислен', () => {
    expect(endScreenHtml(scored(), 'p1', endOf({ xp: 0 }), view)).not.toContain('es-xp');
    expect(endScreenHtml(scored(), 'p1', endOf({ xp: 25 }), view)).toContain('es-xp');
  });

  it('повышение уровня показывается отдельной отметкой', () => {
    const html = endScreenHtml(scored(), 'p1', endOf({ xp: 25, levelUp: 3 }), view);
    expect(html).toContain('lvl');
  });

  it('«ещё раз» в сети и в соло подписано по-разному', () => {
    const solo = endScreenHtml(scored(), 'p1', endOf(), { ...view, net: false });
    const net = endScreenHtml(scored(), 'p1', endOf(), { ...view, net: true });
    const label = (h: string) => h.slice(h.indexOf('data-es="again"')).slice(0, 60);
    expect(label(solo)).not.toBe(label(net));
  });

  it('причина конца экранируется — она попадает в innerHTML (CWE-79)', () => {
    const html = endScreenHtml(
      scored(),
      'p1',
      endOf({ why: '<img src=x onerror=alert(1)>' }),
      view,
    );
    expect(html).toContain('&lt;img');
    expect(html).not.toContain('<img src=x');
  });
});

describe('итоги матча — когда панель показывается', () => {
  it('матч закончен — панель видна', () => {
    const w = wired();
    w.api.render();
    expect(w.ov.shown()).toBe(true);
    expect(w.ov.html()).toContain('es-box');
  });

  it('матч идёт — панели нет', () => {
    const w = wired();
    w.setEnd(null);
    w.api.render();
    expect(w.ov.shown()).toBe(false);
  });

  it('поверх хаба панель НЕ показывается (BF-29: «Победа!» над меню — ложь)', () => {
    const w = wired();
    w.api.render();
    expect(w.ov.shown()).toBe(true);
    w.setHub(true);
    w.api.render();
    expect(w.ov.shown()).toBe(false);
  });

  it('вернулись в матч — панель вернулась', () => {
    const w = wired();
    w.setHub(true);
    w.api.render();
    w.setHub(false);
    w.api.render();
    expect(w.ov.shown()).toBe(true);
  });

  it('игрок закрыл панель ради стола — она не всплывает обратно', () => {
    const w = wired();
    w.api.render();
    w.ov.click('board');
    w.api.render();
    expect(w.ov.shown()).toBe(false);
    expect(w.getEnd()).not.toBeNull(); // итог остался, скрыта только панель
  });
});

describe('итоги матча — уход', () => {
  it('«ещё раз» отдаётся хозяину с пометкой режима', () => {
    const w = wired();
    w.api.render();
    w.ov.click('again');
    expect(w.left).toEqual([['again', false]]);
    expect(w.getEnd()).toBeNull(); // итог сброшен, над хабом не всплывёт
  });

  it('в сетевом матче тот же выбор помечен как сетевой', () => {
    const w = wired();
    w.setNet(true);
    w.api.render();
    w.ov.click('again');
    expect(w.left).toEqual([['again', true]]);
  });

  it('«в меню» — отдельное намерение', () => {
    const w = wired();
    w.api.render();
    w.ov.click('menu');
    expect(w.left).toEqual([['menu', false]]);
  });

  it('клик мимо кнопок ничего не делает', () => {
    const w = wired();
    w.api.render();
    w.ov.click();
    expect(w.left).toEqual([]);
    expect(w.getEnd()).not.toBeNull();
  });

  it('«посмотреть стол» уходом НЕ считается', () => {
    const w = wired();
    w.api.render();
    w.ov.click('board');
    expect(w.left).toEqual([]);
  });
});
