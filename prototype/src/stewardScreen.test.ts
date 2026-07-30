import { describe, it, expect, beforeAll } from 'vitest';
import { setLocale } from '../../localization/runtime';
import { newGame, HOUR, DAY } from './game';
import type { Action, GameState } from '../../packages/shared-core/src/index';
import {
  stewMetrics,
  stewFmtDur,
  stewardTechDone,
  stewLogLine,
  stewLogHtml,
  stewardBodyHtml,
  initSteward,
  type StewardHost,
} from './stewardScreen';

// REFM-7: locale pinned RU (see format.test.ts — Node has no browser language, so the
// runtime would fall back to EN and the label assertions would drift).
beforeAll(() => setLocale('ru'));

/** A state whose p1 seat has the Steward researched. */
function unlocked(): GameState {
  const s = newGame();
  const tech = (s.players.p1!.technologies ??= { completed: [], active: null, points: 0 } as never);
  (tech as { completed: string[] }).completed.push('ai_stewardship');
  return s;
}

/** Node has no DOM — the window shows/hides itself, repaints a body and delegates
 *  clicks, so a stand-in with those is the whole contract. */
function fakeWin(): HTMLElement & {
  fire: (target: unknown) => void;
  shown: () => boolean;
} {
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

function fakeBody(): HTMLElement & { html: () => string } {
  const el = { innerHTML: '', html: () => el.innerHTML };
  return el as unknown as HTMLElement & { html: () => string };
}

/** A click whose `closest(sel)` answers only for the selector we mean to hit. */
function stewClick(dataset: Record<string, string>): unknown {
  return {
    classList: { contains: () => false },
    closest: (q: string) => (q === '[data-stew]' ? { dataset } : null),
  };
}

describe('хранитель — счётчики и формат', () => {
  it('метрики считают ТОЛЬКО мои миры и округляют казну', () => {
    const s = newGame();
    s.players.p1!.resources = { metal: 12.7, credits: 40.2 };
    const m = stewMetrics(s, 'p1');
    expect(m.planets).toBe(Object.values(s.planets).filter((p) => p.owner === 'p1').length);
    expect(m.planets).toBeGreaterThan(0);
    expect(m).toMatchObject({ metal: 13, credits: 40 });
    // чужое место за столом даёт свой счёт, а не мой
    expect(stewMetrics(s, 'p2').planets).not.toBe(0);
    expect(stewMetrics(s, 'нет-такого')).toEqual({ planets: 0, metal: 0, credits: 0 });
  });

  it('длительность под часом читается в минутах, выше — «Nч Mм»', () => {
    expect(stewFmtDur(45 * 60_000)).toBe('45м');
    expect(stewFmtDur(90 * 60_000)).toBe('1ч 30м');
    expect(stewFmtDur(2 * 60 * 60_000)).toBe('2ч 0м');
    expect(stewFmtDur(-5)).toBe('0м'); // просроченный дедлайн не уходит в минус
  });

  it('технология читается с МОЕГО места, отсутствие ветки — не краш', () => {
    expect(stewardTechDone(newGame(), 'p1')).toBe(false);
    expect(stewardTechDone(unlocked(), 'p1')).toBe(true);
    expect(stewardTechDone(unlocked(), 'нет-такого')).toBe(false);
  });
});

describe('хранитель — журнал вахты', () => {
  it('каждый известный вид решения получает свою строку', () => {
    for (const kind of ['evac', 'ferry', 'stranded', 'strike', 'watch', 'hold', 'reinforce']) {
      const line = stewLogLine({ kind, node: 'KRONOS-2', fraction: 0.5, count: 3, to: 'ARES-1' });
      expect(line, kind).not.toContain('steward.log'); // ключ наружу не течёт
      expect(line, kind).toContain('KRONOS-2');
    }
  });

  it('незнакомое решение не исчезает, а честно показывается сырым', () => {
    // вахта, которая что-то сделала, никогда не должна читаться как спящая
    expect(stewLogLine({ kind: 'teleported', node: 'X' })).toBe('teleported: X');
  });

  it('пустой журнал не рисует секцию вовсе', () => {
    const s = newGame();
    expect(stewLogHtml(s, 'p1')).toBe('');
  });

  it('журнал показывает последние 12 решений, свежие сверху', () => {
    const s = newGame();
    s.time = 100 * HOUR;
    s.players.p1!.stewardLog = Array.from({ length: 20 }, (_, i) => ({
      kind: 'hold',
      at: i * HOUR,
      node: `N${i}`,
      fraction: 0.5,
    })) as never;
    const html = stewLogHtml(s, 'p1');
    const nodes = [...html.matchAll(/N(\d+)/g)].map((m) => Number(m[1]));
    expect(nodes).toHaveLength(12);
    expect(nodes[0]).toBe(19); // новейшее первым
    expect(nodes[11]).toBe(8);
  });
});

describe('хранитель — три состояния окна', () => {
  it('без технологии — замок, номер дня и путь к дереву', () => {
    const s = newGame();
    s.time = (s.startedAt ?? 0) + 2 * DAY;
    const html = stewardBodyHtml(s, 'p1', 'defend');
    expect(html).toContain('st-status locked');
    expect(html).toContain('data-stew="tech"');
    expect(html).toContain('3'); // день 1 — первый, значит +2 суток = день 3
    expect(html).not.toContain('data-stew="go"'); // делегировать нечем
  });

  it('с технологией — выбор позы и три длительности', () => {
    const html = stewardBodyHtml(unlocked(), 'p1', 'defend');
    expect(html).toContain('data-stew="posture"');
    const hours = [...html.matchAll(/data-h="(\d+)"/g)].map((m) => Number(m[1]));
    expect(hours).toEqual([4, 8, 12]);
    expect(html).not.toContain('data-stew="recall"');
  });

  it('выбранная поза подсвечена и меняет пояснение под кнопками', () => {
    const def = stewardBodyHtml(unlocked(), 'p1', 'defend');
    const act = stewardBodyHtml(unlocked(), 'p1', 'active_defend');
    expect(def).toContain('data-stew="posture" data-p="defend"');
    expect(def).toMatch(/st-btn sel" data-stew="posture" data-p="defend"/);
    expect(act).toMatch(/st-btn sel" data-stew="posture" data-p="active_defend"/);
    expect(def).not.toBe(act); // пояснение внизу тоже другое
  });

  it('на вахте — обратный отсчёт и кнопка забрать место, без выбора длительности', () => {
    const s = unlocked();
    s.players.p1!.steward = { until: s.time + 90 * 60_000, posture: 'defend' } as never;
    const html = stewardBodyHtml(s, 'p1', 'defend');
    expect(html).toContain('st-status on');
    expect(html).toContain('1ч 30м');
    expect(html).toContain('data-stew="recall"');
    expect(html).not.toContain('data-stew="go"');
  });

  it('журнал доживает до утреннего отчёта — он есть и после конца вахты', () => {
    const s = unlocked();
    s.players.p1!.stewardLog = [{ kind: 'hold', at: 0, node: 'KRONOS-2', fraction: 0.7 }] as never;
    // вахты уже нет (steward не выставлен), а журнал в теле окна — есть
    expect(stewardBodyHtml(s, 'p1', 'defend')).toContain('KRONOS-2');
  });
});

describe('хранитель — окно', () => {
  function wire(over: Partial<StewardHost> = {}) {
    const win = fakeWin();
    const body = fakeBody();
    const sent: Action[] = [];
    let techOpened = 0;
    let intros = 0;
    const api = initSteward({
      root: () => win,
      body: () => body,
      state: () => unlocked(),
      me: () => 'p1',
      order: (a) => sent.push(a),
      onOpen: () => intros++,
      openTech: () => techOpened++,
      ...over,
    });
    return { api, win, body, sent, tech: () => techOpened, intros: () => intros };
  }

  it('open() показывает окно, красит тело и дёргает интро', () => {
    const { api, win, body, intros } = wire();
    expect(api.isOpen()).toBe(false);
    api.open();
    expect(api.isOpen()).toBe(true);
    expect(win.shown()).toBe(true);
    expect(body.html()).toContain('st-status');
    expect(intros()).toBe(1);
  });

  it('выбор позы не шлёт приказ — он только меняет то, что уйдёт следующим', () => {
    const { api, win, body, sent } = wire();
    api.open();
    win.fire(stewClick({ stew: 'posture', p: 'active_defend' }));
    expect(sent).toHaveLength(0);
    expect(body.html()).toMatch(/st-btn sel" data-stew="posture" data-p="active_defend"/);
  });

  it('«8ч» шлёт делегирование с правильным дедлайном и позой', () => {
    const s = unlocked();
    s.time = 5 * HOUR;
    const { api, win, sent } = wire({ state: () => s });
    api.open();
    win.fire(stewClick({ stew: 'posture', p: 'active_defend' }));
    win.fire(stewClick({ stew: 'go', h: '8' }));
    expect(sent).toHaveLength(1);
    expect(sent[0]!.type).toBe('steward.delegate');
    expect(sent[0]!.playerId).toBe('p1');
    expect(sent[0]!.payload).toMatchObject({
      until: 5 * HOUR + 8 * HOUR,
      posture: 'active_defend',
    });
  });

  it('битая длительность падает на 8 часов, а не на NaN', () => {
    const s = unlocked();
    s.time = 0;
    const { api, win, sent } = wire({ state: () => s });
    api.open();
    win.fire(stewClick({ stew: 'go', h: 'вечность' }));
    expect(sent[0]!.payload).toMatchObject({ until: 8 * HOUR });
  });

  it('отзыв шлёт recall от текущего игрока', () => {
    const { api, win, sent } = wire();
    api.open();
    win.fire(stewClick({ stew: 'recall' }));
    expect(sent[0]!.type).toBe('steward.recall');
    expect(sent[0]!.playerId).toBe('p1');
  });

  it('«исследовать» закрывает окно и открывает дерево', () => {
    const { api, win, tech } = wire({ state: () => newGame() });
    api.open();
    win.fire(stewClick({ stew: 'tech' }));
    expect(api.isOpen()).toBe(false);
    expect(tech()).toBe(1);
  });
});
