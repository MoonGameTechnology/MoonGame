import { gameCss } from '../gameSheets.mjs';
import { describe, it, expect, beforeAll } from 'vitest';
import { setLocale, t, tData } from '../../localization/runtime';
import { newGame, data, DAY, HOUR, order, researchTech, advance } from './game';
import { networkSeats } from './matchSetup';
import type { Action, GameState } from '../../packages/shared-core/src/index';
import { MAX_RESEARCH_QUEUE } from '../../packages/shared-core/src/index';
import { queueTech } from '../../decisions/actions';
import { esc } from './format';
import { liveRender, plainText } from './liveTimers.fixture';
import {
  TECH_BRANCHES,
  TECH_LIVE,
  branchLabel,
  fmtClock,
  techCost,
  techCondText,
  techCondOk,
  techFx,
  techTreeHtml,
  techChipsHtml,
  initTechTree,
  type TechHost,
} from './techTree';

// REFM-9: locale pinned RU (see format.test.ts — Node has no browser language, so the
// runtime would fall back to EN and the label assertions would drift).
beforeAll(() => setLocale('ru'));
// Окно ставит живые сроки по `querySelectorAll` (`liveTimers.ts`), и с ним в подставном теле
// оживает и вспышка очереди, которой нужен `CSS.escape` браузера.
beforeAll(() => {
  (globalThis as { CSS?: { escape(s: string): string } }).CSS ??= { escape: (v) => v };
});

/** Live tech defs minus the account-perk pseudo-nodes the tree never shows. */
/** Настоящие узлы дерева. Грант-узлы (мета-прокачка, усиления забега) окну не
 *  принадлежат: их выдают, а не исследуют. Отбор по ФЛАГУ данных `grantOnly`, а не по
 *  префиксу имени — PVR-1.4 перенёс это правило из соглашения об именах в данные. */
const TECHS = Object.fromEntries(
  Object.entries(data.technologies).filter(([, def]) => !def.grantOnly && def.ruleset === undefined),
);

/** Node with the smallest day-gate in a branch — always visible on the first day. */
function firstOf(branch: string): string {
  return Object.keys(TECHS)
    .filter((id) => (TECHS[id]!.branch ?? 'space') === branch)
    .sort((a, b) => (TECHS[a]!.dayGate ?? 0) - (TECHS[b]!.dayGate ?? 0))[0]!;
}

function fakeWin(): HTMLElement & { fire: (t: unknown) => void; shown: () => boolean; chips: () => string } {
  let handler: ((ev: unknown) => void) | null = null;
  const classes = new Set<string>();
  const chips = { innerHTML: '' };
  const el = {
    querySelector: (sel: string) => (sel === '.tt-chips' ? chips : null),
    chips: () => chips.innerHTML,
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
  return el as unknown as HTMLElement & { fire: (t: unknown) => void; shown: () => boolean; chips: () => string };
}

/** The body also answers `.tt-scroll` — the window saves/restores its scroll on repaint. */
function fakeBody(): HTMLElement & { html: () => string; scroll: () => [number, number] } {
  const scroll = { scrollLeft: 0, scrollTop: 0 };
  const el = {
    innerHTML: '',
    querySelector: (sel: string) => (sel === '.tt-scroll' ? scroll : null),
    querySelectorAll: () => [],
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
    const { api, win } = wire({}, s);
    api.open();
    const m = /слоты \d+\/(\d+)/.exec(win.chips());
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

describe('дерево технологий — линия Наместника (BAL-19)', () => {
  /** Партия основной игры: линия Наместника есть только в её дереве. */
  const mainGame = (council: string[]): GameState => {
    const s = newGame({ mapId: 'ffa-4', seats: networkSeats('ffa', 'ffa-4') });
    s.players.p1!.scientists = council.map((id) => ({ id, level: 1 }));
    delete s.players.p1!.scientist;
    return s;
  };

  it('замок узла называет учёного, а не ветку', () => {
    const cond = data.technologies.viceroyalties!.conditions[0]!;
    expect(techCondText(cond)).toBe('нужен учёный: Наместник');
  });

  it('эффект узла — планеты под управлением и надбавка к содержанию армии', () => {
    expect(techFx(data.technologies.viceroyalties!)).toBe(
      '+2 планеты под управлением · +10% содержание армии',
    );
  });

  it('без Куратора «Командование» ведёт Наместник: в ветке его линия', () => {
    const line = (council: string[], tab = 'command'): string =>
      /<div class="tt-bline">(.*?)<\/div>/.exec(techTreeHtml(mainGame(council), 'p1', tab, null))?.[1] ?? '';
    expect(line(['viceroy', 'polymath'])).toContain(`${t('tech.curator')} <b>Наместник</b>`);
    expect(line(['overseer', 'viceroy'])).toContain(`${t('tech.curator')} <b>Куратор</b>`);
    expect(line(['void_admiral', 'polymath'])).toContain(t('tech.curator.none'));
    // В чужой ветке своей линии у Наместника нет. Замков «учёный» в «Космосе» нет вовсе,
    // поэтому нет и предупреждения о них (UIX-10.7).
    const space = line(['viceroy', 'polymath'], 'space');
    expect(space).not.toContain('Наместник');
    expect(space).not.toContain('tt-lead');
  });
  it('предупреждение «без лидера» — только в ветке с замками «учёный» (UIX-10.7)', () => {
    const lead = (council: string[], tab: string): string => {
      const html = techTreeHtml(mainGame(council), 'p1', tab, null);
      return /<span class="tt-lead[^"]*">(.*?)<\/span>/.exec(html)?.[1] ?? '';
    };
    // Замки «учёный» стоят только в «Командовании».
    const gatedBranches = new Set(
      Object.values(TECHS)
        .filter((td) => (td.conditions ?? []).some((c) => c.type === 'has_scientist'))
        .map((td) => td.branch ?? 'space'),
    );
    expect([...gatedBranches]).toEqual(['command']);
    for (const b of TECH_BRANCHES.map((x) => x.key))
      expect(lead(['polymath'], b)).toBe(b === 'command' ? t('tech.curator.none') : '');
    // Выбранный лидер ветки назван и там, где замков нет.
    expect(lead(['void_admiral', 'polymath'], 'space')).toBe(
      `${t('tech.curator')} <b>${tData(data.scientists.void_admiral!.name)}</b>`,
    );
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

  it('урон теха с областью называет свой канал огня (BAL-6)', () => {
    expect(techFx(TECHS.siege_doctrine!)).toContain(`+8% ${t('tech.fx.damage-space')}`);
    expect(techFx(TECHS.combined_arms!)).toContain(`+5% ${t('tech.fx.damage-ground')}`);
  });

  it('открытое узлом — одной строкой «открывает: А, Б», слово не повторяется (UIX-10.7)', () => {
    const names = TECHS.orbital_defense_grid!.unlocks!.buildings!.map((b) =>
      tData(data.buildings[b]!.name),
    );
    expect(names).toHaveLength(2);
    expect(techFx(TECHS.orbital_defense_grid!)).toBe(t('tech.grants', { x: names.join(', ') }));
    // Юниты и здания — в одной строке, юниты первыми.
    const mixed = techFx({
      effects: {},
      unlocks: { units: ['frigate'], buildings: ['hospital'] },
    } as never);
    expect(mixed.split(t('tech.grants', { x: '' }).trim())).toHaveLength(2);
    expect(mixed).toMatch(/: .+, .+/);
    // Два здания с одним именем — имя один раз.
    const hangar = tData(data.buildings.void_hangar!.name);
    expect(tData(data.buildings.station_hangar!.name)).toBe(hangar);
    expect(techFx(TECHS.void_shipworks!)).toBe(t('tech.grants', { x: hangar }));
  });
});

describe('дерево технологий — разметка', () => {
  const s = newGame();

  it('рисует плитки всех веток и подсвечивает открытую', () => {
    const html = techTreeHtml(s, 'p1', 'ground', null);
    for (const b of TECH_BRANCHES) expect(html).toContain(`data-ttab="${b.key}"`);
    expect(html).toContain('<button class="tt-tab on" data-ttab="ground"');
    // У плитки — значок ветки, полное и короткое имя (телефон) и строка о ветке под плитками.
    expect(html).toMatch(/data-ttab="ground"[^>]*>(?:<span[^>]*>[^<]*<\/span>)*<svg/);
    expect(html).toContain(`<span class="tt-bdesc">${t('tech.branch.ground.desc')}</span>`);
  });
  it('вкладки идут СЕТКОЙ, а не лентой с прокруткой — все пять веток видны сразу', () => {
    // Сторож над CSS: у ленты вкладки уезжали за край и до дальних веток надо было
    // досвайпывать. `grid-template-columns` на `.tt-tabs` — то, что это чинит.
    const css = gameCss();
    const rule = css.match(/\n\.tt-tabs\{([^}]*)\}/);
    expect(rule).not.toBeNull();
    expect(rule![1]).toContain('grid-template-columns');
    expect(rule![1]).not.toContain('overflow-x:auto');
  });

  it('плитка ветки несёт счётчик «готово/всего», и он двигается с исследованием', () => {
    const cnt = (html: string): RegExpMatchArray | null =>
      html.match(/data-ttab="space"[\s\S]*?<i class="tt-cnt">(\d+)\/(\d+)<\/i>/);
    const m = cnt(techTreeHtml(s, 'p1', 'space', null));
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
    expect(cnt(techTreeHtml(st, 'p1', 'space', null))![1]).toBe('1');
  });
  it('узел «ждёт родителя» заперт, а его окошко называет РОДИТЕЛЯ', () => {
    // Причины разные — и лекарства разные: исследовать родителя vs подождать день.
    const chained = Object.entries(TECHS).find(([, td]) => (td.prerequisites ?? []).length > 0);
    expect(chained).toBeDefined();
    const [cid, ctd] = chained!;
    const parent = ctd.prerequisites![0]!;
    const html = techTreeHtml(s, 'p1', ctd.branch ?? 'space', null);
    expect(html).toMatch(new RegExp(`class="tt-item st-chain[^"]*" data-tech="${cid}"`));
    const modal = techTreeHtml(s, 'p1', ctd.branch ?? 'space', cid);
    const why = /<div class="tt-mwhy">(.*?)<\/div>/.exec(modal)?.[1] ?? '';
    expect(why).toContain(esc(tData(data.technologies[parent]!.name)));
    // «Нужно» — ссылка на родителя: нажатие открывает его окошко.
    expect(modal).toContain(`data-pick="${parent}"`);
  });
  it('ветка — дерево: ряды по глубине, предок в ветке всегда выше потомка', () => {
    for (const b of TECH_BRANCHES.map((x) => x.key)) {
      const html = techTreeHtml(s, 'p1', b, null);
      const rows = [...html.matchAll(/<div class="tt-row">(.*?)<\/div>(?=<div class="tt-row">|<\/div><\/div>)/g)].map(
        (r) => [...r[1]!.matchAll(/data-tech="([^"]+)"/g)].map((x) => x[1]!),
      );
      expect(rows.length, b).toBeGreaterThan(0);
      const rowOf = new Map(rows.flatMap((r, i) => r.map((id) => [id, i] as const)));
      expect(rowOf.size, b).toBe(Object.keys(TECHS).filter((id) => (TECHS[id]!.branch ?? 'space') === b).length);
      for (const [id, row] of rowOf)
        for (const p of TECHS[id]!.prerequisites ?? [])
          if (rowOf.has(p)) expect(rowOf.get(p)!, `${p} → ${id}`).toBeLessThan(row);
    }
    // Ярусов («Ярус I», «T1») больше нет: ярус ничего не запирает.
    expect(techTreeHtml(s, 'p1', 'space', null)).not.toContain('tt-tierh');
  });
  it('day-гейт назван на плитке узла: «день N»', () => {
    const gated = Object.keys(TECHS).find((id) => (TECHS[id]!.dayGate ?? 0) > 0 && !(TECHS[id]!.prerequisites ?? []).length)
      ?? Object.keys(TECHS).find((id) => (TECHS[id]!.dayGate ?? 0) > 0)!;
    const st = newGame();
    st.players.p1!.technologies = { completed: TECHS[gated]!.prerequisites ?? [], active: [], points: 0 } as never;
    const day = (TECHS[gated]!.dayGate ?? 0) + 1;
    const html = techTreeHtml(st, 'p1', TECHS[gated]!.branch ?? 'space', null);
    const tile = html.slice(html.indexOf(`data-tech="${gated}"`));
    expect(tile.slice(0, tile.indexOf('</button>'))).toContain(t('tech.node.day', { n: day }));
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

  it('окошко закрытого узла предлагает НЕ кнопку исследования, а причину', () => {
    const locked = Object.keys(TECHS).find((id) => (TECHS[id]!.dayGate ?? 0) > 0)!;
    const html = techTreeHtml(s, 'p1', TECHS[locked]!.branch ?? 'space', locked);
    expect(html).toContain('tt-modal');
    expect(html).toContain('tt-mwhy');
    expect(html).not.toContain(`data-go="${locked}"`);
  });
  it('исследованный узел остаётся в дереве зелёным: без него рвались бы связи', () => {
    const st = newGame();
    const id = firstOf('space');
    st.players.p1!.technologies = { completed: [id], active: [], points: 0 } as never;
    const list = techTreeHtml(st, 'p1', 'space', null);
    expect(list).toMatch(new RegExp(`class="tt-item st-done[^"]*" data-tech="${id}"`));
    const html = techTreeHtml(st, 'p1', 'space', id);
    expect(html).not.toContain(`data-go="${id}"`);
    expect(html).toContain(`tt-mbtn wait btn-main" disabled>✓ ${t('tech.action.done')}`);
  });
  it('ветка, изученная целиком, — все плитки зелёные', () => {
    const st = newGame();
    const all = Object.keys(TECHS).filter((id) => (TECHS[id]!.branch ?? 'space') === 'space');
    st.players.p1!.technologies = { completed: all, active: [], points: 0 } as never;
    const html = techTreeHtml(st, 'p1', 'space', null);
    expect(html.match(/class="tt-item st-done/g)?.length).toBe(all.length);
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
    expect(techTreeHtml(rich, 'p1', 'space', id)).toContain(`tt-mbtn btn-main" data-go="${id}">`);
    const noHtml = techTreeHtml(poor, 'p1', 'space', id);
    expect(noHtml).not.toContain(`data-go="${id}"`);
    expect(noHtml).toContain(`disabled>${t('tech.action.no-resources')}`);
    // На плитке — «нет ресурсов» вместо срока.
    expect(techTreeHtml(poor, 'p1', 'space', null)).toContain(t('tech.node.no-res'));
  });
  it('идущее исследование: слот с полосой и сроком, кольцо и срок на плитке', () => {
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
    expect(html).toContain('tt-mbtn wait'); // повторно запустить нельзя
    expect(html).toContain(`<i class="tt-ring" data-since="${st.time - 5 * HOUR}" data-at="${st.time + 5 * HOUR}"></i>`);
    // Доля и сроки — живые узлы: игрок видит их после патча, а разметка с часами не меняется
    // (иначе окно пересобиралось бы каждые полсекунды вместе с кнопками под курсором).
    const seen = liveRender(html, st.time, TECH_LIVE);
    expect(seen).toContain('style="width:50%"'); // полоса слота ровно посередине
    expect(plainText(seen)).toContain(`⏳ ${t('tech.action.running-clock', { n: '5:00:00' })}`);
    expect(seen).toContain(`data-now="${id}"`);
    st.time += 90 * 60_000;
    expect(techTreeHtml(st, 'p1', 'space', id)).toBe(html);
    expect(liveRender(html, st.time, TECH_LIVE)).toContain('3:30:00');
  });
  it('без идущего исследования все слоты свободны и зовут выбрать тему', () => {
    const html = techTreeHtml(s, 'p1', 'space', null);
    expect(html).not.toContain('data-now=');
    expect(html).toContain(t('tech.slot.free.pick'));
  });
  it('«Исследовать» в окошке узла; без казны — «В очередь», с полной очередью — причина', () => {
    const st = newGame();
    const id = firstOf('space');
    const td = data.technologies[id]!;
    st.players.p1!.resources = Object.fromEntries(
      Object.entries(td.cost).map(([k, v]) => [k, (v as number) * 2]),
    );
    expect(techTreeHtml(st, 'p1', 'space', id)).toContain(`tt-mbtn btn-main" data-go="${id}">`);
    st.players.p1!.resources = {};
    const broke = techTreeHtml(st, 'p1', 'space', id);
    expect(broke).toContain(`data-q="${id}"`);
    expect(broke).not.toContain(`data-go="${id}"`);
    // Очередь полна — поставить в план нельзя, остаётся выключенная кнопка с причиной.
    const p1 = st.players.p1!;
    p1.technologies = {
      completed: p1.technologies?.completed ?? [],
      queue: Object.keys(TECHS)
        .filter((x) => x !== id)
        .slice(0, MAX_RESEARCH_QUEUE),
    };
    const full = techTreeHtml(st, 'p1', 'space', id);
    expect(full).toContain(`disabled>${t('tech.action.no-resources')}`);
    expect(full).not.toContain(`data-q="${id}"`);
  });
  it('исчезнувший из данных узел не оставляет висящее досье', () => {
    // модалка чистится, если id больше нет в каталоге — окно не должно падать
    expect(() => techTreeHtml(s, 'p1', 'space', 'нет-такого-теха')).not.toThrow();
    expect(techTreeHtml(s, 'p1', 'space', 'нет-такого-теха')).not.toContain('tt-modal');
  });

  it('чип слотов в шапке держит кламп ядра: 2 базовых, максимум 3', () => {
    const chips = techChipsHtml(s, 'p1');
    expect(chips).toMatch(/tt-chip/);
    expect(chips).toMatch(/[023]\s*\/\s*[23]/);
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

  // Путь от запертого юнита, здания или крепости: окно открывается сразу на досье нужной
  // технологии и на её ветке — без поиска по вкладкам.
  it('open(focus) открывает досье технологии на её ветке; простой open() — без досье', () => {
    const { api, body } = wire();
    const id = firstOf('command');
    api.open(id);
    expect(body.html()).toContain('<button class="tt-tab on" data-ttab="command"');
    expect(body.html()).toContain('tt-modal');
    expect(body.html()).toContain(esc(tData(data.technologies[id]!.name)));
    api.open();
    expect(body.html()).not.toContain('tt-modal');
    api.open('нет-такой-технологии'); // чужой id — просто окно, а не пустое досье
    expect(body.html()).not.toContain('tt-modal');
  });

  it('переключение вкладки перерисовывает дерево другой ветки', () => {
    const { api, win, body } = wire();
    api.open();
    expect(body.html()).toContain('<button class="tt-tab on" data-ttab="space"');
    win.fire(ttClick('.tt-tab', { ttab: 'command' }));
    expect(body.html()).toContain('<button class="tt-tab on" data-ttab="command"');
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
      querySelectorAll: () => [],
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

// CONV-16. Правило («капстоун ветки гейтит учёный этой ветки») записано в одноимённом
// кирпиче `docs/backlog.md`; оно тихо сломалось, когда состав учёных сократили до трёх:
// гейт `has_scientist { branch }` выполним, только если в каталоге ЕСТЬ учёный этой
// ветки (`technology.ts` требует совпадения `def.branch`). Веток пять, учёных три —
// значит три капстоуна нельзя было открыть НИКОГДА, и заметить это можно было лишь
// сыграв до 12-го дня. Сторож ловит любой такой гейт на сборке, а не в партии.
describe('гейты технологий по учёному достижимы (CONV-16)', () => {
  it('нет условия `has_scientist` на ветку, у которой нет учёного', () => {
    // `flatMap`, а не `filter` с предикатом: `branch` — это union литералов веток,
    // и предикат `b is string` шире параметра, что tsc отвергает (TS2677).
    const branches = new Set(
      Object.values(data.scientists).flatMap((s) => (s.branch === undefined ? [] : [s.branch])),
    );
    const unreachable = Object.entries(data.technologies)
      .flatMap(([id, def]) =>
        (def.conditions ?? []).map((c) =>
          c.type === 'has_scientist' && c.branch !== undefined && !branches.has(c.branch)
            ? `${id} → ветка '${c.branch}'`
            : '',
        ),
      )
      .filter((s) => s !== '')
      .sort();
    expect(unreachable, 'технологию не откроет никто: учёного такой ветки в каталоге нет').toEqual(
      [],
    );
  });
});

/**
 * PVR-6.17 — окно в забеге Sector Zero (заказ владельца 2026-09-24: «технологии из
 * сетевой игры надо переделать под Sector Zero — там дневные ограничения, Хранитель,
 * которого нет, и т. д.»). Правила — `state.techRules` из режима, окно их только читает.
 */
describe('techTreeHtml — дерево забега (PVR-6.17)', () => {
  const run = (): GameState => {
    const st = newGame();
    st.techRules = { dayGates: false, exclude: ['ai_stewardship'] };
    delete st.players.p1!.scientists; // совета учёных у забега нет
    return st;
  };
  const allTabs = (st: GameState): string =>
    TECH_BRANCHES.map((b) => techTreeHtml(st, 'p1', b.key, null)).join('');

  it('«Хранителя» нет ни в ветке, ни в счётчике вкладки', () => {
    const html = techTreeHtml(run(), 'p1', 'command', null);
    expect(html).not.toContain('data-tech="ai_stewardship"');
    const commandIds = Object.keys(TECHS).filter(
      (id) => TECHS[id]!.branch === 'command' && id !== 'ai_stewardship',
    );
    expect(html).toContain(`<i class="tt-cnt">0/${commandIds.length}</i>`);
    // В сетевом матче узел на месте.
    expect(techTreeHtml(newGame(), 'p1', 'command', null)).toContain('data-tech="ai_stewardship"');
  });

  it('ни замка «нужен день N», ни счётчика дней', () => {
    const html = allTabs(run());
    expect(html).not.toContain('st-gate');
    expect(techChipsHtml(run(), 'p1')).not.toContain(t('tech.day', { n: 1 }));
    // Окошко узла с воротами дня: ни «с дня N» в «Нужно», ни замка.
    const gated = Object.keys(TECHS).find(
      (id) => (TECHS[id]!.dayGate ?? 0) > 0 && !TECHS[id]!.prerequisites?.length && id !== 'ai_stewardship',
    )!;
    const dossier = techTreeHtml(run(), 'p1', TECHS[gated]!.branch ?? 'space', gated);
    expect(dossier).not.toContain('tt-mwhy');
    expect(dossier).not.toContain('tt-cond');
    // Сетевой матч держит и то и другое.
    expect(techChipsHtml(newGame(), 'p1')).toContain(t('tech.day', { n: 1 }));
    expect(allTabs(newGame())).toContain('st-gate');
  });
  it('строки про лидера ветки нет, когда замков «учёный» в дереве не осталось', () => {
    expect(allTabs(run())).not.toContain('tt-lead');
    expect(allTabs(newGame())).toContain('tt-lead');
  });
});


// RQ-1: очередь исследований в окне. Правила (кто стартует, чего ждёт тема, можно ли
// поднять её выше) решает ядро — окно обязано показать ИМЕННО его ответ и отправить
// ровно те приказы, которые ядро примет.
describe('дерево технологий — очередь исследований (RQ-1)', () => {
  /** Корень ветки космоса без замков и его прямой потомок без дня — из живых данных. */
  const root = 'orbital_defense_grid';
  const child = 'void_fortification';
  const grandchild = 'void_shipworks';

  function richGame(): GameState {
    const st = newGame();
    for (const r of data.resources) st.players.p1!.resources[r] = 1_000_000;
    return st;
  }
  /** Заняты оба базовых слота — тем, что к очереди отношения не имеет. */
  function busy(): GameState {
    let st = richGame();
    for (const id of ['industrial_automation', 'combined_arms']) {
      const r = order(st, researchTech('p1', id), st.time);
      if (r.error) throw new Error(`${id}: ${r.error}`);
      st = r.state;
    }
    return st;
  }
  function queued(st: GameState, ...ids: string[]): GameState {
    let cur = st;
    for (const id of ids) {
      const r = order(cur, queueTech('p1', id), cur.time);
      if (r.error) throw new Error(`${id}: ${r.error}`);
      cur = r.state;
    }
    return cur;
  }

  it('данные теста живые: корень без замков, потомок и внук идут цепочкой', () => {
    expect(TECHS[root]?.prerequisites ?? []).toEqual([]);
    expect(TECHS[child]?.prerequisites).toEqual([root]);
    expect(TECHS[grandchild]?.prerequisites).toEqual([child]);
  });

  it('слоты заняты — в окошке вместо «Исследовать» кнопка «В очередь»', () => {
    const html = techTreeHtml(busy(), 'p1', 'space', root);
    expect(html).toContain(`data-q="${root}"`);
    expect(html).not.toContain(`data-go="${root}"`);
    expect(html).toContain(t('tech.action.slots-full'));
  });
  it('свободный слот и казна — главная кнопка остаётся «Исследовать», без лишней очереди', () => {
    const html = techTreeHtml(richGame(), 'p1', 'space', root);
    expect(html).toContain(`data-go="${root}">`);
    expect(html).not.toContain(`data-q="${root}"`);
  });
  it('без казны в окошке «В очередь», а нехватку называет цена (UIX-10.7)', () => {
    const st = newGame();
    st.players.p1!.resources = {};
    const html = techTreeHtml(st, 'p1', 'space', root);
    expect(html).toContain(`data-q="${root}"`);
    expect(html).not.toContain(`data-go="${root}"`);
    expect(html).toContain('class="lack"');
  });
  it('очередь видна полосой: номер, имя и чего ждёт каждая тема', () => {
    const st = queued(busy(), root, child);
    const html = techTreeHtml(st, 'p1', 'ground', null); // полоса не зависит от вкладки
    expect(html).toContain('tt-queue');
    expect(html).toContain(`<i>2/${MAX_RESEARCH_QUEUE}</i>`);
    const rootRow = html.slice(html.indexOf(`data-qitem="${root}"`));
    expect(rootRow.slice(0, 300)).toContain('<em>1</em>');
    expect(rootRow.slice(0, 400)).toContain(t('tech.queue.wait.slot'));
    const childRow = html.slice(html.indexOf(`data-qitem="${child}"`));
    expect(childRow.slice(0, 400)).toContain(
      t('tech.queue.wait.prerequisite', { x: tData(TECHS[root]!.name) }),
    );
  });

  it('стрелка, которая подняла бы тему над её предком, погашена заранее', () => {
    const st = queued(busy(), root, child, 'orbital_logistics');
    const html = techTreeHtml(st, 'p1', 'space', null);
    const btn = (id: string, to: number): string => {
      const at = html.indexOf(`data-qmove="${id}" data-to="${to}"`);
      expect(at, `${id}→${to}`).toBeGreaterThan(-1);
      return html.slice(at, html.indexOf('>', at));
    };
    expect(btn(child, 0)).toContain('disabled'); // над своим предком — нельзя
    expect(btn(root, 1)).toContain('disabled'); // предок под потомка — нельзя
    expect(btn('orbital_logistics', 1)).not.toContain('disabled'); // независимая — можно
    expect(btn(child, 2)).not.toContain('disabled');
  });

  it('крестик предупреждает, что снимет и зависящие темы', () => {
    const st = queued(busy(), root, child, grandchild);
    const html = techTreeHtml(st, 'p1', 'space', null);
    const at = html.indexOf(`data-dq="${root}"`);
    const tag = html.slice(at, html.indexOf('>', at));
    expect(tag).toContain(tData(TECHS[child]!.name));
    expect(tag).toContain(tData(TECHS[grandchild]!.name));
  });

  it('тема в очереди: плитка называет место, окошко предлагает убрать', () => {
    const st = queued(busy(), root, child);
    const list = techTreeHtml(st, 'p1', 'space', null);
    const tile = list.slice(list.indexOf(`class="tt-item st-queued" data-tech="${child}"`));
    expect(tile.slice(0, tile.indexOf('</button>'))).toContain('№2');
    const dossier = techTreeHtml(st, 'p1', 'space', child);
    expect(dossier).toContain(t('tech.state.queued', { n: 2 }));
    expect(dossier).toContain(`tt-mq btn-second danger" data-dq="${child}"`);
    expect(dossier).not.toContain(`data-q="${child}"`);
  });
  it('потомок темы из очереди предлагает «В очередь», не пряча причину замка', () => {
    const st = queued(busy(), root);
    const html = techTreeHtml(st, 'p1', 'space', child);
    expect(html).toContain('tt-mwhy');
    expect(html).toContain(`data-q="${child}"`);
    // Внук — нет: его предка нет ни в работе, ни в очереди (ядро ответит E_PREREQUISITE).
    expect(techTreeHtml(st, 'p1', 'space', grandchild)).not.toContain(`data-q="${grandchild}"`);
  });
  it('кнопки очереди шлют приказы ядра от текущего игрока', () => {
    const st = queued(busy(), root, child);
    const { api, win, sent } = wire({}, st);
    api.open();
    win.fire(ttClick('[data-q]', { q: 'orbital_logistics' }));
    win.fire(ttClick('[data-dq]', { dq: child }));
    win.fire(ttClick('[data-qmove]', { qmove: root, to: '1' }));
    expect(sent.map((a) => [a.type, a.playerId, a.payload])).toEqual([
      ['technology.queue', 'p1', { technology: 'orbital_logistics' }],
      ['technology.dequeue', 'p1', { technology: child }],
      ['technology.queue.move', 'p1', { technology: root, to: 1 }],
    ]);
  });

  it('телефон: очередь и совет выезжают снизу той же разметкой колонки', () => {
    const st = queued(busy(), root, child);
    const closed = techTreeHtml(st, 'p1', 'space', null);
    expect(closed).toContain('<aside class="tt-side">');
    expect(closed).not.toContain('tt-shade');
    expect(closed).toContain(`data-sheet="queue">${t('tech.queue.title')} <i>2/${MAX_RESEARCH_QUEUE}</i>`);
    const sheet = techTreeHtml(st, 'p1', 'space', null, { sheet: 'queue' });
    expect(sheet).toContain('<aside class="tt-side sheet sheet-queue">');
    expect(sheet).toContain('tt-shade');
  });
  it('тап по кнопке «Очередь» открывает панель, тень её закрывает', () => {
    const st = queued(busy(), root, child);
    const { api, win, body, sent } = wire({}, st);
    api.open();
    win.fire(ttClick('[data-sheet]', { sheet: 'queue' }));
    expect(body.html()).toContain('sheet-queue');
    win.fire(ttClick('[data-sheetclose]'));
    expect(body.html()).not.toContain('sheet-queue');
    win.fire(ttClick('[data-sheet]', { sheet: 'council' }));
    expect(body.html()).toContain('sheet-council');
    expect(sent).toEqual([]); // это вид окна, а не приказ
  });
  it('тап по строке очереди открывает её кнопки, второй тап прячет (телефон)', () => {
    const st = queued(busy(), root, child);
    const { api, win, body, sent } = wire({}, st);
    api.open();
    const row = (): string => {
      const html = body.html();
      const at = html.indexOf(`data-qitem="${child}"`);
      return html.slice(html.lastIndexOf('<div', at), at);
    };
    expect(row()).not.toContain(' sel');
    win.fire(ttClick('[data-qitem]', { qitem: child }));
    expect(row()).toContain(' sel');
    win.fire(ttClick('[data-qitem]', { qitem: child }));
    expect(row()).not.toContain(' sel');
    expect(sent).toEqual([]);
  });

  it('слот освободился — очередь в окне сдвигается так же, как в ядре', () => {
    let st = queued(busy(), root);
    expect(st.players.p1!.technologies!.queue).toEqual([root]);
    // Первая тема в слоте завершается — ядро само запускает тему из очереди.
    const first = st.players.p1!.technologies!.active![0]!;
    st = advance(st, first.completesAt).state;
    expect(st.players.p1!.technologies!.queue ?? []).toEqual([]);
    const html = techTreeHtml(st, 'p1', 'space', null);
    expect(html).not.toContain('data-qitem=');
    expect(html).toContain(`data-now="${root}"`);
  });
});

// TT-5: совет учёных и «Наука уже даёт» в левой колонке говорят только то, что делает правило.
describe('дерево технологий — совет и сумма бонусов (TT-5)', () => {
  const withCouncil = (ids: string[]): GameState => {
    const st = newGame({ mapId: 'ffa-4', seats: networkSeats('ffa', 'ffa-4') });
    st.players.p1!.scientists = ids.map((id) => ({ id, level: 1 }));
    return st;
  };
  const council = (ids: string[]): string =>
    /<section class="tt-sec tt-council">(.*?)<\/section>/.exec(techTreeHtml(withCouncil(ids), 'p1', 'space', null))?.[1] ?? '';

  it('эффект учёного — настоящий: слот, свои узлы или честное «эффекта нет»', () => {
    expect(council(['polymath'])).toContain(t('tech.council.slot', { a: 2, b: 3 }));
    expect(council(['overseer'])).toContain(tData(data.technologies.ai_stewardship!.name));
    expect(council(['viceroy'])).toContain(tData(data.technologies.viceroyalties!.name));
    const none = council(['void_admiral']);
    expect(none).toContain('class="none"');
    expect(none).toContain(t('tech.council.none', { b: branchLabel('space') }));
  });

  it('без совета (забег) нет ни секции, ни кнопки «Совет»', () => {
    const st = newGame();
    delete st.players.p1!.scientists;
    const html = techTreeHtml(st, 'p1', 'space', null);
    expect(html).not.toContain('tt-council');
    expect(html).not.toContain('data-sheet="council"');
  });

  it('«Наука уже даёт» складывает изученные бонусы по виду', () => {
    const st = newGame();
    const fresh = /<section class="tt-sec tt-fxsum">(.*?)<\/section>/.exec(techTreeHtml(st, 'p1', 'space', null))?.[1];
    expect(fresh).toContain(t('tech.fxsum.none'));
    const prod = Object.keys(TECHS).filter((id) => TECHS[id]!.effects?.productionBonus);
    expect(prod.length).toBeGreaterThan(1);
    const sum = prod.reduce((a, id) => a + TECHS[id]!.effects!.productionBonus!, 0);
    st.players.p1!.technologies = { completed: prod, active: [], points: 0 } as never;
    expect(techTreeHtml(st, 'p1', 'space', null)).toContain(
      `<b>+${Math.round(sum * 100)}%</b> ${t('tech.fx.production')}`,
    );
  });

  it('ссылка «Нужно» в окошке открывает окошко предка на его ветке', () => {
    const { api, win, body } = wire();
    const child = Object.keys(TECHS).find((id) =>
      (TECHS[id]!.prerequisites ?? []).some((p) => TECHS[p] && (TECHS[p]!.branch ?? 'space') !== (TECHS[id]!.branch ?? 'space')),
    )!;
    const parent = TECHS[child]!.prerequisites!.find((p) => (TECHS[p]!.branch ?? 'space') !== (TECHS[child]!.branch ?? 'space'))!;
    api.open(child);
    expect(body.html()).toContain(`data-pick="${parent}"`);
    win.fire(ttClick('[data-pick]', { pick: parent }));
    expect(body.html()).toContain(`<button class="tt-tab on" data-ttab="${TECHS[parent]!.branch ?? 'space'}"`);
    expect(body.html()).toContain(`aria-label="${esc(tData(TECHS[parent]!.name))}"`);
  });
});
