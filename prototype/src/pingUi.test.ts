import { describe, it, expect, beforeAll } from 'vitest';
import { setLocale } from '../../localization/runtime';
import { COALITION, type SessionMsg } from './conversations';
import { pingRows } from './pingPanel';
import {
  pingMenuHtml,
  pingPanelHtml,
  pingPopHtml,
  activePings,
  initPingUi,
  PING_DESC_MAX,
  type PingHost,
  type PingNet,
} from './pingUi';

// REFM-25: locale pinned RU (see format.test.ts — Node has no browser language, so the
// runtime would fall back to EN and the label assertions would drift).
beforeAll(() => setLocale('ru'));

const msg = (over: Partial<SessionMsg> = {}): SessionMsg => ({
  to: COALITION,
  from: 'p1',
  text: 'сюда',
  at: 1000,
  sys: false,
  ping: 'C1R1',
  ...over,
});

const dest = (id: string) => ({ id, color: '#0f0', icon: '◆', name: id.toUpperCase(), tag: 'ИИ' });

/** Окно без DOM: разметка строкой, поле ввода и делегированный клик. */
function fakeWin() {
  const on: Record<string, Array<(ev: unknown) => void>> = {};
  const input = { value: '', focus: () => {} };
  const el = {
    innerHTML: '',
    style: { left: '', top: '' } as Record<string, string>,
    shown: false,
    classList: {
      add: (c: string) => c === 'show' && (el.shown = true),
      remove: (c: string) => c === 'show' && (el.shown = false),
      contains: (c: string) => c === 'show' && el.shown,
    },
    addEventListener: (type: string, h: (ev: unknown) => void) => void (on[type] ??= []).push(h),
    querySelector: (sel: string) => (sel === '#pm-text' ? input : null),
  };
  const fire = (type: string, ev: unknown) => {
    for (const h of on[type] ?? []) h(ev);
  };
  /** Клик по элементу с указанными data-атрибутами (closest эмулируем таблицей).
   *  Кнопка строки умеет находить свою строку — так же, как настоящий DOM. */
  const clickOn = (attrs: Record<string, string>, sel?: string, row?: string) => {
    const rowEl = row ? { dataset: { ploc: row } } : null;
    const btn = {
      dataset: attrs.pact ? { pact: attrs.pact } : attrs,
      closest: (q: string) => (q === '[data-ploc]' ? rowEl : null),
    };
    fire('click', {
      target: {
        closest: (q: string) => {
          if (q === '[data-pact]' && attrs.pact) return btn;
          if (sel && q === sel) return btn;
          if (q === '[data-pmcancel]' && attrs.cancel) return {};
          return null;
        },
      },
    });
  };
  return { el: el as unknown as HTMLElement, raw: el, input, fire, clickOn };
}

function wired(over: Partial<PingHost> = {}, seed: SessionMsg[] = []) {
  const menu = fakeWin();
  const panel = fakeWin();
  const pop = fakeWin();
  let messages: SessionMsg[] = [...seed];
  let net: PingNet | null = null;
  let selected: string | null = 'C1R1';
  let answer: string | null = null;
  const notes: string[] = [];
  const pushed: Array<[string, string, string]> = [];
  const placed: Array<{ node: string; label: string }> = [];
  const cleared: string[] = [];
  const camera: Array<[string, string]> = [];
  let feeds = 0;
  const api = initPingUi({
    menuRoot: () => menu.el,
    panelRoot: () => panel.el,
    popRoot: () => pop.el,
    me: () => 'p1',
    selected: () => selected,
    hasProvince: (loc) => loc.startsWith('C'),
    messages: () => messages,
    setMessages: (next) => {
      messages = next;
    },
    push: (to, text, loc) => pushed.push([to, text, loc]),
    net: () => net,
    seats: () => ['p1', 'p2', 'p3'],
    coalitionSize: () => 2,
    name: (id) => ({ p1: 'Вы', p2: 'Красные', p3: 'Синие' })[id] ?? id,
    color: (id) => (id === 'p1' ? '#0ff' : '#f00'),
    badge: () => ({ icon: '◆', tag: 'ИИ' }),
    provinceName: (loc) => `Мир ${loc}`,
    note: (text) => notes.push(text),
    focus: (loc) => camera.push(['focus', loc]),
    jump: (loc) => camera.push(['jump', loc]),
    anchor: (loc) => (loc === 'C1R1' ? { left: 120, top: 240 } : null),
    ask: () => answer,
    onFeedChanged: () => feeds++,
    ...over,
  });
  return {
    api,
    menu,
    panel,
    pop,
    notes,
    pushed,
    placed,
    cleared,
    camera,
    feeds: () => feeds,
    messages: () => messages,
    setNet: () => {
      net = {
        placePing: (p) => placed.push({ node: p.target.node, label: p.label }),
        clearPing: (id) => cleared.push(id),
      };
    },
    setSelected: (v: string | null) => {
      selected = v;
    },
    setAnswer: (v: string | null) => {
      answer = v;
    },
  };
}

describe('метки — окно «куда отправить»', () => {
  it('коалиция и все собеседники получают по кнопке', () => {
    const html = pingMenuHtml('C1R1', 3, [dest('p2'), dest('p3')]);
    expect(html).toContain(`data-pmdest="${COALITION}"`);
    expect(html).toContain('data-pmdest="p2"');
    expect(html).toContain('data-pmdest="p3"');
    expect(html).toContain('C1R1');
  });

  it('без собеседников остаётся только коалиция', () => {
    const html = pingMenuHtml('C1R1', 1, []);
    expect(html).toContain(`data-pmdest="${COALITION}"`);
    expect(html).not.toContain('data-pmdest="p2"');
  });

  it('поле описания ограничено тем же пределом, что и обрезка текста', () => {
    expect(pingMenuHtml('C1R1', 1, [])).toContain(`maxlength="${PING_DESC_MAX}"`);
  });

  it('имя провинции экранируется — оно попадает в innerHTML (CWE-79)', () => {
    expect(pingMenuHtml('<img src=x onerror=alert(1)>', 1, [])).not.toContain('<img src=x');
  });
});

describe('метки — список', () => {
  const view = () => ({ where: 'Мир', who: 'Вы', color: '#0ff' });

  it('своя метка правится и снимается, чужая — нет', () => {
    const rows = pingRows([msg(), msg({ from: 'p2', ping: 'C2R2' })], 'p1', new Set());
    const html = pingPanelHtml(rows, view);
    const mine = html.slice(html.indexOf('data-ploc="C1R1"'), html.indexOf('data-ploc="C2R2"'));
    const theirs = html.slice(html.indexOf('data-ploc="C2R2"'));
    expect(mine).toContain('data-pact="edit"');
    expect(mine).toContain('data-pact="del"');
    expect(theirs).not.toContain('data-pact="edit"');
    expect(theirs).not.toContain('data-pact="del"');
  });

  it('спрятать и показать может ЛЮБУЮ — это локальное действие', () => {
    const rows = pingRows([msg({ from: 'p2' })], 'p1', new Set());
    expect(pingPanelHtml(rows, view)).toContain('data-pact="hide"');
  });

  it('спрятанная строка помечена и предлагает вернуть', () => {
    const rows = pingRows([msg()], 'p1', new Set(['C1R1']));
    const html = pingPanelHtml(rows, view);
    expect(html).toContain('pp-row off');
    expect(html).toContain('🙈');
  });

  it('пустой список говорит об этом словами, а не пустотой', () => {
    const html = pingPanelHtml([], view);
    expect(html).toContain('pp-empty');
    expect(html).toContain('data-pact="close"');
  });

  it('текст метки экранируется', () => {
    const rows = pingRows([msg({ text: '<b>ой</b>' })], 'p1', new Set());
    expect(pingPanelHtml(rows, view)).not.toContain('<b>ой</b>');
  });
});

describe('метки — попап маркера', () => {
  it('своя метка предлагает снятие, чужая — только переход', () => {
    expect(pingPopHtml('C1R1', 'Вы', '#0ff', 'тут', true)).toContain('pp-del');
    expect(pingPopHtml('C1R1', 'Красные', '#f00', 'тут', false)).not.toContain('pp-del');
  });

  it('метка без описания честно говорит, что описания нет', () => {
    const html = pingPopHtml('C1R1', 'Вы', '#0ff', '', true);
    expect(html).toContain('<i>'); // курсивная заглушка вместо пустой строки
    expect(html).toContain('pp-jump');
  });
});

describe('метки — активные', () => {
  it('одна метка на провинцию: последняя побеждает', () => {
    const list = activePings([
      msg({ text: 'старое', at: 1 }),
      msg({ text: 'новое', at: 2 }),
      msg({ ping: 'C2R2', at: 3 }),
    ]);
    expect(list.length).toBe(2);
    expect(list.find((m) => m.ping === 'C1R1')?.text).toBe('новое');
  });

  it('обычные сообщения и личные метки в карту не попадают', () => {
    expect(activePings([msg({ ping: undefined }), msg({ to: 'p2' })])).toEqual([]);
  });
});

describe('метки — композер', () => {
  it('без выбранной провинции окно не открывается, а игроку говорят почему', () => {
    const w = wired();
    w.setSelected(null);
    w.api.openMenu();
    expect(w.menu.raw.shown).toBe(false);
    expect(w.notes.length).toBe(1);
    expect(w.api.menuOpen()).toBe(false);
  });

  it('открытое окно знает свою провинцию', () => {
    const w = wired();
    w.api.openMenu();
    expect(w.menu.raw.shown).toBe(true);
    expect(w.menu.raw.innerHTML).toContain('C1R1');
    expect(w.api.menuOpen()).toBe(true);
  });

  it('в одиночном матче метка ложится строкой в ленту коалиции', () => {
    const w = wired();
    w.api.openMenu();
    w.menu.input.value = 'тут враг';
    w.api.createTo(COALITION);
    expect(w.pushed).toEqual([[COALITION, 'тут враг', 'C1R1']]);
    expect(w.api.menuOpen()).toBe(false);
  });

  it('в сетевом матче метку коалиции ставит СЕРВЕР, а не лента', () => {
    const w = wired();
    w.setNet();
    w.api.openMenu();
    w.menu.input.value = 'тут враг';
    w.api.createTo(COALITION);
    expect(w.placed).toEqual([{ node: 'C1R1', label: 'тут враг' }]);
    expect(w.pushed).toEqual([]);
  });

  it('личная метка идёт в ленту даже в сети — это личное сообщение', () => {
    const w = wired();
    w.setNet();
    w.api.openMenu();
    w.menu.input.value = 'смотри';
    w.api.createTo('p2');
    expect(w.pushed).toEqual([['p2', 'смотри', 'C1R1']]);
    expect(w.placed).toEqual([]);
  });

  it('пустое описание не даёт пустой метки — подставляется подпись места', () => {
    const w = wired();
    w.api.openMenu();
    w.api.createTo(COALITION);
    expect(w.pushed[0]![1]).toBeTruthy();
    expect(w.pushed[0]![1]).toContain('C1R1');
  });

  it('слишком длинное описание обрезается до предела поля', () => {
    const w = wired();
    w.api.openMenu();
    w.menu.input.value = 'я'.repeat(200);
    w.api.createTo(COALITION);
    expect(w.pushed[0]![1].length).toBe(PING_DESC_MAX);
  });

  it('тап по фону закрывает композер', () => {
    const w = wired();
    w.api.openMenu();
    const backdrop = w.menu.raw as unknown as { closest: (q: string) => null };
    backdrop.closest = () => null; // сам корень окна, а не что-то внутри него
    w.menu.fire('click', { target: backdrop });
    expect(w.api.menuOpen()).toBe(false);
  });
});

describe('метки — список: действия', () => {
  it('«к метке» ведёт камеру и закрывает список', () => {
    const w = wired({}, [msg()]);
    w.api.openPanel();
    w.panel.clickOn({ pact: 'go' }, undefined, 'C1R1');
    expect(w.camera).toEqual([['focus', 'C1R1']]);
    expect(w.api.panelOpen()).toBe(false);
  });

  it('спрятать — ЛОКАЛЬНО: метка уходит с карты, но остаётся в ленте', () => {
    const w = wired({}, [msg()]);
    w.api.openPanel();
    expect(w.api.drawable().length).toBe(1);
    w.panel.clickOn({ pact: 'hide' }, undefined, 'C1R1');
    expect(w.api.drawable()).toEqual([]);
    expect(w.messages().length).toBe(1); // у союзника метка цела
  });

  it('чужую метку снять нельзя даже кликом по кнопке, которой нет', () => {
    const w = wired({}, [msg({ from: 'p2' })]);
    w.api.openPanel();
    w.panel.clickOn({ pact: 'del' }, undefined, 'C1R1');
    expect(w.messages().length).toBe(1);
  });

  it('свою метку снятие убирает из ленты и обновляет её', () => {
    const w = wired({}, [msg()]);
    w.api.openPanel();
    w.panel.clickOn({ pact: 'del' }, undefined, 'C1R1');
    expect(w.messages()).toEqual([]);
    expect(w.feeds()).toBe(1);
  });

  it('в сети снятие идёт через сервер, лента не трогается', () => {
    const w = wired({}, [msg({ pingId: 'srv-7' })]);
    w.setNet();
    w.api.openPanel();
    w.panel.clickOn({ pact: 'del' }, undefined, 'C1R1');
    expect(w.cleared).toEqual(['srv-7']);
    expect(w.messages().length).toBe(1); // ждём эха сервера, сами не стираем
  });

  it('правка = снять и поставить заново', () => {
    const w = wired({}, [msg()]);
    w.setAnswer('новый текст');
    w.api.openPanel();
    w.panel.clickOn({ pact: 'edit' }, undefined, 'C1R1');
    expect(w.messages()).toEqual([]); // старая снята
    expect(w.pushed).toEqual([[COALITION, 'новый текст', 'C1R1']]);
  });

  it('передумал править — метка остаётся как была', () => {
    const w = wired({}, [msg()]);
    w.setAnswer(null);
    w.api.openPanel();
    w.panel.clickOn({ pact: 'edit' }, undefined, 'C1R1');
    expect(w.messages().length).toBe(1);
    expect(w.pushed).toEqual([]);
  });

  it('чужую метку править нельзя', () => {
    const w = wired({}, [msg({ from: 'p2' })]);
    w.setAnswer('перепишу-ка');
    w.api.openPanel();
    w.panel.clickOn({ pact: 'edit' }, undefined, 'C1R1');
    expect(w.pushed).toEqual([]);
    expect(w.messages().length).toBe(1);
  });

  it('крестик закрывает список', () => {
    const w = wired({}, [msg()]);
    w.api.openPanel();
    w.panel.clickOn({ pact: 'close' });
    expect(w.api.panelOpen()).toBe(false);
  });

  it('переключатель рельсы открывает и закрывает', () => {
    const w = wired({}, [msg()]);
    w.api.togglePanel();
    expect(w.api.panelOpen()).toBe(true);
    w.api.togglePanel();
    expect(w.api.panelOpen()).toBe(false);
  });
});

describe('метки — попап на карте', () => {
  it('попап встаёт там, где узел на экране', () => {
    const w = wired({}, [msg()]);
    w.api.openPop('C1R1');
    expect(w.pop.raw.shown).toBe(true);
    expect(w.pop.raw.style.left).toBe('120px');
    expect(w.pop.raw.style.top).toBe('240px');
  });

  it('метки на этой провинции нет — попапа тоже нет', () => {
    const w = wired({}, [msg({ ping: 'C2R2' })]);
    w.api.openPop('C1R1');
    expect(w.pop.raw.shown).toBe(false);
  });

  it('«перейти» ведёт камеру и закрывает попап', () => {
    const w = wired({}, [msg()]);
    w.api.openPop('C1R1');
    w.pop.clickOn({ loc: 'C1R1' }, '.pp-jump');
    expect(w.camera).toEqual([['jump', 'C1R1']]);
    expect(w.pop.raw.shown).toBe(false);
  });

  it('снятие из попапа убирает свою метку', () => {
    const w = wired({}, [msg()]);
    w.api.openPop('C1R1');
    w.pop.clickOn({ loc: 'C1R1' }, '.pp-del');
    expect(w.messages()).toEqual([]);
    expect(w.pop.raw.shown).toBe(false);
  });
});
