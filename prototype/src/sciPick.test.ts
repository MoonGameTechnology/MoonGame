import { describe, it, expect, beforeAll } from 'vitest';
import { setLocale, tData } from '../../localization/runtime';
import { data } from './prototypeData';
import {
  sciInfluenceText,
  sciPickBodyHtml,
  initSciPick,
  COUNCIL_SIZE,
  type SciPickHost,
} from './sciPick';

// REFM-18: locale pinned RU (see format.test.ts — Node has no browser language, so the
// runtime would fall back to EN and the label assertions would drift).
beforeAll(() => setLocale('ru'));

const branchLabel = (b: string) => `ветка-${b}`;
const ids = () => Object.keys(data.scientists);

/** Node has no DOM — окно только красит innerHTML, дёргает класс и делегирует клики. */
function fakeWin(): {
  root: HTMLElement;
  body: HTMLElement;
  html: () => string;
  fire: (target: unknown) => void;
  shown: () => boolean;
} {
  let handler: ((ev: unknown) => void) | null = null;
  const classes = new Set<string>();
  const body = { innerHTML: '' };
  const root = {
    classList: {
      add: (c: string) => classes.add(c),
      remove: (c: string) => classes.delete(c),
      contains: (c: string) => classes.has(c),
    },
    addEventListener: (_t: string, h: (ev: unknown) => void) => {
      handler = h;
    },
  };
  return {
    root: root as unknown as HTMLElement,
    body: body as unknown as HTMLElement,
    html: () => body.innerHTML,
    fire: (target: unknown) => handler?.({ target }),
    shown: () => classes.has('show'),
  };
}

/** Клик, чей `closest(sel)` отвечает только на тот селектор, в который мы целимся. */
function click(sel: string, dataset: Record<string, string> = {}, extra: object = {}): unknown {
  return {
    closest: (q: string) => (q === sel ? { dataset, hasAttribute: () => false } : null),
    ...extra,
  };
}

function hostOf(over: Partial<SciPickHost> = {}): SciPickHost {
  let chosen: string[] = [];
  return {
    root: () => fakeWin().root,
    body: () => fakeWin().body,
    data: () => data,
    branchLabel,
    chosen: () => chosen,
    setChosen: (v) => {
      chosen = v;
    },
    onCancel: () => {},
    ...over,
  };
}

describe('совет учёных — влияние кандидата', () => {
  it('генералист описан как генералист, без ветки', () => {
    const generalist = ids().find((id) => !data.scientists[id]!.branch);
    expect(generalist).toBeDefined();
    const text = sciInfluenceText(generalist!, data, branchLabel);
    expect(text).not.toContain('ветка-');
    expect(text.length).toBeGreaterThan(0);
  });

  it('у специалиста названа его ветка', () => {
    const spec = ids().find((id) => data.scientists[id]!.branch);
    const def = data.scientists[spec!]!;
    expect(sciInfluenceText(spec!, data, branchLabel)).toContain(`ветка-${def.branch}`);
  });

  it('неизвестный id не роняет окно, а даёт пустую строку', () => {
    expect(sciInfluenceText('нет-такого', data, branchLabel)).toBe('');
  });

  it('перечисляются только технологии, закрытые БЕЗ учёного', () => {
    const gated = Object.values(data.technologies).filter((td) =>
      (td.conditions ?? []).some((c) => c.type === 'has_scientist'),
    );
    const withGate = ids().find((id) => {
      const b = data.scientists[id]!.branch;
      return b && gated.some((td) => td.branch === b);
    });
    if (!withGate) return; // в бандле нет гейченных техов — правило проверять не на чем
    const text = sciInfluenceText(withGate, data, branchLabel);
    const mine = gated.filter((td) => td.branch === data.scientists[withGate]!.branch);
    // Имя из каталога попало в строку — ЛОКАЛИЗОВАННОЕ. Прежде тут стоял кусок
    // английского `name`, и тест был зелёным ровно потому, что перевода не было:
    // на TT-4 у технологий завелись ключи `data.*`, и сырое имя перестало доезжать.
    expect(text).toContain(tData(mine[0]!.name));
  });
});

describe('совет учёных — разметка окна', () => {
  it('пустой совет показывает два зовущих слота и гасит подтверждение', () => {
    const html = sciPickBodyHtml([], data, branchLabel);
    expect((html.match(/sp-slot empty/g) ?? []).length).toBe(COUNCIL_SIZE);
    expect(html).toContain('id="sp-go" disabled');
  });

  it('полный совет открывает подтверждение', () => {
    const html = sciPickBodyHtml(ids().slice(0, COUNCIL_SIZE), data, branchLabel);
    expect(html).not.toContain('sp-slot empty');
    expect(html).toMatch(/id="sp-go"(?! disabled)/);
  });

  it('выбранный отмечен в ростере и его карточка погашена', () => {
    const one = ids()[0]!;
    const html = sciPickBodyHtml([one], data, branchLabel);
    expect(html).toContain(`data-spadd="${one}" disabled`);
    expect(html).toContain('sp-tick');
  });

  it('полный совет гасит ВЕСЬ ростер — сначала освободи слот', () => {
    const html = sciPickBodyHtml(ids().slice(0, COUNCIL_SIZE), data, branchLabel);
    const cards = html.match(/data-spadd="[^"]+"( disabled)?/g) ?? [];
    expect(cards.length).toBe(ids().length);
    expect(cards.every((c) => c.endsWith('disabled'))).toBe(true);
  });

  it('при неполном совете свободные кандидаты доступны', () => {
    const html = sciPickBodyHtml([ids()[0]!], data, branchLabel);
    const free = (html.match(/data-spadd="[^"]+">/g) ?? []).length;
    expect(free).toBe(ids().length - 1);
  });

  it('окно предупреждает о необратимости выбора', () => {
    expect(sciPickBodyHtml([], data, branchLabel)).toContain('sp-warn');
  });

  it('каждый слот совета можно снять', () => {
    const html = sciPickBodyHtml(ids().slice(0, COUNCIL_SIZE), data, branchLabel);
    for (let i = 0; i < COUNCIL_SIZE; i++) expect(html).toContain(`data-sprm="${i}"`);
  });
});

describe('совет учёных — клики', () => {
  function wired(initial: string[] = []) {
    const win = fakeWin();
    let chosen = [...initial];
    let cancelled = 0;
    const api = initSciPick(
      hostOf({
        root: () => win.root,
        body: () => win.body,
        chosen: () => chosen,
        setChosen: (v) => {
          chosen = v;
        },
        onCancel: () => cancelled++,
      }),
    );
    return {
      win,
      api,
      get chosen() {
        return chosen;
      },
      get cancelled() {
        return cancelled;
      },
    };
  }

  it('open() показывает окно и красит его', () => {
    const w = wired();
    expect(w.win.shown()).toBe(false);
    w.api.open();
    expect(w.win.shown()).toBe(true);
    expect(w.win.html()).toContain('sp-roster');
  });

  it('выбор кандидата пополняет совет', () => {
    const w = wired();
    w.api.open();
    w.win.fire(click('[data-spadd]', { spadd: ids()[0]! }));
    expect(w.chosen).toEqual([ids()[0]!]);
  });

  it('повторный выбор того же не удваивает его в совете', () => {
    const w = wired([ids()[0]!]);
    w.api.open();
    w.win.fire(click('[data-spadd]', { spadd: ids()[0]! }));
    expect(w.chosen).toEqual([ids()[0]!]);
  });

  it('сверх двоих не берут — совет ограничен', () => {
    const w = wired(ids().slice(0, COUNCIL_SIZE));
    w.api.open();
    w.win.fire(click('[data-spadd]', { spadd: ids()[2] ?? ids()[0]! }));
    expect(w.chosen.length).toBe(COUNCIL_SIZE);
  });

  it('снятие освобождает слот', () => {
    const w = wired(ids().slice(0, COUNCIL_SIZE));
    w.api.open();
    w.win.fire(click('[data-sprm]', { sprm: '0' }));
    expect(w.chosen).toEqual([ids()[1]!]);
  });

  it('подтверждение закрывает окно только при полном совете', () => {
    const half = wired([ids()[0]!]);
    half.api.open();
    half.win.fire(click('#none', {}, { id: 'sp-go' }));
    expect(half.win.shown()).toBe(true); // неполный совет — окно держится

    const full = wired(ids().slice(0, COUNCIL_SIZE));
    full.api.open();
    full.win.fire(click('#none', {}, { id: 'sp-go' }));
    expect(full.win.shown()).toBe(false);
  });

  it('отмена закрывает окно и выводит из настройки матча', () => {
    const w = wired();
    w.api.open();
    w.win.fire(click('.sp-cancel'));
    expect(w.win.shown()).toBe(false);
    expect(w.cancelled).toBe(1);
  });

  it('чужой клик ничего не меняет', () => {
    const w = wired([ids()[0]!]);
    w.api.open();
    w.win.fire(click('.что-то-другое'));
    expect(w.chosen).toEqual([ids()[0]!]);
    expect(w.win.shown()).toBe(true);
  });
});
