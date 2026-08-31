import { readFileSync } from 'node:fs';
import { describe, it, expect, beforeAll } from 'vitest';
import { setLocale, tData } from '../../localization/runtime';
import { newGame, data, DAY, HOUR, order, researchTech } from './game';
import type { Action, GameState } from '../../packages/shared-core/src/index';
import {
  TECH_BRANCHES,
  branchLabel,
  fmtClock,
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

// CONV-5: пилюля слотов и редьюсер должны называть ОДНО число. Раньше пилюля считала
// бонус совета своей копией формулы, а `scientistModule` в сборке прототипа не было —
// хук `research.slots` оставался пустым, редьюсер выдавал два слота, а игрок с Полиматом
// читал на экране «слоты 0/3» и получал отказ на третьем исследовании.
describe('дерево технологий — слоты исследования (CONV-5)', () => {
  /** Партия, где место p1 держит в совете учёного с `slotBonus`. Казна набита
   *  намеренно: без неё цикл ниже упирается в `E_INSUFFICIENT` на втором же узле и
   *  меряет не слоты, а стоимость исследований — обе ветки дали бы «2» и тест прошёл
   *  бы, ничего не проверив. */
  function withCouncil(ids: string[]): GameState {
    const s = newGame();
    const seat = s.players['p1'];
    if (seat) {
      seat.scientists = ids.map((id) => ({ id, level: 1 }));
      for (const r of data.resources) seat.resources[r] = 1_000_000;
    }
    return s;
  }
  const polymath = Object.keys(data.scientists).find(
    (id) => (data.scientists[id]?.slotBonus ?? 0) > 0,
  )!;
  /** Сколько слотов НАЗЫВАЕТ интерфейс — читаем из отрисованной пилюли. */
  const shownSlots = (s: GameState): number => {
    const { api, body } = wire({}, s);
    api.open();
    const m = /слоты \d+\/(\d+)/.exec(body.html());
    if (!m) throw new Error('пилюля слотов не найдена в разметке');
    return Number(m[1]);
  };
  /** Сколько слотов ДАЁТ редьюсер — заводим исследования, пока не откажет. */
  const grantedSlots = (s: GameState): number => {
    let cur = s;
    let n = 0;
    for (const id of Object.keys(data.technologies).filter((i) => !i.startsWith('meta_'))) {
      const r = order(cur, researchTech('p1', id), cur.time);
      if (r.error === 'E_RESEARCH_SLOTS_FULL') break;
      if (r.error) continue; // узел закрыт по другой причине (prereq, day-гейт) — не про слоты
      cur = r.state;
      n++;
    }
    return n;
  };

  it('без бонусного учёного — базовые два, и обещание совпадает с выдачей', () => {
    const s = withCouncil([]);
    expect(shownSlots(s)).toBe(2);
    expect(grantedSlots(s)).toBe(2);
  });

  it('с учёным на +слот интерфейс обещает три — и редьюсер их даёт', () => {
    const s = withCouncil([polymath]);
    expect(shownSlots(s)).toBe(3);
    expect(grantedSlots(s)).toBe(3); // до CONV-5 здесь было 2 — обещанный слот не выдавался
  });
});

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

  it('обратный отсчёт закреплённой шапки — ч:мм:сс, часы отбрасываются, минус не течёт', () => {
    expect(fmtClock(5 * 3600_000)).toBe('5:00:00');
    expect(fmtClock(38 * 60_000 + 12_000)).toBe('38:12'); // «0:38:12» читается хуже
    expect(fmtClock(-1)).toBe('00:00'); // просроченный срок — ноль, а не «-00:01»
  });

  it('цена — те же чипы cost(), что и на всех других поверхностях', () => {
    expect(techCost({ metal: 40 })).toContain('rc-metal');
    expect(techCost({ metal: 40 })).toContain('<svg'); // единая SVG-иконка, не глиф
    const two = techCost({ metal: 40, credits: 10 });
    expect(two).toContain('rc-metal');
    expect(two).toContain('rc-credits');
    expect(techCost({})).toBe('');
  });

  it('цена с казной подсвечивает нехватку прямо в модалке технологии', () => {
    const html = techCost({ metal: 40 }, { metal: 15 });
    expect(html).toContain('short');
    expect(html).toContain('−25');
  });

  it('список ветки показывает ВСЕ её узлы — ни один не теряется по дороге', () => {
    // TT-4: раскладку колонок правили руками, и опечатка в id тихо роняла узел
    // в автоколонку. Списку карта не нужна — но проверка «все узлы на месте»
    // нужна тем более: теперь единственный источник строк — сами данные.
    for (const b of TECH_BRANCHES) {
      const html = techTreeHtml(newGame(), 'p1', b.key, null);
      const ids = Object.keys(TECHS).filter((id) => (TECHS[id]!.branch ?? 'space') === b.key);
      for (const id of ids) expect(html, `${b.key}/${id}`).toContain(`data-tech="${id}"`);
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

  // RULES-4. Клиент больше не держит СВОЙ перебор типов условий — он форвардит вопрос
  // в ядро. Раньше перебор покрывал 2 типа из 5, и узел с любым из этих трёх читался бы
  // как запертый НАВСЕГДА, хотя ядро исследование разрешает. В живом каталоге таких
  // условий сегодня нет, поэтому баг был латентным — и тем опаснее для автора контента.
  it('условия, которых прежняя копия не знала, считаются по-настоящему', () => {
    const s = newGame();
    const home = Object.values(s.planets).find((p) => p.owner === 'p1')!;
    const built = home.buildings[0]!.type; // на старте у мира уже есть постройки
    expect(techCondOk(s, 'p1', { type: 'has_building', building: built, min: 1 } as never)).toBe(
      true,
    );
    expect(techCondOk(s, 'p1', { type: 'has_building', building: built, min: 99 } as never)).toBe(
      false,
    );
    expect(
      techCondOk(s, 'p1', { type: 'has_unit', unit: 'нет-такого-юнита', min: 1 } as never),
    ).toBe(false);
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

  it('вкладки идут СЕТКОЙ, а не лентой с прокруткой — все пять веток видны сразу', () => {
    // Сторож над CSS: у ленты вкладки уезжали за край и до дальних веток надо было
    // досвайпывать. `grid-template-columns` на `.tt-tabs` — то, что это чинит.
    const css = readFileSync(new URL('../build.mjs', import.meta.url), 'utf8');
    const rule = css.match(/\n\.tt-tabs\{([^}]*)\}/);
    expect(rule).not.toBeNull();
    expect(rule![1]).toContain('grid-template-columns');
    expect(rule![1]).not.toContain('overflow-x:auto');
  });

  it('вкладка несёт счётчик «готово/всего», и он двигается с исследованием', () => {
    // Навигация без клика: где ещё осталось что исследовать — видно с вкладки.
    const fresh = techTreeHtml(s, 'p1', 'space', null);
    const m = fresh.match(/data-ttab="space"><span>[^<]*<\/span><i class="tt-cnt">(\d+)\/(\d+)<\/i>/);
    expect(m).not.toBeNull();
    expect(m![1]).toBe('0');
    const total = Number(m![2]);
    expect(total).toBeGreaterThan(0);
    const st = newGame();
    st.players.p1!.technologies = {
      completed: [firstOf('space')],
      active: [],
      points: 0,
    } as never;
    const after = techTreeHtml(st, 'p1', 'space', null);
    expect(after).toContain(`<i class="tt-cnt">1/${total}</i>`);
  });

  it('узел «ждёт родителя» называет РОДИТЕЛЯ, а не просто «закрыто»', () => {
    // Причины разные — и лекарства разные: исследовать родителя vs подождать день.
    // Строка обязана назвать лекарство, иначе игроку снова придётся открывать досье.
    const chained = Object.entries(data.technologies).find(
      ([id, td]) => !id.startsWith('meta_') && (td.prerequisites ?? []).length > 0,
    );
    expect(chained).toBeDefined();
    const [cid, ctd] = chained!;
    const parent = ctd.prerequisites![0]!;
    const html = techTreeHtml(s, 'p1', ctd.branch ?? 'space', null);
    const at = html.indexOf(`data-tech="${cid}"`);
    const node = html.slice(at - 80, at + 400);
    expect(node).toContain('st-chain');
    expect(node).toContain(tData(data.technologies[parent]!.name));
  });

  it('узлы сгруппированы ярусами, и заголовок яруса не повторяется', () => {
    // TT-4: ярусы заменили рельсу дней. Порядок строк задаёт tier, поэтому дубль
    // заголовка означал бы, что сортировка разъехалась и узлы одного яруса разбиты.
    const html = techTreeHtml(s, 'p1', 'space', null);
    const heads = [...html.matchAll(/<div class="tt-tierh">([^<]*)<\/div>/g)].map((m) => m[1]!);
    expect(heads.length).toBeGreaterThan(1);
    expect(new Set(heads).size).toBe(heads.length);
    expect(heads[0]).toContain('I'); // римская цифра яруса, а не голое число
  });

  it('day-гейт не пропал вместе с рельсой — он назван ПРИЧИНОЙ замка в строке', () => {
    const gated = Object.keys(TECHS).find((id) => (TECHS[id]!.dayGate ?? 0) > 0)!;
    const day = (TECHS[gated]!.dayGate ?? 0) + 1;
    const html = techTreeHtml(s, 'p1', TECHS[gated]!.branch ?? 'space', null);
    const row = html.slice(html.indexOf(`data-tech="${gated}"`));
    expect(row.slice(0, 400)).toContain(String(day));
    expect(html).toContain('tt-st lock');
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
    // ETA видна прямо в СТРОКЕ, а не только в досье
    expect(html).toContain('tt-st run');
    // …и вынесена в закреплённую шапку — ради неё экран и открывают повторно
    expect(html).toContain('tt-now');
    expect(html).toContain('5:00:00');
  });

  it('без идущего исследования закреплённой шапки нет', () => {
    expect(techTreeHtml(s, 'p1', 'space', null)).not.toContain('tt-now');
  });

  it('кнопка «исследовать» живёт в самой строке и гаснет без казны', () => {
    // TT-4: раньше про доступность говорило свечение узла, а взять его можно было
    // только через досье. Теперь приказ — в один тап из списка.
    const st = newGame();
    const id = firstOf('space');
    const td = data.technologies[id]!;
    st.players.p1!.resources = Object.fromEntries(
      Object.entries(td.cost).map(([k, v]) => [k, (v as number) * 2]),
    );
    expect(techTreeHtml(st, 'p1', 'space', null)).toMatch(
      new RegExp(`tt-take" data-go="${id}">`),
    );
    st.players.p1!.resources = {};
    expect(techTreeHtml(st, 'p1', 'space', null)).toContain(`data-go="${id}" disabled`);
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
    win.fire(ttClick('.tt-item', { tech: firstOf('space') }));
    expect(body.html()).toContain('tt-modal');
    win.fire(ttClick('[data-mclose]'));
    expect(body.html()).not.toContain('tt-modal');
  });

  it('смена вкладки закрывает открытое досье, повторный тык по той же — нет', () => {
    const { api, win, body } = wire();
    api.open();
    win.fire(ttClick('.tt-item', { tech: firstOf('space') }));
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
    win.fire(ttClick('[data-go]', { go: id }));
    expect(sent).toHaveLength(1);
    expect(sent[0]!.type).toBe('technology.research');
    expect(sent[0]!.playerId).toBe('p1');
    expect(sent[0]!.payload).toMatchObject({ technology: id });
  });

  it('кнопка в СТРОКЕ шлёт приказ и НЕ открывает досье поверх него', () => {
    // Кнопка лежит внутри кликабельной строки: без раннего выхода тап давал бы и
    // приказ, и модалку — игрок получал бы окно там, где просил только «взять».
    const st = newGame();
    const id = firstOf('space');
    st.players.p1!.resources = Object.fromEntries(
      Object.keys(TECHS[id]!.cost as Record<string, number>).map((k) => [k, 9999]),
    );
    const { api, win, body, sent } = wire({}, st);
    api.open();
    win.fire(ttClick('[data-go]', { go: id }));
    expect(sent).toHaveLength(1);
    expect(body.html()).not.toContain('tt-modal');
  });

  it('открытие сбрасывает прошлое досье — новое окно начинается чистым', () => {
    const { api, win, body } = wire();
    api.open();
    win.fire(ttClick('.tt-item', { tech: firstOf('space') }));
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
    win.fire(ttClick('.tt-item', { tech: firstOf('space') }));
    win.fire({ classList: { contains: (c: string) => c === 'tw-close' }, closest: () => null });
    expect(api.isOpen()).toBe(false);
    api.open();
    expect(body.html()).not.toContain('tt-modal');
  });
});

// --- досье без мигания (баг живого плейтеста) ---------------------------------
// Окно живо ререндерится каждые ~500мс; анимация появления обязана играть ТОЛЬКО
// на реальном открытии досье (класс .pop), а неизменная разметка — вообще не
// переприсваиваться (innerHTML пересоздаёт DOM даже на идентичной строке).
describe('досье технологии — без мигания на живом ререндере', () => {
  /** fakeBody со счётчиком присваиваний innerHTML и живым .tt-mwin: присваивание
   *  «пересоздаёт» модалку (сбрасывает её классы) — как настоящий DOM. */
  function watchedBody() {
    const scroll = { scrollLeft: 0, scrollTop: 0 };
    const classes = new Set<string>();
    const mwin = {
      classList: { add: (c: string) => classes.add(c), remove: (c: string) => classes.delete(c) },
    };
    let html = '';
    let writes = 0;
    const el = {
      get innerHTML() {
        return html;
      },
      set innerHTML(v: string) {
        html = v;
        writes += 1;
        classes.clear(); // innerHTML = пересоздание DOM: прежних классов у модалки нет
      },
      querySelector: (sel: string) =>
        sel === '.tt-scroll' ? scroll : sel === '.tt-mwin' && html.includes('tt-mwin') ? mwin : null,
      html: () => html,
      writes: () => writes,
      popped: () => classes.has('pop'),
    };
    return el;
  }

  it('открытие досье ставит .pop, а кадровый ререндер не трогает DOM вовсе', () => {
    const body = watchedBody();
    const { api, win } = wire({ body: () => body as unknown as HTMLElement });
    api.open();
    win.fire(ttClick('.tt-item', { tech: firstOf('space') }));
    expect(body.html()).toContain('tt-mwin');
    expect(body.popped()).toBe(true); // анимация — на реальном открытии
    const w = body.writes();
    api.repaint(); // кадровый цикл: состояние не менялось
    api.repaint();
    expect(body.writes()).toBe(w); // разметка та же — innerHTML не переприсвоен
  });

  it('живое изменение перерисовывает досье БЕЗ повторной анимации появления', () => {
    const body = watchedBody();
    const { api, win, s } = wire({ body: () => body as unknown as HTMLElement });
    api.open();
    win.fire(ttClick('.tt-item', { tech: firstOf('space') }));
    const w = body.writes();
    // казна опустела → чипы цены получают пометку нехватки → разметка другая
    for (const k of Object.keys(s.players.p1!.resources)) s.players.p1!.resources[k] = 0;
    api.repaint();
    expect(body.writes()).toBe(w + 1);
    expect(body.popped()).toBe(false); // пересозданная модалка НЕ выпрыгивает заново
  });
});
