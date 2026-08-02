import { describe, it, expect, beforeAll } from 'vitest';
import { setLocale } from '../../localization/runtime';
import { newGame, data, DAY, HOUR } from './game';
import type { Action, GameState } from '../../packages/shared-core/src/index';
import {
  TECH_BRANCHES,
  TECH_COLS,
  branchLabel,
  techCost,
  techCondText,
  techCondOk,
  techFx,
  techTreeHtml,
  initTechTree,
  type TechHost,
} from './techTree';

// REFM-9: locale pinned RU (see format.test.ts — Node has no browser language, so the
// runtime would fall back to EN and the label assertions would drift).
beforeAll(() => setLocale('ru'));

/** Live tech defs minus the account-perk pseudo-nodes the tree never shows. */
const TECHS = Object.fromEntries(
  Object.entries(data.technologies).filter(([id]) => !id.startsWith('meta_')),
);

/** Node with the smallest day-gate in a branch — always visible on the first day. */
function firstOf(branch: string): string {
  return Object.keys(TECHS)
    .filter((id) => (TECHS[id]!.branch ?? 'space') === branch)
    .sort((a, b) => (TECHS[a]!.dayGate ?? 0) - (TECHS[b]!.dayGate ?? 0))[0]!;
}

function fakeWin(): HTMLElement & { fire: (t: unknown) => void; shown: () => boolean } {
  let handler: ((ev: unknown) => void) | null = null;
  const classes = new Set<string>();
  const el = {
    classList: {
      add: (c: string) => classes.add(c),
      remove: (c: string) => classes.delete(c),
      contains: (c: string) => classes.has(c),
    },
    addEventListener: (_t: string, h: (ev: unknown) => void) => {
      handler = h;
    },
    fire: (target: unknown) => handler?.({ target }),
    shown: () => classes.has('show'),
  };
  return el as unknown as HTMLElement & { fire: (t: unknown) => void; shown: () => boolean };
}

/** The body also answers `.tt-scroll` — the window saves/restores its scroll on repaint. */
function fakeBody(): HTMLElement & { html: () => string; scroll: () => [number, number] } {
  const scroll = { scrollLeft: 0, scrollTop: 0 };
  const el = {
    innerHTML: '',
    querySelector: (sel: string) => (sel === '.tt-scroll' ? scroll : null),
    html: () => el.innerHTML,
    scroll: () => [scroll.scrollLeft, scroll.scrollTop] as [number, number],
  };
  return el as unknown as HTMLElement & { html: () => string; scroll: () => [number, number] };
}

function ttClick(sel: string, dataset: Record<string, string> = {}): unknown {
  return {
    classList: { contains: () => false },
    closest: (q: string) => (q === sel ? { dataset } : null),
  };
}

function wire(over: Partial<TechHost> = {}, state?: GameState) {
  const win = fakeWin();
  const body = fakeBody();
  const sent: Action[] = [];
  let intros = 0;
  const s = state ?? newGame();
  const api = initTechTree({
    root: () => win,
    body: () => body,
    state: () => s,
    me: () => 'p1',
    order: (a) => sent.push(a),
    onOpen: () => intros++,
    ...over,
  });
  return { api, win, body, sent, s, intros: () => intros };
}

describe('дерево технологий — подписи', () => {
  it('у каждой ветки есть локализованная подпись, ключ наружу не течёт', () => {
    for (const b of TECH_BRANCHES) {
      expect(branchLabel(b.key), b.key).not.toContain('tech.branch');
      expect(branchLabel(b.key), b.key).not.toBe('');
    }
  });

  it('незнакомая ветка возвращает свой же ключ, а не падает', () => {
    expect(branchLabel('нет-такой')).toBe('нет-такой');
  });

  it('цена собирается из иконок ресурсов', () => {
    expect(techCost({ metal: 40 })).toContain('rc-metal');
    expect(techCost({ metal: 40, credits: 10 })).toContain(' · ');
    expect(techCost({})).toBe('');
  });

  it('раскладка колонок ссылается только на существующие техи', () => {
    // карта раскладки — презентационная и правится руками; опечатка в id тихо
    // выкинула бы узел в автоколонку, поэтому проверяем явно
    for (const [branch, cols] of Object.entries(TECH_COLS)) {
      for (const col of cols) {
        for (const id of col.ids) {
          expect(TECHS[id], `${branch}/${id}`).toBeDefined();
          expect(TECHS[id]!.branch ?? 'space', id).toBe(branch);
        }
      }
    }
  });
});

describe('дерево технологий — условия узла', () => {
  it('каждый живой тип условия печатается человеческим текстом', () => {
    const seen = new Set<string>();
    for (const td of Object.values(TECHS))
      for (const c of td.conditions ?? []) {
        if (seen.has(c.type)) continue;
        seen.add(c.type);
        const text = techCondText(c);
        expect(text, c.type).not.toContain('tech.req.special');
        expect(text, c.type).not.toBe('');
      }
    expect(seen.size).toBeGreaterThan(0);
  });

  it('клиентская проверка fail-secure: неизвестный тип читается как ЗАКРЫТО', () => {
    const s = newGame();
    // ядро всё равно проверит по-настоящему — клиент не имеет права угадывать «открыто»
    expect(techCondOk(s, 'p1', { type: 'нет-такого' } as never)).toBe(false);
  });

  it('own_sectors считает миры МОЕГО места', () => {
    const s = newGame();
    const mine = Object.values(s.planets).filter((p) => p.owner === 'p1').length;
    expect(techCondOk(s, 'p1', { type: 'own_sectors', min: mine } as never)).toBe(true);
    expect(techCondOk(s, 'p1', { type: 'own_sectors', min: mine + 1 } as never)).toBe(false);
  });

  it('techFx перечисляет эффекты и анлоки, пустой узел даёт пустую строку', () => {
    const withFx = Object.values(TECHS).find((td) => Object.keys(td.effects ?? {}).length > 0);
    if (withFx) expect(techFx(withFx)).not.toBe('');
    expect(techFx({ effects: {}, unlocks: {} } as never)).toBe('');
  });
});

describe('дерево технологий — разметка', () => {
  const s = newGame();

  it('рисует вкладки всех веток и подсвечивает открытую', () => {
    const html = techTreeHtml(s, 'p1', 'ground', null);
    for (const b of TECH_BRANCHES) expect(html).toContain(`data-ttab="${b.key}"`);
    expect(html).toContain('<button class="tt-tab on" data-ttab="ground">');
  });

  it('рельса дней общая для всех веток — строки не прыгают при переключении', () => {
    const rows = (tab: string) =>
      [...techTreeHtml(s, 'p1', tab, null).matchAll(/class="tt-drow/g)].length;
    expect(rows('space')).toBe(rows('missile'));
    expect(rows('space')).toBeGreaterThan(1);
  });

  it('показывает узлы ТОЛЬКО открытой ветки', () => {
    const html = techTreeHtml(s, 'p1', 'command', null);
    expect(html).toContain('data-tech="ai_stewardship"'); // ветка «Командование»
    expect(html).not.toContain('data-tech="void_armadas"'); // это космос
  });

  it('мета-узлы аккаунта в дерево не попадают', () => {
    const metaIds = Object.keys(data.technologies).filter((id) => id.startsWith('meta_'));
    if (metaIds.length === 0) return;
    for (const tab of TECH_BRANCHES.map((b) => b.key)) {
      const html = techTreeHtml(s, 'p1', tab, null);
      for (const id of metaIds) expect(html, `${tab}/${id}`).not.toContain(`data-tech="${id}"`);
    }
  });

  it('досье закрытого узла предлагает НЕ кнопку исследования, а причину', () => {
    const locked = Object.keys(TECHS).find((id) => (TECHS[id]!.dayGate ?? 0) > 0)!;
    const html = techTreeHtml(s, 'p1', TECHS[locked]!.branch ?? 'space', locked);
    expect(html).toContain('tt-modal');
    expect(html).toContain('tt-mbtn wait');
    expect(html).not.toContain(`data-go="${locked}"`);
  });

  it('исследованный узел помечен галочкой, а не кнопкой', () => {
    const st = newGame();
    const id = firstOf('space');
    st.players.p1!.technologies = { completed: [id], active: [], points: 0 } as never;
    const html = techTreeHtml(st, 'p1', 'space', id);
    expect(html).toContain('st-done');
    expect(html).not.toContain(`data-go="${id}"`);
  });

  it('кнопка исследования гаснет, когда не хватает ресурсов', () => {
    const rich = newGame();
    const poor = newGame();
    const id = firstOf('space');
    const cost = TECHS[id]!.cost as Record<string, number>;
    rich.players.p1!.resources = Object.fromEntries(
      Object.keys(cost).map((k) => [k, (cost[k] ?? 0) * 10]),
    );
    poor.players.p1!.resources = {};
    const okHtml = techTreeHtml(rich, 'p1', 'space', id);
    const noHtml = techTreeHtml(poor, 'p1', 'space', id);
    expect(okHtml).toMatch(new RegExp(`data-go="${id}"(?! disabled)`));
    expect(noHtml).toMatch(new RegExp(`data-go="${id}" disabled`));
  });

  it('идущее исследование показывает полосу прогресса и ETA в часах', () => {
    const st = newGame();
    const id = firstOf('space');
    st.time = 10 * DAY;
    // половина срока пройдена, до конца 5 часов
    st.players.p1!.technologies = {
      completed: [],
      active: [{ technology: id, startedAt: st.time - 5 * HOUR, completesAt: st.time + 5 * HOUR }],
      points: 0,
    } as never;
    const html = techTreeHtml(st, 'p1', 'space', id);
    expect(html).toContain('st-res');
    expect(html).toContain('width:50%'); // полоса ровно посередине
    expect(html).toContain('tt-mbtn wait'); // повторно запустить нельзя
    expect(html).toContain('5'); // осталось 5 ч
  });

  it('исчезнувший из данных узел не оставляет висящее досье', () => {
    // модалка чистится, если id больше нет в каталоге — окно не должно падать
    expect(() => techTreeHtml(s, 'p1', 'space', 'нет-такого-теха')).not.toThrow();
    expect(techTreeHtml(s, 'p1', 'space', 'нет-такого-теха')).not.toContain('tt-modal');
  });

  it('пилюля слотов держит кламп ядра: 2 базовых, максимум 3', () => {
    const html = techTreeHtml(s, 'p1', 'space', null);
    expect(html).toMatch(/tt-slots/);
    expect(html).toMatch(/[023]\s*\/\s*[23]|\/\s*[23]/);
  });
});

describe('дерево технологий — окно', () => {
  it('open() показывает окно, красит тело и дёргает интро', () => {
    const { api, win, body, intros } = wire();
    expect(api.isOpen()).toBe(false);
    api.open();
    expect(api.isOpen()).toBe(true);
    expect(win.shown()).toBe(true);
    expect(body.html()).toContain('tt-tabs');
    expect(intros()).toBe(1);
  });

  it('переключение вкладки перерисовывает дерево другой ветки', () => {
    const { api, win, body } = wire();
    api.open();
    expect(body.html()).toContain('<button class="tt-tab on" data-ttab="space">');
    win.fire(ttClick('.tt-tab', { ttab: 'command' }));
    expect(body.html()).toContain('<button class="tt-tab on" data-ttab="command">');
  });

  it('тап по узлу открывает досье, крестик модалки его закрывает', () => {
    const { api, win, body } = wire();
    api.open();
    win.fire(ttClick('.tt-node', { tech: firstOf('space') }));
    expect(body.html()).toContain('tt-modal');
    win.fire(ttClick('[data-mclose]'));
    expect(body.html()).not.toContain('tt-modal');
  });

  it('смена вкладки закрывает открытое досье, повторный тык по той же — нет', () => {
    const { api, win, body } = wire();
    api.open();
    win.fire(ttClick('.tt-node', { tech: firstOf('space') }));
    win.fire(ttClick('.tt-tab', { ttab: 'space' })); // та же вкладка
    expect(body.html()).toContain('tt-modal');
    win.fire(ttClick('.tt-tab', { ttab: 'ground' })); // другая
    expect(body.html()).not.toContain('tt-modal');
  });

  it('кнопка исследования шлёт приказ от текущего игрока', () => {
    const st = newGame();
    const id = firstOf('space');
    st.players.p1!.resources = Object.fromEntries(
      Object.keys(TECHS[id]!.cost as Record<string, number>).map((k) => [k, 9999]),
    );
    const { api, win, sent } = wire({ me: () => 'p1' }, st);
    api.open();
    win.fire(ttClick('.tt-mbtn', { go: id }));
    expect(sent).toHaveLength(1);
    expect(sent[0]!.type).toBe('technology.research');
    expect(sent[0]!.playerId).toBe('p1');
    expect(sent[0]!.payload).toMatchObject({ technology: id });
  });

  it('открытие сбрасывает прошлое досье — новое окно начинается чистым', () => {
    const { api, win, body } = wire();
    api.open();
    win.fire(ttClick('.tt-node', { tech: firstOf('space') }));
    expect(body.html()).toContain('tt-modal');
    api.open();
    expect(body.html()).not.toContain('tt-modal');
  });

  it('живая перерисовка сохраняет прокрутку — иначе панель прыгала бы каждые 500мс', () => {
    const { api, body } = wire();
    api.open();
    const scroll = body.querySelector('.tt-scroll') as unknown as {
      scrollLeft: number;
      scrollTop: number;
    };
    scroll.scrollLeft = 140;
    scroll.scrollTop = 60;
    api.repaint();
    expect(body.scroll()).toEqual([140, 60]);
  });

  it('крестик окна закрывает и окно, и досье', () => {
    const { api, win, body } = wire();
    api.open();
    win.fire(ttClick('.tt-node', { tech: firstOf('space') }));
    win.fire({ classList: { contains: (c: string) => c === 'tw-close' }, closest: () => null });
    expect(api.isOpen()).toBe(false);
    api.open();
    expect(body.html()).not.toContain('tt-modal');
  });
});
